import { CameraController } from '../camera/camera'
import {
  COMPETITIVE_ITEM_KINDS,
  GAME_CONFIG,
  type CompetitiveItemKind,
} from '../config'
import { findAutomaticPunchTarget, findHazardContact } from '../game/collision'
import {
  getDifficulty,
  hasActiveShield,
  missTarget,
  scoreHit,
} from '../game/rules'
import {
  applyCompetitiveItem,
  chooseVersusTarget,
  createVersusPlayerState,
  getLaneSpeedMultiplier,
  getVersusWinner,
  groupHandsByLane,
  selectFallbackHands,
  type VersusPlayerState,
} from '../game/versus'
import { videoPointToView } from '../math/coordinates'
import { getPerformanceProfile } from '../performance/profile'
import { drawHands } from '../rendering/landmarks'
import { TargetScene } from '../rendering/targetScene'
import { getHandOrientation } from '../tracking/fist'
import { HandVision } from '../tracking/mediapipe'
import { PunchTracker } from '../tracking/punch'
import type {
  GamePhase,
  HandObservation,
  PlayerLane,
  Point3,
  TrackedFist,
  VersusHudSnapshot,
} from '../types'
import { StartupError } from './startupError'

interface VersusEngineElements {
  video: HTMLVideoElement
  handCanvas: HTMLCanvasElement
  threeCanvas: HTMLCanvasElement
}

interface VersusEngineCallbacks {
  onPhase: (phase: GamePhase) => void
  onHud: (snapshot: VersusHudSnapshot) => void
  onCountdown: (count: number) => void
  onError: (error: unknown) => void
  onImpact: (lane: PlayerLane, hazard: boolean) => void
}

const LANES = ['left', 'right'] as const
const otherLane = (lane: PlayerLane): PlayerLane =>
  lane === 'left' ? 'right' : 'left'

export class VersusGameEngine {
  private readonly camera = new CameraController()
  private readonly vision = new HandVision(4)
  private tracker = new PunchTracker(4)
  private readonly targetScene: TargetScene
  private readonly performanceProfile = getPerformanceProfile()
  private players: Record<PlayerLane, VersusPlayerState> = {
    left: createVersusPlayerState(),
    right: createVersusPlayerState(),
  }
  private phase: GamePhase = 'idle'
  private frame = 0
  private lastFrame = 0
  private lastHud = 0
  private smoothedFps = 30
  private countdownEnds = 0
  private roundStarted = 0
  private readySince: number | null = null
  private calibrationStarted = 0
  private poorPerformanceSince: number | null = null
  private fallbackPending = false
  private trackingMode: VersusHudSnapshot['trackingMode'] = 'four-hands'
  private spawnClocks: Record<PlayerLane, number> = { left: 0, right: 0 }
  private appliedSpeed: Record<PlayerLane, number> = { left: 1, right: 1 }
  private lastFists: TrackedFist[] = []
  private winner: PlayerLane | 'draw' | null = null
  private initialized = false
  private initialization: Promise<void> | null = null
  private disposed = false
  private pausedAt = 0
  private debugCollisions = false
  private resizeObserver: ResizeObserver

  constructor(
    private readonly elements: VersusEngineElements,
    private readonly callbacks: VersusEngineCallbacks,
  ) {
    this.targetScene = new TargetScene(elements.threeCanvas)
    this.resizeObserver = new ResizeObserver(() => this.targetScene.resize())
    this.resizeObserver.observe(elements.threeCanvas)
  }

  initialize(): Promise<void> {
    if (this.initialized) return Promise.resolve()
    this.initialization ??= this.initializeOnce().catch((error) => {
      this.initialization = null
      throw error
    })
    return this.initialization
  }

  private async initializeOnce(): Promise<void> {
    await this.targetScene.initialize()
    if (this.disposed) return
    this.initialized = true
    this.lastFrame = performance.now()
    this.frame = requestAnimationFrame(this.loop)
  }

  async startCamera(): Promise<void> {
    await this.initialize()
    this.setPhase('requesting')
    try {
      await this.camera.start(this.elements.video)
    } catch (error) {
      this.fail(new StartupError('camera', error))
      return
    }
    try {
      await this.vision.initialize()
      this.beginReadiness()
    } catch (error) {
      this.camera.stop()
      this.fail(new StartupError('tracking', error))
    }
  }

  async switchCamera(): Promise<'user' | 'environment'> {
    return this.camera.switch(this.elements.video)
  }

  restart(): void {
    this.players = {
      left: createVersusPlayerState(),
      right: createVersusPlayerState(),
    }
    this.targetScene.clear()
    this.spawnClocks = { left: 0, right: 0 }
    this.appliedSpeed = { left: 1, right: 1 }
    this.winner = null
    this.beginReadiness()
  }

  togglePause(): void {
    if (this.phase === 'playing') {
      this.pausedAt = performance.now()
      this.setPhase('paused')
    } else if (this.phase === 'paused') {
      const pausedFor = performance.now() - this.pausedAt
      this.roundStarted += pausedFor
      for (const lane of LANES) {
        const player = this.players[lane]
        if (player.speedAttackUntil > this.pausedAt)
          player.speedAttackUntil += pausedFor
        if (player.round.shieldUntil > this.pausedAt)
          player.round.shieldUntil += pausedFor
      }
      this.lastFrame = performance.now()
      this.setPhase('playing')
    }
  }

  private beginReadiness(): void {
    this.readySince = null
    this.calibrationStarted = performance.now()
    this.poorPerformanceSince = null
    this.lastFists = []
    this.setPhase('calibrating')
  }

  private beginCountdown(): void {
    this.countdownEnds = performance.now() + 3250
    this.setPhase('countdown')
  }

  private startRound(now: number): void {
    this.roundStarted = now
    this.setPhase('playing')
  }

  private loop = (now: number): void => {
    if (this.disposed) return
    const active = ['calibrating', 'countdown', 'playing'].includes(this.phase)
    const interval = active ? 1000 / this.performanceProfile.renderFps : 100
    if (now - this.lastFrame < interval) {
      this.frame = requestAnimationFrame(this.loop)
      return
    }
    const delta = Math.min((now - this.lastFrame) / 1000, 0.1)
    this.lastFrame = now
    if (delta > 0) {
      const instant = Math.min(120, 1 / delta)
      this.smoothedFps += (instant - this.smoothedFps) * 0.12
    }

    const observations = active ? this.detectHands(now) : null
    if (observations) {
      this.lastFists = this.tracker.update(observations, now)
      drawHands(
        this.elements.handCanvas,
        observations,
        this.lastFists,
        this.targetScene.hasFistModels(),
        this.debugCollisions ? this.targetScene.snapshots() : [],
      )
    } else if (active) {
      this.lastFists = this.tracker.getTrackedFists(now)
    }
    this.targetScene.updateFists(this.lastFists)

    if (this.phase === 'calibrating') {
      this.monitorPerformance(now)
      const grouped = this.activeHandsByLane(now)
      const required = this.trackingMode === 'four-hands' ? 2 : 1
      const ready = LANES.every(
        (lane) =>
          grouped[lane].filter((hand) => hand.isFist).length >= required,
      )
      if (!ready) this.readySince = null
      else this.readySince ??= now
      if (
        this.readySince !== null &&
        now - this.readySince >= GAME_CONFIG.versus.readinessHoldMs
      )
        this.beginCountdown()
    }

    if (this.phase === 'countdown') {
      this.callbacks.onCountdown(
        Math.max(0, Math.ceil((this.countdownEnds - now) / 1000)),
      )
      if (now >= this.countdownEnds) this.startRound(now)
    }

    if (this.phase === 'playing') this.updateRound(now, delta)
    else if (
      this.initialized &&
      ['idle', 'requesting', 'calibrating', 'countdown'].includes(this.phase)
    )
      this.targetScene.update(
        delta,
        0,
        0,
        Number.POSITIVE_INFINITY,
        GAME_CONFIG.physics.initialGravity,
        0,
        3,
        () => undefined,
      )

    this.targetScene.render()
    if (now - this.lastHud >= GAME_CONFIG.hudUpdateMs) {
      this.emitHud(now)
      this.lastHud = now
    }
    this.frame = requestAnimationFrame(this.loop)
  }

  private updateRound(now: number, delta: number): void {
    const elapsed = (now - this.roundStarted) / 1000
    const ratio = Math.min(
      1,
      elapsed / GAME_CONFIG.versus.difficultyRampSeconds,
    )
    const difficulty = getDifficulty(ratio)
    for (const lane of LANES) {
      const multiplier = getLaneSpeedMultiplier(this.players[lane], now)
      if (multiplier !== this.appliedSpeed[lane]) {
        this.targetScene.setLaneSpeedMultiplier(lane, multiplier)
        this.appliedSpeed[lane] = multiplier
      }
      this.spawnClocks[lane] += delta
      if (
        this.spawnClocks[lane] >= difficulty.spawnInterval &&
        this.targetScene.countLaneTargets(lane) <
          GAME_CONFIG.versus.maximumTargetsPerLane
      ) {
        this.spawnClocks[lane] = 0
        const kind = chooseVersusTarget(this.players[lane], ratio, now)
        this.targetScene.spawnForLane(
          kind,
          lane,
          difficulty.fallSpeed,
          multiplier,
        )
      }
    }

    this.targetScene.update(
      delta,
      ratio,
      difficulty.fallSpeed,
      Number.POSITIVE_INFINITY,
      difficulty.gravity,
      0,
      3,
      (kind, lane) => {
        if (lane) missTarget(this.players[lane].round, kind, now)
      },
    )
    this.checkContacts(now)
    const winner = getVersusWinner(this.players)
    if (winner) {
      this.winner = winner
      this.setPhase('gameover')
    }
  }

  private checkContacts(now: number): void {
    const grouped = this.activeHandsByLane(now)
    const targets = this.targetScene.snapshots()
    for (const lane of LANES) {
      const laneTargets = targets.filter((target) => target.lane === lane)
      for (const hand of grouped[lane]) {
        const hazard = findHazardContact(hand, laneTargets)
        if (hazard) {
          const kind = this.targetScene.hit(
            hazard.id,
            Math.max(0.6, hand.speed),
          )
          if (kind === 'hazard') {
            scoreHit(this.players[lane].round, hazard.id, kind, now)
            this.callbacks.onImpact(lane, true)
          }
        }
        const target = findAutomaticPunchTarget(hand, laneTargets)
        if (!target) continue
        const kind = this.targetScene.hit(target.id, hand.speed)
        if (!kind) continue
        if ((COMPETITIVE_ITEM_KINDS as readonly string[]).includes(kind)) {
          applyCompetitiveItem(
            this.players[lane],
            this.players[otherLane(lane)],
            kind as CompetitiveItemKind,
            now,
          )
        } else {
          scoreHit(this.players[lane].round, target.id, kind, now)
        }
        this.tracker.markHit(hand.id, now)
        this.callbacks.onImpact(lane, false)
      }
    }
  }

  private activeHandsByLane(now: number): Record<PlayerLane, TrackedFist[]> {
    const fresh = this.lastFists.filter((hand) =>
      this.tracker.isTrackingFresh(hand.id, now),
    )
    const grouped = groupHandsByLane(fresh)
    return this.trackingMode === 'one-fist'
      ? selectFallbackHands(grouped)
      : grouped
  }

  private monitorPerformance(now: number): void {
    if (
      this.trackingMode !== 'four-hands' ||
      this.fallbackPending ||
      now - this.calibrationStarted < GAME_CONFIG.versus.performanceWarmupMs
    )
      return
    const inference = this.vision.getAverageInferenceMs(
      GAME_CONFIG.versus.performanceWindowMs,
      now,
    )
    const poor =
      inference > GAME_CONFIG.versus.maximumInferenceMs ||
      this.smoothedFps < GAME_CONFIG.versus.minimumRenderFps
    if (!poor) {
      this.poorPerformanceSince = null
      return
    }
    this.poorPerformanceSince ??= now
    if (
      now - this.poorPerformanceSince <
      GAME_CONFIG.versus.performanceWindowMs
    )
      return
    this.fallbackPending = true
    void this.vision
      .reconfigure(2)
      .then(() => {
        if (this.disposed) return
        this.tracker = new PunchTracker(2)
        this.trackingMode = 'one-fist'
        this.readySince = null
      })
      .catch((error) => this.fail(new StartupError('tracking', error)))
      .finally(() => {
        this.fallbackPending = false
      })
  }

  private detectHands(now: number): HandObservation[] | null {
    const video = this.elements.video
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null
    const detected = this.vision.detect(video, now)
    if (!detected) return null
    const videoSize = {
      x: video.videoWidth || 1280,
      y: video.videoHeight || 720,
    }
    const viewSize = {
      x: this.elements.handCanvas.clientWidth,
      y: this.elements.handCanvas.clientHeight,
    }
    const mirrored = this.camera.facing === 'user'
    return detected.map((hand) => ({
      ...hand,
      orientation: getHandOrientation(
        hand.landmarks,
        hand.worldLandmarks ?? hand.landmarks,
        mirrored,
      ),
      landmarks: hand.landmarks.map((point): Point3 => ({
        ...videoPointToView(point, videoSize, viewSize, mirrored),
        z: point.z,
      })),
    }))
  }

  private emitHud(now: number): void {
    const grouped = this.activeHandsByLane(now)
    const playerSnapshot = (lane: PlayerLane) => {
      const player = this.players[lane]
      return {
        lane,
        score: player.round.score,
        combo: player.round.combo,
        lives: player.round.lives,
        shieldActive: hasActiveShield(player.round, now),
        shieldTime: hasActiveShield(player.round, now)
          ? Math.ceil((player.round.shieldUntil - now) / 1000)
          : 0,
        speedAttackTime:
          player.speedAttackUntil > now
            ? Math.ceil((player.speedAttackUntil - now) / 1000)
            : 0,
        pendingHazards: player.pendingHazards,
        hands: grouped[lane],
      }
    }
    this.callbacks.onHud({
      players: { left: playerSnapshot('left'), right: playerSnapshot('right') },
      fps: Math.round(this.smoothedFps),
      activeTargets: this.targetScene.snapshots().length,
      trackingMode: this.trackingMode,
      winner: this.winner,
    })
  }

  private setPhase(phase: GamePhase): void {
    this.phase = phase
    this.callbacks.onPhase(phase)
  }

  setDebug(enabled: boolean): void {
    this.debugCollisions = enabled
  }

  private fail(error: StartupError): void {
    this.setPhase('error')
    this.callbacks.onError(error)
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.resizeObserver.disconnect()
    this.camera.stop()
    this.vision.close()
    this.targetScene.dispose()
  }
}
