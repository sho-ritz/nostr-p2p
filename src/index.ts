import type { Room, RoomOptions } from './types.js'

export type * from './types.js'
export { PROTOCOL_VERSION, DEFAULT_RELAYS, DEFAULT_ICE_SERVERS } from './defaults.js'
export { deriveRoomId, selectRelays } from './room-id.js'

/**
 * Join a room. Everyone who uses the same `appId`, `roomName` and `password`
 * ends up in the same room.
 *
 * Not implemented yet (v0.1 in progress).
 */
export function joinRoom(appId: string, roomName: string, options: RoomOptions = {}): Room {
  void appId
  void roomName
  void options
  throw new Error('nostr-p2p: joinRoom is not implemented yet')
}
