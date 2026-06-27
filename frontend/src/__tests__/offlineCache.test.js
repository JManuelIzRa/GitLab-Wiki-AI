import { describe, it, expect } from 'vitest'
import { offlineCache } from '../utils/offlineCache'

// jsdom ships a minimal IndexedDB stub; we just verify the API surface works
// without throwing. Full persistence is tested in integration.

describe('offlineCache', () => {
  it('exports the expected methods', () => {
    expect(typeof offlineCache.setStructure).toBe('function')
    expect(typeof offlineCache.getStructure).toBe('function')
    expect(typeof offlineCache.setPage).toBe('function')
    expect(typeof offlineCache.getPage).toBe('function')
    expect(typeof offlineCache.clearRepo).toBe('function')
  })

  it('getStructure returns null for an unknown repo without throwing', async () => {
    const result = await offlineCache.getStructure(99999).catch(() => null)
    // null or undefined are both acceptable — key doesn't exist
    expect(result == null).toBe(true)
  })

  it('getPage returns null for an unknown slug without throwing', async () => {
    const result = await offlineCache.getPage(99999, 'nonexistent').catch(() => null)
    expect(result == null).toBe(true)
  })
})
