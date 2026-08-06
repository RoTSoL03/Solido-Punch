export interface PerformanceProfile {
  cameraWidth: number
  cameraHeight: number
  trackingWidth: number
  trackingHeight: number
  renderFps: number
  trackingFps: number
  pixelRatio: number
  antialias: boolean
  particleCount: number
}

interface DeviceSignals {
  cores: number
  memory: number
  coarsePointer: boolean
  reducedMotion: boolean
  devicePixelRatio: number
}

let cachedProfile: PerformanceProfile | null = null

export function createPerformanceProfile(
  signals: DeviceSignals,
): PerformanceProfile {
  const constrained = signals.cores <= 4 || signals.memory <= 3
  const balanced =
    constrained || signals.coarsePointer || signals.devicePixelRatio > 2

  if (constrained) {
    return {
      cameraWidth: 640,
      cameraHeight: 480,
      trackingWidth: 448,
      trackingHeight: 336,
      renderFps: 30,
      trackingFps: 24,
      pixelRatio: 1,
      antialias: false,
      particleCount: signals.reducedMotion ? 0 : 3,
    }
  }

  if (balanced) {
    return {
      cameraWidth: 720,
      cameraHeight: 540,
      trackingWidth: 512,
      trackingHeight: 384,
      renderFps: 30,
      trackingFps: 30,
      pixelRatio: 1,
      antialias: false,
      particleCount: signals.reducedMotion ? 0 : 4,
    }
  }

  return {
    cameraWidth: 1280,
    cameraHeight: 720,
    trackingWidth: 768,
    trackingHeight: 432,
    renderFps: 60,
    trackingFps: 30,
    pixelRatio: Math.min(signals.devicePixelRatio, 1.5),
    antialias: true,
    particleCount: signals.reducedMotion ? 0 : 8,
  }
}

export function getPerformanceProfile(): PerformanceProfile {
  if (cachedProfile) return cachedProfile
  const navigatorWithMemory = navigator as Navigator & {
    deviceMemory?: number
  }
  cachedProfile = createPerformanceProfile({
    cores: navigator.hardwareConcurrency || 4,
    memory: navigatorWithMemory.deviceMemory || 4,
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)')
      .matches,
    devicePixelRatio: window.devicePixelRatio || 1,
  })
  return cachedProfile
}
