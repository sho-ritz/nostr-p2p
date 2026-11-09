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
 * Candidate relays. Must accept ephemeral events; verified by the scheduled relay check.
 * Placeholder list: to be validated before v0.1.
 */
export const DEFAULT_RELAYS: readonly string[] = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://relay.snort.social',
  'wss://offchain.pub',
  'wss://nostr.wine',
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
