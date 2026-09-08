import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runOperation } from '../../src/runtime/run.js'
import { titles } from '../../src/schema/ops/titles.js'
import { fixtureFetch } from './fetch-stub.js'

describe('fixtureFetch', () => {
  it.skipIf(!existsSync(path.resolve(import.meta.dirname, '../fixtures/titles.json')))('serves the recorded title list to the runtime', async () => {
    const result = await runOperation(titles, {}, { fetch: fixtureFetch() })

    expect(result.exit_code).toBe(0)
    expect(result.envelope.ok).toBe(true)
    if (!result.envelope.ok) return
    expect((result.envelope.data as { titles: unknown[] }).titles).toHaveLength(50)
  })
})
