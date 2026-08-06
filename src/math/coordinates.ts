import type { Point2 } from '../types'

export interface CoverTransform {
  scale: number
  renderedWidth: number
  renderedHeight: number
  offsetX: number
  offsetY: number
}

export function getCoverTransform(
  videoWidth: number,
  videoHeight: number,
  viewWidth: number,
  viewHeight: number,
): CoverTransform {
  const scale = Math.max(viewWidth / videoWidth, viewHeight / videoHeight)
  const renderedWidth = videoWidth * scale
  const renderedHeight = videoHeight * scale
  return {
    scale,
    renderedWidth,
    renderedHeight,
    offsetX: (viewWidth - renderedWidth) / 2,
    offsetY: (viewHeight - renderedHeight) / 2,
  }
}

export function videoPointToView(
  point: Point2,
  videoSize: Point2,
  viewSize: Point2,
  mirrored: boolean,
): Point2 {
  const transform = getCoverTransform(
    videoSize.x,
    videoSize.y,
    viewSize.x,
    viewSize.y,
  )
  const sourceX = mirrored ? 1 - point.x : point.x
  return {
    x: (sourceX * transform.renderedWidth + transform.offsetX) / viewSize.x,
    y: (point.y * transform.renderedHeight + transform.offsetY) / viewSize.y,
  }
}

export const distance = (a: Point2, b: Point2): number =>
  Math.hypot(a.x - b.x, a.y - b.y)

export const circlesOverlap = (
  a: Point2,
  aRadius: number,
  b: Point2,
  bRadius: number,
): boolean => distance(a, b) <= aRadius + bRadius
