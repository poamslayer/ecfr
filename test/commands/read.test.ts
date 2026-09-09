import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runOperation } from '../../src/runtime/run.js'
import { read } from '../../src/schema/ops/read.js'
import { flags } from '../../src/schema/flags.js'
import { fixtureFetch } from '../helpers/fetch-stub.js'

const goldenDirectory = path.resolve(import.meta.dirname, '../golden')

const currency = {
  titles: [{ number: 32, latest_issue_date: '2026-04-01', latest_amended_on: '2026-03-30', up_to_date_as_of: '2026-04-01' }],
}

describe('read operation', () => {
  it('defaults the issue date and transforms XML into data', async () => {
    const xml = '<SECTION><SECTNO>§ 2002.14</SECTNO><P>CUI rules</P></SECTION>'
    const fetch = vi.fn(async input => String(input).endsWith('/titles')
      ? new Response(JSON.stringify(currency), { headers: { 'content-type': 'application/json' } })
      : new Response(xml, { headers: { 'content-type': 'application/xml' } })) as typeof globalThis.fetch

    const result = await runOperation(read, { title: '32', part: '2002', section: '2002.14' }, { fetch })

    if (!result.envelope.ok) throw new Error('expected success')
    expect(result.envelope.data).toMatchObject({ title: '32', date: '2026-04-01' })
    expect((result.envelope.data as { content: string }).content).toContain('CUI rules')
    expect((result.envelope.data as { sections: unknown[] }).sections).toEqual([])
    expect(result.envelope.defaulted).toEqual(['date'])
    expect(result.envelope.source?.url).toBe('https://www.ecfr.gov/api/versioner/v1/full/2026-04-01/title-32.xml?part=2002&section=2002.14')
  })

  it('sets raw output to the upstream XML when requested', async () => {
    const xml = '<SECTION><P>Raw XML</P></SECTION>'
    const fetch = vi.fn(async input => String(input).endsWith('/titles')
      ? new Response(JSON.stringify(currency), { headers: { 'content-type': 'application/json' } })
      : new Response(xml, { headers: { 'content-type': 'application/xml' } })) as typeof globalThis.fetch

    const result = await runOperation(read, { title: '32', date: '2026-04-01', xml: true }, { fetch })
    expect(result.raw).toBe(xml)
    expect(result.exit_code).toBe(0)
  })

  it('returns a dry run envelope without fetching the regulation XML', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(currency), {
      headers: { 'content-type': 'application/json' },
    })) as typeof globalThis.fetch
    const result = await runOperation(read, { title: '32' }, { fetch, dryRun: true })
    if (!result.envelope.ok) throw new Error('expected success')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(result.envelope.dry_run).toBe(true)
    expect(result.envelope.data).toBeNull()
  })

  it('returns the title 48 section metadata and faithful Content', async () => {
    const result = await runOperation(read, {
      title: '48',
      part: '252',
      section: '252.204-7012',
      date: '2026-09-01',
    }, { fetch: fixtureFetch() })

    if (!result.envelope.ok) throw new Error('expected success')
    expect(result.envelope).not.toHaveProperty('sections')
    const data = result.envelope.data as {
      content: string
      sections: Array<Record<string, string | null>>
    }
    expect(data.sections).toHaveLength(1)
    expect(data.sections[0]).toMatchObject({
      number: '252.204-7012',
      citation: '48 CFR 252.204-7012',
      alternate_reference: 'DFARS 252.204-7012',
      federal_register_citation: expect.stringContaining('[80 FR 51745'),
    })
    expect(data.content).toContain('Adequate security means')
    expect(data.content).not.toContain('Adequate securitymeans')
    expect(data.content).toContain('(End of clause)')
    expect(data.content).not.toContain('[80 FR 51745')
  })

  it('returns null source fields that the title 32 section does not carry', async () => {
    const result = await runOperation(read, {
      title: '32',
      part: '2002',
      section: '2002.14',
      date: '2026-08-17',
    }, { fetch: fixtureFetch() })

    if (!result.envelope.ok) throw new Error('expected success')
    expect((result.envelope.data as { sections: unknown[] }).sections).toEqual([{
      number: '2002.14',
      citation: '32 CFR 2002.14',
      alternate_reference: null,
      federal_register_citation: null,
    }])
  })

  it('matches the plain-text Content golden byte for byte', async () => {
    const result = await runOperation(read, {
      title: '48',
      part: '252',
      section: '252.204-7012',
      date: '2026-09-01',
    }, { fetch: fixtureFetch() })

    if (!result.envelope.ok) throw new Error('expected success')
    const expected = readFileSync(path.join(goldenDirectory, 'read-48-252-204-7012.content.txt'), 'utf8')
    expect((result.envelope.data as { content: string }).content).toBe(expected)
  })

  it('shows available CFR citations in the human view', () => {
    const rendered = read.render({
      title: '48',
      date: '2026-09-01',
      content: 'Clause',
      sections: [{
        number: '252.204-7012',
        citation: '48 CFR 252.204-7012',
        alternate_reference: 'DFARS 252.204-7012',
        federal_register_citation: null,
      }],
    }, { title: '48', part: '252', section: '252.204-7012', date: '2026-09-01' })
    expect(rendered).toContain('48 CFR 252.204-7012')
  })
})

describe('read positional citation syntax', () => {
  it('resolves a section citation to the same upstream URL as the flag form', async () => {
    const result = await runOperation(read, { title: '32 CFR 2002.14' }, { fetch: fixtureFetch() })

    if (!result.envelope.ok) throw new Error(`expected success: ${JSON.stringify(result.envelope)}`)
    expect(result.envelope.source?.url).toBe(
      'https://www.ecfr.gov/api/versioner/v1/full/2026-08-17/title-32.xml?part=2002&section=2002.14',
    )
    expect(result.envelope.params).toMatchObject({
      title: '32',
      part: '2002',
      section: '2002.14',
      citation: '32 CFR 2002.14',
    })
    expect((result.envelope.data as { title: string }).title).toBe('32')
  })

  it('does not list the part or section as Defaulted; the citation carried them', async () => {
    const result = await runOperation(read, { title: '32 CFR 2002.14' }, { fetch: fixtureFetch() })
    if (!result.envelope.ok) throw new Error('expected success')
    expect(result.envelope.defaulted).toEqual(['date'])
    expect(result.envelope.defaulted).not.toContain('part')
    expect(result.envelope.defaulted).not.toContain('section')
  })

  it('accepts the section sign and odd internal whitespace, reporting the citation verbatim', async () => {
    const result = await runOperation(read, { title: '32  CFR  §  2002.14' }, { fetch: fixtureFetch() })
    if (!result.envelope.ok) throw new Error('expected success')
    expect(result.envelope.params.citation).toBe('32  CFR  §  2002.14')
    expect(result.envelope.params).toMatchObject({ title: '32', part: '2002', section: '2002.14' })
  })

  it('accepts a DFARS section citation rather than reading its hyphen as a range', async () => {
    const result = await runOperation(read, { title: '48 CFR 252.204-7012' }, { fetch: fixtureFetch() })

    if (!result.envelope.ok) throw new Error(`expected success: ${JSON.stringify(result.envelope)}`)
    expect(result.envelope.params).toMatchObject({ title: '48', part: '252', section: '252.204-7012' })
    expect(result.envelope.source?.url).toBe(
      'https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-48.xml?part=252&section=252.204-7012',
    )
  })

  it('resolves the part form to a part with no section', async () => {
    const result = await runOperation(read, { title: '32 CFR Part 2002' }, { fetch: fixtureFetch(), dryRun: true })

    if (!result.envelope.ok) throw new Error('expected success')
    expect(result.envelope.source?.url).toBe(
      'https://www.ecfr.gov/api/versioner/v1/full/2026-08-17/title-32.xml?part=2002',
    )
    expect(result.envelope.params).toMatchObject({ title: '32', part: '2002', citation: '32 CFR Part 2002' })
    expect(result.envelope.params).not.toHaveProperty('section')
  })

  it('leaves the bare title form exactly as it was, with no citation in the params', async () => {
    const result = await runOperation(read, {
      title: '32',
      part: '2002',
      section: '2002.14',
      date: '2026-08-17',
    }, { fetch: fixtureFetch() })

    if (!result.envelope.ok) throw new Error('expected success')
    expect(result.envelope.params).not.toHaveProperty('citation')
    expect(result.envelope.params).toEqual({ title: '32', part: '2002', section: '2002.14', date: '2026-08-17' })
    expect(result.envelope.defaulted).toEqual([])
  })

  it('rejects a citation combined with --part, naming the conflicting flag', async () => {
    const result = await runOperation(read, { title: '32 CFR 2002.14', part: '2002' }, { fetch: fixtureFetch() })

    if (result.envelope.ok) throw new Error('expected failure')
    expect(result.exit_code).toBe(2)
    expect(result.envelope.error.code).toBe('USAGE')
    expect(result.envelope.error.field).toBe('part')
    expect(result.envelope.error.message).toContain('--part')
    expect(result.envelope.error.remediation).toContain('citation already carries')
  })

  it('rejects a citation combined with --section, naming the conflicting flag', async () => {
    const result = await runOperation(read, { title: '32 CFR part 2002', section: '2002.14' }, { fetch: fixtureFetch() })

    if (result.envelope.ok) throw new Error('expected failure')
    expect(result.envelope.error.field).toBe('section')
    expect(result.envelope.error.message).toContain('--section')
  })

  for (const [name, citation, remediation] of [
    ['a section range', '32 CFR 2002.14-2002.16', 'ecfr read 32 --part 2002'],
    ['a subpart', '32 CFR 2002.14 Subpart B', 'ecfr read 32 --part 2002'],
    ['an appendix', '32 CFR part 2002 Appendix A', 'ecfr read 32 --part 2002'],
    ['an alternate reference', 'DFARS 252.204-7012', '48 CFR 252.204-7012'],
    ['a section with no dot', '32 CFR 2002', '32 CFR part 2002'],
    ['plain gibberish', 'the CUI rule', 'ecfr read 32'],
  ] as const) {
    it(`rejects ${name} with exit 2, a title field, and a concrete command to run`, async () => {
      const fetch = vi.fn() as unknown as typeof globalThis.fetch
      const result = await runOperation(read, { title: citation }, { fetch })

      if (result.envelope.ok) throw new Error(`expected failure for ${citation}`)
      expect(result.exit_code).toBe(2)
      expect(result.envelope.error.code).toBe('USAGE')
      expect(result.envelope.error.field).toBe('title')
      expect(result.envelope.error.remediation).toContain(remediation)
      // Rejection is decided before anything is asked of ecfr.gov.
      expect(fetch).not.toHaveBeenCalled()
    })
  }

  it('still applies the hardened identifier schema to a section that arrives through a citation', async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch
    const result = await runOperation(read, { title: '32 CFR 2002..14' }, { fetch })

    if (result.envelope.ok) throw new Error('expected failure')
    expect(result.exit_code).toBe(2)
    expect(result.envelope.error.code).toBe('USAGE')
    expect(result.envelope.error.field).toBe('title')
    expect(result.envelope.error.remediation).toBe(flags.section.remediation)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('still applies the hardened identifier schema to a part that arrives through a citation', async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch
    const result = await runOperation(read, { title: '32 CFR part ..' }, { fetch })

    if (result.envelope.ok) throw new Error('expected failure')
    expect(result.envelope.error.code).toBe('USAGE')
    expect(result.envelope.error.remediation).toBe(flags.part.remediation)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not let a traversal sequence through the citation path', async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch
    const result = await runOperation(read, { title: '32 CFR ../../etc/passwd' }, { fetch })

    if (result.envelope.ok) throw new Error('expected failure')
    expect(result.exit_code).toBe(2)
    expect(fetch).not.toHaveBeenCalled()
  })
})
