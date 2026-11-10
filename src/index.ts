import { RoomImpl } from './room.js'
import type { Room, RoomOptions } from './types.js'

export type * from './types.js'
export { PROTOCOL_VERSION, EVENT_KIND, DEFAULT_RELAYS, DEFAULT_ICE_SERVERS } from './defaults.js'
export { deriveRoomId, selectRelays } from './room-id.js'
export { P2PError } from './room.js'

/**
 * Join a room. Everyone who uses the same `appId`, `roomName` and `password` ends up in the same
 * room. Signaling goes through Nostr relays; data goes over WebRTC when possible and falls back to
 * (encrypted, ephemeral) relay messages in `auto` mode.
 */
export function joinRoom(appId: string, roomName: string, options: RoomOptions = {}): Room & { readonly roomId: string } {
  return new RoomImpl(appId, roomName, options)
}
