import { describe, expect, it } from 'vitest'
import { deriveRoomId, selectRelays } from '../src/room-id.js'

describe('deriveRoomId', () => {
  it('is deterministic', () => {
    expect(deriveRoomId('app', 'room')).toBe(deriveRoomId('app', 'room'))
  })

  it('changes with the password', () => {
    expect(deriveRoomId('app', 'room', 'pw')).not.toBe(deriveRoomId('app', 'room'))
  })

  it('does not collide when field boundaries shift', () => {
    expect(deriveRoomId('ab', 'c')).not.toBe(deriveRoomId('a', 'bc'))
  })

  it('returns 64 hex chars', () => {
    expect(deriveRoomId('app', 'room')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('selectRelays', () => {
  const relays = ['wss://a', 'wss://b', 'wss://c', 'wss://d', 'wss://e', 'wss://f']

  it('picks the same relays regardless of candidate order', () => {
    const id = deriveRoomId('app', 'room')
    expect(selectRelays(id, relays, 3)).toEqual(selectRelays(id, [...relays].reverse(), 3))
  })

  it('returns the requested count without duplicates', () => {
    const picked = selectRelays('x', [...relays, 'wss://a'], 4)
    expect(picked).toHaveLength(4)
    expect(new Set(picked).size).toBe(4)
  })

  it('spreads different rooms across relays', () => {
    const firsts = new Set(
      Array.from({ length: 50 }, (_, i) => selectRelays(deriveRoomId('app', `room-${i}`), relays, 1)[0]),
    )
    expect(firsts.size).toBeGreaterThan(1)
  })
})
