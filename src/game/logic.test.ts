import { describe, expect, it, vi } from 'vitest'
import { BACKGROUND_MUSIC_URL } from '../audio/backgroundMusic'
import {
  createRetroNoiseSamples,
  getCountdownTonePlan,
  getGameOverTonePlan,
  prepareRetroAudio,
} from '../audio/retroBreak'
import { GAME_CONFIG } from '../config'
import { getBonusSpawnProfile } from './bonusSpawning'
import { findAutomaticPunchTarget, findHazardContact } from './collision'
import {
  scoreHit,
  createRoundState,
  getDifficulty,
  getRoundDurationSeconds,
  getScoreMultiplier,
  missTarget,
} from './rules'
import { videoPointToView } from '../math/coordinates'
import { FixedStepAccumulator } from '../physics/fixedStep'
import { createPerformanceProfile } from '../performance/profile'
import { shouldDrawSkeleton } from '../rendering/landmarks'
import { classifyFist, getHandOrientation } from '../tracking/fist'
import { PunchTracker } from '../tracking/punch'
import { FistReadinessGate } from '../tracking/readiness'
import type { HandObservation, Point3, TrackedFist } from '../types'

function makeHand(closed: boolean, offsetX = 0): Point3[] {
  const points: Point3[] = Array.from({ length: 21 }, () => ({
    x: 0.5 + offsetX,
    y: 0.6,
    z: 0,
  }))
  points[0] = { x: 0.5 + offsetX, y: 0.72, z: 0 }
  const bases = [0.38, 0.46, 0.54, 0.62]
  const indices = [
    [5, 6, 7, 8],
    [9, 10, 11, 12],
    [13, 14, 15, 16],
    [17, 18, 19, 20],
  ]
  indices.forEach((finger, fingerIndex) => {
    const x = bases[fingerIndex] + offsetX
    points[finger[0]] = { x, y: 0.58, z: 0 }
    points[finger[1]] = { x, y: 0.49, z: 0 }
    points[finger[2]] = { x, y: closed ? 0.55 : 0.37, z: 0 }
    points[finger[3]] = {
      x: closed ? 0.5 + offsetX : x,
      y: closed ? 0.57 : 0.25,
      z: 0,
    }
  })
  points[1] = { x: 0.45 + offsetX, y: 0.65, z: 0 }
  points[2] = { x: 0.42 + offsetX, y: 0.61, z: 0 }
  points[3] = { x: 0.44 + offsetX, y: closed ? 0.58 : 0.55, z: 0 }
  points[4] = {
    x: closed ? 0.48 + offsetX : 0.3 + offsetX,
    y: closed ? 0.58 : 0.5,
    z: 0,
  }
  return points
}

function rotateHand(points: Point3[], radians: number): Point3[] {
  const center = { x: 0.5, y: 0.55 }
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return points.map((point) => {
    const x = point.x - center.x
    const y = point.y - center.y
    return {
      x: center.x + x * cosine - y * sine,
      y: center.y + x * sine + y * cosine,
      z: point.z,
    }
  })
}

const observation = (
  closed: boolean,
  offsetX = 0,
  handedness: HandObservation['handedness'] = 'Left',
): HandObservation => ({
  landmarks: makeHand(closed, offsetX),
  handedness,
})

describe('fist classification', () => {
  it('distinguishes an open hand from a closed fist', () => {
    expect(classifyFist(makeHand(false)).closed).toBe(false)
    expect(classifyFist(makeHand(true)).closed).toBe(true)
  })

  it('recognizes a fist at different screen rotations', () => {
    for (const angle of [Math.PI / 3, Math.PI / 2, -Math.PI / 2]) {
      expect(classifyFist(rotateHand(makeHand(true), angle)).closed).toBe(true)
      expect(classifyFist(rotateHand(makeHand(false), angle)).closed).toBe(
        false,
      )
    }
  })

  it('does not require the thumb to be perfectly tucked', () => {
    const relaxedThumb = makeHand(true)
    relaxedThumb[4] = { x: 0.34, y: 0.55, z: 0 }
    expect(classifyFist(relaxedThumb).closed).toBe(true)
  })

  it('derives roll, pitch, and yaw from the palm landmarks', () => {
    const baseline = getHandOrientation(makeHand(true))
    const rolled = getHandOrientation(rotateHand(makeHand(true), Math.PI / 3))
    expect(rolled.z - baseline.z).toBeCloseTo(-Math.PI / 3)

    const tilted = makeHand(true)
    tilted[9].z = -0.12
    tilted[5].z = -0.1
    tilted[17].z = 0.1
    const orientation = getHandOrientation(tilted)
    expect(orientation.x).toBeGreaterThan(0)
    expect(orientation.y).toBeLessThan(0)
  })

  it('replaces only closed-hand skeletons when the 3D model is ready', () => {
    const closedHand = observation(true)
    const fist = {
      id: 1,
      handedness: 'Left' as const,
      center: { x: 0.5, y: 0.535 },
      radius: 0.08,
      isFist: true,
      speed: 0.8,
      confidence: 0.95,
      phase: 'punching' as const,
      orientation: { x: 0, y: 0, z: 0 },
    }
    expect(shouldDrawSkeleton(closedHand, [fist], true)).toBe(false)
    expect(
      shouldDrawSkeleton(
        observation(false),
        [{ ...fist, isFist: false }],
        true,
      ),
    ).toBe(true)
  })
})

describe('retro impact audio', () => {
  it('uses the documented public background-music path', () => {
    expect(BACKGROUND_MUSIC_URL).toBe('/audio/background-music.mp3')
  })

  it('creates deterministic decaying 8-bit noise samples', () => {
    const first = createRetroNoiseSamples(8000, 0.1, false)
    const second = createRetroNoiseSamples(8000, 0.1, false)
    expect(first.length).toBe(800)
    expect(first).toEqual(second)
    expect(Math.abs(first[0])).toBeGreaterThan(Math.abs(first[799]))
  })

  it('reuses one audio context and prebuilt impact buffers', () => {
    let contextsCreated = 0
    let buffersCreated = 0
    class FakeAudioContext {
      readonly sampleRate = 8000
      readonly state = 'running'

      constructor() {
        contextsCreated += 1
      }

      createBuffer(_channels: number, length: number): AudioBuffer {
        buffersCreated += 1
        const samples = new Float32Array(length)
        return {
          getChannelData: () => samples,
        } as unknown as AudioBuffer
      }
    }
    vi.stubGlobal('window', { AudioContext: FakeAudioContext })
    prepareRetroAudio()
    prepareRetroAudio()
    expect(contextsCreated).toBe(1)
    expect(buffersCreated).toBe(2)
    vi.unstubAllGlobals()
  })

  it('uses rising countdown notes and a descending game-over sequence', () => {
    const countdownNotes = [3, 2, 1].map(
      (count) => getCountdownTonePlan(count).frequencies[0],
    )
    expect(countdownNotes).toEqual([440, 550, 660])
    expect(getCountdownTonePlan(0).frequencies).toEqual([880, 1175])

    const gameOverNotes = [...getGameOverTonePlan().frequencies]
    expect(gameOverNotes).toEqual([523, 392, 294, 196, 147])
    expect(gameOverNotes).toEqual([...gameOverNotes].sort((a, b) => b - a))
  })
})

describe('punch tracking', () => {
  it('does not produce a punch from slow fist movement', () => {
    const tracker = new PunchTracker()
    tracker.update([observation(true, 0)], 0)
    const [hand] = tracker.update([observation(true, 0.004)], 32)
    expect(hand.speed).toBeLessThan(GAME_CONFIG.punch.velocityThreshold)
    expect(hand.phase).not.toBe('punching')
  })

  it('produces a punch from fast closed-fist movement', () => {
    const tracker = new PunchTracker()
    tracker.update([observation(true, 0)], 0)
    const [hand] = tracker.update([observation(true, 0.08)], 16)
    expect(hand.speed).toBeGreaterThan(GAME_CONFIG.punch.velocityThreshold)
    expect(hand.phase).toBe('punching')
  })

  it('prevents repeated hits during cooldown', () => {
    const tracker = new PunchTracker()
    tracker.update([observation(true, 0)], 0)
    const [hand] = tracker.update([observation(true, 0.08)], 16)
    tracker.markHit(hand.id, 16)
    const [cooling] = tracker.update([observation(true, 0.16)], 32)
    expect(cooling.phase).toBe('cooldown')
    expect(tracker.canHit(hand.id)).toBe(false)
  })

  it('rearms a moving fist when the shortened cooldown expires', () => {
    const tracker = new PunchTracker()
    tracker.update([observation(true, 0)], 0)
    const [punching] = tracker.update([observation(true, 0.08)], 16)
    tracker.markHit(punching.id, 16)
    const [rearmed] = tracker.update(
      [observation(true, 0.18)],
      16 + GAME_CONFIG.punch.cooldownMs + 1,
    )
    expect(rearmed.phase).toBe('armed')
  })

  it('keeps separate state for two hands', () => {
    const tracker = new PunchTracker()
    const first = tracker.update(
      [observation(true, -0.2, 'Left'), observation(false, 0.2, 'Right')],
      0,
    )
    const second = tracker.update(
      [observation(true, -0.12, 'Left'), observation(false, 0.202, 'Right')],
      16,
    )
    expect(new Set(second.map((hand) => hand.id)).size).toBe(2)
    expect(second.find((hand) => hand.id === first[0].id)?.phase).toBe(
      'punching',
    )
    expect(second.find((hand) => hand.id === first[1].id)?.phase).toBe('idle')
  })

  it('holds a hand briefly through dropped detections without allowing a hit', () => {
    const tracker = new PunchTracker()
    tracker.update([observation(true, 0)], 0)
    tracker.update([observation(true, 0.08)], 16)
    const held = tracker.update([], 64)
    expect(held).toHaveLength(1)
    expect(tracker.getSmoothedObservations(64)).toHaveLength(1)
    expect(tracker.canHit(held[0].id)).toBe(false)
    expect(tracker.update([], 300)).toHaveLength(0)
  })

  it('ignores temporary handedness label swaps when matching two hands', () => {
    const tracker = new PunchTracker()
    const initial = tracker.update(
      [observation(false, -0.2, 'Left'), observation(false, 0.2, 'Right')],
      0,
    )
    const updated = tracker.update(
      [observation(false, -0.195, 'Right'), observation(false, 0.195, 'Left')],
      33,
    )
    const leftSideId = updated.sort((a, b) => a.center.x - b.center.x)[0].id
    expect(leftSideId).toBe(
      initial.sort((a, b) => a.center.x - b.center.x)[0].id,
    )
    expect(updated.find((hand) => hand.id === leftSideId)?.handedness).toBe(
      'Left',
    )
  })

  it('keeps both identities stable when observations arrive in reverse order', () => {
    const tracker = new PunchTracker()
    const initial = tracker.update(
      [observation(false, -0.2, 'Left'), observation(false, 0.2, 'Right')],
      0,
    )
    const updated = tracker.update(
      [observation(false, 0.18, 'Right'), observation(false, -0.18, 'Left')],
      33,
    )
    expect(updated.find((hand) => hand.center.x < 0.5)?.id).toBe(
      initial.find((hand) => hand.center.x < 0.5)?.id,
    )
    expect(updated.find((hand) => hand.center.x > 0.5)?.id).toBe(
      initial.find((hand) => hand.center.x > 0.5)?.id,
    )
  })

  it('smooths small landmark jitter while preserving motion tracking', () => {
    const tracker = new PunchTracker()
    const [initial] = tracker.update([observation(false, 0)], 0)
    const [smoothed] = tracker.update([observation(false, 0.02)], 33)
    expect(smoothed.center.x - initial.center.x).toBeGreaterThan(0)
    expect(smoothed.center.x - initial.center.x).toBeLessThan(0.02)
  })

  it('smooths orientation across the minus-pi/plus-pi boundary', () => {
    const tracker = new PunchTracker()
    tracker.update(
      [{ ...observation(true), orientation: { x: 0, y: 0, z: 3.1 } }],
      0,
    )
    const [updated] = tracker.update(
      [{ ...observation(true), orientation: { x: 0, y: 0, z: -3.1 } }],
      33,
    )
    expect(Math.abs(updated.orientation.z - 3.1)).toBeLessThan(0.1)
  })
})

describe('two-fist readiness', () => {
  const trackedFist = (id: number, isFist = true): TrackedFist => ({
    id,
    handedness: id === 1 ? 'Left' : 'Right',
    center: { x: id === 1 ? 0.35 : 0.65, y: 0.55 },
    radius: 0.08,
    isFist,
    speed: 0,
    confidence: isFist ? 0.9 : 0.1,
    phase: 'idle',
    orientation: { x: 0, y: 0, z: 0 },
  })

  it('requires two fresh fists to remain recognized for the hold period', () => {
    const gate = new FistReadinessGate()
    const fists = [trackedFist(1), trackedFist(2)]
    expect(gate.update(fists, 0, () => true)).toBe(false)
    expect(
      gate.update(fists, GAME_CONFIG.readiness.holdMs - 1, () => true),
    ).toBe(false)
    expect(gate.update(fists, GAME_CONFIG.readiness.holdMs, () => true)).toBe(
      true,
    )
  })

  it('resets when a fist opens or its tracking becomes stale', () => {
    const gate = new FistReadinessGate()
    const fists = [trackedFist(1), trackedFist(2)]
    gate.update(fists, 0, () => true)
    expect(gate.update(fists, 300, (id) => id === 1)).toBe(false)
    expect(gate.update(fists, 400, () => true)).toBe(false)
    expect(
      gate.update([trackedFist(1), trackedFist(2, false)], 900, () => true),
    ).toBe(false)
  })
})

describe('performance profile', () => {
  it('reduces camera, rendering, and effects work on constrained devices', () => {
    const constrained = createPerformanceProfile({
      cores: 4,
      memory: 2,
      coarsePointer: true,
      reducedMotion: false,
      devicePixelRatio: 3,
    })
    const desktop = createPerformanceProfile({
      cores: 12,
      memory: 16,
      coarsePointer: false,
      reducedMotion: false,
      devicePixelRatio: 2,
    })
    expect(constrained.cameraWidth).toBeLessThan(desktop.cameraWidth)
    expect(constrained.trackingWidth).toBeLessThan(desktop.trackingWidth)
    expect(constrained.trackingFps).toBeLessThan(desktop.trackingFps)
    expect(constrained.pixelRatio).toBeLessThan(desktop.pixelRatio)
    expect(constrained.antialias).toBe(false)
    expect(constrained.particleCount).toBeLessThan(desktop.particleCount)
  })
})

describe('coordinate conversion', () => {
  it('accounts for cover cropping and mirroring', () => {
    const unmirrored = videoPointToView(
      { x: 0.25, y: 0.5 },
      { x: 1920, y: 1080 },
      { x: 375, y: 812 },
      false,
    )
    const mirrored = videoPointToView(
      { x: 0.25, y: 0.5 },
      { x: 1920, y: 1080 },
      { x: 375, y: 812 },
      true,
    )
    expect(unmirrored.x).toBeLessThan(0)
    expect(mirrored.x).toBeGreaterThan(1)
    expect(unmirrored.x + mirrored.x).toBeCloseTo(1)
    expect(mirrored.y).toBeCloseTo(0.5)
  })
})

describe('round rules', () => {
  it('connects a tracked punch to an overlapping target without keyboard input', () => {
    const target = {
      id: 14,
      kind: 'orb' as const,
      x: 0.52,
      y: 0.48,
      radius: 0.06,
      hit: false,
    }
    const collision = findAutomaticPunchTarget(
      {
        id: 1,
        handedness: 'Right',
        center: { x: 0.5, y: 0.5 },
        radius: 0.08,
        isFist: true,
        speed: 1.1,
        confidence: 0.9,
        phase: 'punching',
        orientation: { x: 0, y: 0, z: 0 },
      },
      [target],
    )
    expect(collision?.id).toBe(14)
  })

  it('connects a fast punch that crosses a target between tracking samples', () => {
    const collision = findAutomaticPunchTarget(
      {
        id: 2,
        handedness: 'Left',
        previousCenter: { x: 0.3, y: 0.5 },
        center: { x: 0.7, y: 0.5 },
        radius: 0.035,
        isFist: true,
        speed: 1.8,
        confidence: 0.88,
        phase: 'punching',
        orientation: { x: 0, y: 0, z: 0 },
      },
      [
        {
          id: 15,
          kind: 'cube',
          x: 0.5,
          y: 0.5,
          radius: 0.04,
          hit: false,
        },
      ],
    )
    expect(collision?.id).toBe(15)
  })

  it('does not connect a swept punch that clearly misses the target', () => {
    const collision = findAutomaticPunchTarget(
      {
        id: 3,
        handedness: 'Right',
        previousCenter: { x: 0.3, y: 0.5 },
        center: { x: 0.7, y: 0.5 },
        radius: 0.035,
        isFist: true,
        speed: 1.8,
        confidence: 0.9,
        phase: 'punching',
        orientation: { x: 0, y: 0, z: 0 },
      },
      [
        {
          id: 16,
          kind: 'orb',
          x: 0.5,
          y: 0.72,
          radius: 0.04,
          hit: false,
        },
      ],
    )
    expect(collision).toBeUndefined()
  })

  it('detects red-hazard contact without requiring a fist or punch', () => {
    const hand: TrackedFist = {
      id: 4,
      handedness: 'Left',
      center: { x: 0.5, y: 0.5 },
      radius: 0.07,
      isFist: false,
      speed: 0,
      confidence: 0.9,
      phase: 'idle',
      orientation: { x: 0, y: 0, z: 0 },
    }
    const hazard = {
      id: 17,
      kind: 'hazard' as const,
      x: 0.54,
      y: 0.5,
      radius: 0.045,
      hit: false,
    }
    expect(findHazardContact(hand, [hazard])?.id).toBe(17)
    expect(findAutomaticPunchTarget(hand, [hazard])).toBeUndefined()
  })

  it('never treats a red hazard as a normal punch target', () => {
    const punchingHand: TrackedFist = {
      id: 5,
      handedness: 'Right',
      center: { x: 0.5, y: 0.5 },
      radius: 0.07,
      isFist: true,
      speed: 1.2,
      confidence: 0.92,
      phase: 'punching',
      orientation: { x: 0, y: 0, z: 0 },
    }
    expect(
      findAutomaticPunchTarget(punchingHand, [
        {
          id: 18,
          kind: 'hazard',
          x: 0.5,
          y: 0.5,
          radius: 0.045,
          hit: false,
        },
      ]),
    ).toBeUndefined()
  })

  it('allows a target to score at most once', () => {
    const state = createRoundState()
    expect(scoreHit(state, 7, 'orb')).toBe(true)
    expect(scoreHit(state, 7, 'orb')).toBe(false)
    expect(state.score).toBe(100)
  })

  it('preserves the highest combo after the live combo resets', () => {
    const state = createRoundState()
    scoreHit(state, 1, 'orb')
    scoreHit(state, 2, 'cube')
    scoreHit(state, 3, 'crystal')
    missTarget(state, 'orb')
    scoreHit(state, 4, 'orb')
    expect(state.combo).toBe(1)
    expect(state.bestCombo).toBe(3)
  })

  it('removes a life for a missed normal target', () => {
    const state = createRoundState()
    state.combo = 5
    missTarget(state, 'cube')
    expect(state.lives).toBe(2)
    expect(state.combo).toBe(0)
  })

  it('penalizes contacting a hazard but not letting it fall', () => {
    const state = createRoundState()
    missTarget(state, 'hazard')
    expect(state.lives).toBe(3)
    scoreHit(state, 9, 'hazard')
    expect(state.lives).toBe(2)
  })

  it('doubles normal target scores for three seconds', () => {
    const state = createRoundState()
    scoreHit(state, 20, 'multiplier', 1000)
    expect(getScoreMultiplier(state, 3999)).toBe(2)
    scoreHit(state, 21, 'orb', 3999)
    expect(state.score).toBe(200)
    expect(getScoreMultiplier(state, 4000)).toBe(1)
    scoreHit(state, 22, 'orb', 4000)
    expect(state.score).toBe(300)
  })

  it('extends the actual round by each timer-bonus variant', () => {
    const state = createRoundState()
    scoreHit(state, 23, 'time5')
    scoreHit(state, 24, 'time7')
    scoreHit(state, 25, 'time10')
    expect(state.timeBonusSeconds).toBe(22)
    expect(getRoundDurationSeconds(state)).toBe(
      GAME_CONFIG.roundDurationSeconds + 22,
    )
  })

  it('adds hearts up to the configured maximum', () => {
    const state = createRoundState()
    scoreHit(state, 26, 'heart')
    scoreHit(state, 27, 'heart')
    scoreHit(state, 28, 'heart')
    expect(state.lives).toBe(GAME_CONFIG.maxLives)
  })

  it('does not penalize missed bonuses or reset the combo', () => {
    const state = createRoundState()
    state.combo = 4
    for (const kind of [
      'multiplier',
      'time5',
      'time7',
      'time10',
      'heart',
    ] as const)
      missTarget(state, kind)
    expect(state.lives).toBe(GAME_CONFIG.startingLives)
    expect(state.combo).toBe(4)
  })

  it('increases timer-bonus frequency below twenty seconds', () => {
    const normal = getBonusSpawnProfile(20, 3)
    const urgent = getBonusSpawnProfile(19.99, 3)
    const timerRate = (profile: typeof normal) => {
      const total = Object.values(profile.weights).reduce(
        (sum, weight) => sum + weight,
        0,
      )
      return (
        (profile.chance *
          (profile.weights.time5 +
            profile.weights.time7 +
            profile.weights.time10)) /
        total
      )
    }
    expect(urgent.chance).toBeGreaterThan(normal.chance)
    expect(timerRate(urgent)).toBeGreaterThan(timerRate(normal))
  })

  it('increases heart-bonus frequency at one remaining heart', () => {
    const healthy = getBonusSpawnProfile(40, 2)
    const critical = getBonusSpawnProfile(40, 1)
    const heartRate = (profile: typeof healthy) => {
      const total = Object.values(profile.weights).reduce(
        (sum, weight) => sum + weight,
        0,
      )
      return (profile.chance * profile.weights.heart) / total
    }
    expect(critical.chance).toBeGreaterThan(healthy.chance)
    expect(heartRate(critical)).toBeGreaterThan(heartRate(healthy))
  })

  it('increases difficulty over time', () => {
    const early = getDifficulty(0)
    const late = getDifficulty(1)
    expect(late.spawnInterval).toBeLessThan(early.spawnInterval)
    expect(late.fallSpeed).toBeGreaterThan(early.fallSpeed)
    expect(late.gravity).toBeLessThan(early.gravity)
  })

  it('moves an early-round target into view promptly', () => {
    const early = getDifficulty(0)
    const distanceAfterOneSecond = early.fallSpeed + Math.abs(early.gravity) / 2
    expect(
      GAME_CONFIG.spawning.spawnHeight - distanceAfterOneSecond,
    ).toBeLessThan(1)
  })
})

describe('fixed-step simulation', () => {
  it('uses a fixed accumulator and limits large frame bursts', () => {
    const advance = vi.fn()
    const accumulator = new FixedStepAccumulator(1 / 60, 0.1, 4)
    expect(accumulator.update(1 / 120, advance)).toBe(0)
    expect(accumulator.update(1 / 120, advance)).toBe(1)
    expect(accumulator.update(1, advance)).toBe(4)
    expect(advance).toHaveBeenCalledTimes(5)
    expect(advance).toHaveBeenCalledWith(1 / 60)
  })
})
