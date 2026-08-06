import { friendlyCameraError } from '../camera/camera'

export type StartupStage = 'camera' | 'tracking'

export class StartupError extends Error {
  constructor(
    readonly stage: StartupStage,
    cause: unknown,
  ) {
    super(`Failed to initialize ${stage}`, { cause })
    this.name = 'StartupError'
  }
}

export interface StartupErrorDescription {
  title: string
  message: string
}

export function describeStartupError(error: unknown): StartupErrorDescription {
  if (error instanceof StartupError && error.stage === 'tracking') {
    return {
      title: 'Hand tracking couldn’t start',
      message:
        'Your camera opened, but the hand-tracking engine could not load. Check your connection, then try again.',
    }
  }

  const cameraError = error instanceof StartupError ? error.cause : error
  return {
    title: 'We couldn’t open the camera',
    message: friendlyCameraError(cameraError),
  }
}
