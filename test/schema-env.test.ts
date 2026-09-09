import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { envVars, readEnv } from '../src/schema/env.js'

const sourceDirectory = path.resolve(import.meta.dirname, '../src')

function sourceFiles(): string[] {
  return readdirSync(sourceDirectory, { recursive: true, encoding: 'utf8' })
    .filter(entry => entry.endsWith('.ts'))
    .map(entry => path.join(sourceDirectory, entry))
}

describe('environment registry', () => {
  it('declares and parses every behavior-changing environment variable', () => {
    expect(Object.keys(envVars)).toEqual(['output', 'agent'])
    expect(readEnv({ ECFR_OUTPUT: 'text', ECFR_AGENT: 'audit-agent' })).toEqual({
      output: 'text',
      agent: 'audit-agent',
    })
  })

  // Drift guard: a variable read anywhere in src/ but missing from the registry would
  // change behaviour without being discoverable through `capabilities`.
  it('registers every ECFR_-prefixed variable named anywhere in src/', () => {
    const registered = Object.values(envVars).map(variable => variable.name).sort()
    const named = new Set<string>()
    for (const file of sourceFiles()) {
      for (const match of readFileSync(file, 'utf8').matchAll(/ECFR_[A-Z0-9_]+/g)) named.add(match[0])
    }
    expect([...named].sort()).toEqual(registered)
  })

  it('ignores invalid values and emits diagnostics', () => {
    const diagnostics = vi.fn()
    expect(readEnv({ ECFR_OUTPUT: 'yaml', ECFR_AGENT: '' }, diagnostics)).toEqual({})
    expect(diagnostics).toHaveBeenCalledTimes(2)
    expect(diagnostics.mock.calls.flat().join('\n')).toContain('ECFR_OUTPUT')
    expect(diagnostics.mock.calls.flat().join('\n')).toContain('ECFR_AGENT')
  })
})
