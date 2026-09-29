import { describe, expect, it } from 'vitest'
import { cameraConstraintCandidates } from './camera'

describe('cameraConstraintCandidates', () => {
  it('falls back from 1080p to 720p and then the camera default', () => {
    const candidates = cameraConstraintCandidates('user', {
      width: 1920,
      height: 1080,
      frameRate: 30,
    })

    expect(candidates).toHaveLength(3)
    expect(candidates[0].video).toMatchObject({
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    })
    expect(candidates[1].video).toMatchObject({
      width: { ideal: 1280 },
      height: { ideal: 720 },
    })
    expect(candidates[2]).toEqual({
      audio: false,
      video: { facingMode: 'user' },
    })
  })

  it('does not raise a performance-profile request to 720p', () => {
    const candidates = cameraConstraintCandidates('environment', {
      width: 640,
      height: 360,
    })

    expect(candidates).toHaveLength(2)
  })
})
