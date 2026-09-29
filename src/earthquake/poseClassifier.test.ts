import { describe, expect, it } from 'vitest'
import {
  classifyPose,
  createCalibration,
  isFullBodyVisible,
  starsForTime,
} from './poseClassifier'
import type { PoseObservation, PosePoint } from './types'

function landmark(x = 0.5, y = 0.5, visibility = 1): PosePoint {
  return { x, y, z: 0, visibility }
}

function standingPose(): PoseObservation {
  const landmarks = Array.from({ length: 33 }, () => landmark())
  landmarks[0] = landmark(0.5, 0.08)
  landmarks[7] = landmark(0.46, 0.1)
  landmarks[8] = landmark(0.54, 0.1)
  landmarks[11] = landmark(0.4, 0.2)
  landmarks[12] = landmark(0.6, 0.2)
  landmarks[15] = landmark(0.34, 0.48)
  landmarks[16] = landmark(0.66, 0.48)
  landmarks[23] = landmark(0.44, 0.5)
  landmarks[24] = landmark(0.56, 0.5)
  landmarks[25] = landmark(0.44, 0.7)
  landmarks[26] = landmark(0.56, 0.7)
  landmarks[27] = landmark(0.44, 0.9)
  landmarks[28] = landmark(0.56, 0.9)
  return { landmarks, timestamp: 0 }
}

function crouchingPose(covered = false): PoseObservation {
  const observation = standingPose()
  observation.landmarks[23] = landmark(0.44, 0.64)
  observation.landmarks[24] = landmark(0.56, 0.64)
  observation.landmarks[25] = landmark(0.34, 0.74)
  observation.landmarks[26] = landmark(0.66, 0.74)
  observation.landmarks[27] = landmark(0.44, 0.9)
  observation.landmarks[28] = landmark(0.56, 0.9)
  if (covered) {
    observation.landmarks[15] = landmark(0.48, 0.055)
    observation.landmarks[16] = landmark(0.52, 0.155)
  }
  return observation
}

function allFoursPose(): PoseObservation {
  const observation = crouchingPose()
  observation.landmarks[11] = landmark(0.36, 0.58)
  observation.landmarks[12] = landmark(0.48, 0.58)
  observation.landmarks[23] = landmark(0.58, 0.64)
  observation.landmarks[24] = landmark(0.7, 0.64)
  observation.landmarks[15] = landmark(0.25, 0.78)
  observation.landmarks[16] = landmark(0.35, 0.78)
  return observation
}

describe('earthquake pose classifier', () => {
  const calibration = createCalibration([standingPose()])!

  it('requires all essential full-body landmarks to remain visible', () => {
    expect(isFullBodyVisible(standingPose())).toBe(true)
    const clipped = standingPose()
    clipped.landmarks[28] = landmark(0.56, 0.99)
    expect(isFullBodyVisible(clipped)).toBe(false)
  })

  it('calibrates body dimensions from a standing pose', () => {
    expect(calibration.hipY).toBeCloseTo(0.5)
    expect(calibration.bodyHeight).toBeCloseTo(0.7)
    expect(calibration.shoulderWidth).toBeCloseTo(0.2)
  })

  it('recognizes a crouch as Drop but not as Cover', () => {
    expect(classifyPose('drop', crouchingPose(), calibration).matched).toBe(
      true,
    )
    expect(classifyPose('cover', crouchingPose(), calibration).matched).toBe(
      false,
    )
  })

  it('rejects an all-fours posture as Drop', () => {
    expect(classifyPose('drop', allFoursPose(), calibration).matched).toBe(
      false,
    )
  })

  it('recognizes protected crouches as Cover and Hold On', () => {
    expect(
      classifyPose('cover', crouchingPose(true), calibration).matched,
    ).toBe(true)
    expect(classifyPose('hold', crouchingPose(true), calibration).matched).toBe(
      true,
    )
  })

  it('requires different hands at the crown and nape', () => {
    const faceOnly = crouchingPose()
    faceOnly.landmarks[15] = landmark(0.46, 0.1)
    faceOnly.landmarks[16] = landmark(0.54, 0.1)
    expect(classifyPose('cover', faceOnly, calibration).matched).toBe(false)

    const reversed = crouchingPose()
    reversed.landmarks[16] = landmark(0.48, 0.055)
    reversed.landmarks[15] = landmark(0.52, 0.155, 0.32)
    expect(classifyPose('cover', reversed, calibration).matched).toBe(true)
  })

  it('assigns stars at the configured completion boundaries', () => {
    expect(starsForTime(12)).toBe(3)
    expect(starsForTime(12.01)).toBe(2)
    expect(starsForTime(20)).toBe(2)
    expect(starsForTime(20.01)).toBe(1)
  })
})
