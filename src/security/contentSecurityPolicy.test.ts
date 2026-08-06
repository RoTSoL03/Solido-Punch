import { describe, expect, it } from 'vitest'
import html from '../../index.html?raw'

describe('Content Security Policy', () => {
  it('allows the pinned MediaPipe WASM loader script', () => {
    const policy = html.match(
      /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
    )?.[1]
    const scriptSource = policy
      ?.split(';')
      .find((directive) => directive.trim().startsWith('script-src '))

    expect(scriptSource).toContain('https://cdn.jsdelivr.net')
  })
})
