import {
  Camera,
  CameraIcon,
  ChevronDown,
  Heart,
  Home,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Swords,
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
import type { VersusGameEngine } from './engine/VersusGameEngine'
import { describeStartupError } from './engine/startupError'
import type {
  GamePhase,
  PlayerLane,
  VersusHudSnapshot,
  VersusPlayerSnapshot,
} from './types'

interface VersusPunchGameProps {
  onHome: () => void
  onChangeMode: () => void
}

const emptyPlayer = (lane: PlayerLane): VersusPlayerSnapshot => ({
  lane,
  score: 0,
  combo: 0,
  lives: GAME_CONFIG.versus.startingLives,
  shieldActive: false,
  shieldTime: 0,
  speedAttackTime: 0,
  pendingHazards: 0,
  hands: [],
})

const EMPTY_HUD: VersusHudSnapshot = {
  players: { left: emptyPlayer('left'), right: emptyPlayer('right') },
  fps: 0,
  activeTargets: 0,
  trackingMode: 'four-hands',
  winner: null,
}

const LANES = ['left', 'right'] as const

export function VersusPunchGame({
  onHome,
  onChangeMode,
}: VersusPunchGameProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const handCanvasRef = useRef<HTMLCanvasElement>(null)
  const threeCanvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<VersusGameEngine | null>(null)
  const phaseRef = useRef<GamePhase>('idle')
  const lastCountdownRef = useRef<number | null>(null)
  const soundRef = useRef(true)
  const [phase, setPhase] = useState<GamePhase>('idle')
  const [hud, setHud] = useState(EMPTY_HUD)
  const [countdown, setCountdown] = useState(3)
  const [sound, setSound] = useState(true)
  const [facing, setFacing] = useState<'user' | 'environment'>('user')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [errorTitle, setErrorTitle] = useState('We couldn’t open the camera')
  const [debug, setDebug] = useState(false)

  const impact = useCallback((lane: PlayerLane, hazard: boolean) => {
    const overlay = document.querySelector<HTMLElement>(
      `.versus-impact.${lane}`,
    )
    overlay?.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 180,
      easing: 'ease-out',
    })
    if (soundRef.current) playRetroBreakSound(hazard)
  }, [])

  useEffect(() => {
    if (!videoRef.current || !handCanvasRef.current || !threeCanvasRef.current)
      return
    let disposed = false
    let engine: VersusGameEngine | null = null
    void import('./engine/VersusGameEngine')
      .then(({ VersusGameEngine }) => {
        if (disposed) return
        engine = new VersusGameEngine(
          {
            video: videoRef.current!,
            handCanvas: handCanvasRef.current!,
            threeCanvas: threeCanvasRef.current!,
          },
          {
            onPhase: (value) => {
              const previous = phaseRef.current
              phaseRef.current = value
              if (value === 'countdown' && previous !== 'countdown')
                lastCountdownRef.current = null
              if (value === 'playing' && soundRef.current)
                playBackgroundMusic(previous !== 'paused')
              if (['paused', 'gameover', 'error'].includes(value))
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
            onImpact: impact,
          },
        )
        engineRef.current = engine
        void engine.initialize().then(() => {
          if (!disposed) setReady(true)
        })
      })
      .catch(() => {
        if (disposed) return
        setErrorTitle('We couldn’t load versus mode')
        setError(
          'The versus engine could not load. Restart the app and try again.',
        )
        setPhase('error')
      })
    return () => {
      disposed = true
      engine?.dispose()
      engineRef.current = null
      pauseBackgroundMusic()
    }
  }, [impact])

  const start = () => {
    setError('')
    if (soundRef.current) {
      prepareRetroAudio()
      primeBackgroundMusic()
    }
    void engineRef.current?.startCamera()
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

  const inRound = ['countdown', 'playing', 'paused'].includes(phase)
  const cameraSession = phase === 'calibrating' || inRound
  const required = hud.trackingMode === 'four-hands' ? 2 : 1
  const winnerText =
    hud.winner === 'draw'
      ? 'Draw'
      : hud.winner === 'left'
        ? 'Player 1 wins'
        : 'Player 2 wins'

  const leave = (action: () => void) => {
    if (
      inRound &&
      !window.confirm('Leave this versus match and discard the result?')
    )
      return
    action()
  }

  return (
    <main
      className={`game-shell versus-shell phase-${phase} ${facing === 'user' ? 'user-camera' : ''}`}
    >
      <video ref={videoRef} className="camera-feed" playsInline muted />
      <div className="camera-fallback" aria-hidden="true" />
      <canvas ref={threeCanvasRef} className="three-layer" />
      <canvas ref={handCanvasRef} className="hand-layer" />
      <div className="versus-divider" aria-hidden="true" />
      <div className="versus-impact left" aria-hidden="true" />
      <div className="versus-impact right" aria-hidden="true" />

      {LANES.map((lane, index) => {
        const player = hud.players[lane]
        return (
          <header className={`versus-hud ${lane}`} key={lane}>
            <span className="versus-player">Player {index + 1}</span>
            <strong>{player.score.toLocaleString()}</strong>
            <span>{player.combo} combo</span>
            <span className="versus-hearts">
              {Array.from({ length: 3 }, (_, heart) => (
                <Heart
                  key={heart}
                  size={18}
                  fill={heart < player.lives ? 'currentColor' : 'none'}
                />
              ))}
            </span>
            {player.shieldActive && (
              <span className="versus-effect shield">
                <ShieldAlert size={14} /> Shield {player.shieldTime}s
              </span>
            )}
            {player.speedAttackTime > 0 && (
              <span className="versus-effect danger">
                Speed surge {player.speedAttackTime}s
              </span>
            )}
            {player.pendingHazards > 0 && (
              <span className="versus-effect danger">
                +{player.pendingHazards} hazards
              </span>
            )}
          </header>
        )
      })}

      <nav className="game-controls" aria-label="Game controls">
        <IconButton
          label="Game menu"
          icon={Home}
          onClick={() => leave(onHome)}
        />
        {cameraSession && (
          <>
            <IconButton
              label="Switch camera"
              icon={RefreshCw}
              onClick={switchCamera}
            />
            <IconButton
              label={sound ? 'Mute sound' : 'Turn sound on'}
              icon={sound ? Volume2 : VolumeX}
              active={!sound}
              onClick={() => {
                const next = !soundRef.current
                soundRef.current = next
                setSound(next)
                if (!next) pauseBackgroundMusic()
              }}
            />
            {inRound && (
              <IconButton
                label={phase === 'paused' ? 'Resume game' : 'Pause game'}
                icon={phase === 'paused' ? Play : Pause}
                onClick={() => engineRef.current?.togglePause()}
              />
            )}
          </>
        )}
      </nav>

      {phase === 'idle' && (
        <section className="start-panel versus-start">
          <div className="brand-lockup">
            <span className="eyebrow">TWO-PLAYER SURVIVAL</span>
            <h1>
              SOLIDO <em>VERSUS</em>
            </h1>
            <p>Stand side-by-side. Defend your lane. Last survivor wins.</p>
          </div>

          <div className="versus-lobby-lanes" aria-label="Player lanes">
            <article className="left">
              <span>Player 1</span>
              <strong>Left lane</strong>
              <small>Stand on this side</small>
            </article>
            <b className="versus-lobby-vs" aria-hidden="true">
              <span>VS</span>
            </b>
            <article className="right">
              <span>Player 2</span>
              <strong>Right lane</strong>
              <small>Stand on this side</small>
            </article>
          </div>

          <button
            className="primary-action versus-start-button"
            type="button"
            disabled={!ready}
            onClick={start}
          >
            <CameraIcon size={21} /> {ready ? 'Start versus' : 'Loading…'}
          </button>
          <div className="versus-item-key">
            <span>
              <b>SH</b>
              <i>
                <strong>Shield</strong>
                <small>Block one hit</small>
              </i>
            </span>
            <span>
              <b>&gt;&gt;</b>
              <i>
                <strong>Speed attack</strong>
                <small>Rush the opponent</small>
              </i>
            </span>
            <span>
              <b>!!</b>
              <i>
                <strong>Hazard barrage</strong>
                <small>Send two hazards</small>
              </i>
            </span>
          </div>
        </section>
      )}

      {phase === 'requesting' && (
        <section className="center-status">
          <span className="loader" />
          <strong>Preparing four-hand tracking…</strong>
        </section>
      )}

      {phase === 'calibrating' && (
        <section className="versus-readiness">
          <span className="eyebrow">PLAYER CHECK</span>
          <h2>{required === 2 ? 'Two fists each' : 'One fist each'}</h2>
          <div className="versus-ready-grid">
            {LANES.map((lane, index) => {
              const fists = hud.players[lane].hands.filter(
                (hand) => hand.isFist,
              ).length
              return (
                <span className={fists >= required ? 'ready' : ''} key={lane}>
                  Player {index + 1}: {Math.min(fists, required)}/{required}
                </span>
              )
            })}
          </div>
          {hud.trackingMode === 'one-fist' && (
            <small>Performance mode: one fist each</small>
          )}
        </section>
      )}

      {phase === 'countdown' && (
        <section className="countdown">
          <span>Survive</span>
          <strong>{countdown || 'GO'}</strong>
        </section>
      )}

      {phase === 'paused' && (
        <section className="pause-panel">
          <span className="eyebrow">MATCH PAUSED</span>
          <button
            className="primary-action compact"
            type="button"
            onClick={() => engineRef.current?.togglePause()}
          >
            <Play size={19} /> Resume
          </button>
        </section>
      )}

      {phase === 'gameover' && (
        <section className="gameover-panel versus-result">
          <Swords size={42} />
          <span className="eyebrow">MATCH COMPLETE</span>
          <h2>{winnerText}</h2>
          <div className="result-stats">
            <span>Player 1 · {hud.players.left.score.toLocaleString()}</span>
            <span>Player 2 · {hud.players.right.score.toLocaleString()}</span>
          </div>
          <div className="versus-result-actions">
            <button
              className="primary-action compact"
              type="button"
              onClick={() => engineRef.current?.restart()}
            >
              <RotateCcw size={18} /> Rematch
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={onChangeMode}
            >
              Change mode
            </button>
            <button className="secondary-action" type="button" onClick={onHome}>
              Game menu
            </button>
          </div>
        </section>
      )}

      {phase === 'error' && (
        <section className="error-panel" role="alert">
          <Camera size={30} />
          <span className="eyebrow">VERSUS UNAVAILABLE</span>
          <h2>{errorTitle}</h2>
          <p>{error}</p>
          <button
            className="primary-action compact"
            type="button"
            onClick={start}
          >
            <RefreshCw size={18} /> Try again
          </button>
        </section>
      )}

      {hud.trackingMode === 'one-fist' && cameraSession && (
        <div className="performance-mode">Performance mode · one fist each</div>
      )}
      {cameraSession && (
        <button
          className="debug-toggle"
          type="button"
          aria-expanded={debug}
          onClick={() =>
            setDebug((value) => {
              const enabled = !value
              engineRef.current?.setDebug(enabled)
              return enabled
            })
          }
        >
          Debug <ChevronDown size={13} />
        </button>
      )}
      {debug && cameraSession && (
        <aside className="debug-panel">
          <span>FPS {hud.fps}</span>
          <span>Tracking {hud.trackingMode}</span>
          <span>Targets {hud.activeTargets}</span>
          <span>
            Hands{' '}
            {hud.players.left.hands.length + hud.players.right.hands.length}/4
          </span>
        </aside>
      )}
    </main>
  )
}
