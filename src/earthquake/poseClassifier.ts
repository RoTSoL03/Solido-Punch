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
  leftElbow: 13,
  rightElbow: 14,
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
): {
  lowered: boolean
  kneesBent: boolean
  torsoUpright: boolean
  confidence: number
} {
  const shoulders = midpoint(
    point(observation, LANDMARK.leftShoulder),
    point(observation, LANDMARK.rightShoulder),
  )
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
  const torsoHeight = hips.y - shoulders.y
  const torsoLean =
    (Math.atan2(Math.abs(hips.x - shoulders.x), Math.abs(torsoHeight)) * 180) /
    Math.PI
  const torsoUpright =
    torsoHeight >=
      calibration.bodyHeight * EARTHQUAKE_CONFIG.minimumTorsoHeightRatio &&
    torsoLean <= EARTHQUAKE_CONFIG.maximumTorsoLeanDegrees
  return {
    lowered: loweredBy >= EARTHQUAKE_CONFIG.dropHipRatio,
    kneesBent: kneeAngle <= EARTHQUAKE_CONFIG.maxBentKneeDegrees,
    torsoUpright,
    confidence: Math.min(
      1,
      Math.max(0, loweredBy / EARTHQUAKE_CONFIG.dropHipRatio) * 0.45 +
        Math.max(
          0,
          (180 - kneeAngle) / (180 - EARTHQUAKE_CONFIG.maxBentKneeDegrees),
        ) *
          0.35 +
        (torsoUpright ? 0.2 : 0),
    ),
  }
}

interface HeadProtectionStatus {
  covered: boolean
  crownCovered: boolean
  napeCovered: boolean
}

function handsProtectHead(
  observation: PoseObservation,
  calibration: PoseCalibration,
): HeadProtectionStatus {
  const nose = point(observation, LANDMARK.nose)
  const ears = midpoint(
    point(observation, LANDMARK.leftEar),
    point(observation, LANDMARK.rightEar),
  )
  const shoulders = midpoint(
    point(observation, LANDMARK.leftShoulder),
    point(observation, LANDMARK.rightShoulder),
  )
  const crown = {
    ...ears,
    y:
      Math.min(nose.y, ears.y) -
      Math.max(calibration.shoulderWidth * 0.18, 0.018),
  }
  const nape = {
    ...ears,
    y: ears.y + (shoulders.y - ears.y) * 0.55,
  }
  const wrists = [
    point(observation, LANDMARK.leftWrist),
    point(observation, LANDMARK.rightWrist),
  ]
  const world = observation.worldLandmarks
  const leftWorldEar = world?.[LANDMARK.leftEar]
  const rightWorldEar = world?.[LANDMARK.rightEar]
  const worldHead =
    leftWorldEar && rightWorldEar ? midpoint(leftWorldEar, rightWorldEar) : null
  const isCrown = (wrist: PosePoint) =>
    wrist.visibility >= 0.45 &&
    wrist.y <= ears.y + calibration.bodyHeight * 0.025 &&
    distance(wrist, crown) <=
      calibration.shoulderWidth * EARTHQUAKE_CONFIG.crownRadiusShoulderRatio
  const isNape = (wrist: PosePoint, index: number) => {
    const worldWrist =
      world?.[index === 0 ? LANDMARK.leftWrist : LANDMARK.rightWrist]
    const depthPlausible =
      !worldWrist || !worldHead || worldWrist.z >= worldHead.z - 0.12
    return (
      wrist.visibility >= 0.28 &&
      wrist.y >= ears.y + calibration.shoulderWidth * 0.07 &&
      wrist.y <= shoulders.y + calibration.shoulderWidth * 0.2 &&
      distance(wrist, nape) <=
        calibration.shoulderWidth * EARTHQUAKE_CONFIG.napeRadiusShoulderRatio &&
      depthPlausible
    )
  }
  const leftCrown = isCrown(wrists[0])
  const rightCrown = isCrown(wrists[1])
  const leftNape = isNape(wrists[0], 0)
  const rightNape = isNape(wrists[1], 1)
  return {
    covered: (leftCrown && rightNape) || (rightCrown && leftNape),
    crownCovered: leftCrown || rightCrown,
    napeCovered: leftNape || rightNape,
  }
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
  if (!drop.torsoUpright)
    return {
      matched: false,
      confidence: drop.confidence,
      coaching: 'Stay in a lowered squat—keep your chest upright.',
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
  if (!covered.crownCovered)
    return {
      matched: false,
      confidence: drop.confidence * 0.7,
      coaching: 'Place one hand on top of your head.',
      fullBodyVisible: true,
    }
  if (!covered.napeCovered)
    return {
      matched: false,
      confidence: drop.confidence * 0.7,
      coaching: 'Move your other hand behind your neck.',
      fullBodyVisible: true,
    }
  if (!covered.covered)
    return {
      matched: false,
      confidence: drop.confidence * 0.7,
      coaching: 'Use separate hands to protect your head and neck.',
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
