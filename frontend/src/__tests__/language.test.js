import { describe, it, expect } from 'vitest'
import { languageFromPath } from '../utils/language'

describe('languageFromPath', () => {
  it('maps common extensions to Prism language ids', () => {
    expect(languageFromPath('src/index.js')).toBe('javascript')
    expect(languageFromPath('app/main.py')).toBe('python')
    expect(languageFromPath('backend/server.ts')).toBe('typescript')
    expect(languageFromPath('main.go')).toBe('go')
    expect(languageFromPath('config.yml')).toBe('yaml')
    expect(languageFromPath('schema.json')).toBe('json')
    expect(languageFromPath('build.sh')).toBe('bash')
  })

  it('returns "text" for unknown extensions', () => {
    expect(languageFromPath('file.xyz')).toBe('text')
    expect(languageFromPath('Makefile')).toBe('text')
    expect(languageFromPath('')).toBe('text')
  })

  it('is case-insensitive for extensions', () => {
    expect(languageFromPath('File.PY')).toBe('python')
    expect(languageFromPath('App.JSX')).toBe('jsx')
  })
})
