import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../src/api.js', () => ({
  ecfrFetchXml: vi.fn(),
  latestDate: vi.fn(),
}))

import { ecfrFetchXml, latestDate } from '../../src/api.js'
import { readAction } from '../../src/commands/read.js'

describe('readAction', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  const mockFetchXml = vi.mocked(ecfrFetchXml)

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.mocked(latestDate).mockResolvedValue('2026-04-01')
  })

  afterEach(() => {
    logSpy.mockRestore()
    vi.clearAllMocks()
  })

  it('fetches XML with correct path and params', async () => {
    mockFetchXml.mockResolvedValueOnce('<SECTION><P>Test</P></SECTION>')

    await readAction('32', { part: '2002', section: '2002.14', date: '2026-04-01' }, { json: true })
    expect(mockFetchXml).toHaveBeenCalledWith(
      '/api/versioner/v1/full/2026-04-01/title-32.xml?part=2002&section=2002.14'
    )
  })

  it('outputs raw XML when --xml flag is set', async () => {
    const xml = '<SECTION><P>Raw XML</P></SECTION>'
    mockFetchXml.mockResolvedValueOnce(xml)

    await readAction('32', { xml: true }, { json: false })
    expect(latestDate).toHaveBeenCalledWith('32')
    expect(mockFetchXml).toHaveBeenCalledWith('/api/versioner/v1/full/2026-04-01/title-32.xml')
    expect(logSpy).toHaveBeenCalledWith(xml)
  })

  it('outputs parsed text for human mode', async () => {
    const originalIsTTY = process.stdout.isTTY
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true })

    mockFetchXml.mockResolvedValueOnce('<SECTION><SECTNO>§ 2002.14</SECTNO><P>CUI rules</P></SECTION>')

    await readAction('32', { date: '2026-04-01' }, { json: false })
    // Should have two log calls: title header + empty line, then parsed text
    const allOutput = logSpy.mock.calls.map(c => c[0]).join('\n')
    expect(allOutput).toContain('§ 2002.14')
    expect(allOutput).toContain('CUI rules')

    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, writable: true })
  })
})
