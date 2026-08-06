export const BACKGROUND_MUSIC_URL = `${import.meta.env.BASE_URL}audio/background-music.mp3`

const MUSIC_VOLUME = 0.18
let music: HTMLAudioElement | null = null

function getMusic(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null
  if (music) return music
  music = new Audio(BACKGROUND_MUSIC_URL)
  music.loop = true
  music.preload = 'auto'
  music.volume = 0
  return music
}

/** Starts the media element silently from a user gesture for mobile autoplay rules. */
export function primeBackgroundMusic(): void {
  const audio = getMusic()
  if (!audio) return
  audio.volume = 0
  audio.currentTime = 0
  void audio
    .play()
    .then(() => {
      if (audio.volume !== 0) return
      audio.pause()
      audio.currentTime = 0
    })
    .catch(() => {})
}

export function playBackgroundMusic(restart = false): void {
  const audio = getMusic()
  if (!audio) return
  if (restart) audio.currentTime = 0
  audio.volume = MUSIC_VOLUME
  if (audio.paused) void audio.play().catch(() => {})
}

export function pauseBackgroundMusic(): void {
  if (!music) return
  music.pause()
}
