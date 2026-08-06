import type { TargetSnapshot, TrackedFist } from '../types'

const FIST_HITBOX_SCALE = 1.14
const HAND_HAZARD_SCALE = 1.22
const TARGET_HITBOX_SCALE = 1.08
const CONTACT_PADDING = 0.008

function distanceToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const segmentX = end.x - start.x
  const segmentY = end.y - start.y
  const lengthSquared = segmentX * segmentX + segmentY * segmentY
  if (lengthSquared < 1e-8) return Math.hypot(point.x - end.x, point.y - end.y)
  const progress = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) /
        lengthSquared,
    ),
  )
  const closestX = start.x + segmentX * progress
  const closestY = start.y + segmentY * progress
  return Math.hypot(point.x - closestX, point.y - closestY)
}

export function findAutomaticPunchTarget(
  fist: TrackedFist,
  targets: TargetSnapshot[],
): TargetSnapshot | undefined {
  if (!fist.isFist || fist.phase !== 'punching') return undefined
  const start = fist.previousCenter ?? fist.center
  let closest: TargetSnapshot | undefined
  let closestContact = Infinity
  for (const target of targets) {
    if (target.hit || target.kind === 'hazard') continue
    const contactDistance = distanceToSegment(target, start, fist.center)
    const contactRadius =
      fist.radius * FIST_HITBOX_SCALE +
      target.radius * TARGET_HITBOX_SCALE +
      CONTACT_PADDING
    if (contactDistance > contactRadius || contactDistance >= closestContact)
      continue
    closest = target
    closestContact = contactDistance
  }
  return closest
}

export function findHazardContact(
  hand: TrackedFist,
  targets: TargetSnapshot[],
): TargetSnapshot | undefined {
  const start = hand.previousCenter ?? hand.center
  let closest: TargetSnapshot | undefined
  let closestContact = Infinity
  for (const target of targets) {
    if (target.hit || target.kind !== 'hazard') continue
    const contactDistance = distanceToSegment(target, start, hand.center)
    const contactRadius =
      hand.radius * HAND_HAZARD_SCALE +
      target.radius * TARGET_HITBOX_SCALE +
      CONTACT_PADDING
    if (contactDistance > contactRadius || contactDistance >= closestContact)
      continue
    closest = target
    closestContact = contactDistance
  }
  return closest
}
