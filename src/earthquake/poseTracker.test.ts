import { describe, expect, it } from 'vitest'
import type { PoseObservation, PosePoint } from './types'
import { PoseIdentityTracker } from './poseTracker'

const point = (x: number, y = 0.5): PosePoint => ({
  x,
  y,
  z: 0,
  visibility: 1,
})

function pose(x: number, timestamp = 0): PoseObservation {
  const landmarks = Array.from({ length: 33 }, () => point(x))
  landmarks[11] = point(x - 0.04, 0.3)
  landmarks[12] = point(x + 0.04, 0.3)
  landmarks[23] = point(x - 0.03, 0.55)
  landmarks[24] = point(x + 0.03, 0.55)
  return { landmarks, timestamp }
}

describe('pose identity tracker', () => {
  it('keeps stable identities when detector result order changes', () => {
    const tracker = new PoseIdentityTracker()
    const initial = tracker.update([pose(0.25), pose(0.75)], 0)
    const next = tracker.update([pose(0.73), pose(0.27)], 33)
    expect(next.map(({ id }) => id)).toEqual(initial.map(({ id }) => id))
  })

  it('retains a temporarily missing participant as stale', () => {
    const tracker = new PoseIdentityTracker()
    tracker.update([pose(0.3), pose(0.7)], 0)
    const tracked = tracker.update([pose(0.31)], 150)
    expect(tracked).toHaveLength(2)
    expect(tracked.some(({ staleMs }) => staleMs === 150)).toBe(true)
  })
})
