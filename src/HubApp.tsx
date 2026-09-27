import { useState } from 'react'
import { PunchExperience } from './PunchExperience'
import { EarthquakeGame } from './earthquake/EarthquakeGame'
import { GAMES, type GameId } from './games'

function requestedScreen(): GameId | 'hub' {
  const demo = new URLSearchParams(window.location.search).get('demo')
  if (demo === 'punch') return 'punch'
  if (demo?.startsWith('earthquake')) return 'earthquake'
  return 'hub'
}

export default function HubApp() {
  const [screen, setScreen] = useState<GameId | 'hub'>(requestedScreen)
  const [sound, setSound] = useState(true)

  if (screen === 'punch')
    return <PunchExperience onHome={() => setScreen('hub')} />
  if (screen === 'earthquake')
    return (
      <EarthquakeGame
        sound={sound}
        onSoundChange={setSound}
        onHome={() => setScreen('hub')}
      />
    )

  return (
    <main className="hub-shell">
      <section className="game-roster" aria-label="DRRM games">
        {GAMES.filter((game) => game.available).map((game) => (
          <button
            key={game.id}
            type="button"
            className="game-card"
            onClick={() => setScreen(game.id as GameId)}
          >
            <strong>{game.title}</strong>
          </button>
        ))}
      </section>
    </main>
  )
}
