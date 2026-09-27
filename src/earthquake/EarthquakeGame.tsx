import {
  Camera,
  Check,
  Download,
  Home,
  RefreshCw,
  Star,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CameraController, friendlyCameraError } from '../camera/camera'
import { EARTHQUAKE_CONFIG, POSE_STEPS } from './config'
import { createResultCollage } from './collage'
import {
  classifyPose,
  createCalibration,
  isFullBodyVisible,
  starsForTime,
} from './poseClassifier'
import { PoseVision } from './poseVision'
import type {
  EarthquakePhase,
  EarthquakeResult,
  EarthquakeStep,
  PoseCalibration,
  PoseCapture,
  PoseObservation,
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

function drawPose(
  canvas: HTMLCanvasElement,
  observation: PoseObservation | null,
) {
  const context = canvas.getContext('2d')
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  context?.clearRect(0, 0, width, height)
  if (!context || !observation) return
  context.save()
  context.strokeStyle = 'rgba(100, 239, 255, .82)'
  context.fillStyle = '#00aeee'
  context.lineWidth = Math.max(3, width / 320)
  for (const [from, to] of CONNECTIONS) {
    const a = observation.landmarks[from]
    const b = observation.landmarks[to]
    if (!a || !b || a.visibility < 0.45 || b.visibility < 0.45) continue
    context.beginPath()
    context.moveTo((1 - a.x) * width, a.y * height)
    context.lineTo((1 - b.x) * width, b.y * height)
    context.stroke()
  }
  for (const landmark of observation.landmarks) {
    if (landmark.visibility < 0.55) continue
    context.beginPath()
    context.arc(
      (1 - landmark.x) * width,
      landmark.y * height,
      4,
      0,
      Math.PI * 2,
    )
    context.fill()
  }
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
  const soundRef = useRef(sound)
  const frameRef = useRef(0)
  const phaseRef = useRef<EarthquakePhase>(initialPhase)
  const stepRef = useRef<EarthquakeStep>(initialStep)
  const calibrationRef = useRef<PoseCalibration | null>(null)
  const calibrationSamples = useRef<PoseObservation[]>([])
  const calibrationStarted = useRef(0)
  const stableStarted = useRef(0)
  const promptStarted = useRef(0)
  const roundStarted = useRef(0)
  const lastObservation = useRef<PoseObservation | null>(null)
  const capturesRef = useRef<PoseCapture[]>([])
  const [phase, setPhaseState] = useState<EarthquakePhase>(initialPhase)
  const [step, setStepState] = useState<EarthquakeStep>(initialStep)
  const [fullBody, setFullBody] = useState(demo === 'earthquake-framing')
  const [coaching, setCoaching] = useState(
    'Step back until your whole body is in the frame.',
  )
  const [holdProgress, setHoldProgress] = useState(0)
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
        setResult({
          totalSeconds,
          stars: starsForTime(totalSeconds),
          captures: capturesRef.current,
        })
        cameraRef.current.stop()
        setPhase('results')
      }
    },
    [beep, captureFrame, setPhase, setStep],
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

  const processObservation = useCallback(
    (observation: PoseObservation, now: number) => {
      lastObservation.current = observation
      drawPose(canvasRef.current!, observation)
      if (phaseRef.current === 'framing') {
        setFullBody(isFullBodyVisible(observation))
        return
      }
      if (phaseRef.current === 'calibrating') {
        if (isFullBodyVisible(observation))
          calibrationSamples.current.push(observation)
        if (
          now - calibrationStarted.current >=
          EARTHQUAKE_CONFIG.calibrationMs
        ) {
          const calibration = createCalibration(calibrationSamples.current)
          if (!calibration) {
            setCoaching('We lost your full body. Step back and try again.')
            setPhase('framing')
            return
          }
          calibrationRef.current = calibration
          roundStarted.current = 0
          setStep('drop')
          setPhase('demonstrate')
        }
        return
      }
      if (phaseRef.current !== 'matching' || !calibrationRef.current) return
      const match = classifyPose(
        stepRef.current,
        observation,
        calibrationRef.current,
      )
      setCoaching(match.coaching)
      if (!match.matched) {
        stableStarted.current = 0
        setHoldProgress(0)
        return
      }
      stableStarted.current ||= now
      const required =
        stepRef.current === 'hold'
          ? EARTHQUAKE_CONFIG.holdPoseMs
          : EARTHQUAKE_CONFIG.stablePoseMs
      const progress = Math.min(1, (now - stableStarted.current) / required)
      setHoldProgress(progress)
      if (progress >= 1) completeStep(now)
    },
    [completeStep, setPhase, setStep],
  )

  useEffect(() => {
    if (demo) return
    const camera = cameraRef.current
    const vision = visionRef.current
    const loop = (now: number) => {
      const video = videoRef.current
      if (video) {
        const observation = vision.detect(video, now)
        if (observation) processObservation(observation, now)
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
          calibrationRef.current = {
            hipY: 0.52,
            bodyHeight: 0.48,
            shoulderWidth: 0.22,
          }
          roundStarted.current = 0
          setStep('drop')
          setPhase('demonstrate')
        } else if (phaseRef.current === 'framing') {
          calibrationRef.current = {
            hipY: 0.52,
            bodyHeight: 0.48,
            shoulderWidth: 0.22,
          }
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
  }, [demo, processObservation, setPhase, setStep])

  const startCamera = async () => {
    setError('')
    setPhase('loading')
    try {
      await cameraRef.current.start(videoRef.current!)
    } catch (value) {
      cameraRef.current.stop()
      setErrorKind('camera')
      setError(friendlyCameraError(value))
      setPhase('error')
      return
    }
    try {
      await visionRef.current.initialize()
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
    calibrationSamples.current = []
    calibrationStarted.current = performance.now()
    setPhase('calibrating')
  }

  const reset = () => {
    capturesRef.current = []
    setResult(null)
    calibrationRef.current = null
    roundStarted.current = 0
    stableStarted.current = 0
    setStep('drop')
    setFullBody(false)
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
          <div className="privacy-card">
            <Camera />
            <span>
              <b>Your camera stays private</b>Your three successful poses will
              appear at the end and can be downloaded. Nothing is uploaded or
              saved automatically.
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
          <div className={`body-frame ${fullBody ? 'ready' : ''}`}>
            <span className="frame-head" />
            <span className="frame-body" />
          </div>
          <div className="quake-instruction-card">
            <span className="eyebrow">STEP INTO THE SAFETY ZONE</span>
            <h2>
              {fullBody
                ? 'Perfect—stay there!'
                : 'We need to see your whole body'}
            </h2>
            <p>
              Stand facing the camera with your head, hands, knees, and feet
              inside the frame.
            </p>
            <div className={`tracking-status ${fullBody ? 'good' : ''}`}>
              <span />
              {fullBody ? 'Full body detected' : 'Finding your full body…'}
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
          <p>Solido is learning your starting position.</p>
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
                <div className="hold-meter">
                  <i style={{ width: `${holdProgress * 100}%` }} />
                </div>
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
    </main>
  )
}
