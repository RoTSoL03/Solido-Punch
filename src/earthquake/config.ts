export const EARTHQUAKE_CONFIG = {
  calibrationMs: 1500,
  demonstrationMs: 2500,
  stablePoseMs: 700,
  holdPoseMs: 2000,
  trackingFps: 30,
  staleGraceMs: 250,
  performanceWarmupMs: 3000,
  performanceWindowMs: 3000,
  maximumInferenceMs: 55,
  minimumRenderFps: 24,
  minVisibility: 0.55,
  framingMargin: 0.025,
  dropHipRatio: 0.13,
  maxBentKneeDegrees: 145,
  maximumTorsoLeanDegrees: 38,
  minimumTorsoHeightRatio: 0.16,
  crownRadiusShoulderRatio: 0.78,
  napeRadiusShoulderRatio: 0.82,
  stars: { three: 12, two: 20 },
} as const

export const POSE_STEPS = ['drop', 'cover', 'hold'] as const
