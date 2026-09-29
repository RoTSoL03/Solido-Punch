import { EARTHQUAKE_CONFIG } from './config'

export interface PosePerformanceSample {
  activeTracking: boolean
  performanceMode: boolean
  fallbackPending: boolean
  elapsedMs: number
  inferenceMs: number
  renderFps: number
}

export function shouldActivatePoseFallback(
  sample: PosePerformanceSample,
): boolean {
  return (
    sample.activeTracking &&
    !sample.performanceMode &&
    !sample.fallbackPending &&
    sample.elapsedMs >= EARTHQUAKE_CONFIG.performanceWarmupMs &&
    (sample.inferenceMs > EARTHQUAKE_CONFIG.maximumInferenceMs ||
      sample.renderFps < EARTHQUAKE_CONFIG.minimumRenderFps)
  )
}
