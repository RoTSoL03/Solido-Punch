import { describe, expect, it } from 'vitest'
import { GAME_CONFIG } from '../config'
import type { TrackedFist } from '../types'
import {
  applyCompetitiveItem,
  chooseVersusTarget,
  createVersusPlayerState,
  getLaneSpeedMultiplier,
  getVersusWinner,
  groupHandsByLane,
  laneForX,
  selectFallbackHands,
} from './versus'

const hand = (id: number, x: number, radius = 0.06): TrackedFist => ({
  id,
  handedness: 'Unknown',
  center: { x, y: 0.5 },
  radius,
  isFist: true,
  speed: 0,
  confidence: 1,
  phase: 'armed',
  orientation: { x: 0, y: 0, z: 0 },
})

describe('versus rules', () => {
  it('keeps hands out of the center dead zone and opposite lane', () => {
    expect(laneForX(0.2)).toBe('left')
    expect(laneForX(0.8)).toBe('right')
    expect(laneForX(0.5)).toBeNull()
    const grouped = groupHandsByLane([hand(1, 0.2), hand(2, 0.5), hand(3, 0.8)])
    expect(grouped.left.map(({ id }) => id)).toEqual([1])
    expect(grouped.right.map(({ id }) => id)).toEqual([3])
  })

  it('keeps the largest hand in each lane for fallback mode', () => {
    const grouped = groupHandsByLane([
      hand(1, 0.2, 0.05),
      hand(2, 0.3, 0.08),
      hand(3, 0.8, 0.07),
    ])
    const selected = selectFallbackHands(grouped)
    expect(selected.left[0].id).toBe(2)
    expect(selected.right[0].id).toBe(3)
  })

  it('applies competitive effects to the correct player', () => {
    const left = createVersusPlayerState()
    const right = createVersusPlayerState()
    applyCompetitiveItem(left, right, 'speedAttack', 1000)
    expect(getLaneSpeedMultiplier(right, 3999)).toBe(1.5)
    expect(getLaneSpeedMultiplier(right, 4000)).toBe(1)
    applyCompetitiveItem(left, right, 'hazardAttack', 4000)
    expect(right.pendingHazards).toBe(GAME_CONFIG.versus.hazardBarrageCount)
    applyCompetitiveItem(left, right, 'shield', 5000)
    expect(left.round.shieldCharges).toBe(1)
  })

  it('refreshes timed effects without stacking them', () => {
    const left = createVersusPlayerState()
    const right = createVersusPlayerState()
    applyCompetitiveItem(left, right, 'speedAttack', 1000)
    applyCompetitiveItem(left, right, 'speedAttack', 2500)
    expect(right.speedAttackUntil).toBe(
      2500 + GAME_CONFIG.versus.speedAttackDurationMs,
    )

    applyCompetitiveItem(left, right, 'shield', 3000)
    applyCompetitiveItem(left, right, 'shield', 4500)
    expect(left.round.shieldCharges).toBe(1)
    expect(left.round.shieldUntil).toBe(
      4500 + GAME_CONFIG.bonuses.shieldDurationMs,
    )
  })

  it('forces a hazard barrage before normal random spawns', () => {
    const player = createVersusPlayerState()
    player.pendingHazards = 2
    expect(chooseVersusTarget(player, 0, 0, () => 0.99)).toBe('hazard')
    expect(chooseVersusTarget(player, 0, 0, () => 0.99)).toBe('hazard')
    expect(player.pendingHazards).toBe(0)
  })

  it('enforces the per-player item spawn cooldown', () => {
    const player = createVersusPlayerState()
    expect(chooseVersusTarget(player, 0, 0, () => 0)).toBe('speedAttack')
    expect(chooseVersusTarget(player, 0, 1000, () => 0)).toBe('hazard')
    expect(
      chooseVersusTarget(player, 0, GAME_CONFIG.versus.itemCooldownMs, () => 0),
    ).toBe('speedAttack')
  })

  it('reports wins and simultaneous draws', () => {
    const players = {
      left: createVersusPlayerState(),
      right: createVersusPlayerState(),
    }
    expect(getVersusWinner(players)).toBeNull()
    players.right.round.lives = 0
    expect(getVersusWinner(players)).toBe('left')
    players.left.round.lives = 0
    expect(getVersusWinner(players)).toBe('draw')
  })
})
