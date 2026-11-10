// Two peers in one process, real public relays + public STUN, real WebRTC (node-datachannel).
// Run: npm run smoke:public
import { RTCPeerConnection } from 'node-datachannel/polyfill'
import { DEFAULT_RELAYS, joinRoom } from '../dist/index.js'

const room = `smoke-${Date.now()}`
const opts = { rtc: { RTCPeerConnection } }
const t0 = Date.now()
const ms = () => `${Date.now() - t0} ms`
console.log('relays:', DEFAULT_RELAYS.join(', '))
const a = joinRoom('nostr-p2p-smoke', room, opts)
const b = joinRoom('nostr-p2p-smoke', room, opts)
b.on('message', (d) => console.log(`B received ${JSON.stringify(d)} via ${b.peers[0]?.transport} (${ms()})`))
a.on('join', () => console.log(`A saw B join (${ms()})`))
a.on('transport', (_p, t) => console.log(`A ↔ B transport: ${t} (${ms()})`))
const deadline = Date.now() + 25_000
while (a.peers[0]?.transport !== 'direct' && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100))
await a.send({ hello: a.peers[0]?.transport ?? 'nobody' })
await new Promise((r) => setTimeout(r, 2000))
const ok = a.peers[0]?.transport === 'direct'
await a.leave()
await b.leave()
console.log(ok ? 'OK: direct WebRTC via public relays' : 'NO DIRECT CONNECTION')
process.exit(ok ? 0 : 1)
