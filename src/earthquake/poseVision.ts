import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import { EARTHQUAKE_CONFIG } from './config'
import type { PoseObservation } from './types'

const WASM_ROOT = `${import.meta.env.BASE_URL}mediapipe/wasm`
const MODEL_URL = `${import.meta.env.BASE_URL}mediapipe/models/pose_landmarker_lite.task`

export class PoseVision {
  private landmarker: PoseLandmarker | null = null
  private initialization: Promise<void> | null = null
  private lastVideoTime = -1
  private nextDetectionAt = 0

  initialize(): Promise<void> {
    this.initialization ??= this.create().catch((error) => {
      this.initialization = null
      throw error
    })
    return this.initialization
  }

  private async create(): Promise<void> {
    const { FilesetResolver, PoseLandmarker } =
      await import('@mediapipe/tasks-vision')
    const vision = await FilesetResolver.forVisionTasks(WASM_ROOT)
    const options = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO' as const,
      numPoses: 1,
      minPoseDetectionConfidence: 0.45,
      minPosePresenceConfidence: 0.45,
      minTrackingConfidence: 0.45,
    })
    try {
      this.landmarker = await PoseLandmarker.createFromOptions(
        vision,
        options('GPU'),
      )
    } catch {
      this.landmarker = await PoseLandmarker.createFromOptions(
        vision,
        options('CPU'),
      )
    }
  }

  detect(video: HTMLVideoElement, now: number): PoseObservation | null {
    if (
      !this.landmarker ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      video.currentTime === this.lastVideoTime ||
      now < this.nextDetectionAt
    )
      return null
    this.lastVideoTime = video.currentTime
    this.nextDetectionAt = now + 1000 / EARTHQUAKE_CONFIG.trackingFps
    const result = this.landmarker.detectForVideo(video, now)
    const landmarks = result.landmarks[0]
    if (!landmarks) return null
    return {
      landmarks: landmarks.map(({ x, y, z, visibility }) => ({
        x,
        y,
        z,
        visibility: visibility ?? 0,
      })),
    }
  }

  close(): void {
    this.landmarker?.close()
    this.landmarker = null
    this.initialization = null
  }
}
