import { GAME_CONFIG } from '../config'
import { distance } from '../math/coordinates'
import type { Point2, Point3 } from '../types'

const FIST_CORE = [5, 6, 9, 10, 13, 14, 17, 18] as const
const FINGERS = [
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
] as const

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

const distance3 = (a: Point3, b: Point3): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

function angleAt(a: Point3, joint: Point3, b: Point3): number {
  const first = {
    x: a.x - joint.x,
    y: a.y - joint.y,
    z: a.z - joint.z,
  }
  const second = {
    x: b.x - joint.x,
    y: b.y - joint.y,
    z: b.z - joint.z,
  }
  const denominator =
    Math.hypot(first.x, first.y, first.z) *
    Math.hypot(second.x, second.y, second.z)
  if (denominator < 1e-6) return Math.PI
  const cosine = Math.max(
    -1,
    Math.min(
      1,
      (first.x * second.x + first.y * second.y + first.z * second.z) /
        denominator,
    ),
  )
  return Math.acos(cosine)
}

const angleCurl = (angle: number): number =>
  clamp01((Math.PI * 0.92 - angle) / (Math.PI * 0.42))

function getPalmCenter3(landmarks: Point3[]): Point3 {
  const indices = [0, 5, 9, 13, 17]
  const points = indices.map((index) => landmarks[index])
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    z: points.reduce((sum, point) => sum + point.z, 0) / points.length,
  }
}

export function getFistCenter(landmarks: Point3[]): Point2 {
  const points = FIST_CORE.map((index) => landmarks[index]).filter(Boolean)
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  }
}

export function getHandOrientation(
  landmarks: Point3[],
  worldLandmarks: Point3[] = landmarks,
  mirrorX = false,
): Point3 {
  const wrist = landmarks[0]
  const middle = landmarks[9]
  const worldWrist = worldLandmarks[0]
  const worldMiddle = worldLandmarks[9]
  const worldIndex = worldLandmarks[5]
  const worldPinky = worldLandmarks[17]
  const screenLongitudinal = {
    x: (middle.x - wrist.x) * (mirrorX ? -1 : 1),
    y: middle.y - wrist.y,
  }
  const worldLongitudinal = {
    x: (worldMiddle.x - worldWrist.x) * (mirrorX ? -1 : 1),
    y: worldMiddle.y - worldWrist.y,
    z: worldMiddle.z - worldWrist.z,
  }
  const worldRight = {
    x: (worldIndex.x - worldPinky.x) * (mirrorX ? -1 : 1),
    y: worldIndex.y - worldPinky.y,
    z: worldIndex.z - worldPinky.z,
  }
  const roll = -(
    Math.atan2(screenLongitudinal.y, screenLongitudinal.x) +
    Math.PI / 2
  )
  const longitudinalScreenLength = Math.max(
    Math.hypot(worldLongitudinal.x, worldLongitudinal.y),
    0.001,
  )
  const lateralScreenLength = Math.max(
    Math.hypot(worldRight.x, worldRight.y),
    0.001,
  )
  const clampTilt = (value: number) =>
    Math.max(
      -GAME_CONFIG.fistModel.maxTilt,
      Math.min(GAME_CONFIG.fistModel.maxTilt, value),
    )
  return {
    x: clampTilt(
      Math.atan2(-worldLongitudinal.z, longitudinalScreenLength) *
        GAME_CONFIG.fistModel.depthRotationMultiplier,
    ),
    y: clampTilt(
      Math.atan2(worldRight.z, lateralScreenLength) *
        GAME_CONFIG.fistModel.depthRotationMultiplier,
    ),
    z: roll,
  }
}

export function getFistRadius(landmarks: Point3[]): number {
  const palmWidth = distance(landmarks[5], landmarks[17])
  const wristDepth = distance(landmarks[0], landmarks[9])
  return Math.max(
    GAME_CONFIG.punch.minRadius,
    ((palmWidth + wristDepth) / 2) * GAME_CONFIG.punch.radiusScale,
  )
}

export function classifyFist(landmarks: Point3[]): {
  closed: boolean
  confidence: number
} {
  if (landmarks.length < 21) return { closed: false, confidence: 0 }
  const palm = getPalmCenter3(landmarks)
  const wrist = landmarks[0]
  const palmScale = Math.max(distance3(landmarks[5], landmarks[17]), 0.04)
  const fingerScores = FINGERS.map(([mcp, pip, dip, tip]) => {
    const pipCurl = angleCurl(
      angleAt(landmarks[mcp], landmarks[pip], landmarks[dip]),
    )
    const dipCurl = angleCurl(
      angleAt(landmarks[pip], landmarks[dip], landmarks[tip]),
    )
    const bendScore = pipCurl * 0.58 + dipCurl * 0.42
    const extendedReach = Math.max(
      distance3(landmarks[mcp], wrist),
      palmScale * 0.35,
    )
    const reachRatio = distance3(landmarks[tip], wrist) / extendedReach
    const reachScore = clamp01((1.5 - reachRatio) / 0.72)
    const proximityScore = clamp01(
      (1.18 - distance3(landmarks[tip], palm) / palmScale) / 0.7,
    )
    return bendScore * 0.46 + reachScore * 0.36 + proximityScore * 0.18
  })

  const folded = fingerScores.filter((score) => score >= 0.44).length
  const averageFingerScore =
    fingerScores.reduce((sum, score) => sum + score, 0) / fingerScores.length
  const thumbBend = angleCurl(angleAt(landmarks[2], landmarks[3], landmarks[4]))
  const thumbProximity = clamp01(
    (1.05 - distance3(landmarks[4], palm) / palmScale) / 0.72,
  )
  const thumbScore = thumbBend * 0.38 + thumbProximity * 0.62
  const confidence = clamp01(averageFingerScore * 0.88 + thumbScore * 0.12)
  return {
    closed:
      folded >= 3 &&
      averageFingerScore >= GAME_CONFIG.punch.fistEnterConfidence,
    confidence,
  }
}
