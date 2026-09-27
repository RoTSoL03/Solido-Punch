import type {
  HandLandmarker,
  HandLandmarkerResult,
} from '@mediapipe/tasks-vision'
import { GAME_CONFIG } from '../config'
import { getPerformanceProfile } from '../performance/profile'
import type { HandObservation } from '../types'

const WASM_ROOT = `${import.meta.env.BASE_URL}mediapipe/wasm`
const MODEL_URL = `${import.meta.env.BASE_URL}mediapipe/models/hand_landmarker.task`

export class HandVision {
  private readonly profile = getPerformanceProfile()
  private readonly inputCanvas = document.createElement('canvas')
  private readonly inputContext = this.inputCanvas.getContext('2d', {
    alpha: false,
    desynchronized: true,
  })
  private landmarker: HandLandmarker | null = null
  private initialization: Promise<void> | null = null
  private disposed = false
  private lastVideoTime = -1
  private nextDetectionAt = 0
  private readonly minimumInterval = 1000 / this.profile.trackingFps
  private detectionInterval = this.minimumInterval
  private inputScale = 1
  private slowInferenceFrames = 0
  private inferenceSamples: Array<{ at: number; duration: number }> = []

  constructor(private maximumHands: number = GAME_CONFIG.maxHands) {}

  initialize(): Promise<void> {
    if (this.landmarker) return Promise.resolve()
    if (!this.initialization) {
      this.initialization = this.createLandmarker().catch((error) => {
        this.initialization = null
        throw error
      })
    }
    return this.initialization
  }

  private async createLandmarker(): Promise<void> {
    const { FilesetResolver, HandLandmarker } =
      await import('@mediapipe/tasks-vision')
    const vision = await FilesetResolver.forVisionTasks(WASM_ROOT)
    if (this.disposed) return
    const options = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO' as const,
      numHands: this.maximumHands,
      minHandDetectionConfidence: GAME_CONFIG.vision.minDetectionConfidence,
      minHandPresenceConfidence: GAME_CONFIG.vision.minPresenceConfidence,
      minTrackingConfidence: GAME_CONFIG.vision.minTrackingConfidence,
    })
    let landmarker: HandLandmarker
    try {
      landmarker = await HandLandmarker.createFromOptions(
        vision,
        options('GPU'),
      )
    } catch {
      if (this.disposed) return
      landmarker = await HandLandmarker.createFromOptions(
        vision,
        options('CPU'),
      )
    }
    if (this.disposed) landmarker.close()
    else this.landmarker = landmarker
  }

  detect(video: HTMLVideoElement, timestamp: number): HandObservation[] | null {
    if (
      !this.landmarker ||
      timestamp + 3 < this.nextDetectionAt ||
      video.currentTime === this.lastVideoTime
    )
      return null
    this.lastVideoTime = video.currentTime
    const startedAt = performance.now()
    const input = this.prepareInput(video)
    const result = this.landmarker.detectForVideo(input, timestamp)
    const inferenceMs = performance.now() - startedAt
    this.inferenceSamples.push({ at: timestamp, duration: inferenceMs })
    const cutoff = timestamp - 5000
    while (this.inferenceSamples[0]?.at < cutoff) this.inferenceSamples.shift()
    this.adaptInputResolution(video, inferenceMs)
    const sustainableInterval = Math.max(
      this.minimumInterval,
      inferenceMs * 1.08,
    )
    this.detectionInterval = Math.min(
      1000 / 15,
      this.detectionInterval * 0.72 + sustainableInterval * 0.28,
    )
    this.nextDetectionAt =
      timestamp + Math.max(this.minimumInterval, this.detectionInterval - 4)
    return this.toObservations(result)
  }

  getAverageInferenceMs(windowMs = 3000, now = performance.now()): number {
    const samples = this.inferenceSamples.filter(
      (sample) => sample.at >= now - windowMs,
    )
    if (samples.length === 0) return 0
    return (
      samples.reduce((sum, sample) => sum + sample.duration, 0) / samples.length
    )
  }

  async reconfigure(maximumHands: number): Promise<void> {
    if (maximumHands === this.maximumHands && this.landmarker) return
    this.landmarker?.close()
    this.landmarker = null
    this.initialization = null
    this.maximumHands = maximumHands
    this.lastVideoTime = -1
    this.nextDetectionAt = 0
    this.inferenceSamples = []
    await this.initialize()
  }

  private prepareInput(video: HTMLVideoElement): TexImageSource {
    if (!this.inputContext) return video
    this.resizeInput(video)
    this.inputContext.drawImage(
      video,
      0,
      0,
      this.inputCanvas.width,
      this.inputCanvas.height,
    )
    return this.inputCanvas
  }

  private resizeInput(video: HTMLVideoElement): void {
    const sourceWidth = Math.max(1, video.videoWidth)
    const sourceHeight = Math.max(1, video.videoHeight)
    const scale = Math.min(
      (this.profile.trackingWidth * this.inputScale) / sourceWidth,
      (this.profile.trackingHeight * this.inputScale) / sourceHeight,
      1,
    )
    const width = Math.max(2, Math.round((sourceWidth * scale) / 2) * 2)
    const height = Math.max(2, Math.round((sourceHeight * scale) / 2) * 2)
    if (this.inputCanvas.width === width && this.inputCanvas.height === height)
      return
    this.inputCanvas.width = width
    this.inputCanvas.height = height
  }

  private adaptInputResolution(
    video: HTMLVideoElement,
    inferenceMs: number,
  ): void {
    const tooSlow = inferenceMs > Math.max(45, this.minimumInterval * 1.2)
    this.slowInferenceFrames = tooSlow
      ? this.slowInferenceFrames + 1
      : Math.max(0, this.slowInferenceFrames - 2)
    if (this.slowInferenceFrames < 8 || this.inputScale <= 0.72) return
    this.inputScale = Math.max(0.72, this.inputScale * 0.85)
    this.slowInferenceFrames = 0
    this.resizeInput(video)
  }

  private toObservations(result: HandLandmarkerResult): HandObservation[] {
    return result.landmarks.map((landmarks, index) => {
      const category = result.handedness[index]?.[0]?.categoryName
      const handedness =
        category === 'Left' || category === 'Right' ? category : 'Unknown'
      return {
        landmarks: landmarks.map(({ x, y, z }) => ({ x, y, z })),
        worldLandmarks: result.worldLandmarks[index]?.map(({ x, y, z }) => ({
          x,
          y,
          z,
        })),
        handedness,
      }
    })
  }

  close(): void {
    this.disposed = true
    this.landmarker?.close()
    this.landmarker = null
    this.lastVideoTime = -1
    this.nextDetectionAt = 0
    this.detectionInterval = this.minimumInterval
    this.inputScale = 1
    this.slowInferenceFrames = 0
    this.inferenceSamples = []
  }
}
