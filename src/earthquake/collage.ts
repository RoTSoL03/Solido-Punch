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
  canvas.width = 3840
  canvas.height = 2160
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable')

  context.fillStyle = '#121212'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#f7fbff'
  context.font = '800 142px Arial, sans-serif'
  context.fillText('DROP · COVER · HOLD ON', 150, 210)
  context.fillStyle = '#ffd34e'
  context.font = '700 54px Arial, sans-serif'
  context.fillText(
    `${'★'.repeat(result.stars)}${'☆'.repeat(3 - result.stars)}  Completed in ${result.totalSeconds.toFixed(1)} seconds`,
    154,
    300,
  )

  const images = await Promise.all(
    result.captures.map((capture) => loadImage(capture.dataUrl)),
  )
  images.forEach((image, index) => {
    const x = 150 + index * 1230
    const y = 430
    const width = 1140
    const height = 760
    const scale = Math.min(width / image.width, height / image.height)
    context.save()
    context.beginPath()
    context.roundRect(x, y, width, height, 42)
    context.clip()
    context.fillStyle = '#071018'
    context.fillRect(x, y, width, height)
    context.drawImage(
      image,
      0,
      0,
      image.width,
      image.height,
      x + (width - image.width * scale) / 2,
      y + (height - image.height * scale) / 2,
      image.width * scale,
      image.height * scale,
    )
    context.restore()
    context.fillStyle = '#ffffff'
    context.font = '800 62px Arial, sans-serif'
    context.fillText(result.captures[index].label, x, 1310)
    context.fillStyle = '#9ed4df'
    context.font = '600 39px Arial, sans-serif'
    context.fillText(
      `${result.captures[index].reactionSeconds.toFixed(1)} seconds`,
      x,
      1372,
    )
  })

  context.fillStyle = '#c3d7df'
  context.font = '500 42px Arial, sans-serif'
  context.fillText(
    `${result.mode === 'group' ? `Team of ${result.participantCount}` : 'Solo challenge'} · Resilient 4 DRRM AR Games`,
    150,
    1900,
  )
  context.fillStyle = '#7fa4b4'
  context.font = '500 34px Arial, sans-serif'
  context.fillText(
    'Camera processing and photos stayed on this device',
    150,
    1970,
  )
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Export failed'))),
      'image/png',
    ),
  )
}
