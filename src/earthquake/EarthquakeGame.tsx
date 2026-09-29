import {
  Camera,
  Check,
  Download,
  HardDrive,
  Home,
  RefreshCw,
  Star,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import {
  CameraController,
  friendlyCameraError,
  type CameraSettings,
} from '../camera/camera'
import { videoPointToView } from '../math/coordinates'
import { EARTHQUAKE_CONFIG, POSE_STEPS } from './config'
import {
  allParticipantsMatch,
  areParticipantsFramed,
  trackingLossWithinGrace,
} from './groupRules'
import { createResultCollage } from './collage'
import {
  classifyPose,
  createCalibration,
  isFullBodyVisible,
  starsForTime,
} from './poseClassifier'
import { PoseVision } from './poseVision'
import { PoseIdentityTracker } from './poseTracker'
import { shouldActivatePoseFallback } from './performance'
import { canAutoSavePhotos, saveEarthquakeSession } from './saveSession'
import type {
  EarthquakeMode,
  EarthquakePhase,
  EarthquakeResult,
  EarthquakeStep,
  PoseCalibration,
  PoseCapture,
  PoseDiagnostics,
  PoseObservation,
  TrackedPose,
} from './types'

interface EarthquakeGameProps {
  sound: boolean
  onSoundChange: (sound: boolean) => void
  onHome: () => void
}

const STEP_COPY: Record<
  EarthquakeStep,
  { label: string; number: string; instruction: string; tip: string }
> = {
  drop: {
    label: 'DROP',
    number: '01',
    instruction: 'Get low and bend both knees.',
    tip: 'Lower your center of gravity so shaking is less likely to knock you down.',
  },
  cover: {
    label: 'COVER',
    number: '02',
    instruction: 'Protect your head and neck.',
    tip: 'Use both hands to shield the most vulnerable parts of your body.',
  },
  hold: {
    label: 'HOLD ON',
    number: '03',
    instruction: 'Stay protected and hold the position.',
    tip: 'In a real earthquake, hold onto sturdy cover until the shaking stops.',
  },
}

const CONNECTIONS = [
  [0, 7],
  [0, 8],
  [7, 11],
  [8, 12],
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
] as const

const POSE_COLORS = ['#00aeee', '#ffdf66', '#5ef0a9', '#ff7a68', '#c98cff']

const SOLIDO_POSE_IMAGES: Record<EarthquakeStep, string> = {
  drop: `${import.meta.env.BASE_URL}characters/Solido_Drop.png`,
  cover: `${import.meta.env.BASE_URL}characters/Solido_Cover.png`,
  hold: `${import.meta.env.BASE_URL}characters/Solido_Hold.png`,
}

function demoImage(label: string, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720"><rect width="100%" height="100%" fill="#121212"/><rect x="0" y="0" width="32" height="720" fill="${color}"/><circle cx="480" cy="270" r="80" fill="#FFFFFF"/><path d="M350 590 Q480 330 610 590" fill="#00AEEE"/><text x="480" y="670" text-anchor="middle" fill="#FFFFFF" font-family="Arial" font-size="54" font-weight="bold">${label}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function demoResult(): EarthquakeResult {
  return {
    totalSeconds: 10.8,
    stars: 3,
    captures: POSE_STEPS.map((step, index) => ({
      step,
      label: STEP_COPY[step].label,
      reactionSeconds: [3.2, 3.7, 3.9][index],
      dataUrl: demoImage(STEP_COPY[step].label, '#00AEEE'),
    })),
    mode: 'solo',
    participantCount: 1,
  }
}

function Coach({ step }: { step: EarthquakeStep }) {
  return (
    <img
      className={`solido-coach ${step}`}
      src={SOLIDO_POSE_IMAGES[step]}
      alt={`Solido demonstrates ${STEP_COPY[step].label}`}
    />
  )
}

function drawPoses(
  canvas: HTMLCanvasElement,
  poses: TrackedPose[],
  video: HTMLVideoElement,
) {
  const context = canvas.getContext('2d')
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)
  if (
    canvas.width !== Math.round(width * pixelRatio) ||
    canvas.height !== Math.round(height * pixelRatio)
  ) {
    canvas.width = Math.round(width * pixelRatio)
    canvas.height = Math.round(height * pixelRatio)
  }
  if (!context) return
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  context.clearRect(0, 0, width, height)
  if (!poses.length || !video.videoWidth || !video.videoHeight) return
  const map = (landmark: { x: number; y: number }) =>
    videoPointToView(
      landmark,
      { x: video.videoWidth, y: video.videoHeight },
      { x: width, y: height },
      true,
    )
  context.save()
  context.lineWidth = Math.max(3, width / 320)
  poses.forEach((pose, poseIndex) => {
    const observation = pose.observation
    const color = POSE_COLORS[poseIndex % POSE_COLORS.length]
    context.strokeStyle = color
    context.fillStyle = color
    context.globalAlpha = pose.staleMs > 0 ? 0.4 : 0.88
    for (const [from, to] of CONNECTIONS) {
      const a = observation.landmarks[from]
      const b = observation.landmarks[to]
      if (!a || !b || a.visibility < 0.35 || b.visibility < 0.35) continue
      const start = map(a)
      const end = map(b)
      context.beginPath()
      context.moveTo(start.x * width, start.y * height)
      context.lineTo(end.x * width, end.y * height)
      context.stroke()
    }
    for (const landmark of observation.landmarks) {
      if (landmark.visibility < 0.45) continue
      const position = map(landmark)
      context.beginPath()
      context.arc(position.x * width, position.y * height, 4, 0, Math.PI * 2)
      context.fill()
    }
  })
  context.globalAlpha = 1
  context.restore()
}

export function EarthquakeGame({
  sound,
  onSoundChange,
  onHome,
}: EarthquakeGameProps) {
  const demo = new URLSearchParams(window.location.search).get('demo')
  const initialPhase: EarthquakePhase =
    demo === 'earthquake-results'
      ? 'results'
      : demo === 'earthquake-error'
        ? 'error'
        : demo === 'earthquake-framing'
          ? 'framing'
          : demo?.startsWith('earthquake-')
            ? 'demonstrate'
            : 'consent'
  const demoStep = demo?.replace('earthquake-', '')
  const initialStep = POSE_STEPS.includes(demoStep as EarthquakeStep)
    ? (demoStep as EarthquakeStep)
    : 'drop'
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cameraRef = useRef(new CameraController())
  const visionRef = useRef(new PoseVision())
  const poseTrackerRef = useRef(new PoseIdentityTracker())
  const soundRef = useRef(sound)
  const frameRef = useRef(0)
  const phaseRef = useRef<EarthquakePhase>(initialPhase)
  const stepRef = useRef<EarthquakeStep>(initialStep)
  const modeRef = useRef<EarthquakeMode>('solo')
  const groupSizeRef = useRef(2)
  const calibrationsRef = useRef(new Map<number, PoseCalibration>())
  const calibrationSamples = useRef(new Map<number, PoseObservation[]>())
  const calibrationStarted = useRef(0)
  const stableStarted = useRef(0)
  const promptStarted = useRef(0)
  const roundStarted = useRef(0)
  const latestPoses = useRef<TrackedPose[]>([])
  const lastUiUpdate = useRef(0)
  const lastDiagnosticUpdate = useRef(0)
  const lastRenderFrame = useRef(0)
  const smoothedFps = useRef(30)
  const trackingStarted = useRef(0)
  const fallbackPending = useRef(false)
  const performanceModeRef = useRef(false)
  const capturesRef = useRef<PoseCapture[]>([])
  const [mode, setModeState] = useState<EarthquakeMode>('solo')
  const [groupSize, setGroupSizeState] = useState(2)
  const [phase, setPhaseState] = useState<EarthquakePhase>(initialPhase)
  const [step, setStepState] = useState<EarthquakeStep>(initialStep)
  const [fullBody, setFullBody] = useState(demo === 'earthquake-framing')
  const [coaching, setCoaching] = useState(
    'Step back until your whole body is in the frame.',
  )
  const [holdProgress, setHoldProgress] = useState(0)
  const [trackedCount, setTrackedCount] = useState(0)
  const [participantMatches, setParticipantMatches] = useState<boolean[]>([])
  const [cameraSettings, setCameraSettings] = useState<CameraSettings | null>(
    null,
  )
  const [diagnostics, setDiagnostics] = useState<PoseDiagnostics>({
    inferenceMs: 0,
    model: 'full',
    delegate: 'GPU',
    inputWidth: 960,
    inputHeight: 540,
  })
  const [performanceMode, setPerformanceMode] = useState(false)
  const [error, setError] = useState(
    demo === 'earthquake-error'
      ? 'Camera access was blocked. Allow permission, then try again.'
      : '',
  )
  const [errorKind, setErrorKind] = useState<'camera' | 'tracking'>('camera')
  const [result, setResult] = useState<EarthquakeResult | null>(
    demo === 'earthquake-results' ? demoResult() : null,
  )
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [saving, setSaving] = useState(false)
  const [savePath, setSavePath] = useState('')
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    soundRef.current = sound
  }, [sound])

  const setPhase = useCallback((value: EarthquakePhase) => {
    phaseRef.current = value
    setPhaseState(value)
  }, [])

  const setStep = useCallback((value: EarthquakeStep) => {
    stepRef.current = value
    setStepState(value)
  }, [])

  const setMode = (value: EarthquakeMode) => {
    modeRef.current = value
    setModeState(value)
  }

  const setGroupSize = (value: number) => {
    groupSizeRef.current = value
    setGroupSizeState(value)
  }

  const beep = useCallback((frequency = 620) => {
    if (!soundRef.current) return
    const AudioContextClass = window.AudioContext
    const context = new AudioContextClass()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.08, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.18)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.2)
    oscillator.onended = () => void context.close()
  }, [])

  const captureFrame = useCallback(
    (currentStep: EarthquakeStep): PoseCapture => {
      const video = videoRef.current
      if (!video) throw new Error('Camera frame is unavailable')
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 1280
      canvas.height = video.videoHeight || 720
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Photo capture is unavailable')
      context.translate(canvas.width, 0)
      context.scale(-1, 1)
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      return {
        step: currentStep,
        label: STEP_COPY[currentStep].label,
        reactionSeconds: (performance.now() - promptStarted.current) / 1000,
        dataUrl: canvas.toDataURL('image/png'),
      }
    },
    [],
  )

  const saveCompletedResult = useCallback(
    async (completed: EarthquakeResult) => {
      if (!canAutoSavePhotos()) return
      setSaving(true)
      setSaveError('')
      try {
        setSavePath(await saveEarthquakeSession(completed))
      } catch (value) {
        setSaveError(
          value instanceof Error
            ? value.message
            : 'The photos could not be saved automatically.',
        )
      } finally {
        setSaving(false)
      }
    },
    [],
  )

  const completeStep = useCallback(
    (now: number) => {
      const currentStep = stepRef.current
      const capture = captureFrame(currentStep)
      capturesRef.current = [...capturesRef.current, capture]
      beep(currentStep === 'hold' ? 880 : 720)
      const index = POSE_STEPS.indexOf(currentStep)
      if (index < POSE_STEPS.length - 1) {
        setStep(POSE_STEPS[index + 1])
        stableStarted.current = 0
        setHoldProgress(0)
        setPhase('demonstrate')
      } else {
        const totalSeconds = (now - roundStarted.current) / 1000
        const completed: EarthquakeResult = {
          totalSeconds,
          stars: starsForTime(totalSeconds),
          captures: capturesRef.current,
          mode: modeRef.current,
          participantCount:
            modeRef.current === 'group' ? groupSizeRef.current : 1,
        }
        setResult(completed)
        cameraRef.current.stop()
        setPhase('results')
        void saveCompletedResult(completed)
      }
    },
    [beep, captureFrame, saveCompletedResult, setPhase, setStep],
  )

  useEffect(() => {
    if (phase !== 'demonstrate' || demo?.startsWith('earthquake-')) return
    const timeout = window.setTimeout(() => {
      promptStarted.current = performance.now()
      if (stepRef.current === 'drop' && !roundStarted.current)
        roundStarted.current = promptStarted.current
      stableStarted.current = 0
      setPhase('matching')
      beep(540)
    }, EARTHQUAKE_CONFIG.demonstrationMs)
    return () => window.clearTimeout(timeout)
  }, [beep, demo, phase, setPhase])

  const processObservations = useCallback(
    (poses: TrackedPose[], now: number) => {
      const expected = modeRef.current === 'group' ? groupSizeRef.current : 1
      const fresh = poses.filter(({ staleMs }) => staleMs === 0)
      const updateUi = now - lastUiUpdate.current >= 100
      if (updateUi) {
        lastUiUpdate.current = now
        setTrackedCount(fresh.length)
      }
      if (phaseRef.current === 'framing') {
        const ready = areParticipantsFramed(poses, expected)
        if (updateUi) setFullBody(ready)
        return
      }
      if (phaseRef.current === 'calibrating') {
        for (const pose of fresh) {
          if (!isFullBodyVisible(pose.observation)) continue
          const samples = calibrationSamples.current.get(pose.id) ?? []
          samples.push(pose.observation)
          calibrationSamples.current.set(pose.id, samples)
        }
        if (
          now - calibrationStarted.current >=
          EARTHQUAKE_CONFIG.calibrationMs
        ) {
          const calibrations = new Map<number, PoseCalibration>()
          for (const pose of fresh) {
            const calibration = createCalibration(
              calibrationSamples.current.get(pose.id) ?? [],
            )
            if (calibration) calibrations.set(pose.id, calibration)
          }
          if (fresh.length !== expected || calibrations.size !== expected) {
            setCoaching(
              `We need all ${expected} full ${expected === 1 ? 'body' : 'bodies'}. Step back and try again.`,
            )
            setPhase('framing')
            return
          }
          calibrationsRef.current = calibrations
          roundStarted.current = 0
          setStep('drop')
          setPhase('demonstrate')
        }
        return
      }
      if (phaseRef.current !== 'matching' || !calibrationsRef.current.size)
        return
      const orderedIds = [...calibrationsRef.current.keys()]
      const current = orderedIds.map((id) =>
        poses.find((pose) => pose.id === id),
      )
      if (current.some((pose) => !pose || pose.staleMs > 0)) {
        const withinGrace = trackingLossWithinGrace(current)
        if (withinGrace) return
        stableStarted.current = 0
        if (updateUi) {
          setParticipantMatches(orderedIds.map(() => false))
          setHoldProgress(0)
          setCoaching('Keep every participant fully visible in the frame.')
        }
        return
      }
      const matches = current.map((pose, index) =>
        classifyPose(
          stepRef.current,
          pose!.observation,
          calibrationsRef.current.get(orderedIds[index])!,
        ),
      )
      if (updateUi) {
        setParticipantMatches(matches.map(({ matched }) => matched))
        const failed = matches.findIndex(({ matched }) => !matched)
        setCoaching(
          failed >= 0 && expected > 1
            ? `Player ${failed + 1}: ${matches[failed].coaching}`
            : matches[0].coaching,
        )
      }
      if (!allParticipantsMatch(matches)) {
        stableStarted.current = 0
        if (updateUi) setHoldProgress(0)
        return
      }
      stableStarted.current ||= now
      const required =
        stepRef.current === 'hold'
          ? EARTHQUAKE_CONFIG.holdPoseMs
          : EARTHQUAKE_CONFIG.stablePoseMs
      const progress = Math.min(1, (now - stableStarted.current) / required)
      if (updateUi) setHoldProgress(progress)
      if (progress >= 1) completeStep(now)
    },
    [completeStep, setPhase, setStep],
  )

  useEffect(() => {
    if (demo) return
    const camera = cameraRef.current
    const vision = visionRef.current
    const loop = (now: number) => {
      if (lastRenderFrame.current) {
        const delta = Math.max(1, now - lastRenderFrame.current)
        const fps = Math.min(120, 1000 / delta)
        smoothedFps.current += (fps - smoothedFps.current) * 0.1
      }
      lastRenderFrame.current = now
      const video = videoRef.current
      if (video) {
        const observations = vision.detect(video, now)
        if (observations !== null) {
          latestPoses.current = poseTrackerRef.current.update(observations, now)
          processObservations(latestPoses.current, now)
        } else {
          latestPoses.current = poseTrackerRef.current.getTracked(now)
        }
        drawPoses(canvasRef.current!, latestPoses.current, video)
        if (now - lastDiagnosticUpdate.current >= 250) {
          lastDiagnosticUpdate.current = now
          setDiagnostics(vision.getDiagnostics(now))
        }
        const inference = vision.getAverageInferenceMs(undefined, now)
        const activeTracking = [
          'framing',
          'calibrating',
          'demonstrate',
          'matching',
        ].includes(phaseRef.current)
        if (
          shouldActivatePoseFallback({
            activeTracking,
            performanceMode: performanceModeRef.current,
            fallbackPending: fallbackPending.current,
            elapsedMs: now - trackingStarted.current,
            inferenceMs: inference,
            renderFps: smoothedFps.current,
          })
        ) {
          fallbackPending.current = true
          void vision
            .activatePerformanceMode()
            .then(() => {
              performanceModeRef.current = true
              setPerformanceMode(true)
            })
            .catch(() => undefined)
            .finally(() => {
              fallbackPending.current = false
            })
        }
      }
      frameRef.current = requestAnimationFrame(loop)
    }
    frameRef.current = requestAnimationFrame(loop)
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.code === 'KeyN') {
        event.preventDefault()
        if (['consent', 'error'].includes(phaseRef.current)) {
          camera.stop()
          capturesRef.current = []
          calibrationsRef.current = new Map([
            [1, { hipY: 0.52, bodyHeight: 0.48, shoulderWidth: 0.22 }],
          ])
          roundStarted.current = 0
          setStep('drop')
          setPhase('demonstrate')
        } else if (phaseRef.current === 'framing') {
          calibrationsRef.current = new Map([
            [1, { hipY: 0.52, bodyHeight: 0.48, shoulderWidth: 0.22 }],
          ])
          setStep('drop')
          setPhase('demonstrate')
        } else if (phaseRef.current === 'demonstrate') {
          promptStarted.current = performance.now()
          roundStarted.current ||= promptStarted.current
          setPhase('matching')
        } else if (phaseRef.current === 'matching') {
          capturesRef.current = [
            ...capturesRef.current,
            {
              step: stepRef.current,
              label: STEP_COPY[stepRef.current].label,
              reactionSeconds:
                (performance.now() - promptStarted.current) / 1000,
              dataUrl: demoImage(STEP_COPY[stepRef.current].label, '#246878'),
            },
          ]
          const index = POSE_STEPS.indexOf(stepRef.current)
          if (index < 2) {
            setStep(POSE_STEPS[index + 1])
            setPhase('demonstrate')
          } else {
            const totalSeconds = Math.max(
              1,
              (performance.now() - roundStarted.current) / 1000,
            )
            setResult({
              totalSeconds,
              stars: starsForTime(totalSeconds),
              captures: capturesRef.current,
              mode: modeRef.current,
              participantCount:
                modeRef.current === 'group' ? groupSizeRef.current : 1,
            })
            cameraRef.current.stop()
            setPhase('results')
          }
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(frameRef.current)
      window.removeEventListener('keydown', onKey)
      camera.stop()
      vision.close()
    }
  }, [demo, processObservations, setPhase, setStep])

  const startCamera = async () => {
    setError('')
    setSavePath('')
    setSaveError('')
    poseTrackerRef.current.reset()
    latestPoses.current = []
    calibrationsRef.current.clear()
    performanceModeRef.current = false
    setPerformanceMode(false)
    const maximumPoses = modeRef.current === 'group' ? 5 : 1
    visionRef.current.configure(maximumPoses)
    setPhase('loading')
    try {
      const settings = await cameraRef.current.start(
        videoRef.current!,
        cameraRef.current.facing,
        { width: 1920, height: 1080, frameRate: 30 },
      )
      setCameraSettings(settings)
    } catch (value) {
      cameraRef.current.stop()
      setErrorKind('camera')
      setError(friendlyCameraError(value))
      setPhase('error')
      return
    }
    try {
      await visionRef.current.initialize()
      trackingStarted.current = performance.now()
      setPhase('framing')
    } catch {
      cameraRef.current.stop()
      setErrorKind('tracking')
      setError(
        'Your camera opened, but the local pose-tracking engine could not load. Restart the app, then try again.',
      )
      setPhase('error')
    }
  }

  const startCalibration = () => {
    calibrationSamples.current = new Map()
    calibrationStarted.current = performance.now()
    setPhase('calibrating')
  }

  const reset = () => {
    capturesRef.current = []
    setResult(null)
    calibrationsRef.current.clear()
    calibrationSamples.current.clear()
    poseTrackerRef.current.reset()
    latestPoses.current = []
    roundStarted.current = 0
    stableStarted.current = 0
    setStep('drop')
    setFullBody(false)
    setTrackedCount(0)
    setParticipantMatches([])
    setSavePath('')
    setSaveError('')
    setCameraSettings(null)
    cameraRef.current.stop()
    setPhase('consent')
  }

  const returnHome = () => {
    if (
      !['consent', 'results', 'error'].includes(phase) &&
      !window.confirm('Leave this challenge and discard the photos?')
    )
      return
    cameraRef.current.stop()
    capturesRef.current = []
    setResult(null)
    onHome()
  }

  const download = async () => {
    if (!result) return
    setExporting(true)
    setExportError('')
    try {
      const blob = await createResultCollage(result)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `solido-earthquake-${new Date().toISOString().slice(0, 10)}.png`
      anchor.hidden = true
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      setExportError('The collage could not be created. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  const retrySave = () => {
    if (result) void saveCompletedResult(result)
  }

  const activeCamera = [
    'loading',
    'framing',
    'calibrating',
    'demonstrate',
    'matching',
  ].includes(phase)
  const stepCopy = STEP_COPY[step]

  return (
    <main className="earthquake-shell">
      <video
        ref={videoRef}
        className={`earthquake-video ${activeCamera ? 'visible' : ''}`}
        playsInline
        muted
      />
      <canvas ref={canvasRef} className="pose-layer" />
      <div className="earthquake-shade" />

      <header className="earthquake-header">
        <button className="exhibit-control" type="button" onClick={returnHome}>
          <Home /> Game menu
        </button>
        <div className="earthquake-brand">
          <span>S</span>
          <b>
            SOLIDO
            <br />
            <small>EARTHQUAKE READY</small>
          </b>
        </div>
        <button
          className="exhibit-control"
          type="button"
          onClick={() => onSoundChange(!sound)}
        >
          {sound ? <Volume2 /> : <VolumeX />} {sound ? 'Sound on' : 'Sound off'}
        </button>
      </header>

      {phase === 'consent' && (
        <section className="earthquake-intro-panel">
          <div className="quake-rings">
            <span />
            <span />
            <span />
          </div>
          <span className="eyebrow">EARTHQUAKE SAFETY CHALLENGE</span>
          <h1>
            Drop. Cover.
            <br />
            <em>Hold On.</em>
          </h1>
          <p>
            Follow Solido and complete all three safety actions as quickly and
            accurately as you can.
          </p>
          <div className="earthquake-mode-picker" aria-label="Challenge mode">
            <button
              type="button"
              className={mode === 'solo' ? 'active' : ''}
              onClick={() => setMode('solo')}
            >
              <span>1</span>
              <b>Solo</b>
              <small>One participant</small>
            </button>
            <button
              type="button"
              className={mode === 'group' ? 'active' : ''}
              onClick={() => setMode('group')}
            >
              <Users />
              <b>Group</b>
              <small>Complete every pose together</small>
            </button>
          </div>
          {mode === 'group' && (
            <div className="group-size-picker" aria-label="Group size">
              <span>Participants</span>
              {[2, 3, 4, 5].map((size) => (
                <button
                  type="button"
                  className={groupSize === size ? 'active' : ''}
                  onClick={() => setGroupSize(size)}
                  key={size}
                >
                  {size}
                </button>
              ))}
            </div>
          )}
          <div className="privacy-card">
            <HardDrive />
            <span>
              <b>Your camera stays private</b>
              {canAutoSavePhotos()
                ? 'Completing the challenge saves three full-quality photos and a collage to this device. Nothing is uploaded.'
                : 'Photos stay in this browser until you download the collage. Nothing is uploaded.'}
            </span>
          </div>
          <button
            className="quake-primary"
            type="button"
            onClick={() => void startCamera()}
          >
            <Camera /> Start challenge
          </button>
          <small className="facilitator-hint">
            Facilitator test shortcut: Alt + N
          </small>
        </section>
      )}

      {phase === 'loading' && (
        <section className="quake-center">
          <span className="loader" />
          <h2>Preparing the safety zone…</h2>
          <p>Starting the camera and body tracker.</p>
        </section>
      )}

      {phase === 'framing' && (
        <section className="framing-layout">
          <div
            className={`group-frame-guide ${fullBody ? 'ready' : ''}`}
            aria-label={`${trackedCount} of ${mode === 'group' ? groupSize : 1} participants visible`}
          >
            {Array.from(
              { length: mode === 'group' ? groupSize : 1 },
              (_, index) => (
                <span
                  className={index < trackedCount ? 'detected' : ''}
                  style={
                    { '--pose-color': POSE_COLORS[index] } as CSSProperties
                  }
                  key={index}
                >
                  <i />
                  Player {index + 1}
                </span>
              ),
            )}
          </div>
          <div className="quake-instruction-card">
            <span className="eyebrow">STEP INTO THE SAFETY ZONE</span>
            <h2>
              {fullBody
                ? 'Perfect—everyone stay there!'
                : `We need ${mode === 'group' ? `all ${groupSize} full bodies` : 'your whole body'}`}
            </h2>
            <p>
              Stand side-by-side facing the camera with every head, hand, knee,
              and foot inside the frame.
            </p>
            <div className={`tracking-status ${fullBody ? 'good' : ''}`}>
              <span />
              {fullBody
                ? `${trackedCount} of ${mode === 'group' ? groupSize : 1} ready`
                : `${trackedCount} of ${mode === 'group' ? groupSize : 1} full bodies detected`}
            </div>
            <button
              className="quake-primary"
              type="button"
              disabled={!fullBody && !demo}
              onClick={startCalibration}
            >
              Calibrate standing position
            </button>
          </div>
        </section>
      )}

      {phase === 'calibrating' && (
        <section className="quake-center">
          <span className="calibration-pulse" />
          <span className="eyebrow">QUICK CALIBRATION</span>
          <h2>Stand tall and hold still</h2>
          <p>
            Solido is learning{' '}
            {mode === 'group' ? 'each position' : 'your position'}.
          </p>
        </section>
      )}

      {(phase === 'demonstrate' || phase === 'matching') && (
        <section className="challenge-layout">
          <aside
            className="coach-panel"
            aria-label={`${stepCopy.label} reference pose`}
          >
            <Coach step={step} />
          </aside>
          <div className="player-zone">
            <div className="step-dots">
              {POSE_STEPS.map((item) => (
                <span
                  key={item}
                  className={
                    POSE_STEPS.indexOf(item) <= POSE_STEPS.indexOf(step)
                      ? 'active'
                      : ''
                  }
                >
                  {item === step && phase === 'matching'
                    ? 'YOUR TURN'
                    : STEP_COPY[item].label}
                </span>
              ))}
            </div>
            <div className="live-prompt">
              <span>
                {phase === 'demonstrate' ? 'WATCH SOLIDO' : 'YOUR TURN'}
              </span>
              <strong>
                {phase === 'demonstrate' ? `Learn ${stepCopy.label}` : coaching}
              </strong>
              {phase === 'matching' && (
                <>
                  {mode === 'group' && (
                    <div className="participant-readiness">
                      {Array.from({ length: groupSize }, (_, index) => (
                        <span
                          className={participantMatches[index] ? 'ready' : ''}
                          style={
                            {
                              '--pose-color': POSE_COLORS[index],
                            } as CSSProperties
                          }
                          key={index}
                        >
                          P{index + 1}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="hold-meter">
                    <i style={{ width: `${holdProgress * 100}%` }} />
                  </div>
                </>
              )}
            </div>
            <div className="safety-tip">
              <b>WHY IT MATTERS</b>
              {stepCopy.tip}
            </div>
          </div>
        </section>
      )}

      {phase === 'results' && result && (
        <section className="results-panel">
          <div className="results-heading">
            <span className="completion-check">
              <Check />
            </span>
            <div>
              <span className="eyebrow">CHALLENGE COMPLETE</span>
              <h1>You’re earthquake ready!</h1>
              <p>
                <b>{result.totalSeconds.toFixed(1)} seconds</b> total time
              </p>
            </div>
            <div className="stars" aria-label={`${result.stars} stars`}>
              {[1, 2, 3].map((value) => (
                <Star
                  key={value}
                  fill={value <= result.stars ? 'currentColor' : 'none'}
                />
              ))}
            </div>
          </div>
          <div className="photo-strip">
            {result.captures.map((capture) => (
              <figure key={capture.step}>
                <img
                  src={capture.dataUrl}
                  alt={`${capture.label} successful pose`}
                />
                <figcaption>
                  <b>{capture.label}</b>
                  <span>{capture.reactionSeconds.toFixed(1)}s</span>
                </figcaption>
              </figure>
            ))}
          </div>
          <div className="result-actions">
            <button
              className="quake-primary"
              type="button"
              disabled={exporting}
              onClick={() => void download()}
            >
              <Download />{' '}
              {exporting ? 'Preparing collage…' : 'Download photos'}
            </button>
            <button className="quake-secondary" type="button" onClick={reset}>
              <RefreshCw /> Play again
            </button>
            <button
              className="quake-secondary"
              type="button"
              onClick={returnHome}
            >
              <Home /> Game menu
            </button>
          </div>
          {saving && <p className="save-status">Saving full-quality photos…</p>}
          {savePath && (
            <p className="save-status success">
              <HardDrive /> Saved locally to <b>{savePath}</b>
            </p>
          )}
          {saveError && (
            <div className="save-status error" role="alert">
              <span>{saveError}</span>
              <button type="button" onClick={retrySave} disabled={saving}>
                Retry save
              </button>
            </div>
          )}
          {exportError && (
            <p className="export-error" role="alert">
              {exportError}
            </p>
          )}
          <p className="result-lesson">
            Remember: during a real earthquake, stay under sturdy cover and hold
            on until the shaking stops.
          </p>
        </section>
      )}

      {phase === 'error' && (
        <section className="quake-center error-panel">
          <Camera />
          <span className="eyebrow">
            {errorKind === 'camera'
              ? 'CAMERA UNAVAILABLE'
              : 'TRACKING UNAVAILABLE'}
          </span>
          <h2>
            {errorKind === 'camera'
              ? 'We couldn’t open the camera'
              : 'Pose tracking couldn’t start'}
          </h2>
          <p>{error}</p>
          <button
            className="quake-primary"
            type="button"
            onClick={() => void startCamera()}
          >
            Try again
          </button>
        </section>
      )}

      {activeCamera && (
        <aside className="quake-diagnostics" aria-label="Tracking diagnostics">
          <span>
            Camera {cameraSettings?.width ?? '—'}×
            {cameraSettings?.height ?? '—'}
          </span>
          <span>{Math.round(diagnostics.inferenceMs)} ms inference</span>
          <span>
            {diagnostics.model} · {diagnostics.delegate}
          </span>
          {performanceMode && <b>Performance mode</b>}
        </aside>
      )}
    </main>
  )
}
