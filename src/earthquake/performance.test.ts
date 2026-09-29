import { describe, expect, it } from 'vitest'
import { shouldActivatePoseFallback } from './performance'

const healthy = {
  activeTracking: true,
  performanceMode: false,
  fallbackPending: false,
  elapsedMs: 3000,
  inferenceMs: 40,
  renderFps: 30,
}

describe('shouldActivatePoseFallback', () => {
  it('falls back for slow inference or sustained low render FPS', () => {
    expect(shouldActivatePoseFallback({ ...healthy, inferenceMs: 56 })).toBe(
      true,
    )
    expect(shouldActivatePoseFallback({ ...healthy, renderFps: 23 })).toBe(true)
  })

  it('waits for warm-up and never recreates an active fallback', () => {
    expect(shouldActivatePoseFallback({ ...healthy, elapsedMs: 2999 })).toBe(
      false,
    )
    expect(
      shouldActivatePoseFallback({ ...healthy, performanceMode: true }),
    ).toBe(false)
  })
})
