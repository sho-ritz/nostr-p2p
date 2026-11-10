import { RTCPeerConnection } from 'node-datachannel/polyfill'
import { afterEach, describe, expect, it } from 'vitest'
import { type Payload, type Room, type RoomOptions, joinRoom } from '../src/index.js'
import { MockRelay, until } from './helpers/relay.js'

const rtc = { RTCPeerConnection: RTCPeerConnection as unknown as typeof globalThis.RTCPeerConnection }
const cleanup: Array<() => unknown> = []
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f()
})

async function relay() {
  const r = await new MockRelay().start()
  cleanup.push(() => r.stop())
  return r
}
function join(r: MockRelay, opts: RoomOptions = {}, room = 'room-1'): Room {
  const x = joinRoom('test-app', room, { relays: [r.url], rtc, iceServers: [], ...opts })
  cleanup.push(() => x.leave())
  return x
}
const inbox = (room: Room, ch = '') => {
  const got: Payload[] = []
  room.channel(ch).on((d) => got.push(d))
  return got
}

describe('nostr-p2p rooms', () => {
  it('connects two peers directly over WebRTC and exchanges JSON and bytes', async () => {
    const r = await relay()
    const a = join(r)
    const b = join(r)
    const transports: string[] = []
    a.on('transport', (_p, t) => transports.push(t))
    await until(() => a.peers[0]?.transport === 'direct' && b.peers[0]?.transport === 'direct', 15000, 'direct')
    expect(transports).toEqual(['relay', 'direct']) // usable via relay at once, upgraded when WebRTC opens
    const got = inbox(b)
    await a.send({ hello: 'world', n: [1, 2] })
    await a.send(new Uint8Array([1, 2, 255]))
    await until(() => got.length === 2)
    expect(got[0]).toEqual({ hello: 'world', n: [1, 2] })
    expect(got[1]).toEqual(new Uint8Array([1, 2, 255]))
  })

  it('chunks large messages and preserves order per channel', async () => {
    const r = await relay()
    const a = join(r)
    const b = join(r)
    await until(() => a.peers[0]?.transport === 'direct' && b.peers[0]?.transport === 'direct', 15000)
    const big = new Uint8Array(300_000).map((_, i) => i % 256)
    const got = inbox(b, 'files')
    const seq = inbox(b, 'seq')
    await a.channel('files').send(big)
    for (let i = 0; i < 50; i++) await a.channel('seq').send(i)
    await until(() => got.length === 1 && seq.length === 50, 10000)
    expect(got[0]).toEqual(big)
    expect(seq).toEqual([...Array(50).keys()])
  })

  it('relay transport: encrypted messages through relays only; enforces the size limit', async () => {
    const r = await relay()
    const a = join(r, { transport: 'relay' })
    const b = join(r, { transport: 'relay' })
    await until(() => a.peers.length === 1 && b.peers.length === 1)
    expect(a.peers[0]!.transport).toBe('relay')
    const got = inbox(b)
    await a.send({ secret: 'plaintext-marker' })
    await until(() => got.length === 1)
    expect(JSON.stringify(r.seen)).not.toContain('plaintext-marker')
    await expect(a.send('x'.repeat(70_000))).rejects.toMatchObject({ code: 'MESSAGE_TOO_LARGE' })
  })

  it('falls back to relay when the direct channel drops (auto) and keeps delivering', async () => {
    const r = await relay()
    const a = join(r)
    const b = join(r)
    await until(() => a.peers[0]?.transport === 'direct' && b.peers[0]?.transport === 'direct', 15000)
    const got = inbox(b)
    // kill A's WebRTC connection
    ;(a as unknown as { peers: Array<{ pc: RTCPeerConnection }> }).peers[0]!.pc.close()
    await until(() => a.peers[0]?.transport === 'relay', 5000, 'fallback')
    await a.send('still here')
    await until(() => got.includes('still here'), 5000)
  })

  it('reports mismatched transports and full rooms; rooms are isolated by name/password', async () => {
    const r = await relay()
    const errors: string[] = []
    const a = join(r, { transport: 'direct' })
    a.on('error', (e) => errors.push(e.code))
    join(r, { transport: 'relay' })
    await until(() => errors.includes('TRANSPORT_MISMATCH'))

    const full: string[] = []
    const x = join(r, { maxPeers: 2 }, 'small')
    join(r, { maxPeers: 2 }, 'small')
    const z = join(r, { maxPeers: 2 }, 'small')
    z.on('error', (e) => full.push(e.code))
    await until(() => full.includes('ROOM_FULL'))
    expect(x.peers).toHaveLength(1)

    const p1 = join(r, { password: 'one' }, 'secret')
    join(r, { password: 'two' }, 'secret')
    await new Promise((res) => setTimeout(res, 500))
    expect(p1.peers).toHaveLength(0)
  })

  it('emits join and leave', async () => {
    const r = await relay()
    const a = join(r, { transport: 'relay' })
    const events: string[] = []
    a.on('join', () => events.push('join'))
    a.on('leave', () => events.push('leave'))
    const b = joinRoom('test-app', 'room-1', { relays: [r.url], transport: 'relay' })
    await until(() => events.includes('join'))
    await b.leave()
    await until(() => events.includes('leave'))
  })

  it('requires WebRTC for transport "direct"', () => {
    expect(() => joinRoom('a', 'b', { transport: 'direct', relays: [] })).toThrow(/WebRTC is not available/)
  })
})
