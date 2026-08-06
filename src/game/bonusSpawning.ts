import {
  BONUS_TARGET_KINDS,
  GAME_CONFIG,
  type BonusTargetKind,
} from '../config'

export interface BonusSpawnProfile {
  chance: number
  weights: Record<BonusTargetKind, number>
}

export function getBonusSpawnProfile(
  remainingSeconds: number,
  lives: number,
): BonusSpawnProfile {
  const urgentTime =
    remainingSeconds < GAME_CONFIG.bonuses.urgentTimeThresholdSeconds
  const lowLife = lives <= 1
  return {
    chance:
      GAME_CONFIG.spawning.bonusChance +
      (urgentTime ? GAME_CONFIG.bonuses.urgentTimeBonusChance : 0) +
      (lowLife ? GAME_CONFIG.bonuses.lowLifeBonusChance : 0),
    weights: {
      multiplier: 3,
      time5: urgentTime ? 7 : 3,
      time7: urgentTime ? 5 : 2,
      time10: urgentTime ? 3 : 1,
      heart: lowLife ? 8 : 1,
    },
  }
}

export function selectBonusKind(
  profile: BonusSpawnProfile,
  randomValue = Math.random(),
): BonusTargetKind {
  const totalWeight = BONUS_TARGET_KINDS.reduce(
    (sum, kind) => sum + profile.weights[kind],
    0,
  )
  let cursor = Math.max(0, Math.min(0.999999, randomValue)) * totalWeight
  for (const kind of BONUS_TARGET_KINDS) {
    cursor -= profile.weights[kind]
    if (cursor < 0) return kind
  }
  return 'heart'
}
