import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runOperation } from '../../src/runtime/run.js'
import { read } from '../../src/schema/ops/read.js'
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
