# nostr-p2p protocol (draft, version 1)

Status: **draft**. Wire details may change until v0.1 is released.

## Event

All traffic uses one ephemeral event kind so observers cannot tell message types apart.

| Field | Value |
|---|---|
| `kind` | `25050` (placeholder, to be checked against existing NIPs) |
| `pubkey` | sender's session public key |
| `tags` | `["d", <roomId>]`, plus `["p", <recipient session pubkey>]` for pairwise messages |
| `content` | encrypted payload (see below) |

`roomId = hex(sha256("nostr-p2p/room/v1" ‖ lp(appId) ‖ lp(roomName) ‖ lp(password)))`,
where `lp(s) = "<utf8 byte length>:" ‖ s`.

## Encryption

- **Room-scoped** (presence, broadcast): encrypted with a room key derived from appId, roomName and password. KDF: TBD.
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

## Open questions

- Final event kind
- Room key KDF and binary payload encoding over relays
- Glare resolution (who sends the offer): proposed lower session pubkey offers
