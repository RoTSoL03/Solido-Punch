export type EarthquakeStep = 'drop' | 'cover' | 'hold'
export type EarthquakeMode = 'solo' | 'group'
export type PoseModel = 'full' | 'lite'

export type EarthquakePhase =
  | 'consent'
  | 'loading'
  | 'framing'
  | 'calibrating'
  | 'demonstrate'
  | 'matching'
  | 'results'
  | 'error'

export interface PosePoint {
  x: number
  y: number
  z: number
  visibility: number
}

export interface PoseObservation {
  landmarks: PosePoint[]
  worldLandmarks?: PosePoint[]
  timestamp: number
}

export interface TrackedPose {
  id: number
  observation: PoseObservation
  lastSeenAt: number
  staleMs: number
}

export interface PoseCalibration {
  hipY: number
  bodyHeight: number
  shoulderWidth: number
}

export interface PoseMatch {
  matched: boolean
  confidence: number
  coaching: string
  fullBodyVisible: boolean
}

export interface PoseCapture {
  step: EarthquakeStep
  label: string
  reactionSeconds: number
  dataUrl: string
}

export interface EarthquakeResult {
  totalSeconds: number
  stars: 1 | 2 | 3
  captures: PoseCapture[]
  mode: EarthquakeMode
  participantCount: number
}

export interface PoseDiagnostics {
  inferenceMs: number
  model: PoseModel
  delegate: 'GPU' | 'CPU'
  inputWidth: number
  inputHeight: number
}
