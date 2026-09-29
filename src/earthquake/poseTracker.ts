import type { PoseObservation, PosePoint, TrackedPose } from './types'

interface InternalTrack {
  id: number
  observation: PoseObservation
  lastSeenAt: number
}

const TORSO = [11, 12, 23, 24] as const

function torsoCenter(observation: PoseObservation): { x: number; y: number } {
  const points = TORSO.map((index) => observation.landmarks[index]).filter(
    Boolean,
  )
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  }
}

function blendPoint(previous: PosePoint, next: PosePoint, alpha: number) {
  return {
    x: previous.x + (next.x - previous.x) * alpha,
    y: previous.y + (next.y - previous.y) * alpha,
    z: previous.z + (next.z - previous.z) * alpha,
    visibility: next.visibility,
  }
}

function smoothObservation(
  previous: PoseObservation,
  next: PoseObservation,
): PoseObservation {
  const oldCenter = torsoCenter(previous)
  const newCenter = torsoCenter(next)
  const speed = Math.hypot(newCenter.x - oldCenter.x, newCenter.y - oldCenter.y)
  const alpha = Math.min(0.9, Math.max(0.38, 0.38 + speed * 8))
  return {
    ...next,
    landmarks: next.landmarks.map((point, index) =>
      previous.landmarks[index]
        ? blendPoint(previous.landmarks[index], point, alpha)
        : point,
    ),
    worldLandmarks: next.worldLandmarks?.map((point, index) =>
      previous.worldLandmarks?.[index]
        ? blendPoint(previous.worldLandmarks[index], point, alpha)
        : point,
    ),
  }
}

export class PoseIdentityTracker {
  private tracks: InternalTrack[] = []
  private nextId = 1

  update(observations: PoseObservation[], now: number): TrackedPose[] {
    const available = new Set(this.tracks.map((track) => track.id))
    const ordered = [...observations].sort(
      (a, b) => torsoCenter(a).x - torsoCenter(b).x,
    )
    for (const observation of ordered) {
      const center = torsoCenter(observation)
      let best: InternalTrack | undefined
      let bestDistance = 0.22
      for (const track of this.tracks) {
        if (!available.has(track.id)) continue
        const previous = torsoCenter(track.observation)
        const distance = Math.hypot(
          center.x - previous.x,
          center.y - previous.y,
        )
        if (distance < bestDistance) {
          best = track
          bestDistance = distance
        }
      }
      if (best) {
        best.observation = smoothObservation(best.observation, observation)
        best.lastSeenAt = now
        available.delete(best.id)
      } else {
        this.tracks.push({
          id: this.nextId++,
          observation,
          lastSeenAt: now,
        })
      }
    }
    this.tracks = this.tracks.filter((track) => now - track.lastSeenAt <= 750)
    return this.getTracked(now)
  }

  getTracked(now: number): TrackedPose[] {
    return [...this.tracks]
      .sort(
        (a, b) => torsoCenter(a.observation).x - torsoCenter(b.observation).x,
      )
      .map((track) => ({
        id: track.id,
        observation: track.observation,
        lastSeenAt: track.lastSeenAt,
        staleMs: Math.max(0, now - track.lastSeenAt),
      }))
  }

  reset(): void {
    this.tracks = []
    this.nextId = 1
  }
}
