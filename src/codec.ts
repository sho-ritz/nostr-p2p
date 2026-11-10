import type { Payload } from './types.js'

/** Payload ↔ string. Uint8Array is encoded as {"$b": base64} so binary survives JSON. */
export function encodePayload(data: Payload): string {
  return JSON.stringify(data, (_k, v: unknown) => (v instanceof Uint8Array ? { $b: toBase64(v) } : v))
}

export function decodePayload(s: string): Payload {
  return JSON.parse(s, (_k, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>
      if (Object.keys(o).length === 1 && typeof o.$b === 'string') return fromBase64(o.$b)
    }
    return v
  }) as Payload
}

export function toBase64(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function chunk(s: string, size: number): string[] {
  if (s.length <= size) return [s]
  const out: string[] = []
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size))
  return out
}

export const byteLength = (s: string) => new TextEncoder().encode(s).length
