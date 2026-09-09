import { describe, expect, it, vi } from 'vitest'
import { envVars, readEnv } from '../src/schema/env.js'

describe('environment registry', () => {
  it('declares and parses every behavior-changing environment variable', () => {
    expect(Object.keys(envVars)).toEqual(['output', 'agent'])
    expect(readEnv({ ECFR_OUTPUT: 'text', ECFR_AGENT: 'audit-agent' })).toEqual({
      output: 'text',
      agent: 'audit-agent',
    })
  })

  it('ignores invalid values and emits diagnostics', () => {
    const diagnostics = vi.fn()
    expect(readEnv({ ECFR_OUTPUT: 'yaml', ECFR_AGENT: '' }, diagnostics)).toEqual({})
    expect(diagnostics).toHaveBeenCalledTimes(2)
    expect(diagnostics.mock.calls.flat().join('\n')).toContain('ECFR_OUTPUT')
    expect(diagnostics.mock.calls.flat().join('\n')).toContain('ECFR_AGENT')
  })
})
