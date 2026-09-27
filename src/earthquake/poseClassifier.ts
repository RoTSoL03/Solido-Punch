import { EARTHQUAKE_CONFIG } from './config'
import type {
  EarthquakeStep,
  PoseCalibration,
  PoseMatch,
  PoseObservation,
  PosePoint,
} from './types'

const LANDMARK = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const

const ESSENTIAL = [0, 11, 12, 23, 24, 25, 26, 27, 28]

function point(observation: PoseObservation, index: number): PosePoint {
  return observation.landmarks[index] ?? { x: 0, y: 0, z: 0, visibility: 0 }
}

function distance(a: PosePoint, b: PosePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function midpoint(a: PosePoint, b: PosePoint): PosePoint {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: Math.min(a.visibility, b.visibility),
  }
}

function angle(a: PosePoint, vertex: PosePoint, c: PosePoint): number {
  const first = { x: a.x - vertex.x, y: a.y - vertex.y }
  const second = { x: c.x - vertex.x, y: c.y - vertex.y }
  const dot = first.x * second.x + first.y * second.y
  const lengths = Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y)
  if (!lengths) return 180
  return (Math.acos(Math.max(-1, Math.min(1, dot / lengths))) * 180) / Math.PI
}

export function isFullBodyVisible(observation: PoseObservation): boolean {
  return ESSENTIAL.every((index) => {
    const item = point(observation, index)
    const margin = EARTHQUAKE_CONFIG.framingMargin
    return (
      item.visibility >= EARTHQUAKE_CONFIG.minVisibility &&
      item.x >= margin &&
      item.x <= 1 - margin &&
      item.y >= margin &&
      item.y <= 1 - margin
    )
  })
}

export function createCalibration(
  observations: readonly PoseObservation[],
): PoseCalibration | null {
  const visible = observations.filter(isFullBodyVisible)
  if (!visible.length) return null
  const values = visible.map((observation) => {
    const shoulders = midpoint(
      point(observation, LANDMARK.leftShoulder),
      point(observation, LANDMARK.rightShoulder),
    )
    const hips = midpoint(
      point(observation, LANDMARK.leftHip),
      point(observation, LANDMARK.rightHip),
    )
    const ankles = midpoint(
      point(observation, LANDMARK.leftAnkle),
      point(observation, LANDMARK.rightAnkle),
    )
    return {
      hipY: hips.y,
      bodyHeight: Math.max(0.1, ankles.y - shoulders.y),
      shoulderWidth: Math.max(
        0.05,
        distance(
          point(observation, LANDMARK.leftShoulder),
          point(observation, LANDMARK.rightShoulder),
        ),
      ),
    }
  })
  return {
    hipY: values.reduce((sum, item) => sum + item.hipY, 0) / values.length,
    bodyHeight:
      values.reduce((sum, item) => sum + item.bodyHeight, 0) / values.length,
    shoulderWidth:
      values.reduce((sum, item) => sum + item.shoulderWidth, 0) / values.length,
  }
}

function dropStatus(
  observation: PoseObservation,
  calibration: PoseCalibration,
): { lowered: boolean; kneesBent: boolean; confidence: number } {
  const hips = midpoint(
    point(observation, LANDMARK.leftHip),
    point(observation, LANDMARK.rightHip),
  )
  const loweredBy = (hips.y - calibration.hipY) / calibration.bodyHeight
  const leftAngle = angle(
    point(observation, LANDMARK.leftHip),
    point(observation, LANDMARK.leftKnee),
    point(observation, LANDMARK.leftAnkle),
  )
  const rightAngle = angle(
    point(observation, LANDMARK.rightHip),
    point(observation, LANDMARK.rightKnee),
    point(observation, LANDMARK.rightAnkle),
  )
  const kneeAngle = Math.max(leftAngle, rightAngle)
  return {
    lowered: loweredBy >= EARTHQUAKE_CONFIG.dropHipRatio,
    kneesBent: kneeAngle <= EARTHQUAKE_CONFIG.maxBentKneeDegrees,
    confidence: Math.min(
      1,
      Math.max(0, loweredBy / EARTHQUAKE_CONFIG.dropHipRatio) * 0.55 +
        Math.max(
          0,
          (180 - kneeAngle) / (180 - EARTHQUAKE_CONFIG.maxBentKneeDegrees),
        ) *
          0.45,
    ),
  }
}

function handsProtectHead(
  observation: PoseObservation,
  calibration: PoseCalibration,
): boolean {
  const leftHead = midpoint(
    point(observation, LANDMARK.nose),
    point(observation, LANDMARK.leftEar),
  )
  const rightHead = midpoint(
    point(observation, LANDMARK.nose),
    point(observation, LANDMARK.rightEar),
  )
  const maximum =
    calibration.shoulderWidth * EARTHQUAKE_CONFIG.handToHeadShoulderRatio
  return (
    point(observation, LANDMARK.leftWrist).visibility >=
      EARTHQUAKE_CONFIG.minVisibility &&
    point(observation, LANDMARK.rightWrist).visibility >=
      EARTHQUAKE_CONFIG.minVisibility &&
    distance(point(observation, LANDMARK.leftWrist), leftHead) <= maximum &&
    distance(point(observation, LANDMARK.rightWrist), rightHead) <= maximum
  )
}

export function classifyPose(
  step: EarthquakeStep,
  observation: PoseObservation,
  calibration: PoseCalibration,
): PoseMatch {
  if (!isFullBodyVisible(observation)) {
    return {
      matched: false,
      confidence: 0,
      coaching: 'Step back until your whole body is inside the frame.',
      fullBodyVisible: false,
    }
  }
  const drop = dropStatus(observation, calibration)
  if (!drop.lowered)
    return {
      matched: false,
      confidence: drop.confidence,
      coaching: 'Get low—lower your hips toward the floor.',
      fullBodyVisible: true,
    }
  if (!drop.kneesBent)
    return {
      matched: false,
      confidence: drop.confidence,
      coaching: 'Bend both knees into a safe crouch.',
      fullBodyVisible: true,
    }
  if (step === 'drop')
    return {
      matched: true,
      confidence: drop.confidence,
      coaching: 'Great drop! Hold steady.',
      fullBodyVisible: true,
    }
  const covered = handsProtectHead(observation, calibration)
  if (!covered)
    return {
      matched: false,
      confidence: drop.confidence * 0.7,
      coaching: 'Bring both hands over your head and neck.',
      fullBodyVisible: true,
    }
  return {
    matched: true,
    confidence: Math.max(0.8, drop.confidence),
    coaching:
      step === 'hold'
        ? 'Stay low, protect your head, and hold on!'
        : 'Head and neck protected—hold steady.',
    fullBodyVisible: true,
  }
}

export function starsForTime(seconds: number): 1 | 2 | 3 {
  if (seconds <= EARTHQUAKE_CONFIG.stars.three) return 3
  if (seconds <= EARTHQUAKE_CONFIG.stars.two) return 2
  return 1
}
