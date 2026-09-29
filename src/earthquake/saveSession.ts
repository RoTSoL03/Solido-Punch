import { createResultCollage } from './collage'
import type { EarthquakeResult } from './types'

interface SavedImage {
  filename: string
  dataUrl: string
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function sessionName(result: EarthquakeResult): string {
  const now = new Date()
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-')
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-')
  const suffix =
    result.mode === 'group' ? `group-${result.participantCount}` : 'solo'
  return `${date}/${time}-${suffix}`
}

export function canAutoSavePhotos(): boolean {
  return Boolean(window.__TAURI_INTERNALS__)
}

export async function saveEarthquakeSession(
  result: EarthquakeResult,
): Promise<string> {
  if (!canAutoSavePhotos())
    throw new Error('Automatic saving is available in the desktop app only.')
  const collage = await createResultCollage(result)
  const filenames = ['01-drop.png', '02-cover.png', '03-hold-on.png']
  const images: SavedImage[] = result.captures.map((capture, index) => ({
    filename: filenames[index],
    dataUrl: capture.dataUrl,
  }))
  images.push({
    filename: 'results-collage.png',
    dataUrl: await blobToDataUrl(collage),
  })
  const { invoke } = await import('@tauri-apps/api/core')
  return await invoke<string>('save_earthquake_session', {
    sessionName: sessionName(result),
    images,
  })
}
