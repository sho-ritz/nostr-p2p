/**
 * Public types for nostr-p2p. See docs/design.md for the reasoning behind each option.
 */

/** Which path carries application data. Signaling always goes through relays. */
export type Transport = 'auto' | 'direct' | 'relay'

/** The path a connected peer is currently using. */
export type ActiveTransport = 'direct' | 'relay'

export type PeerState = 'connecting' | 'connected' | 'reconnecting' | 'closed'

/** Data accepted by `send`: JSON-serializable values or raw bytes. */
export type Payload = Uint8Array | string | number | boolean | null | Payload[] | { [key: string]: Payload }

/** WebRTC implementation to inject outside the browser (e.g. node-datachannel/polyfill). */
export interface RtcImplementation {
  RTCPeerConnection: typeof RTCPeerConnection
}

export interface RelayLimits {
  /** Max size of one message sent over relays, in bytes. Default 64 KiB. */
  maxMessageSize?: number
}

export interface HeartbeatOptions {
  /** Interval/timeout over a direct WebRTC channel (ms). Default 5000 / 15000. */
  directIntervalMs?: number
  directTimeoutMs?: number
  /** Interval/timeout over relays (ms). Default 30000 / 90000. */
  relayIntervalMs?: number
  relayTimeoutMs?: number
}

export interface RoomOptions {
  /** Data path. Default `'auto'`. */
  transport?: Transport
  /** Optional room password. Mixed into the room ID and the room-shared key. */
  password?: string
  /** Override the default relay list. */
  relays?: string[]
  /** STUN/TURN servers. Defaults to public STUN only; TURN must be supplied by you. */
  iceServers?: RTCIceServer[]
  /** WebRTC implementation for non-browser runtimes. */
  rtc?: RtcImplementation
  /** Maximum number of peers in the room, including yourself. Default 10. */
  maxPeers?: number
  relayLimits?: RelayLimits
  heartbeat?: HeartbeatOptions
  /** WebSocket implementation (defaults to globalThis.WebSocket; Node 22+ has one). */
  WebSocket?: new (url: string) => WebSocket
}

export type MessageHandler = (data: Payload, peer: Peer) => void

export interface Channel {
  readonly name: string
  /** Send to every peer, or only to `to` when given. */
  send(data: Payload, to?: Peer | Peer[]): Promise<void>
  on(handler: MessageHandler): () => void
}

export interface Peer {
  /** Session public key (hex). Stable across reconnects within a session. */
  readonly id: string
  readonly state: PeerState
  readonly transport: ActiveTransport | null
}

export type P2PErrorCode =
  | 'ROOM_FULL'
  | 'TRANSPORT_MISMATCH'
  | 'PROTOCOL_MISMATCH'
  | 'DIRECT_CONNECT_FAILED'
  | 'RTC_UNAVAILABLE'
  | 'MESSAGE_TOO_LARGE'
  | 'RELAY_ERROR'

export interface P2PError extends Error {
  code: P2PErrorCode
  peer: Peer | undefined
}

export interface RoomEvents {
  join: (peer: Peer) => void
  leave: (peer: Peer) => void
  message: MessageHandler
  transport: (peer: Peer, transport: ActiveTransport) => void
  error: (error: P2PError) => void
}

export interface Room {
  readonly peers: readonly Peer[]
  /** Your own session public key (hex). */
  readonly selfId: string
  channel(name: string): Channel
  /** Shorthand for the default channel. */
  send(data: Payload, to?: Peer | Peer[]): Promise<void>
  on<E extends keyof RoomEvents>(event: E, handler: RoomEvents[E]): () => void
  leave(): Promise<void>
}
