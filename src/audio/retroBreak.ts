type WebkitWindow = typeof window & {
  webkitAudioContext?: typeof AudioContext
}

let sharedContext: AudioContext | null = null
const noiseBuffers = new Map<string, AudioBuffer>()

export interface RetroTonePlan {
  frequencies: readonly number[]
  duration: number
  volume: number
}

export function getCountdownTonePlan(count: number): RetroTonePlan {
  const remaining = Math.max(0, Math.min(3, Math.round(count)))
  if (remaining === 0) {
    return { frequencies: [880, 1175], duration: 0.22, volume: 0.1 }
  }
  return {
    frequencies: [440 + (3 - remaining) * 110],
    duration: 0.105,
    volume: 0.075,
  }
}

export function getGameOverTonePlan(): RetroTonePlan {
  return {
    frequencies: [523, 392, 294, 196, 147],
    duration: 0.72,
    volume: 0.1,
  }
}

export function createRetroNoiseSamples(
  sampleRate: number,
  duration: number,
  hazard: boolean,
): Float32Array {
  const sampleCount = Math.ceil(sampleRate * duration)
  const samples = new Float32Array(sampleCount)
  const holdLength = Math.max(
    1,
    Math.floor(sampleRate / (hazard ? 2600 : 4200)),
  )
  let register = 0xace1
  let heldSample = 0
  for (let index = 0; index < sampleCount; index += 1) {
    if (index % holdLength === 0) {
      register = (register >> 1) ^ (-(register & 1) & 0xb400)
      heldSample = (register / 0xffff) * 2 - 1
    }
    const envelope = (1 - index / sampleCount) ** 2
    samples[index] = heldSample * envelope
  }
  return samples
}

function getAudioContext(): AudioContext | null {
  const AudioContextClass =
    window.AudioContext ?? (window as WebkitWindow).webkitAudioContext
  if (!AudioContextClass) return null
  if (!sharedContext || sharedContext.state === 'closed')
    sharedContext = new AudioContextClass()
  return sharedContext
}

function withReadyContext(callback: (context: AudioContext) => void): void {
  const context = getAudioContext()
  if (!context) return
  if (context.state === 'suspended') {
    void context
      .resume()
      .then(() => callback(context))
      .catch(() => {})
    return
  }
  callback(context)
}

export function prepareRetroAudio(): void {
  const context = getAudioContext()
  if (!context) return
  getNoiseBuffer(context, 0.15, false)
  getNoiseBuffer(context, 0.19, true)
  if (context.state === 'suspended') void context.resume().catch(() => {})
}

function getNoiseBuffer(
  context: AudioContext,
  duration: number,
  hazard: boolean,
): AudioBuffer {
  const key = `${context.sampleRate}:${hazard ? 'hazard' : 'normal'}`
  const cached = noiseBuffers.get(key)
  if (cached) return cached
  const generatedSamples = createRetroNoiseSamples(
    context.sampleRate,
    duration,
    hazard,
  )
  const buffer = context.createBuffer(
    1,
    generatedSamples.length,
    context.sampleRate,
  )
  buffer.getChannelData(0).set(generatedSamples)
  noiseBuffers.set(key, buffer)
  return buffer
}

function play(context: AudioContext, hazard: boolean): void {
  const start = context.currentTime
  const duration = hazard ? 0.19 : 0.15
  const master = context.createGain()
  master.gain.setValueAtTime(hazard ? 0.14 : 0.11, start)
  master.gain.exponentialRampToValueAtTime(0.001, start + duration)
  master.connect(context.destination)

  const tone = context.createOscillator()
  tone.type = 'square'
  const notes = hazard ? [190, 125, 78, 52] : [880, 620, 360, 150]
  notes.forEach((frequency, index) => {
    tone.frequency.setValueAtTime(
      frequency,
      start + (duration * index) / notes.length,
    )
  })
  const toneGain = context.createGain()
  toneGain.gain.setValueAtTime(0.72, start)
  toneGain.gain.exponentialRampToValueAtTime(0.001, start + duration)
  tone.connect(toneGain).connect(master)

  const noise = context.createBufferSource()
  noise.buffer = getNoiseBuffer(context, duration, hazard)
  const noiseGain = context.createGain()
  noiseGain.gain.setValueAtTime(hazard ? 0.9 : 0.68, start)
  noise.connect(noiseGain).connect(master)

  tone.start(start)
  noise.start(start)
  tone.stop(start + duration)
  noise.stop(start + duration)
}

function playTonePlan(context: AudioContext, plan: RetroTonePlan): void {
  const start = context.currentTime
  const master = context.createGain()
  master.gain.setValueAtTime(plan.volume, start)
  master.gain.exponentialRampToValueAtTime(0.001, start + plan.duration)
  master.connect(context.destination)

  const tone = context.createOscillator()
  tone.type = 'square'
  plan.frequencies.forEach((frequency, index) => {
    tone.frequency.setValueAtTime(
      frequency,
      start + (plan.duration * index) / plan.frequencies.length,
    )
  })
  tone.connect(master)
  tone.start(start)
  tone.stop(start + plan.duration)
}

export function playRetroBreakSound(hazard: boolean): void {
  withReadyContext((context) => play(context, hazard))
}

export function playCountdownSound(count: number): void {
  withReadyContext((context) =>
    playTonePlan(context, getCountdownTonePlan(count)),
  )
}

export function playGameOverSound(): void {
  withReadyContext((context) => playTonePlan(context, getGameOverTonePlan()))
}
