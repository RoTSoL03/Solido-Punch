import { Swords, User, Users } from 'lucide-react'
import { useState } from 'react'
import PunchGame from './App'
import { VersusPunchGame } from './VersusPunchGame'
import type { PunchMode } from './types'

interface PunchExperienceProps {
  onHome: () => void
}

export function PunchExperience({ onHome }: PunchExperienceProps) {
  const [mode, setMode] = useState<PunchMode | null>(null)

  if (mode === 'solo') return <PunchGame onHome={onHome} />
  if (mode === 'versus')
    return (
      <VersusPunchGame onHome={onHome} onChangeMode={() => setMode(null)} />
    )

  return (
    <main className="punch-mode-shell">
      <button className="mode-home" type="button" onClick={onHome}>
        Game menu
      </button>
      <section className="mode-heading">
        <Swords aria-hidden="true" />
        <span>AR COMBAT TRAINING</span>
        <h1>
          SOLIDO <em>PUNCH</em>
        </h1>
        <p>Choose how you want to train.</p>
      </section>
      <section className="mode-grid" aria-label="Choose Solido Punch mode">
        <button type="button" onClick={() => setMode('solo')}>
          <User aria-hidden="true" />
          <strong>Solo</strong>
          <span>60-second score challenge · two fists</span>
        </button>
        <button type="button" onClick={() => setMode('versus')}>
          <Users aria-hidden="true" />
          <strong>Versus</strong>
          <span>Two players · last survivor wins</span>
        </button>
      </section>
    </main>
  )
}
