import { HAND_CONNECTIONS } from '../config'
import { distance } from '../math/coordinates'
import { getPerformanceProfile } from '../performance/profile'
import type { HandObservation, TargetSnapshot, TrackedFist } from '../types'
import { getFistCenter } from '../tracking/fist'

export function shouldDrawSkeleton(
  hand: HandObservation,
  fists: TrackedFist[],
  hasFistModels: boolean,
): boolean {
  if (!hasFistModels) return true
  const center = getFistCenter(hand.landmarks)
  const matchedFist = fists
    .filter((fist) => distance(fist.center, center) < 0.24)
    .sort((a, b) => distance(a.center, center) - distance(b.center, center))[0]
  return !matchedFist?.isFist
}

export function drawHands(
  canvas: HTMLCanvasElement,
  hands: HandObservation[],
  fists: TrackedFist[],
  hasFistModels: boolean,
  debugTargets: TargetSnapshot[] = [],
): void {
  const context = canvas.getContext('2d', {
    alpha: true,
    desynchronized: true,
  })
  if (!context) return
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const dpr = getPerformanceProfile().pixelRatio
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr
    canvas.height = height * dpr
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, width, height)
  context.lineCap = 'round'
  context.lineJoin = 'round'

  hands.forEach((hand, index) => {
    if (!shouldDrawSkeleton(hand, fists, hasFistModels)) return

    context.strokeStyle = index === 0 ? '#6fffea' : '#ffdf66'
    context.fillStyle = context.strokeStyle
    context.lineWidth = 2
    context.globalAlpha = 0.78
    context.beginPath()
    for (const [a, b] of HAND_CONNECTIONS) {
      context.moveTo(hand.landmarks[a].x * width, hand.landmarks[a].y * height)
      context.lineTo(hand.landmarks[b].x * width, hand.landmarks[b].y * height)
    }
    context.stroke()
    context.beginPath()
    hand.landmarks.forEach((point) => {
      const x = point.x * width
      const y = point.y * height
      context.moveTo(x + 2.5, y)
      context.arc(x, y, 2.5, 0, Math.PI * 2)
    })
    context.fill()
  })

  context.globalAlpha = 1
  fists.forEach((fist) => {
    if (!fist.isFist) return
    const radius = fist.radius * Math.min(width, height)
    const color =
      fist.phase === 'punching'
        ? '#ffffff'
        : fist.phase === 'cooldown'
          ? '#ff8b66'
          : fist.phase === 'armed'
            ? '#6fffea'
            : '#aab4c8'
    context.strokeStyle = color
    context.lineWidth = fist.phase === 'punching' ? 6 : 3
    context.setLineDash(fist.phase === 'cooldown' ? [6, 6] : [])
    context.beginPath()
    context.arc(
      fist.center.x * width,
      fist.center.y * height,
      radius,
      0,
      Math.PI * 2,
    )
    context.stroke()
    context.setLineDash([])
    if (fist.phase === 'punching') {
      context.globalAlpha = 0.2
      context.fillStyle = color
      context.fill()
      context.globalAlpha = 1
    }
  })

  if (debugTargets.length > 0) {
    const scale = Math.min(width, height)
    context.setLineDash([5, 5])
    context.lineWidth = 2
    context.globalAlpha = 0.9
    for (const target of debugTargets) {
      if (target.kind !== 'hazard' || target.hit) continue
      context.strokeStyle = '#ff536f'
      context.beginPath()
      context.arc(
        target.x * width,
        target.y * height,
        target.radius * 0.85 * scale,
        0,
        Math.PI * 2,
      )
      context.stroke()
    }
    for (const fist of fists) {
      context.strokeStyle = '#5ee7ff'
      context.beginPath()
      context.arc(
        fist.center.x * width,
        fist.center.y * height,
        fist.radius * 0.55 * scale,
        0,
        Math.PI * 2,
      )
      context.stroke()
    }
    context.setLineDash([])
    context.globalAlpha = 1
  }
}
