import {
  COMPETITIVE_ITEM_KINDS,
  GAME_CONFIG,
  type CompetitiveItemKind,
  type TargetKind,
} from '../config'
import type { PlayerLane, TrackedFist } from '../types'
import { createRoundState, type RoundState } from './rules'

export interface VersusPlayerState {
  round: RoundState
  speedAttackUntil: number
  pendingHazards: number
  lastItemSpawnAt: number
}

export const createVersusPlayerState = (): VersusPlayerState => ({
  round: createRoundState(),
  speedAttackUntil: 0,
  pendingHazards: 0,
  lastItemSpawnAt: -Infinity,
})

export function laneForX(x: number): PlayerLane | null {
  const halfDeadZone = GAME_CONFIG.versus.centerDeadZone / 2
  if (x < 0.5 - halfDeadZone) return 'left'
  if (x > 0.5 + halfDeadZone) return 'right'
  return null
}

export function groupHandsByLane(
  hands: TrackedFist[],
): Record<PlayerLane, TrackedFist[]> {
  const grouped: Record<PlayerLane, TrackedFist[]> = { left: [], right: [] }
  for (const hand of hands) {
    const lane = laneForX(hand.center.x)
    if (lane) grouped[lane].push(hand)
  }
  return grouped
}

export function selectFallbackHands(
  hands: Record<PlayerLane, TrackedFist[]>,
): Record<PlayerLane, TrackedFist[]> {
  return {
    left: [...hands.left].sort((a, b) => b.radius - a.radius).slice(0, 1),
    right: [...hands.right].sort((a, b) => b.radius - a.radius).slice(0, 1),
  }
}

export function applyCompetitiveItem(
  collector: VersusPlayerState,
  opponent: VersusPlayerState,
  kind: CompetitiveItemKind,
  now: number,
): void {
  if (kind === 'shield') {
    collector.round.shieldCharges = 1
    collector.round.shieldUntil = now + GAME_CONFIG.bonuses.shieldDurationMs
  } else if (kind === 'speedAttack') {
    opponent.speedAttackUntil = now + GAME_CONFIG.versus.speedAttackDurationMs
  } else {
    opponent.pendingHazards += GAME_CONFIG.versus.hazardBarrageCount
  }
}

export function getLaneSpeedMultiplier(
  state: VersusPlayerState,
  now: number,
): number {
  return state.speedAttackUntil > now
    ? GAME_CONFIG.versus.speedAttackMultiplier
    : 1
}

export function chooseVersusTarget(
  state: VersusPlayerState,
  elapsedRatio: number,
  now: number,
  random = Math.random,
): TargetKind {
  if (state.pendingHazards > 0) {
    state.pendingHazards -= 1
    return 'hazard'
  }
  if (
    now - state.lastItemSpawnAt >= GAME_CONFIG.versus.itemCooldownMs &&
    random() < GAME_CONFIG.versus.itemChance
  ) {
    state.lastItemSpawnAt = now
    return COMPETITIVE_ITEM_KINDS[
      Math.min(
        COMPETITIVE_ITEM_KINDS.length - 1,
        Math.floor(random() * COMPETITIVE_ITEM_KINDS.length),
      )
    ]
  }
  if (
    random() <
    GAME_CONFIG.spawning.hazardChance * (0.65 + elapsedRatio * 0.7)
  )
    return 'hazard'
  const normals = ['orb', 'cube', 'crystal'] as const
  return normals[Math.min(normals.length - 1, Math.floor(random() * 3))]
}

export function getVersusWinner(
  players: Record<PlayerLane, VersusPlayerState>,
): PlayerLane | 'draw' | null {
  const leftOut = players.left.round.lives <= 0
  const rightOut = players.right.round.lives <= 0
  if (leftOut && rightOut) return 'draw'
  if (leftOut) return 'right'
  if (rightOut) return 'left'
  return null
}
