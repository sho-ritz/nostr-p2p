/** Protocol version carried inside every encrypted payload. Independent of the npm version. */
export const PROTOCOL_VERSION = 1

/**
 * Ephemeral event kind (20000–29999) used for all nostr-p2p traffic.
 * Placeholder: must be checked against existing NIPs before v0.1.
 */
export const EVENT_KIND = 25050

/** How many relays a room connects to. */
export const RELAYS_PER_ROOM = 5

/**
 * Candidate relays. Must forward ephemeral events; verified by `npm run smoke:public`.
 */
export const DEFAULT_RELAYS: readonly string[] = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://relay.nostr.net',
  'wss://offchain.pub',
  'wss://relay.snort.social',
]

export const DEFAULT_ICE_SERVERS: readonly RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
]

export const DEFAULT_MAX_PEERS = 10
export const DEFAULT_MAX_RELAY_MESSAGE_SIZE = 64 * 1024

export const DEFAULT_HEARTBEAT = {
  directIntervalMs: 5_000,
  directTimeoutMs: 15_000,
  relayIntervalMs: 30_000,
  relayTimeoutMs: 90_000,
} as const

/** How long `direct` mode waits for a data channel before DIRECT_CONNECT_FAILED. */
export const DIRECT_CONNECT_TIMEOUT_MS = 15_000

/** Chunk size for application data (bytes of encoded payload per frame). */
export const CHUNK_SIZE = 16 * 1024
