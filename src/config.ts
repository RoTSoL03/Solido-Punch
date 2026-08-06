export const GAME_CONFIG = {
  roundDurationSeconds: 60,
  startingLives: 3,
  maxLives: 5,
  countdownSeconds: 3,
  hudUpdateMs: 200,
  maxHands: 2,
  interactionPlaneZ: 0,
  readiness: {
    requiredFists: 2,
    holdMs: 450,
  },
  punch: {
    velocityThreshold: 0.48,
    armedVelocity: 0.18,
    resetVelocity: 0.14,
    smoothing: 0.28,
    maxSmoothing: 0.82,
    landmarkMotionGain: 8,
    landmarkSmoothingRate: 18,
    landmarkMotionRate: 190,
    modelPredictionMs: 52,
    maxPredictionDistance: 0.05,
    hitFreshnessMs: 120,
    punchGraceMs: 140,
    cooldownMs: 200,
    maxFrameMs: 80,
    maxVelocity: 5,
    minRadius: 0.045,
    radiusScale: 1.2,
    fistEnterConfidence: 0.5,
    fistExitConfidence: 0.34,
    fistGraceMs: 160,
    trackingHoldMs: 240,
    identityMaxDistance: 0.42,
    handednessPenalty: 0.055,
    labelSwitchFrames: 3,
  },
  vision: {
    minDetectionConfidence: 0.38,
    minPresenceConfidence: 0.36,
    minTrackingConfidence: 0.42,
  },
  physics: {
    fixedStep: 1 / 60,
    maxFrameDelta: 0.1,
    maxSubsteps: 5,
    initialGravity: -0.12,
    finalGravity: -0.38,
  },
  spawning: {
    initialInterval: 1.35,
    finalInterval: 0.5,
    initialSpeed: 0.3,
    finalSpeed: 1.05,
    spawnHeight: 1.1,
    spawnHeightJitter: 0.08,
    minSeparation: 0.2,
    hazardChance: 0.12,
    bonusChance: 0.11,
    maxTargets: 12,
  },
  bonuses: {
    multiplierDurationMs: 3000,
    urgentTimeThresholdSeconds: 20,
    urgentTimeBonusChance: 0.09,
    lowLifeBonusChance: 0.09,
  },
  targetTypes: {
    orb: { points: 100, color: 0xff4f87, radius: 0.078 },
    cube: { points: 150, color: 0x45e6ff, radius: 0.08 },
    crystal: { points: 225, color: 0xffd84b, radius: 0.075 },
    hazard: { points: 0, color: 0xff3b2f, radius: 0.085 },
    multiplier: { points: 0, color: 0xffa42d, radius: 0.082 },
    time5: { points: 0, color: 0x55f6b2, radius: 0.078 },
    time7: { points: 0, color: 0x45cfff, radius: 0.08 },
    time10: { points: 0, color: 0xa879ff, radius: 0.084 },
    heart: { points: 0, color: 0xff5e85, radius: 0.08 },
  },
  fistModel: {
    url: `${import.meta.env.BASE_URL}models/fist.glb`,
    sizeMultiplier: 4.4,
    rotation: { x: -0.12, y: 0, z: 0 },
    orientationSmoothing: 0.5,
    orientationSmoothingRate: 22,
    orientationMotionRate: 16,
    depthRotationMultiplier: 2.1,
    maxTilt: 1.35,
  },
  comboStep: 5,
  comboBonus: 0.1,
} as const

export type TargetKind = keyof typeof GAME_CONFIG.targetTypes

export const BONUS_TARGET_KINDS = [
  'multiplier',
  'time5',
  'time7',
  'time10',
  'heart',
] as const satisfies readonly TargetKind[]

export type BonusTargetKind = (typeof BONUS_TARGET_KINDS)[number]

export function isBonusTarget(kind: TargetKind): kind is BonusTargetKind {
  return (BONUS_TARGET_KINDS as readonly TargetKind[]).includes(kind)
}

export function getTimeBonusSeconds(kind: TargetKind): number {
  if (kind === 'time5') return 5
  if (kind === 'time7') return 7
  if (kind === 'time10') return 10
  return 0
}

export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
]
