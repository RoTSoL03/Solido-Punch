import { CameraController, type FacingMode } from '../camera/camera'
import { GAME_CONFIG } from '../config'
import {
  createRoundState,
  getDifficulty,
  getRoundDurationSeconds,
  getScoreMultiplier,
  hasActiveShield,
  missTarget,
  scoreHit,
} from '../game/rules'
import { findAutomaticPunchTarget, findHazardContact } from '../game/collision'
import { videoPointToView } from '../math/coordinates'
import { getPerformanceProfile } from '../performance/profile'
import { drawHands } from '../rendering/landmarks'
import { TargetScene } from '../rendering/targetScene'
import { HandVision } from '../tracking/mediapipe'
import { PunchTracker } from '../tracking/punch'
import { FistReadinessGate } from '../tracking/readiness'
import { getHandOrientation } from '../tracking/fist'
import type {
  GamePhase,
  HandObservation,
  HudSnapshot,
  Point3,
  TrackedFist,
} from '../types'
import { StartupError } from './startupError'

interface EngineElements {
  video: HTMLVideoElement
  handCanvas: HTMLCanvasElement
  threeCanvas: HTMLCanvasElement
}

interface EngineCallbacks {
  onPhase: (phase: GamePhase) => void
  onHud: (snapshot: HudSnapshot) => void
  onCountdown: (count: number) => void
  onError: (error: unknown) => void
  onImpact: (hazard: boolean) => void
}

export class GameEngine {
  private readonly camera = new CameraController()
  private readonly vision = new HandVision()
  private readonly punch = new PunchTracker()
  private readonly readiness = new FistReadinessGate()
  private readonly targetScene: TargetScene
  private readonly performanceProfile = getPerformanceProfile()
  private round = createRoundState()
  private frame = 0
  private lastFrame = 0
  private lastHud = 0
  private smoothedFps = 60
  private countdownEnds = 0
  private roundStarted = 0
  private pausedAt = 0
  private phase: GamePhase = 'idle'
  private disposed = false
  private initialized = false
  private initialization: Promise<void> | null = null
  private demo = false
  private hiddenPause = false
  private debugCollisions = false
  private lastObservations: HandObservation[] = []
  private lastFists: TrackedFist[] = []
  private resizeObserver: ResizeObserver

  constructor(
    private readonly elements: EngineElements,
    private readonly callbacks: EngineCallbacks,
  ) {
    this.targetScene = new TargetScene(elements.threeCanvas)
    this.resizeObserver = new ResizeObserver(() => this.targetScene.resize())
    this.resizeObserver.observe(elements.threeCanvas)
    window.addEventListener('keydown', this.onKeyDown)
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  initialize(): Promise<void> {
    if (this.initialized) return Promise.resolve()
    if (!this.initialization) {
      this.initialization = this.initializeOnce().catch((error) => {
        this.initialization = null
        throw error
      })
    }
    return this.initialization
  }

  private async initializeOnce(): Promise<void> {
    void this.vision.initialize().catch(() => {
      // Start Camera retries if an idle preload was interrupted or failed.
    })
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
      this.failStartup(new StartupError('camera', error))
      return
    }

    try {
      await this.vision.initialize()
      this.beginHandCheck()
    } catch (error) {
      this.camera.stop()
      this.failStartup(new StartupError('tracking', error))
    }
  }

  private failStartup(error: StartupError): void {
    this.setPhase('error')
    this.callbacks.onError(error)
  }

  startKeyboardTraining(): void {
    this.demo = true
    void this.initialize().then(() => {
      if (!this.disposed) this.beginCountdown()
    })
  }

  async switchCamera(): Promise<FacingMode> {
    const facing = await this.camera.switch(this.elements.video)
    return facing
  }

  togglePause(): void {
    if (this.phase === 'playing') {
      this.pausedAt = performance.now()
      this.setPhase('paused')
    } else if (this.phase === 'paused') {
      const now = performance.now()
      const pausedDuration = now - this.pausedAt
      this.roundStarted += pausedDuration
      if (this.round.scoreMultiplierUntil > this.pausedAt)
        this.round.scoreMultiplierUntil += pausedDuration
      this.lastFrame = now
      this.setPhase('playing')
    }
  }

  restart(): void {
    this.round = createRoundState()
    this.targetScene.clear()
    this.beginCountdown()
  }

  setDemoPhase(phase: GamePhase): void {
    this.demo = true
    void this.initialize().then(() => {
      if (this.disposed) return
      this.round = createRoundState()
      this.round.score = phase === 'gameover' ? 4850 : 1250
      this.round.combo = phase === 'gameover' ? 12 : 4
      this.round.bestCombo = this.round.combo
      if (phase === 'countdown') {
        this.beginCountdown()
        this.countdownEnds = performance.now() + 2800
      } else {
        this.roundStarted = performance.now() - 18_000
        this.setPhase(phase)
        if (
          phase === 'calibrating' ||
          phase === 'playing' ||
          phase === 'paused'
        ) {
          this.lastFists = [
            {
              id: 101,
              handedness: 'Left',
              center: { x: 0.34, y: 0.72 },
              radius: 0.085,
              isFist: phase !== 'calibrating',
              speed: 0.35,
              confidence: 0.96,
              phase: 'armed',
              orientation: { x: -0.12, y: -0.18, z: -0.18 },
            },
            {
              id: 102,
              handedness: 'Right',
              center: { x: 0.66, y: 0.72 },
              radius: 0.085,
              isFist: true,
              speed: 0.35,
              confidence: 0.95,
              phase: 'armed',
              orientation: { x: -0.12, y: 0.18, z: 0.18 },
            },
          ]
          if (phase === 'playing' || phase === 'paused') {
            this.targetScene.spawnForDemo('orb', -0.35)
            this.targetScene.spawnForDemo('cube', 0.22)
            this.targetScene.spawnForDemo('hazard', 0.55)
          }
        }
      }
      this.emitHud(performance.now(), [])
    })
  }

  private beginHandCheck(): void {
    this.round = createRoundState()
    this.targetScene.clear()
    this.lastFists = []
    this.lastObservations = []
    this.readiness.reset()
    this.setPhase('calibrating')
  }

  private beginCountdown(): void {
    this.round = createRoundState()
    this.targetScene.clear()
    this.lastFists = []
    this.lastObservations = []
    this.countdownEnds =
      performance.now() + GAME_CONFIG.countdownSeconds * 1000 + 250
    this.setPhase('countdown')
  }

  private startRound(now: number): void {
    this.roundStarted = now
    this.targetScene.spawnForDemo('orb', 0)
    this.setPhase('playing')
  }

  private loop = (now: number): void => {
    if (this.disposed) return
    const active =
      this.phase === 'calibrating' ||
      this.phase === 'countdown' ||
      this.phase === 'playing'
    const frameInterval = active
      ? 1000 / this.performanceProfile.renderFps
      : 100
    if (now - this.lastFrame < frameInterval) {
      this.frame = requestAnimationFrame(this.loop)
      return
    }
    const delta = Math.min((now - this.lastFrame) / 1000, 0.1)
    this.lastFrame = now
    if (delta > 0) {
      const instantFps = Math.min(120, 1 / delta)
      this.smoothedFps += (instantFps - this.smoothedFps) * 0.12
    }
    let fists: TrackedFist[] = []

    if (this.phase === 'countdown') {
      const remaining = Math.max(
        0,
        Math.ceil((this.countdownEnds - now) / 1000),
      )
      this.callbacks.onCountdown(remaining)
      if (now >= this.countdownEnds) this.startRound(now)
    }

    if (
      this.phase === 'calibrating' ||
      this.phase === 'countdown' ||
      this.phase === 'playing'
    ) {
      const observations = this.demo ? null : this.detectHands(now)
      if (observations) {
        this.lastFists = this.punch.update(observations, now)
        this.lastObservations = this.punch.getSmoothedObservations(now)
        drawHands(
          this.elements.handCanvas,
          this.lastObservations,
          this.lastFists,
          this.targetScene.hasFistModels(),
          this.debugCollisions ? this.targetScene.snapshots() : [],
        )
      } else if (!this.demo) {
        this.lastFists = this.punch.getTrackedFists(now)
      }
      fists = this.lastFists
      if (
        this.phase === 'calibrating' &&
        !this.demo &&
        this.readiness.update(fists, now, (id) =>
          this.punch.isTrackingFresh(id, now),
        )
      ) {
        this.beginCountdown()
        fists = []
      }
      if (this.phase === 'playing') {
        const elapsed = (now - this.roundStarted) / 1000
        const remainingSeconds = Math.max(
          0,
          getRoundDurationSeconds(this.round) - elapsed,
        )
        const ratio = elapsed / GAME_CONFIG.roundDurationSeconds
        const difficulty = getDifficulty(ratio)
        this.targetScene.update(
          delta,
          ratio,
          difficulty.fallSpeed,
          difficulty.spawnInterval,
          difficulty.gravity,
          remainingSeconds,
          this.round.lives,
          (kind) => {
            if (!this.demo) missTarget(this.round, kind, now)
            if (this.round.lives <= 0) this.endRound()
          },
        )
        this.checkContacts(fists, now)
        if (elapsed >= getRoundDurationSeconds(this.round)) this.endRound()
      }
    }

    this.targetScene.updateFists(fists)
    this.targetScene.render()
    if (now - this.lastHud > GAME_CONFIG.hudUpdateMs) {
      this.emitHud(now, fists)
      this.lastHud = now
    }
    this.frame = requestAnimationFrame(this.loop)
  }

  private detectHands(now: number): HandObservation[] | null {
    const video = this.elements.video
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null
    const observations = this.vision.detect(video, now)
    if (!observations) return null
    const videoSize = {
      x: video.videoWidth || 1280,
      y: video.videoHeight || 720,
    }
    const viewSize = {
      x: this.elements.handCanvas.clientWidth,
      y: this.elements.handCanvas.clientHeight,
    }
    const mirrored = this.camera.facing === 'user'
    return observations.map((hand) => ({
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

  private checkContacts(fists: TrackedFist[], now: number): void {
    let targets: ReturnType<TargetScene['snapshots']> | null = null
    for (const hand of fists) {
      if (!this.punch.isTrackingFresh(hand.id, now)) continue
      targets ??= this.targetScene.snapshots()
      const hazard = findHazardContact(hand, targets)
      if (hazard) {
        const kind = this.targetScene.hit(hazard.id, Math.max(0.6, hand.speed))
        if (kind === 'hazard' && scoreHit(this.round, hazard.id, kind, now)) {
          this.callbacks.onImpact(true)
          if (this.round.lives <= 0) {
            this.endRound()
            return
          }
        }
      }

      if (!hand.isFist || !this.punch.canHit(hand.id, now)) continue
      const target = findAutomaticPunchTarget(hand, targets)
      if (!target) continue
      const kind = this.targetScene.hit(target.id, hand.speed)
      if (!kind || !scoreHit(this.round, target.id, kind, now)) continue
      this.punch.markHit(hand.id, now)
      this.callbacks.onImpact(false)
      if (this.round.lives <= 0) this.endRound()
    }
  }

  private keyboardPunch(): void {
    if (this.phase !== 'playing') return
    const target = this.targetScene
      .snapshots()
      .filter((item) => !item.hit && item.kind !== 'hazard')
      .sort((a, b) => b.y - a.y)[0]
    if (!target) return
    const kind = this.targetScene.hit(target.id, 1.2)
    if (kind && scoreHit(this.round, target.id, kind, performance.now()))
      this.callbacks.onImpact(false)
  }

  setDebug(enabled: boolean): void {
    this.debugCollisions = enabled
  }

  private emitHud(now: number, hands: TrackedFist[]): void {
    const effectiveNow = this.phase === 'paused' ? this.pausedAt : now
    const elapsed =
      this.phase === 'playing' || this.phase === 'paused'
        ? (effectiveNow - this.roundStarted) / 1000
        : 0
    const scoreMultiplier = getScoreMultiplier(this.round, effectiveNow)
    this.callbacks.onHud({
      score: this.round.score,
      combo: this.round.combo,
      bestCombo: this.round.bestCombo,
      lives: this.round.lives,
      time: Math.max(
        0,
        Math.ceil(getRoundDurationSeconds(this.round) - elapsed),
      ),
      fps: Math.round(this.smoothedFps),
      hands,
      activeTargets: this.targetScene.snapshots().length,
      scoreMultiplier,
      multiplierTime:
        scoreMultiplier === 2
          ? Math.max(
              0,
              Math.ceil(
                (this.round.scoreMultiplierUntil - effectiveNow) / 1000,
              ),
            )
          : 0,
      shieldActive: hasActiveShield(this.round, effectiveNow),
      shieldTime: hasActiveShield(this.round, effectiveNow)
        ? Math.max(0, Math.ceil((this.round.shieldUntil - effectiveNow) / 1000))
        : 0,
    })
  }

  private endRound(): void {
    if (this.phase === 'gameover') return
    this.setPhase('gameover')
  }

  private setPhase(phase: GamePhase): void {
    this.phase = phase
    this.callbacks.onPhase(phase)
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Space' || event.code === 'KeyF') {
      event.preventDefault()
      this.keyboardPunch()
    }
    if (event.code === 'KeyP' || event.code === 'Escape') this.togglePause()
  }

  private onVisibility = (): void => {
    if (document.hidden && this.phase === 'playing') {
      this.hiddenPause = true
      this.togglePause()
    } else if (
      !document.hidden &&
      this.hiddenPause &&
      this.phase === 'paused'
    ) {
      this.hiddenPause = false
      this.togglePause()
    }
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    window.removeEventListener('keydown', this.onKeyDown)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.resizeObserver.disconnect()
    this.camera.stop()
    this.vision.close()
    this.targetScene.dispose()
  }
}
