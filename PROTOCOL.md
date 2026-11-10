# nostr-p2p protocol (version 1)

Status: **v0.1**. The event kind is provisional (not yet checked against the NIP registry).

## Event

All traffic uses one ephemeral event kind so observers cannot tell message types apart.

| Field | Value |
|---|---|
| `kind` | `25050` (ephemeral; provisional) |
| `pubkey` | sender's session public key |
| `tags` | `["d", <roomId>]`, plus `["p", <recipient session pubkey>]` for pairwise messages |
| `content` | encrypted payload (see below) |

`roomId = hex(sha256("nostr-p2p/room/v1" ‖ lp(appId) ‖ lp(roomName) ‖ lp(password)))`,
where `lp(s) = "<utf8 byte length>:" ‖ s`.

## Encryption

- **Room-scoped** (presence, broadcast): NIP-44 v2 with the room key as conversation key:
  `roomKey = sha256(lp("nostr-p2p/room-key/v1") ‖ lp(appId) ‖ lp(roomName) ‖ lp(password))` (different domain separator from `roomId`, so the public ID does not reveal the key).
- **Pairwise** (signaling, direct-to-peer data over relays): NIP-44 v2 between session keys.
- **WebRTC data channel**: DTLS only.

## Payload

Decrypted content is JSON:

```json
{ "v": 1, "t": "<type>", ... }
```

| `t` | Scope | Purpose |
|---|---|---|
| `hello` | room | announce presence: transport mode, protocol version, optional identity proof |
| `hello-ack` | pairwise | reply to `hello` |
| `bye` | room | graceful leave |
| `hb` | room / channel | heartbeat |
| `sdp` | pairwise | WebRTC offer/answer |
| `ice` | pairwise | ICE candidate |
| `data` | room or pairwise | application data: channel name, sequence number, chunk index/count, body |
| `err` | pairwise | refusal: `ROOM_FULL`, `TRANSPORT_MISMATCH`, `PROTOCOL_MISMATCH` |

## Rules

- **Discovery**: on connecting to a relay a peer broadcasts `hello {transport}`; every `relayIntervalMs` it broadcasts `hb {transport}`. A `hello`/`hb` from an unknown peer is answered with pairwise `hello-ack`.
- **Compatibility**: `direct` + `relay` → `err TRANSPORT_MISMATCH`; full room → `err ROOM_FULL`; other `v` → `err PROTOCOL_MISMATCH`.
  Relay fallback is allowed unless either side is `direct`; WebRTC is attempted unless either side is `relay`.
- **Glare**: the peer with the lexicographically lower session pubkey sends the offer (`sdp`), ICE candidates follow as `ice`.
- **Data**: `{t:"data", ch, seq, i, n, body}` — `body` is part `i` of `n` (16 KiB slices) of the JSON-encoded payload;
  `Uint8Array` values are encoded as `{"$b": base64}`. `seq` counts per (sender, recipient, channel) from 1. Frames go over the
  data channel when open, otherwise as pairwise relay events (`auto`/`relay`). Receivers reassemble, then deliver in `seq` order,
  skipping a missing `seq` after 10 s.
- **Liveness**: `hb` over the data channel every `directIntervalMs`; a silent channel is closed after `directTimeoutMs`
  (fallback to relay in `auto`). Peers silent for `relayTimeoutMs` are dropped (`leave`). `bye` leaves immediately.
