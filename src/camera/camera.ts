import { getPerformanceProfile } from '../performance/profile'

export type FacingMode = 'user' | 'environment'

export class CameraController {
  private stream: MediaStream | null = null
  facing: FacingMode = 'user'

  async start(video: HTMLVideoElement, facing = this.facing): Promise<void> {
    this.stop()
    this.facing = facing
    const profile = getPerformanceProfile()
    const preferred: MediaStreamConstraints = {
      audio: false,
      video: {
        facingMode: { ideal: facing },
        width: { ideal: profile.cameraWidth },
        height: { ideal: profile.cameraHeight },
        frameRate: { ideal: 30, max: 30 },
      },
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(preferred)
    } catch {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: facing },
      })
    }
    video.srcObject = this.stream
    try {
      await video.play()
    } catch (error) {
      video.srcObject = null
      this.stop()
      throw error
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
