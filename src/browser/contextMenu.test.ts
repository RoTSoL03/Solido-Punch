import { describe, expect, it } from 'vitest'
import { preventContextMenu } from './contextMenu'

describe('context menu guard', () => {
  it('cancels the browser context-menu event', () => {
    const event = new Event('contextmenu', { cancelable: true })

    preventContextMenu(event)

    expect(event.defaultPrevented).toBe(true)
  })
})
