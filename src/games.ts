import type { LucideIcon } from 'lucide-react'
import { Activity, CloudRain, Flame, Shield, Waves } from 'lucide-react'

export type GameId = 'earthquake' | 'punch'

export interface GameDefinition {
  id: GameId | string
  title: string
  eyebrow: string
  description: string
  icon: LucideIcon
  available: boolean
  featured?: boolean
  accent: string
}

export const GAMES: readonly GameDefinition[] = [
  {
    id: 'earthquake',
    title: 'Drop, Cover, Hold On',
    eyebrow: 'EARTHQUAKE SAFETY',
    description:
      'Follow Solido and master the three actions that keep you safe.',
    icon: Shield,
    available: true,
    featured: true,
    accent: '#ffd34e',
  },
  {
    id: 'punch',
    title: 'Solido Punch',
    eyebrow: 'AR REFLEX GAME',
    description: 'Raise your fists, strike the targets, and avoid the hazards.',
    icon: Activity,
    available: true,
    accent: '#5ee7ff',
  },
  {
    id: 'flood',
    title: 'Flood Ready',
    eyebrow: 'COMING SOON',
    description: 'Make quick choices and move to safer ground.',
    icon: Waves,
    available: false,
    accent: '#63a8ff',
  },
  {
    id: 'fire',
    title: 'Fire Escape',
    eyebrow: 'COMING SOON',
    description: 'Practice a calm and safe evacuation.',
    icon: Flame,
    available: false,
    accent: '#ff755e',
  },
  {
    id: 'storm',
    title: 'Storm Smart',
    eyebrow: 'COMING SOON',
    description: 'Learn what to prepare before severe weather.',
    icon: CloudRain,
    available: false,
    accent: '#b890ff',
  },
]
