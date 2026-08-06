import { GAME_CONFIG } from '../config'
import { distance } from '../math/coordinates'
import type {
  HandObservation,
  Point2,
  Point3,
  PunchPhase,
  TrackedFist,
} from '../types'
import {
  classifyFist,
  getFistCenter,
  getFistRadius,
  getHandOrientation,
} from './fist'

interface HandState {
  id: number
  label: HandObservation['handedness']
  center: Point2
  previousCenter: Point2
  rawCenter: Point2
  velocity: Point2
  landmarks: Point3[]
  radius: number
  speed: number
  phase: PunchPhase
  cooldownUntil: number
  punchUntil: number
  lastTime: number
  isFist: boolean
  confidence: number
  lastStrongFistAt: number
  orientation: { x: number; y: number; z: number }
  pendingLabel: HandObservation['handedness']
  pendingLabelFrames: number
  seen: boolean
}

export class PunchTracker {
  private states = new Map<number, HandState>()
  private nextId = 1

  update(observations: HandObservation[], now: number): TrackedFist[] {
    for (const state of this.states.values()) state.seen = false
    const visibleObservations = observations.slice(0, GAME_CONFIG.maxHands)
    const rawCenters = visibleObservations.map((observation) =>
      getFistCenter(observation.landmarks),
    )
    const matches = this.matchAll(
      visibleObservations.map((observation, index) => ({
        label: observation.handedness,
        center: rawCenters[index],
      })),
      now,
    )

    for (const [
      observationIndex,
      observation,
    ] of visibleObservations.entries()) {
      const rawCenter = rawCenters[observationIndex]
      const state = matches.get(observationIndex)
      const fist = classifyFist(observation.landmarks)
      const radius = getFistRadius(observation.landmarks)
      const orientation =
        observation.orientation ?? getHandOrientation(observation.landmarks)

      if (!state) {
        const created: HandState = {
          id: this.nextId++,
          label: observation.handedness,
          center: rawCenter,
          previousCenter: rawCenter,
          rawCenter,
          velocity: { x: 0, y: 0 },
          landmarks: observation.landmarks.map((point) => ({ ...point })),
          radius,
          speed: 0,
          phase: 'idle',
          cooldownUntil: 0,
          punchUntil: 0,
          lastTime: now,
          isFist: fist.closed,
          confidence: fist.confidence,
          lastStrongFistAt: fist.closed ? now : -Infinity,
          orientation,
          pendingLabel: 'Unknown',
          pendingLabelFrames: 0,
          seen: true,
        }
        this.states.set(created.id, created)
        continue
      }

      const elapsedMs = Math.max(
        8,
        Math.min(now - state.lastTime, GAME_CONFIG.punch.maxFrameMs),
      )
      const dt = elapsedMs / 1000
      const smoothedLandmarks = observation.landmarks.map((point, index) => {
        const previous = state.landmarks[index] ?? point
        const motion = Math.hypot(
          point.x - previous.x,
          point.y - previous.y,
          (point.z - previous.z) * 0.55,
        )
        const smoothingRate =
          GAME_CONFIG.punch.landmarkSmoothingRate +
          motion * GAME_CONFIG.punch.landmarkMotionRate
        const alpha = Math.min(
          GAME_CONFIG.punch.maxSmoothing,
          1 - Math.exp(-smoothingRate * dt),
        )
        return {
          x: previous.x + (point.x - previous.x) * alpha,
          y: previous.y + (point.y - previous.y) * alpha,
          z: previous.z + (point.z - previous.z) * Math.min(alpha, 0.68),
        }
      })
      const smoothedCenter = getFistCenter(smoothedLandmarks)
      const instantVelocity = {
        x: (smoothedCenter.x - state.center.x) / dt,
        y: (smoothedCenter.y - state.center.y) / dt,
      }
      state.velocity = {
        x: state.velocity.x * 0.42 + instantVelocity.x * 0.58,
        y: state.velocity.y * 0.42 + instantVelocity.y * 0.58,
      }
      state.speed = Math.min(
        Math.hypot(state.velocity.x, state.velocity.y),
        GAME_CONFIG.punch.maxVelocity,
      )
      const smoothedFist = classifyFist(smoothedLandmarks)
      const smoothedRadius = getFistRadius(smoothedLandmarks)
      const smoothedOrientation =
        observation.orientation ?? getHandOrientation(smoothedLandmarks)
      if (smoothedFist.closed) state.lastStrongFistAt = now
      const stableFist =
        smoothedFist.closed ||
        (state.isFist &&
          (smoothedFist.confidence >= GAME_CONFIG.punch.fistExitConfidence ||
            now - state.lastStrongFistAt <= GAME_CONFIG.punch.fistGraceMs))

      state.previousCenter = state.center
      state.center = smoothedCenter
      state.rawCenter = rawCenter
      state.landmarks = smoothedLandmarks
      state.radius = state.radius * 0.58 + smoothedRadius * 0.42
      state.isFist = stableFist
      state.confidence = smoothedFist.confidence
      const orientationDelta = {
        x: this.angleDelta(state.orientation.x, smoothedOrientation.x),
        y: this.angleDelta(state.orientation.y, smoothedOrientation.y),
        z: this.angleDelta(state.orientation.z, smoothedOrientation.z),
      }
      const orientationMotion = Math.hypot(
        orientationDelta.x,
        orientationDelta.y,
        orientationDelta.z,
      )
      const orientationRate =
        GAME_CONFIG.fistModel.orientationSmoothingRate +
        orientationMotion * GAME_CONFIG.fistModel.orientationMotionRate
      const orientationAlpha = Math.min(
        0.88,
        1 - Math.exp(-orientationRate * dt),
      )
      state.orientation = {
        x: state.orientation.x + orientationDelta.x * orientationAlpha,
        y: state.orientation.y + orientationDelta.y * orientationAlpha,
        z: state.orientation.z + orientationDelta.z * orientationAlpha,
      }
      this.updateLabel(state, observation.handedness)
      state.lastTime = now
      state.seen = true
      this.advanceState(state, now)
    }

    for (const [id, state] of this.states) {
      if (state.seen) continue
      const missingFor = now - state.lastTime
      if (missingFor > GAME_CONFIG.punch.trackingHoldMs) {
        this.states.delete(id)
        continue
      }
      state.speed *= 0.72
      state.velocity.x *= 0.72
      state.velocity.y *= 0.72
      state.confidence *= 0.94
      if (state.phase === 'armed' || state.phase === 'punching')
        state.phase = 'idle'
    }
    return this.getTrackedFists(now)
  }

  markHit(id: number, now: number): void {
    const state = this.states.get(id)
    if (!state || state.phase !== 'punching') return
    state.phase = 'cooldown'
    state.cooldownUntil = now + GAME_CONFIG.punch.cooldownMs
  }

  canHit(id: number, now?: number): boolean {
    const state = this.states.get(id)
    return (
      state?.seen === true &&
      state.phase === 'punching' &&
      (now === undefined ||
        now - state.lastTime <= GAME_CONFIG.punch.hitFreshnessMs)
    )
  }

  isTrackingFresh(id: number, now: number): boolean {
    const state = this.states.get(id)
    return (
      state?.seen === true &&
      now - state.lastTime <= GAME_CONFIG.punch.hitFreshnessMs
    )
  }

  getSmoothedObservations(now: number): HandObservation[] {
    return [...this.states.values()]
      .filter(
        (state) => now - state.lastTime <= GAME_CONFIG.punch.trackingHoldMs,
      )
      .map((state) => ({
        handedness: state.label,
        landmarks: state.landmarks,
      }))
  }

  private advanceState(state: HandState, now: number): void {
    if (state.phase === 'cooldown') {
      if (now >= state.cooldownUntil)
        state.phase =
          state.isFist && state.speed >= GAME_CONFIG.punch.armedVelocity
            ? 'armed'
            : 'idle'
      return
    }
    if (!state.isFist) {
      state.phase = 'idle'
      return
    }
    if (
      state.phase === 'idle' &&
      state.speed >= GAME_CONFIG.punch.armedVelocity
    )
      state.phase = 'armed'
    if (
      (state.phase === 'idle' || state.phase === 'armed') &&
      state.speed >= GAME_CONFIG.punch.velocityThreshold
    ) {
      state.phase = 'punching'
      state.punchUntil = now + GAME_CONFIG.punch.punchGraceMs
    }
    if (
      state.phase === 'punching' &&
      now >= state.punchUntil &&
      state.speed < GAME_CONFIG.punch.resetVelocity
    )
      state.phase = 'idle'
  }

  private matchAll(
    observations: Array<{
      label: HandObservation['handedness']
      center: Point2
    }>,
    now: number,
  ): Map<number, HandState> {
    const states = [...this.states.values()]
    const unmatchedCost = GAME_CONFIG.punch.identityMaxDistance * 0.8
    let bestCost = Infinity
    let bestMatches = new Map<number, HandState>()

    const search = (
      observationIndex: number,
      usedStateIds: Set<number>,
      cost: number,
      matches: Map<number, HandState>,
    ): void => {
      if (cost >= bestCost) return
      if (observationIndex >= observations.length) {
        bestCost = cost
        bestMatches = new Map(matches)
        return
      }

      search(observationIndex + 1, usedStateIds, cost + unmatchedCost, matches)

      const observation = observations[observationIndex]
      for (const state of states) {
        if (usedStateIds.has(state.id)) continue
        const ageSeconds = Math.min((now - state.lastTime) / 1000, 0.12)
        const predicted = {
          x: state.rawCenter.x + state.velocity.x * ageSeconds * 0.35,
          y: state.rawCenter.y + state.velocity.y * ageSeconds * 0.35,
        }
        const spatialDistance = distance(predicted, observation.center)
        if (spatialDistance > GAME_CONFIG.punch.identityMaxDistance) continue
        const labelPenalty =
          observation.label !== 'Unknown' &&
          state.label !== 'Unknown' &&
          observation.label !== state.label
            ? GAME_CONFIG.punch.handednessPenalty
            : 0
        usedStateIds.add(state.id)
        matches.set(observationIndex, state)
        search(
          observationIndex + 1,
          usedStateIds,
          cost + spatialDistance + labelPenalty,
          matches,
        )
        matches.delete(observationIndex)
        usedStateIds.delete(state.id)
      }
    }

    search(0, new Set(), 0, new Map())
    return bestMatches
  }

  private updateLabel(
    state: HandState,
    observed: HandObservation['handedness'],
  ): void {
    if (observed === 'Unknown' || observed === state.label) {
      state.pendingLabel = 'Unknown'
      state.pendingLabelFrames = 0
      return
    }
    if (state.label === 'Unknown') {
      state.label = observed
      return
    }
    if (state.pendingLabel === observed) state.pendingLabelFrames += 1
    else {
      state.pendingLabel = observed
      state.pendingLabelFrames = 1
    }
    if (state.pendingLabelFrames >= GAME_CONFIG.punch.labelSwitchFrames) {
      state.label = observed
      state.pendingLabel = 'Unknown'
      state.pendingLabelFrames = 0
    }
  }

  getTrackedFists(now: number): TrackedFist[] {
    return [...this.states.values()]
      .filter(
        (state) => now - state.lastTime <= GAME_CONFIG.punch.trackingHoldMs,
      )
      .map(
        ({
          id,
          label: handedness,
          center,
          previousCenter,
          radius,
          isFist,
          speed,
          confidence,
          phase,
          orientation,
          velocity,
          lastTime,
        }) => {
          const predictionSeconds =
            Math.min(
              GAME_CONFIG.punch.modelPredictionMs,
              Math.max(12, now - lastTime + 12),
            ) / 1000
          const predictedOffset = {
            x: velocity.x * predictionSeconds,
            y: velocity.y * predictionSeconds,
          }
          const predictionDistance = Math.hypot(
            predictedOffset.x,
            predictedOffset.y,
          )
          const predictionScale =
            predictionDistance > GAME_CONFIG.punch.maxPredictionDistance
              ? GAME_CONFIG.punch.maxPredictionDistance / predictionDistance
              : 1
          return {
            id,
            handedness,
            center: {
              x: center.x + predictedOffset.x * predictionScale,
              y: center.y + predictedOffset.y * predictionScale,
            },
            previousCenter,
            radius,
            isFist,
            speed,
            confidence,
            phase,
            orientation,
          }
        },
      )
  }

  private angleDelta(from: number, to: number): number {
    return Math.atan2(Math.sin(to - from), Math.cos(to - from))
  }
}
