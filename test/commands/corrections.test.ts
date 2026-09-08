import { describe, expect, it, vi } from 'vitest'
import { runOperation } from '../../src/runtime/run.js'
import { corrections } from '../../src/schema/ops/corrections.js'

describe('corrections operation', () => {
  it('uses title and date query params on the corrections endpoint', async () => {
    const data = {
      ecfr_corrections: [{
        fr_citation: '90 FR 12345', corrective_action: 'Correcting amendment',
        error_corrected: '2026-01-15', error_occurred: '2025-12-01', title: 32,
        cfr_references: [{ cfr_reference: '32 CFR 2002.14' }],
      }],
    }
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), {
      headers: { 'content-type': 'application/json' },
    })) as typeof globalThis.fetch

    const result = await runOperation(corrections, { title: '32', date: '2025-01-01' }, { fetch })

    if (!result.envelope.ok) throw new Error('expected success')
    expect(result.envelope.data).toEqual(data)
    expect(result.envelope.source?.url).toBe('https://www.ecfr.gov/api/admin/v1/corrections.json?title=32&date=2025-01-01')
  })
})
