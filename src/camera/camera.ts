import { getPerformanceProfile } from '../performance/profile'

export type FacingMode = 'user' | 'environment'

export interface CameraStartOptions {
  width?: number
  height?: number
  frameRate?: number
}

export interface CameraSettings {
  width: number
  height: number
  frameRate: number
  facingMode: FacingMode
}

export function cameraConstraintCandidates(
  facing: FacingMode,
  options: CameraStartOptions,
): MediaStreamConstraints[] {
  const profile =
    options.width === undefined || options.height === undefined
      ? getPerformanceProfile()
      : null
  const width = options.width ?? profile?.cameraWidth ?? 1280
  const height = options.height ?? profile?.cameraHeight ?? 720
  const frameRate = options.frameRate ?? 30
  const candidates: MediaStreamConstraints[] = [
    {
      audio: false,
      video: {
        facingMode: { ideal: facing },
        width: { ideal: width },
        height: { ideal: height },
        frameRate: { ideal: frameRate, max: 30 },
      },
    },
  ]

  if (width >= 1920 || height >= 1080) {
    candidates.push({
      audio: false,
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: Math.min(frameRate, 30), max: 30 },
      },
    })
  }

  candidates.push({ audio: false, video: { facingMode: facing } })
  return candidates
}

export class CameraController {
  private stream: MediaStream | null = null
  facing: FacingMode = 'user'

  async start(
    video: HTMLVideoElement,
    facing = this.facing,
    options: CameraStartOptions = {},
  ): Promise<CameraSettings> {
    this.stop()
    this.facing = facing
    let lastError: unknown
    for (const constraints of cameraConstraintCandidates(facing, options)) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia(constraints)
        break
      } catch (error) {
        lastError = error
      }
    }
    if (!this.stream) throw lastError
    video.srcObject = this.stream
    try {
      await video.play()
    } catch (error) {
      video.srcObject = null
      this.stop()
      throw error
    }
    const settings = this.stream.getVideoTracks()[0]?.getSettings()
    return {
      width: settings?.width ?? video.videoWidth,
      height: settings?.height ?? video.videoHeight,
      frameRate: settings?.frameRate ?? options.frameRate ?? 30,
      facingMode: this.facing,
    }
  }

  async switch(video: HTMLVideoElement): Promise<FacingMode> {
    const next = this.facing === 'user' ? 'environment' : 'user'
    await this.start(video, next)
    return next
  }

  stop(): void {
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
  }
}

export function friendlyCameraError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError')
      return 'Camera access was blocked. Allow camera permission in your browser, then try again.'
    if (error.name === 'NotFoundError')
      return 'No camera was found. Connect a camera or use keyboard training mode.'
    if (error.name === 'NotReadableError')
      return 'Your camera is busy in another app. Close that app, then try again.'
  }
  if (!window.isSecureContext)
    return 'Camera access needs HTTPS on a phone. Open this game on a secure address.'
  return 'The camera could not start. Check browser permissions and try again.'
}
