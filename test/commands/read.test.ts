import { describe, expect, it, vi } from 'vitest'
import { runOperation } from '../../src/runtime/run.js'
import { read } from '../../src/schema/ops/read.js'

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
})
