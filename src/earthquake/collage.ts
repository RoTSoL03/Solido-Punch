import type { EarthquakeResult } from './types'

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = source
  })
}

export async function createResultCollage(
  result: EarthquakeResult,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = 1800
  canvas.height = 1125
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable')

  context.fillStyle = '#121212'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#f7fbff'
  context.font = '800 76px Arial, sans-serif'
  context.fillText('DROP · COVER · HOLD ON', 90, 115)
  context.fillStyle = '#ffd34e'
  context.font = '700 34px Arial, sans-serif'
  context.fillText(
    `${'★'.repeat(result.stars)}${'☆'.repeat(3 - result.stars)}  Completed in ${result.totalSeconds.toFixed(1)} seconds`,
    92,
    175,
  )

  const images = await Promise.all(
    result.captures.map((capture) => loadImage(capture.dataUrl)),
  )
  images.forEach((image, index) => {
    const x = 90 + index * 570
    const y = 240
    const width = 510
    const height = 680
    const scale = Math.max(width / image.width, height / image.height)
    const sourceWidth = width / scale
    const sourceHeight = height / scale
    context.save()
    context.beginPath()
    context.roundRect(x, y, width, height, 28)
    context.clip()
    context.drawImage(
      image,
      (image.width - sourceWidth) / 2,
      (image.height - sourceHeight) / 2,
      sourceWidth,
      sourceHeight,
      x,
      y,
      width,
      height,
    )
    context.restore()
    context.fillStyle = '#ffffff'
    context.font = '800 38px Arial, sans-serif'
    context.fillText(result.captures[index].label, x, 975)
    context.fillStyle = '#9ed4df'
    context.font = '600 25px Arial, sans-serif'
    context.fillText(
      `${result.captures[index].reactionSeconds.toFixed(1)} seconds`,
      x,
      1016,
    )
  })

  context.fillStyle = '#c3d7df'
  context.font = '500 24px Arial, sans-serif'
  context.fillText(
    'Solido DRRM Games · Camera processing stayed on this device',
    90,
    1080,
  )
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Export failed'))),
      'image/png',
    ),
  )
}
