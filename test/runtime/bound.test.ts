import { describe, expect, it } from 'vitest'
import { boundData } from '../../src/runtime/bound.js'

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

describe('boundData', () => {
  it.each([
    null,
    true,
    42,
    'small',
    ['one', 'two'],
    { first: 1, second: 'two' },
  ])('passes through a value already within the budget: %j', value => {
    const result = boundData(value, bytes(value))

    expect(result).toEqual({ data: value, truncated: false, bytes: bytes(value), original_bytes: bytes(value), dropped: 0 })
    expect(JSON.stringify(result.data)).toBe(JSON.stringify(value))
  })

  it('drops array tail elements in document order and counts them', () => {
    const result = boundData(['one', 'two', 'three'], bytes(['one']))

    expect(result.data).toEqual(['one'])
    expect(result.truncated).toBe(true)
    expect(result.bytes).toBe(bytes(['one']))
    expect(result.original_bytes).toBe(bytes(['one', 'two', 'three']))
    expect(result.dropped).toBe(2)
  })

  it('truncates nested objects depth-first and counts nested and outer keys', () => {
    const data = { first: { alpha: 1, beta: 2 }, second: 3 }
    const result = boundData(data, bytes({ first: { alpha: 1 } }))

    expect(result.data).toEqual({ first: { alpha: 1 } })
    expect(result.truncated).toBe(true)
    expect(result.dropped).toBe(2)
  })

  it('drops an oversized string whole and never emits a proper prefix', () => {
    const input = 'start—😀—finish'
    const result = boundData({ first: 'kept', second: input }, bytes({ first: 'kept' }))

    expect(result.data).toEqual({ first: 'kept' })
    expect(result.truncated).toBe(true)
    expect(result.dropped).toBe(1)
    const returnedStrings = JSON.stringify(result.data).match(/"(?:[^"\\]|\\.)*"/g) ?? []
    expect(returnedStrings.every(value => !input.startsWith(JSON.parse(value) as string))).toBe(true)
  })

  it('counts every value inside subtrees dropped whole', () => {
    const data = {
      kept: 1,
      omitted: { alpha: 2, nested: [3, 4] },
      last: 5,
    }
    const result = boundData(data, bytes({ kept: 1 }))

    expect(result.data).toEqual({ kept: 1 })
    // omitted object + alpha + nested array + its two entries + last
    expect(result.dropped).toBe(6)
  })

  it('treats maxBytes 0 as an unbounded passthrough', () => {
    const data = { content: 'x'.repeat(10_000) }

    expect(boundData(data, 0)).toEqual({ data, truncated: false, bytes: bytes(data), original_bytes: bytes(data), dropped: 0 })
  })

  it('does not mutate the input value', () => {
    const data = { first: ['one', 'two'], second: { nested: true } }
    const before = structuredClone(data)

    boundData(data, bytes({ first: ['one'] }))

    expect(data).toEqual(before)
  })
})
