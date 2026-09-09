export interface BoundResult {
  data: unknown
  truncated: boolean
  /** Serialized byte length of the value actually returned. */
  bytes: number
  /** Serialized byte length before bounding, so a caller can see the scale of what it lost. */
  original_bytes: number
  dropped: number
}

interface WalkResult {
  json: string
  bytes: number
  truncated: boolean
  dropped: number
}

const encoder = new TextEncoder()

function byteLength(value: string): number {
  return encoder.encode(value).byteLength
}

/** Count a value plus every array entry or object-property value nested inside it. */
function countValues(value: unknown): number {
  if (Array.isArray(value)) {
    return 1 + value.reduce((total, child) => total + countValues(child), 0)
  }
  if (value !== null && typeof value === 'object') {
    return 1 + Object.values(value).reduce((total, child) => total + countValues(child), 0)
  }
  return 1
}

function fitValue(value: unknown, maxBytes: number): WalkResult | null {
  if (Array.isArray(value)) {
    if (maxBytes < 2) return null
    const parts: string[] = []
    let bytes = 2
    let dropped = 0
    let truncated = false

    for (let index = 0; index < value.length; index += 1) {
      const separatorBytes = parts.length === 0 ? 0 : 1
      const child = fitValue(value[index], maxBytes - bytes - separatorBytes)
      if (child === null) {
        dropped += value.slice(index).reduce((total, omitted) => total + countValues(omitted), 0)
        truncated = true
        break
      }

      parts.push(child.json)
      bytes += separatorBytes + child.bytes
      dropped += child.dropped
      if (child.truncated) {
        dropped += value.slice(index + 1).reduce((total, omitted) => total + countValues(omitted), 0)
        truncated = true
        break
      }
    }

    return { json: `[${parts.join(',')}]`, bytes, truncated, dropped }
  }

  if (value !== null && typeof value === 'object') {
    if (maxBytes < 2) return null
    const entries = Object.entries(value)
    const parts: string[] = []
    let bytes = 2
    let dropped = 0
    let truncated = false

    for (let index = 0; index < entries.length; index += 1) {
      const [key, childValue] = entries[index]
      const keyJson = JSON.stringify(key)
      const separatorBytes = parts.length === 0 ? 0 : 1
      const prefixBytes = byteLength(keyJson) + 1
      const child = fitValue(childValue, maxBytes - bytes - separatorBytes - prefixBytes)
      if (child === null) {
        dropped += entries.slice(index).reduce((total, [, omitted]) => total + countValues(omitted), 0)
        truncated = true
        break
      }

      parts.push(`${keyJson}:${child.json}`)
      bytes += separatorBytes + prefixBytes + child.bytes
      dropped += child.dropped
      if (child.truncated) {
        dropped += entries.slice(index + 1).reduce((total, [, omitted]) => total + countValues(omitted), 0)
        truncated = true
        break
      }
    }

    return { json: `{${parts.join(',')}}`, bytes, truncated, dropped }
  }

  const json = JSON.stringify(value)
  if (json === undefined) return null
  const bytes = byteLength(json)
  return bytes <= maxBytes ? { json, bytes, truncated: false, dropped: 0 } : null
}

/** Bound JSON-compatible Data with a deterministic, depth-first document-order walk. */
export function boundData(data: unknown, maxBytes: number): BoundResult {
  const serialized = JSON.stringify(data)
  if (serialized === undefined) {
    return { data, truncated: false, bytes: 0, original_bytes: 0, dropped: 0 }
  }

  const serializedLength = byteLength(serialized)
  if (maxBytes === 0 || serializedLength <= maxBytes) {
    return { data, truncated: false, bytes: serializedLength, original_bytes: serializedLength, dropped: 0 }
  }

  // Work from the JSON representation so the rebuilt value follows JSON.stringify
  // semantics for values such as undefined object properties and non-finite numbers.
  const normalized = JSON.parse(serialized) as unknown
  const bounded = fitValue(normalized, maxBytes)
  if (bounded === null) {
    const fallback = null
    return {
      data: fallback,
      truncated: true,
      bytes: byteLength(JSON.stringify(fallback)),
      original_bytes: serializedLength,
      dropped: countValues(normalized),
    }
  }

  return {
    data: JSON.parse(bounded.json) as unknown,
    truncated: true,
    bytes: bounded.bytes,
    original_bytes: serializedLength,
    dropped: bounded.dropped,
  }
}
