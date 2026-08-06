import { describe, expect, it } from 'vitest'
import { describeStartupError, StartupError } from './startupError'

describe('startup error descriptions', () => {
  it('distinguishes hand-tracking failures from camera failures', () => {
    const result = describeStartupError(
      new StartupError('tracking', new Error('loader blocked')),
    )

    expect(result.title).toBe('Hand tracking couldn’t start')
    expect(result.message).toContain('camera opened')
  })

  it('preserves useful browser camera errors', () => {
    const result = describeStartupError(
      new StartupError(
        'camera',
        new DOMException('Permission denied', 'NotAllowedError'),
      ),
    )

    expect(result.title).toBe('We couldn’t open the camera')
    expect(result.message).toContain('Camera access was blocked')
  })
})
