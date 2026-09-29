import { EARTHQUAKE_CONFIG } from './config'
import { isFullBodyVisible } from './poseClassifier'
import type { PoseMatch, TrackedPose } from './types'

export function areParticipantsFramed(
  poses: readonly TrackedPose[],
  expected: number,
): boolean {
  const fresh = poses.filter(({ staleMs }) => staleMs === 0)
  return (
    fresh.length === expected &&
    fresh.every(({ observation }) => isFullBodyVisible(observation))
  )
}

export function trackingLossWithinGrace(
  poses: ReadonlyArray<TrackedPose | undefined>,
): boolean {
  return poses.every(
    (pose) => pose && pose.staleMs <= EARTHQUAKE_CONFIG.staleGraceMs,
  )
}

export function allParticipantsMatch(matches: readonly PoseMatch[]): boolean {
  return matches.length > 0 && matches.every(({ matched }) => matched)
}
