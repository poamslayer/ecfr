import { describe, expect, it } from 'vitest'
import { isSectionRange, parseCitation, partOf, type ParsedCitation } from '../../src/schema/citation.js'

/** Every accepted spelling of the grammar, one row per rule. */
const accepted: Array<{ input: string; expected: Omit<ParsedCitation, 'citation'> }> = [
  { input: '32 CFR 2002.14', expected: { title: '32', part: '2002', section: '2002.14' } },
  { input: '32 CFR § 2002.14', expected: { title: '32', part: '2002', section: '2002.14' } },
  { input: '32 CFR §2002.14', expected: { title: '32', part: '2002', section: '2002.14' } },
  { input: '48 CFR 252.204-7012', expected: { title: '48', part: '252', section: '252.204-7012' } },
  { input: '26 CFR 1.1031(a)-1', expected: { title: '26', part: '1', section: '1.1031(a)-1' } },
  { input: '26 CFR 1.148-1A', expected: { title: '26', part: '1', section: '1.148-1A' } },
  { input: '32 CFR part 2002', expected: { title: '32', part: '2002' } },
  { input: '32 CFR Part 2002', expected: { title: '32', part: '2002' } },
  { input: '32 CFR PART 2002', expected: { title: '32', part: '2002' } },
  { input: '32 cfr 2002.14', expected: { title: '32', part: '2002', section: '2002.14' } },
  { input: '32   CFR \t 2002.14', expected: { title: '32', part: '2002', section: '2002.14' } },
  { input: '  32 CFR part   2002  ', expected: { title: '32', part: '2002' } },
]

/** Every rejected spelling, each with the distinct reason it is rejected for. */
const rejected: Array<{ name: string; input: string; reason: RegExp; remediation: RegExp }> = [
  {
    name: 'a section range',
    input: '32 CFR 2002.14-2002.16',
    reason: /range of sections/,
    remediation: /ecfr read 32 --part 2002/,
  },
  {
    name: 'a subpart qualifier',
    input: '32 CFR 2002.14 Subpart B',
    reason: /subpart, appendix, or other qualifier/,
    remediation: /ecfr read 32 --part 2002/,
  },
  {
    name: 'a lowercase subpart qualifier',
    input: '32 CFR 2002.14 subpart C',
    reason: /subpart, appendix, or other qualifier/,
    remediation: /ecfr read 32 --part 2002/,
  },
  {
    name: 'an appendix qualifier on the part form',
    input: '32 CFR part 2002 Appendix A',
    reason: /subpart, appendix, or other qualifier/,
    remediation: /ecfr read 32 --part 2002/,
  },
  {
    name: 'an abbreviated appendix qualifier',
    input: '32 CFR part 2002 App. A',
    reason: /subpart, appendix, or other qualifier/,
    remediation: /ecfr read 32 --part 2002/,
  },
  {
    name: 'an alternate reference',
    input: 'DFARS 252.204-7012',
    reason: /alternate reference, not a CFR citation/,
    remediation: /48 CFR 252\.204-7012/,
  },
  {
    name: 'a section with no dot',
    input: '32 CFR 2002',
    reason: /not a section number/,
    remediation: /32 CFR part 2002/,
  },
  {
    name: 'plain gibberish',
    input: 'not a citation at all',
    reason: /is not a CFR citation/,
    remediation: /ecfr read 32/,
  },
  {
    name: 'the empty string',
    input: '',
    reason: /empty positional/,
    remediation: /ecfr read 32/,
  },
  {
    name: 'whitespace only',
    input: '   ',
    reason: /empty positional/,
    remediation: /ecfr read 32/,
  },
]

describe('parseCitation', () => {
  for (const row of accepted) {
    it(`accepts ${JSON.stringify(row.input)}`, () => {
      const result = parseCitation(row.input)
      if (!result.ok) throw new Error(`expected ${row.input} to parse: ${result.reason}`)
      expect(result.value).toEqual({ ...row.expected, citation: row.input })
    })
  }

  it('reports the citation exactly as the caller typed it, untrimmed', () => {
    const result = parseCitation('  32 CFR   §  2002.14 ')
    if (!result.ok) throw new Error('expected a parse')
    expect(result.value.citation).toBe('  32 CFR   §  2002.14 ')
  })

  for (const row of rejected) {
    it(`rejects ${row.name}`, () => {
      const result = parseCitation(row.input)
      if (result.ok) throw new Error(`expected ${row.input} to be rejected`)
      expect(result.reason).toMatch(row.reason)
      expect(result.remediation).toMatch(row.remediation)
    })
  }

  it('gives every rejection its own reason', () => {
    const reasons = rejected.map(row => {
      const result = parseCitation(row.input)
      if (result.ok) throw new Error(`expected ${row.input} to be rejected`)
      return result.reason
    })
    // The two empty-ish rows and the three qualifier rows share a rule, and so a reason shape;
    // every distinct rule must still speak for itself.
    expect(new Set(reasons).size).toBeGreaterThanOrEqual(6)
  })
})

/**
 * The subtle rule. A hyphen alone does not mean a range: getting this backwards would reject
 * every DFARS clause, which is the CLI's most important use.
 */
describe('range detection', () => {
  it('treats 2002.14-2002.16 as a range because a dot follows the last hyphen', () => {
    expect(isSectionRange('2002.14-2002.16')).toBe(true)
  })

  for (const section of ['252.204-7012', '1.148-1A', '1.1031(a)-1', '2002.14']) {
    it(`does not treat ${section} as a range`, () => {
      expect(isSectionRange(section)).toBe(false)
    })
  }

  it('accepts 48 CFR 252.204-7012 rather than reading it as a range', () => {
    const result = parseCitation('48 CFR 252.204-7012')
    if (!result.ok) throw new Error(`DFARS clauses must parse: ${result.reason}`)
    expect(result.value).toMatchObject({ title: '48', part: '252', section: '252.204-7012' })
  })

  it('accepts 26 CFR 1.148-1A rather than reading it as a range', () => {
    const result = parseCitation('26 CFR 1.148-1A')
    if (!result.ok) throw new Error(`trailing letters must not read as a range: ${result.reason}`)
    expect(result.value).toMatchObject({ title: '26', part: '1', section: '1.148-1A' })
  })
})

describe('partOf', () => {
  it('takes everything before the first dot', () => {
    expect(partOf('2002.14')).toBe('2002')
    expect(partOf('252.204-7012')).toBe('252')
    expect(partOf('1.1031(a)-1')).toBe('1')
  })
})
