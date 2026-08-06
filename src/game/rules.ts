import {
  GAME_CONFIG,
  getTimeBonusSeconds,
  isBonusTarget,
  type TargetKind,
} from '../config'

export interface RoundState {
  score: number
  combo: number
  bestCombo: number
  lives: number
  timeBonusSeconds: number
  scoreMultiplierUntil: number
  hitTargets: Set<number>
}

export const createRoundState = (): RoundState => ({
  score: 0,
  combo: 0,
  bestCombo: 0,
  lives: GAME_CONFIG.startingLives,
  timeBonusSeconds: 0,
  scoreMultiplierUntil: 0,
  hitTargets: new Set(),
})

export function scoreHit(
  state: RoundState,
  targetId: number,
  kind: TargetKind,
  now = 0,
): boolean {
  if (state.hitTargets.has(targetId)) return false
  state.hitTargets.add(targetId)
  if (kind === 'hazard') {
    state.lives = Math.max(0, state.lives - 1)
    state.combo = 0
    return true
  }
  if (kind === 'multiplier') {
    state.scoreMultiplierUntil = now + GAME_CONFIG.bonuses.multiplierDurationMs
    return true
  }
  const timeBonus = getTimeBonusSeconds(kind)
  if (timeBonus > 0) {
    state.timeBonusSeconds += timeBonus
    return true
  }
  if (kind === 'heart') {
    state.lives = Math.min(GAME_CONFIG.maxLives, state.lives + 1)
    return true
  }
  state.combo += 1
  state.bestCombo = Math.max(state.bestCombo, state.combo)
  const base = GAME_CONFIG.targetTypes[kind].points
  const tier = Math.floor(state.combo / GAME_CONFIG.comboStep)
  const multiplier = state.scoreMultiplierUntil > now ? 2 : 1
  state.score += Math.round(
    base * (1 + tier * GAME_CONFIG.comboBonus) * multiplier,
  )
  return true
}

export function missTarget(state: RoundState, kind: TargetKind): void {
  if (kind === 'hazard' || isBonusTarget(kind)) return
  state.lives = Math.max(0, state.lives - 1)
  state.combo = 0
}

export function getRoundDurationSeconds(state: RoundState): number {
  return GAME_CONFIG.roundDurationSeconds + state.timeBonusSeconds
}

export function getScoreMultiplier(state: RoundState, now: number): 1 | 2 {
  return state.scoreMultiplierUntil > now ? 2 : 1
}

export function getDifficulty(elapsedRatio: number): {
  spawnInterval: number
  fallSpeed: number
  gravity: number
} {
  const t = Math.min(Math.max(elapsedRatio, 0), 1)
  const eased = t * t * (3 - 2 * t)
  return {
    spawnInterval:
      GAME_CONFIG.spawning.initialInterval +
      (GAME_CONFIG.spawning.finalInterval -
        GAME_CONFIG.spawning.initialInterval) *
        eased,
    fallSpeed:
      GAME_CONFIG.spawning.initialSpeed +
      (GAME_CONFIG.spawning.finalSpeed - GAME_CONFIG.spawning.initialSpeed) *
        eased,
    gravity:
      GAME_CONFIG.physics.initialGravity +
      (GAME_CONFIG.physics.finalGravity - GAME_CONFIG.physics.initialGravity) *
        eased,
  }
}
