import { describe, expect, it } from 'vitest'
import html from '../../index.html?raw'

describe('Content Security Policy', () => {
  it('allows local MediaPipe WASM without remote script hosts', () => {
    const policy = html.match(
      /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
    )?.[1]
    const scriptSource = policy
      ?.split(';')
      .find((directive) => directive.trim().startsWith('script-src '))
    const connectSource = policy
      ?.split(';')
      .find((directive) => directive.trim().startsWith('connect-src '))

    expect(scriptSource).toContain("'self'")
    expect(scriptSource).toContain("'wasm-unsafe-eval'")
    expect(scriptSource).not.toContain('https://')
    expect(connectSource).toContain("'self'")
    expect(connectSource).toContain('blob:')
    expect(connectSource).not.toContain('https://')
  })
})
