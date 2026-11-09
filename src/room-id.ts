import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

/**
 * Hashed room identifier placed in the event tag. Relays and observers never see the
 * plain app ID, room name or password. Fields are length-prefixed so that
 * ("ab", "c") and ("a", "bc") cannot collide.
 */
export function deriveRoomId(appId: string, roomName: string, password = ''): string {
  const parts = ['nostr-p2p/room/v1', appId, roomName, password]
  const encoded = parts.map((p) => `${utf8ToBytes(p).length}:${p}`).join('')
  return bytesToHex(sha256(utf8ToBytes(encoded)))
}

/**
 * Pick `count` relays deterministically from `candidates`, ordered by sha256(roomId + relay).
 * Every member of the same room picks the same relays, while different rooms spread
 * across the list instead of piling onto one relay.
 */
export function selectRelays(roomId: string, candidates: readonly string[], count: number): string[] {
  const unique = [...new Set(candidates)]
  return unique
    .map((relay) => ({ relay, score: bytesToHex(sha256(utf8ToBytes(`${roomId}|${relay}`))) }))
    .sort((a, b) => (a.score < b.score ? -1 : a.score > b.score ? 1 : 0))
    .slice(0, count)
    .map((r) => r.relay)
}
