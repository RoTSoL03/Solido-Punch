import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import { EARTHQUAKE_CONFIG } from './config'
import type { PoseDiagnostics, PoseModel, PoseObservation } from './types'

const WASM_ROOT = `${import.meta.env.BASE_URL}mediapipe/wasm`
const MODEL_URLS: Record<PoseModel, string> = {
  full: `${import.meta.env.BASE_URL}mediapipe/models/pose_landmarker_full.task`,
  lite: `${import.meta.env.BASE_URL}mediapipe/models/pose_landmarker_lite.task`,
}

export class PoseVision {
  private landmarker: PoseLandmarker | null = null
  private initialization: Promise<void> | null = null
  private lastVideoTime = -1
  private nextDetectionAt = 0
  private inputCanvas = document.createElement('canvas')
  private inputContext = this.inputCanvas.getContext('2d', {
    alpha: false,
    desynchronized: true,
  })
  private inferenceSamples: Array<{ at: number; duration: number }> = []
  private maximumPoses = 1
  private model: PoseModel = 'full'
  private delegate: 'GPU' | 'CPU' = 'GPU'
  private inputWidth = 960
  private inputHeight = 540

  configure(maximumPoses: number): void {
    this.close()
    this.maximumPoses = Math.max(1, Math.min(5, maximumPoses))
    this.model = 'full'
    this.delegate = 'GPU'
    this.inputWidth = 960
    this.inputHeight = 540
  }

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
      baseOptions: { modelAssetPath: MODEL_URLS[this.model], delegate },
      runningMode: 'VIDEO' as const,
      numPoses: this.maximumPoses,
      minPoseDetectionConfidence: 0.45,
      minPosePresenceConfidence: 0.45,
      minTrackingConfidence: 0.45,
    })
    try {
      this.landmarker = await PoseLandmarker.createFromOptions(
        vision,
        options('GPU'),
      )
      this.delegate = 'GPU'
    } catch {
      this.model = 'lite'
      this.landmarker = await PoseLandmarker.createFromOptions(
        vision,
        options('CPU'),
      )
      this.delegate = 'CPU'
    }
  }

  detect(video: HTMLVideoElement, now: number): PoseObservation[] | null {
    if (
      !this.landmarker ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      video.currentTime === this.lastVideoTime ||
      now < this.nextDetectionAt
    )
      return null
    this.lastVideoTime = video.currentTime
    this.nextDetectionAt = now + 1000 / EARTHQUAKE_CONFIG.trackingFps
    const input = this.prepareInput(video)
    const started = performance.now()
    const result = this.landmarker.detectForVideo(input, now)
    const duration = performance.now() - started
    this.inferenceSamples.push({ at: now, duration })
    const cutoff = now - 5000
    while (this.inferenceSamples[0]?.at < cutoff) this.inferenceSamples.shift()
    return result.landmarks.map((landmarks, index) => ({
      timestamp: now,
      landmarks: landmarks.map(({ x, y, z, visibility }) => ({
        x,
        y,
        z,
        visibility: visibility ?? 0,
      })),
      worldLandmarks: result.worldLandmarks[index]?.map(
        ({ x, y, z, visibility }) => ({
          x,
          y,
          z,
          visibility: visibility ?? 0,
        }),
      ),
    }))
  }

  private prepareInput(video: HTMLVideoElement): TexImageSource {
    if (!this.inputContext) return video
    const aspect = video.videoWidth / Math.max(video.videoHeight, 1)
    const targetWidth = this.inputWidth
    const targetHeight = Math.round(targetWidth / aspect)
    if (
      this.inputCanvas.width !== targetWidth ||
      this.inputCanvas.height !== targetHeight
    ) {
      this.inputCanvas.width = targetWidth
      this.inputCanvas.height = targetHeight
      this.inputHeight = targetHeight
    }
    this.inputContext.drawImage(video, 0, 0, targetWidth, targetHeight)
    return this.inputCanvas
  }

  getAverageInferenceMs(
    windowMs = EARTHQUAKE_CONFIG.performanceWindowMs,
    now = performance.now(),
  ): number {
    const samples = this.inferenceSamples.filter(
      (sample) => sample.at >= now - windowMs,
    )
    return samples.length
      ? samples.reduce((sum, sample) => sum + sample.duration, 0) /
          samples.length
      : 0
  }

  getDiagnostics(now = performance.now()): PoseDiagnostics {
    return {
      inferenceMs: this.getAverageInferenceMs(undefined, now),
      model: this.model,
      delegate: this.delegate,
      inputWidth: this.inputWidth,
      inputHeight: this.inputHeight,
    }
  }

  async activatePerformanceMode(): Promise<void> {
    if (this.model === 'lite' && this.inputWidth <= 640) return
    this.landmarker?.close()
    this.landmarker = null
    this.initialization = null
    this.model = 'lite'
    this.inputWidth = 640
    this.inputHeight = 360
    this.inferenceSamples = []
    this.lastVideoTime = -1
    await this.initialize()
  }

  close(): void {
    this.landmarker?.close()
    this.landmarker = null
    this.initialization = null
    this.inferenceSamples = []
  }
}
