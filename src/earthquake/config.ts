export const EARTHQUAKE_CONFIG = {
  calibrationMs: 1500,
  demonstrationMs: 2500,
  stablePoseMs: 700,
  holdPoseMs: 2000,
  trackingFps: 24,
  minVisibility: 0.55,
  framingMargin: 0.025,
  dropHipRatio: 0.13,
  maxBentKneeDegrees: 145,
  handToHeadShoulderRatio: 1.45,
  stars: { three: 12, two: 20 },
} as const

export const POSE_STEPS = ['drop', 'cover', 'hold'] as const
