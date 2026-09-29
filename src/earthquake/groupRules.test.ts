import { describe, expect, it } from 'vitest'
import { EARTHQUAKE_CONFIG } from './config'
import {
  allParticipantsMatch,
  areParticipantsFramed,
  trackingLossWithinGrace,
} from './groupRules'
import type { PoseMatch, PoseObservation, TrackedPose } from './types'

function pose(id: number, staleMs = 0): TrackedPose {
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1,
  }))
  Object.assign(landmarks[0], { y: 0.08 })
  Object.assign(landmarks[11], { x: 0.4, y: 0.2 })
  Object.assign(landmarks[12], { x: 0.6, y: 0.2 })
  Object.assign(landmarks[23], { x: 0.44, y: 0.5 })
  Object.assign(landmarks[24], { x: 0.56, y: 0.5 })
  Object.assign(landmarks[25], { x: 0.44, y: 0.7 })
  Object.assign(landmarks[26], { x: 0.56, y: 0.7 })
  Object.assign(landmarks[27], { x: 0.44, y: 0.9 })
  Object.assign(landmarks[28], { x: 0.56, y: 0.9 })
  const observation: PoseObservation = { landmarks, timestamp: 0 }
  return { id, observation, lastSeenAt: 0, staleMs }
}

const match = (matched: boolean): PoseMatch => ({
  matched,
  confidence: matched ? 1 : 0,
  coaching: '',
  fullBodyVisible: true,
})

describe('earthquake group rules', () => {
  it('requires exactly the selected number of fresh full bodies', () => {
    expect(areParticipantsFramed([pose(1), pose(2)], 2)).toBe(true)
    expect(areParticipantsFramed([pose(1)], 2)).toBe(false)
    expect(areParticipantsFramed([pose(1), pose(2), pose(3)], 2)).toBe(false)
    expect(areParticipantsFramed([pose(1), pose(2, 10)], 2)).toBe(false)
  })

  it('allows only the configured tracking-loss grace period', () => {
    expect(
      trackingLossWithinGrace([
        pose(1),
        pose(2, EARTHQUAKE_CONFIG.staleGraceMs),
      ]),
    ).toBe(true)
    expect(
      trackingLossWithinGrace([
        pose(1),
        pose(2, EARTHQUAKE_CONFIG.staleGraceMs + 1),
      ]),
    ).toBe(false)
    expect(trackingLossWithinGrace([pose(1), undefined])).toBe(false)
  })

  it('requires every participant to match', () => {
    expect(allParticipantsMatch([match(true), match(true)])).toBe(true)
    expect(allParticipantsMatch([match(true), match(false)])).toBe(false)
  })
})
