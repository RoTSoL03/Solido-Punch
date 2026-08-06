import type { TargetKind } from './config'

export interface Point3 {
  x: number
  y: number
  z: number
}

export interface Point2 {
  x: number
  y: number
}

export type PunchPhase = 'idle' | 'armed' | 'punching' | 'cooldown'

export interface HandObservation {
  landmarks: Point3[]
  worldLandmarks?: Point3[]
  handedness: 'Left' | 'Right' | 'Unknown'
  orientation?: Point3
}

export interface TrackedFist {
  id: number
  handedness: HandObservation['handedness']
  center: Point2
  previousCenter?: Point2
  radius: number
  isFist: boolean
  speed: number
  confidence: number
  phase: PunchPhase
  orientation: Point3
}

export interface TargetSnapshot {
  id: number
  kind: TargetKind
  x: number
  y: number
  radius: number
  hit: boolean
}

export interface HudSnapshot {
  score: number
  combo: number
  bestCombo: number
  lives: number
  time: number
  fps: number
  hands: TrackedFist[]
  activeTargets: number
  scoreMultiplier: 1 | 2
  multiplierTime: number
}

export type GamePhase =
  | 'idle'
  | 'requesting'
  | 'calibrating'
  | 'countdown'
  | 'playing'
  | 'paused'
  | 'gameover'
  | 'error'
