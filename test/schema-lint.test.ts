import { describe, expect, it } from 'vitest'
import type { FlagKey } from '../src/schema/flags.js'
import { lintOperations, lintRules, operations } from '../src/schema/index.js'
import { titles } from '../src/schema/ops/titles.js'
import type { AnyOperation } from '../src/schema/types.js'

/**
 * One minimal broken operation per lint rule, built by spreading the `titles` op (which
 * has no positional, no flags, and is remote) and overriding just enough to trip the rule.
 */
const brokenFixtures: Record<string, () => AnyOperation[]> = {
  'name-is-lowercase-words': () => [{ ...titles, name: 'Titles' }],
  'name-has-no-drift-verb': () => [{ ...titles, name: 'show' }],
  'flags-exist-in-registry': () => [{ ...titles, flags: ['bogus'] as unknown as FlagKey[] }],
  'flags-are-not-global': () => [{ ...titles, flags: ['json'] as FlagKey[] }],
  'has-summary': () => [{ ...titles, summary: '' }],
  'has-description': () => [{ ...titles, description: '   ' }],
  'has-example': () => [{ ...titles, examples: [] }],
  'has-output-schema': () => [{ ...titles, output: undefined as unknown as typeof titles.output }],
  'has-render': () => [{ ...titles, render: undefined as unknown as typeof titles.render }],
  'network-matches-request': () => [{ ...titles, request: undefined }],
  'examples-start-with-name': () => [{ ...titles, examples: [{ command: 'nope', description: 'wrong prefix' }] }],
  // The uniqueness rule needs two operations sharing a name, so this fixture is the
  // exception to "one broken op" — the real `titles` plus an identical copy.
  'name-is-unique': () => [titles, { ...titles }],
  'title-scoped-has-title': () => [{ ...titles, titleScoped: true }],
  'raw-output-xml-has-xml-flag': () => [{ ...titles, rawOutput: 'xml' as const }],
}

describe('schema lint', () => {
  it('reports no issues for the real operation registry', () => {
    expect(lintOperations(operations)).toEqual([])
  })

  it('has a broken fixture for every exported rule', () => {
    expect(Object.keys(brokenFixtures).sort()).toEqual(Object.keys(lintRules).sort())
  })

  for (const ruleName of Object.keys(lintRules)) {
    it(`flags a violation of "${ruleName}"`, () => {
      const buildFixture = brokenFixtures[ruleName]
      expect(buildFixture, `no fixture defined for rule ${ruleName}`).toBeDefined()
      const issues = lintOperations(buildFixture())
      expect(issues.some(issue => issue.rule === ruleName)).toBe(true)
    })
  }
})
