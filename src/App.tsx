import {
  Camera,
  CameraIcon,
  ChevronDown,
  Heart,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  pauseBackgroundMusic,
  playBackgroundMusic,
  primeBackgroundMusic,
} from './audio/backgroundMusic'
import {
  playCountdownSound,
  playGameOverSound,
  playRetroBreakSound,
  prepareRetroAudio,
} from './audio/retroBreak'
import { friendlyCameraError } from './camera/camera'
import { IconButton } from './components/IconButton'
import { GAME_CONFIG } from './config'
import type { GameEngine } from './engine/GameEngine'
import { describeStartupError } from './engine/startupError'
import type { GamePhase, HudSnapshot } from './types'

const EMPTY_HUD: HudSnapshot = {
  score: 0,
  combo: 0,
  bestCombo: 0,
  lives: 3,
  time: 60,
  fps: 0,
  hands: [],
  activeTargets: 0,
  scoreMultiplier: 1,
  multiplierTime: 0,
}

const PHASE_COPY: Partial<Record<GamePhase, string>> = {
  requesting: 'Preparing camera…',
  paused: 'Training paused',
  gameover: 'Round complete',
}

function getDemoPhase(): GamePhase | null {
  const value = new URLSearchParams(window.location.search).get('demo')
  return [
    'idle',
    'calibrating',
    'countdown',
    'playing',
    'paused',
    'gameover',
    'error',
  ].includes(value ?? '')
    ? (value as GamePhase)
    : null
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const handCanvasRef = useRef<HTMLCanvasElement>(null)
  const threeCanvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<GameEngine | null>(null)
  const impactOverlayRef = useRef<HTMLDivElement>(null)
  const impactAnimationRef = useRef<Animation | null>(null)
  const soundRef = useRef(true)
  const phaseRef = useRef<GamePhase>('idle')
  const lastCountdownRef = useRef<number | null>(null)
  const [phase, setPhase] = useState<GamePhase>('idle')
  const [hud, setHud] = useState(EMPTY_HUD)
  const [countdown, setCountdown] = useState(3)
  const [error, setError] = useState('')
  const [errorTitle, setErrorTitle] = useState('We couldn’t open the camera')
  const [facing, setFacing] = useState<'user' | 'environment'>('user')
  const [sound, setSound] = useState(true)
  const [debug, setDebug] = useState(false)
  const [engineReady, setEngineReady] = useState(false)
  const handleImpact = useCallback((hazard: boolean) => {
    const overlay = impactOverlayRef.current
    if (overlay) {
      impactAnimationRef.current?.cancel()
      overlay.style.boxShadow = hazard
        ? 'inset 0 0 90px rgb(255 59 47 / 78%)'
        : 'inset 0 0 65px rgb(111 255 234 / 55%)'
      impactAnimationRef.current = overlay.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: 150, easing: 'ease-out' },
      )
    }
    if (soundRef.current) playRetroBreakSound(hazard)
  }, [])

  useEffect(() => {
    if (!videoRef.current || !handCanvasRef.current || !threeCanvasRef.current)
      return
    const elements = {
      video: videoRef.current,
      handCanvas: handCanvasRef.current,
      threeCanvas: threeCanvasRef.current,
    }
    let disposed = false
    let engine: GameEngine | null = null

    void import('./engine/GameEngine')
      .then(({ GameEngine }) => {
        if (disposed) return
        engine = new GameEngine(elements, {
          onPhase: (value) => {
            const previous = phaseRef.current
            phaseRef.current = value
            if (value === 'countdown' && previous !== 'countdown')
              lastCountdownRef.current = null
            if (value === 'playing' && soundRef.current)
              playBackgroundMusic(previous !== 'paused')
            if (value === 'paused' || value === 'gameover' || value === 'error')
              pauseBackgroundMusic()
            if (
              value === 'gameover' &&
              previous !== 'gameover' &&
              soundRef.current
            )
              playGameOverSound()
            setPhase(value)
          },
          onHud: setHud,
          onCountdown: (value) => {
            setCountdown(value)
            if (lastCountdownRef.current === value) return
            lastCountdownRef.current = value
            if (soundRef.current) playCountdownSound(value)
          },
          onError: (value) => {
            const description = describeStartupError(value)
            setErrorTitle(description.title)
            setError(description.message)
          },
          onImpact: handleImpact,
        })
        engineRef.current = engine
        setEngineReady(true)
        const demoPhase = getDemoPhase()
        if (demoPhase && demoPhase !== 'idle') {
          if (demoPhase === 'error') {
            setError(
              'Camera access was blocked. Allow camera permission in your browser, then try again.',
            )
            setPhase('error')
          } else {
            engine.setDemoPhase(demoPhase)
          }
        } else {
          void engine.initialize()
        }
      })
      .catch(() => {
        if (disposed) return
        setError(
          'The game engine could not load. Refresh the page and try again.',
        )
        setErrorTitle('We couldn’t load the game')
        setPhase('error')
      })

    return () => {
      disposed = true
      engine?.dispose()
      engineRef.current = null
      impactAnimationRef.current?.cancel()
      pauseBackgroundMusic()
    }
  }, [handleImpact])

  const start = () => {
    if (!engineRef.current) {
      window.location.reload()
      return
    }
    setError('')
    if (soundRef.current) {
      prepareRetroAudio()
      primeBackgroundMusic()
    }
    void engineRef.current.startCamera()
  }

  const switchCamera = () => {
    void engineRef.current
      ?.switchCamera()
      .then(setFacing)
      .catch((value) => {
        setErrorTitle('We couldn’t switch the camera')
        setError(friendlyCameraError(value))
      })
  }

  const keyboardTraining = () => {
    setError('')
    if (soundRef.current) {
      prepareRetroAudio()
      primeBackgroundMusic()
    }
    engineRef.current?.startKeyboardTraining()
  }

  const inRound =
    phase === 'countdown' || phase === 'playing' || phase === 'paused'
  const cameraSession = phase === 'calibrating' || inRound
  const recognizedFists = hud.hands.filter((hand) => hand.isFist).length
  const trackedHands = hud.hands.length
  const readinessTitle =
    trackedHands < 2
      ? 'Show both hands'
      : recognizedFists < 2
        ? 'Make two fists'
        : 'Fists recognized'

  return (
    <main className={`game-shell ${facing === 'user' ? 'user-camera' : ''}`}>
      <video ref={videoRef} className="camera-feed" playsInline muted />
      <div className="camera-fallback" aria-hidden="true">
        <span className="scan-line" />
        <div className="grid-floor" />
      </div>
      <canvas ref={threeCanvasRef} className="three-layer" />
      <canvas ref={handCanvasRef} className="hand-layer" />
      <div
        ref={impactOverlayRef}
        className="impact-overlay"
        aria-hidden="true"
      />

      <header className={`hud ${inRound ? 'visible' : ''}`} aria-live="polite">
        <section className="hud-block score-block">
          <span className="hud-label">Score</span>
          <strong>{hud.score.toLocaleString()}</strong>
        </section>
        <section className="combo-block">
          <Sparkles size={15} aria-hidden="true" />
          <span>
            <b>{hud.combo}</b> combo
          </span>
          {hud.scoreMultiplier === 2 && (
            <span className="multiplier-badge">
              2× score · {hud.multiplierTime}s
            </span>
          )}
        </section>
        <section className="hud-block timer-block">
          <span className="hud-label">Time</span>
          <strong>{hud.time}</strong>
        </section>
        <section className="lives" aria-label={`${hud.lives} lives remaining`}>
          {Array.from(
            { length: Math.max(GAME_CONFIG.startingLives, hud.lives) },
            (_, life) => (
              <Heart
                key={life}
                size={19}
                fill={life < hud.lives ? 'currentColor' : 'none'}
                className={life < hud.lives ? 'alive' : 'lost'}
                aria-hidden="true"
              />
            ),
          )}
        </section>
      </header>

      <nav className="game-controls" aria-label="Game controls">
        {cameraSession && (
          <>
            <IconButton
              label="Switch camera"
              icon={RefreshCw}
              onClick={switchCamera}
              disabled={phase === 'paused'}
            />
            <IconButton
              label={sound ? 'Mute sound' : 'Turn sound on'}
              icon={sound ? Volume2 : VolumeX}
              active={!sound}
              onClick={() =>
                setSound((value) => {
                  const enabled = !value
                  soundRef.current = enabled
                  if (enabled) {
                    prepareRetroAudio()
                    if (phaseRef.current === 'playing')
                      playBackgroundMusic(false)
                    else primeBackgroundMusic()
                  } else pauseBackgroundMusic()
                  return enabled
                })
              }
            />
            {inRound && (
              <IconButton
                label={phase === 'paused' ? 'Resume game' : 'Pause game'}
                icon={phase === 'paused' ? Play : Pause}
                active={phase === 'paused'}
                onClick={() => engineRef.current?.togglePause()}
              />
            )}
          </>
        )}
      </nav>

      {phase === 'idle' && (
        <section className="start-panel">
          <div className="brand-lockup">
            <span className="eyebrow">AR COMBAT TRAINING</span>
            <h1>
              SOLIDO <em>PUNCH</em>
            </h1>
            <p>
              Raise your fists. Strike the falling targets. Avoid the hazards.
            </p>
          </div>
          <div className="start-actions">
            <button
              className="primary-action"
              type="button"
              onClick={start}
              disabled={!engineReady}
              aria-busy={!engineReady}
            >
              <CameraIcon size={21} aria-hidden="true" />
              {engineReady ? 'Start game' : 'Loading game…'}
            </button>
            <span className="privacy-note">
              Camera processing stays on this device
            </span>
          </div>
          <div className="target-key" aria-label="Target guide">
            <span>
              <i className="dot cyan" /> Cube · 150
            </span>
            <span>
              <i className="dot pink" /> Orb · 100
            </span>
            <span>
              <i className="dot yellow" /> Crystal · 225
            </span>
            <span className="hazard-key">
              <ShieldAlert size={14} /> Avoid red completely
            </span>
            <span>
              <i className="dot boost" /> 2× score · 3 sec
            </span>
            <span>
              <i className="dot time" /> Time · +5 / +7 / +10
            </span>
            <span>
              <i className="dot heart" /> Extra heart
            </span>
          </div>
        </section>
      )}

      {phase === 'requesting' && (
        <section className="center-status">
          <span className="loader" />
          <strong>{PHASE_COPY.requesting}</strong>
          <small>Hold still while hand tracking warms up</small>
        </section>
      )}

      {phase === 'calibrating' && (
        <section className="readiness-panel" aria-live="polite">
          <span className="eyebrow">HAND CHECK</span>
          <h2>{readinessTitle}</h2>
          <p>Raise both hands into view and close each hand into a fist.</p>
          <div
            className="readiness-progress"
            aria-label={`${Math.min(recognizedFists, 2)} of 2 fists recognized`}
          >
            {[0, 1].map((index) => (
              <span
                className={recognizedFists > index ? 'recognized' : ''}
                key={index}
              >
                <i aria-hidden="true" />
                Fist {index + 1}
              </span>
            ))}
          </div>
          <small>
            {recognizedFists >= 2
              ? 'Hold steady — countdown starting'
              : `${Math.min(trackedHands, 2)}/2 hands · ${Math.min(
                  recognizedFists,
                  2,
                )}/2 fists`}
          </small>
        </section>
      )}

      {phase === 'countdown' && (
        <section className="countdown" aria-live="assertive">
          <span>Get ready</span>
          <strong key={countdown}>{countdown || 'GO'}</strong>
          <small>Make a fist and punch through a target</small>
        </section>
      )}

      {phase === 'paused' && (
        <section className="pause-panel">
          <span className="eyebrow">ROUND HELD</span>
          <h2>{PHASE_COPY.paused}</h2>
          <button
            className="primary-action compact"
            type="button"
            onClick={() => engineRef.current?.togglePause()}
          >
            <Play size={19} fill="currentColor" /> Resume
          </button>
        </section>
      )}

      {phase === 'gameover' && (
        <section className="gameover-panel">
          <span className="eyebrow">{PHASE_COPY.gameover}</span>
          <h2>{hud.score.toLocaleString()}</h2>
          <p>Final score</p>
          <div className="result-stats">
            <span>
              <b>{hud.bestCombo}</b> best combo
            </span>
            <span>
              <b>{Math.max(0, hud.score ? Math.round(hud.score / 135) : 0)}</b>{' '}
              targets
            </span>
          </div>
          <button
            className="primary-action compact"
            type="button"
            onClick={() => {
              if (soundRef.current) primeBackgroundMusic()
              engineRef.current?.restart()
            }}
          >
            <RotateCcw size={19} /> Train again
          </button>
        </section>
      )}

      {phase === 'error' && (
        <section className="error-panel" role="alert">
          <div className="error-icon">
            <Camera size={26} />
            <span />
          </div>
          <span className="eyebrow">TRAINING UNAVAILABLE</span>
          <h2>{errorTitle}</h2>
          <p>{error}</p>
          <div className="error-actions">
            <button
              className="primary-action compact"
              type="button"
              onClick={start}
            >
              <RefreshCw size={18} /> Try again
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={keyboardTraining}
            >
              Keyboard practice
            </button>
          </div>
        </section>
      )}

      {debug && cameraSession && (
        <aside className="debug-panel">
          <span>FPS {hud.fps}</span>
          <span>Hands {hud.hands.length}/2</span>
          <span>Targets {hud.activeTargets}</span>
          {hud.hands.map((hand) => (
            <span key={hand.id}>
              H{hand.id} {hand.phase} · {hand.speed.toFixed(2)} ·{' '}
              {Math.round(hand.confidence * 100)}%
            </span>
          ))}
        </aside>
      )}
      {cameraSession && (
        <button
          className="debug-toggle"
          type="button"
          aria-expanded={debug}
          onClick={() => setDebug((value) => !value)}
        >
          Debug <ChevronDown size={13} />
        </button>
      )}
      {phase === 'playing' && (
        <div className="keyboard-hint">
          Camera punch detection active · F / Space optional
        </div>
      )}
    </main>
  )
}
