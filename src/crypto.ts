import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import * as nip44 from 'nostr-tools/nip44'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'

export interface NostrEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

const lp = (parts: string[]) => parts.map((p) => `${utf8ToBytes(p).length}:${p}`).join('')

/**
 * Room-shared symmetric key (NIP-44 conversation key for room-scoped messages). Uses a different
 * domain separator than the public room ID, so knowing the ID does not reveal the key.
 */
export function deriveRoomKey(appId: string, roomName: string, password = ''): Uint8Array {
  return sha256(utf8ToBytes(lp(['nostr-p2p/room-key/v1', appId, roomName, password])))
}

export class SessionKey {
  readonly secret = generateSecretKey()
  readonly pubkey = getPublicKey(this.secret)
  readonly #pair = new Map<string, Uint8Array>()

  pairKey(peer: string): Uint8Array {
    let k = this.#pair.get(peer)
    if (!k) this.#pair.set(peer, (k = nip44.getConversationKey(this.secret, peer)))
    return k
  }

  sign(t: { kind: number; tags: string[][]; content: string }): NostrEvent {
    return finalizeEvent({ ...t, created_at: Math.floor(Date.now() / 1000) }, this.secret) as NostrEvent
  }
}

export const encrypt = (plain: string, key: Uint8Array) => nip44.encrypt(plain, key)
export const decrypt = (payload: string, key: Uint8Array) => nip44.decrypt(payload, key)

export function verify(e: NostrEvent): boolean {
  try {
    const { id, pubkey, created_at, kind, tags, content, sig } = e
    return verifyEvent({ id, pubkey, created_at, kind, tags, content, sig })
  } catch {
    return false
  }
}

export const hex = bytesToHex
