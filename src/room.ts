import { CHUNK_SIZE, DEFAULT_HEARTBEAT, DEFAULT_ICE_SERVERS, DEFAULT_MAX_PEERS, DEFAULT_MAX_RELAY_MESSAGE_SIZE, DEFAULT_RELAYS, DIRECT_CONNECT_TIMEOUT_MS, EVENT_KIND, PROTOCOL_VERSION, RELAYS_PER_ROOM } from './defaults.js'
import { byteLength, chunk, decodePayload, encodePayload } from './codec.js'
import { type NostrEvent, SessionKey, decrypt, deriveRoomKey, encrypt, verify } from './crypto.js'
import { RelayPool } from './relay.js'
import { deriveRoomId, selectRelays } from './room-id.js'
import type {
  ActiveTransport,
  Channel,
  MessageHandler,
  P2PErrorCode,
  Payload,
  Peer,
  PeerState,
  Room,
  RoomEvents,
  RoomOptions,
  Transport,
} from './types.js'

export class P2PError extends Error {
  readonly code: P2PErrorCode
  readonly peer: Peer | undefined
  constructor(code: P2PErrorCode, message: string, peer?: Peer) {
    super(message)
    this.name = 'P2PError'
    this.code = code
    this.peer = peer
  }
}

interface Frame {
  t: 'data'
  ch: string
  seq: number
  i: number
  n: number
  body: string
}

type Msg = { v: number; t: string; [k: string]: unknown }

const ORDER_GAP_TIMEOUT_MS = 10_000
let warnedNoRtc = false

class PeerImpl implements Peer {
  state: PeerState = 'connecting'
  transport: ActiveTransport | null = null
  allowRelay = true
  wantDirect = false
  everConnected = false
  pc: RTCPeerConnection | null = null
  dc: RTCDataChannel | null = null
  pendingIce: RTCIceCandidateInit[] = []
  remoteSet = false
  lastSeen = Date.now()
  lastDirect = 0
  lastHbSent = 0
  directTimer: ReturnType<typeof setTimeout> | null = null
  renegotiate: ReturnType<typeof setTimeout> | null = null
  seqOut = new Map<string, number>()
  inbound = new Map<string, { next: number; done: Map<number, string>; parts: Map<number, { n: number; got: Map<number, string> }>; gapTimer: ReturnType<typeof setTimeout> | null }>()
  queue: Array<() => void> = []
  constructor(readonly id: string) {}
}

export class RoomImpl implements Room {
  readonly selfId: string
  readonly roomId: string
  readonly #key = new SessionKey()
  readonly #roomKey: Uint8Array
  readonly #pool: RelayPool
  readonly #mode: Transport
  readonly #rtc: typeof RTCPeerConnection | null
  readonly #ice: RTCIceServer[]
  readonly #maxPeers: number
  readonly #maxRelay: number
  readonly #hb: Required<NonNullable<RoomOptions['heartbeat']>>
  readonly #peers = new Map<string, PeerImpl>()
  readonly #listeners = new Map<string, Set<(...a: never[]) => void>>()
  readonly #channelHandlers = new Map<string, Set<MessageHandler>>()
  readonly #timers: Array<ReturnType<typeof setInterval>> = []
  #closed = false

  constructor(appId: string, roomName: string, opts: RoomOptions = {}) {
    this.selfId = this.#key.pubkey
    this.roomId = deriveRoomId(appId, roomName, opts.password)
    this.#roomKey = deriveRoomKey(appId, roomName, opts.password)
    const requested = opts.transport ?? 'auto'
    this.#rtc = opts.rtc?.RTCPeerConnection ?? (globalThis as { RTCPeerConnection?: typeof RTCPeerConnection }).RTCPeerConnection ?? null
    if (!this.#rtc && requested === 'direct') throw new P2PError('RTC_UNAVAILABLE', 'nostr-p2p: WebRTC is not available; pass options.rtc or use transport "relay"')
    if (!this.#rtc && requested === 'auto' && !warnedNoRtc) {
      warnedNoRtc = true
      console.warn('nostr-p2p: WebRTC is not available, falling back to relay transport')
    }
    this.#mode = this.#rtc ? requested : 'relay'
    this.#ice = opts.iceServers ?? [...DEFAULT_ICE_SERVERS]
    this.#maxPeers = opts.maxPeers ?? DEFAULT_MAX_PEERS
    this.#maxRelay = opts.relayLimits?.maxMessageSize ?? DEFAULT_MAX_RELAY_MESSAGE_SIZE
    this.#hb = { ...DEFAULT_HEARTBEAT, ...opts.heartbeat }
    const relays = opts.relays ?? selectRelays(this.roomId, DEFAULT_RELAYS, RELAYS_PER_ROOM)
    this.#pool = new RelayPool(relays, opts.WebSocket)
    this.#pool.subscribe({ kinds: [EVENT_KIND], '#d': [this.roomId] }, (e) => this.#onEvent(e), () => this.#broadcast({ t: 'hello', transport: this.#mode }))
    this.#timers.push(setInterval(() => this.#broadcast({ t: 'hb', transport: this.#mode }), this.#hb.relayIntervalMs))
    this.#timers.push(setInterval(() => this.#tick(), 1000))
    for (const t of this.#timers) (t as { unref?: () => void }).unref?.()
  }

  get peers(): readonly Peer[] {
    return [...this.#peers.values()]
  }

  // ---- events ------------------------------------------------------------------------

  on<E extends keyof RoomEvents>(event: E, handler: RoomEvents[E]): () => void {
    if (event === 'message') return this.channel('').on(handler as MessageHandler)
    let set = this.#listeners.get(event)
    if (!set) this.#listeners.set(event, (set = new Set()))
    set.add(handler as never)
    return () => set.delete(handler as never)
  }

  #emit<E extends keyof RoomEvents>(event: E, ...args: Parameters<RoomEvents[E]>): void {
    for (const fn of this.#listeners.get(event) ?? []) {
      try {
        ;(fn as (...a: unknown[]) => void)(...args)
      } catch (e) {
        console.error(e)
      }
    }
  }

  #error(code: P2PErrorCode, message: string, peer?: Peer): void {
    this.#emit('error', new P2PError(code, message, peer))
  }

  // ---- channels ----------------------------------------------------------------------

  channel(name: string): Channel {
    return {
      name,
      send: (data, to) => this.#send(name, data, to),
      on: (handler) => {
        let set = this.#channelHandlers.get(name)
        if (!set) this.#channelHandlers.set(name, (set = new Set()))
        set.add(handler)
        return () => set.delete(handler)
      },
    }
  }

  send(data: Payload, to?: Peer | Peer[]): Promise<void> {
    return this.#send('', data, to)
  }

  async #send(ch: string, data: Payload, to?: Peer | Peer[]): Promise<void> {
    if (this.#closed) throw new Error('nostr-p2p: room is closed')
    const body = encodePayload(data)
    const targets = (to ? (Array.isArray(to) ? to : [to]) : [...this.#peers.values()])
      .map((p) => this.#peers.get(p.id))
      .filter((p): p is PeerImpl => p !== undefined)
    for (const p of targets) {
      const viaRelay = !(p.dc && p.dc.readyState === 'open') && p.allowRelay
      if (viaRelay && byteLength(body) > this.#maxRelay) {
        throw new P2PError('MESSAGE_TOO_LARGE', `nostr-p2p: message is ${byteLength(body)} bytes; relay limit is ${this.#maxRelay}`, p)
      }
    }
    for (const p of targets) {
      const seq = (p.seqOut.get(ch) ?? 0) + 1
      p.seqOut.set(ch, seq)
      const parts = chunk(body, CHUNK_SIZE)
      const frames: Frame[] = parts.map((part, i) => ({ t: 'data', ch, seq, i, n: parts.length, body: part }))
      const deliver = () => {
        for (const f of frames) this.#sendFrame(p, f)
      }
      if (p.state === 'connected') deliver()
      else p.queue.push(deliver)
    }
  }

  #sendFrame(p: PeerImpl, f: Frame | Msg): void {
    if (p.dc && p.dc.readyState === 'open') {
      try {
        p.dc.send(JSON.stringify(f))
        return
      } catch {
        /* fall through to relay */
      }
    }
    if (p.allowRelay) this.#pairwise(p.id, { ...(f as object), v: PROTOCOL_VERSION } as Msg)
  }

  // ---- relay messages ------------------------------------------------------------------

  #broadcast(body: Omit<Msg, 'v'>): void {
    if (this.#closed && body.t !== 'bye') return
    const content = encrypt(JSON.stringify({ v: PROTOCOL_VERSION, ...body }), this.#roomKey)
    this.#pool.publish(this.#key.sign({ kind: EVENT_KIND, tags: [['d', this.roomId]], content }))
  }

  #pairwise(to: string, body: Msg): void {
    const content = encrypt(JSON.stringify({ ...body, v: body.v || PROTOCOL_VERSION }), this.#key.pairKey(to))
    this.#pool.publish(this.#key.sign({ kind: EVENT_KIND, tags: [['d', this.roomId], ['p', to]], content }))
  }

  #onEvent(e: NostrEvent): void {
    if (this.#closed || e.kind !== EVENT_KIND || e.pubkey === this.selfId) return
    const p = e.tags.find((t) => t[0] === 'p')?.[1]
    if (p && p !== this.selfId) return
    if (!verify(e)) return
    let msg: Msg
    try {
      msg = JSON.parse(decrypt(e.content, p ? this.#key.pairKey(e.pubkey) : this.#roomKey)) as Msg
    } catch {
      return
    }
    if (typeof msg !== 'object' || msg === null || typeof msg.t !== 'string') return
    this.#onMessage(e.pubkey, msg, p ? 'pairwise' : 'room')
  }

  #onMessage(from: string, msg: Msg, scope: 'room' | 'pairwise' | 'direct'): void {
    if (msg.t === 'hello' || msg.t === 'hb' || msg.t === 'hello-ack') {
      if (msg.v !== PROTOCOL_VERSION) {
        if (!this.#peers.has(from)) {
          this.#pairwise(from, { v: PROTOCOL_VERSION, t: 'err', code: 'PROTOCOL_MISMATCH' })
          this.#error('PROTOCOL_MISMATCH', `nostr-p2p: peer ${from.slice(0, 8)} speaks protocol ${String(msg.v)}`)
        }
        return
      }
      const known = this.#peers.get(from)
      if (known) {
        known.lastSeen = Date.now()
        return
      }
      this.#meet(from, String(msg.transport ?? 'auto') as Transport, msg.t !== 'hello-ack')
      return
    }
    const peer = this.#peers.get(from)
    if (msg.t === 'err') {
      const code = String(msg.code) as P2PErrorCode
      this.#error(code, `nostr-p2p: peer ${from.slice(0, 8)} refused: ${code}`, peer)
      if (peer) this.#drop(peer, false)
      return
    }
    if (!peer) return
    peer.lastSeen = Date.now()
    if (scope === 'direct') peer.lastDirect = Date.now()
    switch (msg.t) {
      case 'bye':
        this.#drop(peer, true)
        break
      case 'sdp':
        void this.#onSdp(peer, msg.sdp as RTCSessionDescriptionInit)
        break
      case 'ice':
        void this.#onIce(peer, msg.candidate as RTCIceCandidateInit)
        break
      case 'data':
        this.#onFrame(peer, msg as unknown as Frame)
        break
    }
  }

  /** First contact with a peer: check compatibility and decide the path. */
  #meet(id: string, theirs: Transport, replyAck: boolean): void {
    if (this.#peers.size + 1 >= this.#maxPeers) {
      this.#pairwise(id, { v: PROTOCOL_VERSION, t: 'err', code: 'ROOM_FULL' })
      return
    }
    const mine = this.#mode
    if ((mine === 'direct' && theirs === 'relay') || (mine === 'relay' && theirs === 'direct')) {
      this.#pairwise(id, { v: PROTOCOL_VERSION, t: 'err', code: 'TRANSPORT_MISMATCH' })
      this.#error('TRANSPORT_MISMATCH', `nostr-p2p: peer ${id.slice(0, 8)} uses "${theirs}", this room uses "${mine}"`)
      return
    }
    const peer = new PeerImpl(id)
    peer.allowRelay = mine !== 'direct' && theirs !== 'direct'
    peer.wantDirect = mine !== 'relay' && theirs !== 'relay' && this.#rtc !== null
    this.#peers.set(id, peer)
    if (replyAck) this.#pairwise(id, { v: PROTOCOL_VERSION, t: 'hello-ack', transport: mine })
    if (peer.allowRelay) this.#connected(peer, 'relay')
    if (peer.wantDirect) {
      if (!peer.allowRelay) {
        peer.directTimer = setTimeout(() => {
          if (peer.transport !== 'direct' && this.#peers.get(id) === peer) {
            this.#error('DIRECT_CONNECT_FAILED', `nostr-p2p: could not open a direct connection to ${id.slice(0, 8)}`, peer)
          }
        }, DIRECT_CONNECT_TIMEOUT_MS)
      }
      // Glare avoidance: the lower session pubkey makes the offer.
      if (this.selfId < id) void this.#offer(peer)
    }
  }

  #connected(peer: PeerImpl, transport: ActiveTransport): void {
    const changed = peer.transport !== transport
    peer.state = 'connected'
    peer.transport = transport
    if (!peer.everConnected) {
      peer.everConnected = true
      this.#emit('join', peer)
    }
    if (changed) this.#emit('transport', peer, transport)
    for (const fn of peer.queue.splice(0)) fn()
  }

  #drop(peer: PeerImpl, emit: boolean): void {
    if (this.#peers.get(peer.id) !== peer) return
    this.#peers.delete(peer.id)
    peer.state = 'closed'
    if (peer.directTimer) clearTimeout(peer.directTimer)
    if (peer.renegotiate) clearTimeout(peer.renegotiate)
    for (const s of peer.inbound.values()) if (s.gapTimer) clearTimeout(s.gapTimer)
    try {
      peer.dc?.close()
      peer.pc?.close()
    } catch {
      /* ignore */
    }
    if (emit && peer.everConnected) this.#emit('leave', peer)
  }

  // ---- WebRTC --------------------------------------------------------------------------

  #newPc(peer: PeerImpl): RTCPeerConnection {
    try {
      peer.pc?.close()
    } catch {
      /* ignore */
    }
    const pc = new this.#rtc!({ iceServers: this.#ice })
    peer.pc = pc
    peer.remoteSet = false
    peer.pendingIce = []
    pc.onicecandidate = (e) => {
      if (!e.candidate) return
      const c = e.candidate as RTCIceCandidate & { toJSON?: () => RTCIceCandidateInit }
      const init = c.toJSON ? c.toJSON() : { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex }
      this.#pairwise(peer.id, { v: PROTOCOL_VERSION, t: 'ice', candidate: init })
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.#directLost(peer, pc)
    }
    pc.ondatachannel = (e) => this.#setupDc(peer, e.channel)
    return pc
  }

  async #offer(peer: PeerImpl): Promise<void> {
    if (this.#closed || this.#peers.get(peer.id) !== peer) return
    try {
      const pc = this.#newPc(peer)
      this.#setupDc(peer, pc.createDataChannel('nostr-p2p', { ordered: true }))
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      this.#pairwise(peer.id, { v: PROTOCOL_VERSION, t: 'sdp', sdp: { type: offer.type, sdp: offer.sdp } })
    } catch {
      this.#scheduleRenegotiation(peer)
    }
  }

  async #onSdp(peer: PeerImpl, sdp: RTCSessionDescriptionInit): Promise<void> {
    if (!peer.wantDirect || !sdp || (sdp.type !== 'offer' && sdp.type !== 'answer')) return
    try {
      if (sdp.type === 'offer') {
        const pc = this.#newPc(peer)
        await pc.setRemoteDescription(sdp)
        peer.remoteSet = true
        for (const c of peer.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {})
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        this.#pairwise(peer.id, { v: PROTOCOL_VERSION, t: 'sdp', sdp: { type: answer.type, sdp: answer.sdp } })
      } else if (peer.pc) {
        await peer.pc.setRemoteDescription(sdp)
        peer.remoteSet = true
        for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {})
      }
    } catch {
      this.#scheduleRenegotiation(peer)
    }
  }

  async #onIce(peer: PeerImpl, c: RTCIceCandidateInit): Promise<void> {
    if (!c || !peer.wantDirect) return
    if (peer.pc && peer.remoteSet) await peer.pc.addIceCandidate(c).catch(() => {})
    else peer.pendingIce.push(c)
  }

  #setupDc(peer: PeerImpl, dc: RTCDataChannel): void {
    peer.dc = dc
    dc.onopen = () => {
      peer.lastDirect = Date.now()
      if (peer.directTimer) clearTimeout(peer.directTimer)
      this.#connected(peer, 'direct')
    }
    dc.onmessage = (m) => {
      if (typeof m.data !== 'string') return
      try {
        this.#onMessage(peer.id, JSON.parse(m.data) as Msg, 'direct')
      } catch {
        /* ignore malformed frame */
      }
    }
    dc.onclose = () => this.#directLost(peer, peer.pc)
  }

  #directLost(peer: PeerImpl, pc: RTCPeerConnection | null): void {
    if (pc && peer.pc !== pc) return // an older connection
    if (this.#peers.get(peer.id) !== peer) return
    const wasDirect = peer.transport === 'direct'
    peer.dc = null
    if (peer.allowRelay) {
      if (wasDirect) this.#connected(peer, 'relay')
    } else if (wasDirect) {
      peer.state = 'reconnecting'
    }
    this.#scheduleRenegotiation(peer)
  }

  #scheduleRenegotiation(peer: PeerImpl): void {
    if (this.#closed || !peer.wantDirect || peer.renegotiate || this.selfId > peer.id) return
    peer.renegotiate = setTimeout(() => {
      peer.renegotiate = null
      if (this.#peers.get(peer.id) === peer && peer.transport !== 'direct') void this.#offer(peer)
    }, 3000)
  }

  // ---- data frames ----------------------------------------------------------------------

  #onFrame(peer: PeerImpl, f: Frame): void {
    if (typeof f.ch !== 'string' || !Number.isSafeInteger(f.seq) || !Number.isSafeInteger(f.i) || !Number.isSafeInteger(f.n) || typeof f.body !== 'string') return
    if (f.n < 1 || f.n > 100_000 || f.i < 0 || f.i >= f.n) return
    let st = peer.inbound.get(f.ch)
    if (!st) peer.inbound.set(f.ch, (st = { next: 1, done: new Map(), parts: new Map(), gapTimer: null }))
    if (f.seq < st.next || st.done.has(f.seq)) return
    let parts = st.parts.get(f.seq)
    if (!parts) st.parts.set(f.seq, (parts = { n: f.n, got: new Map() }))
    parts.got.set(f.i, f.body)
    if (parts.got.size < parts.n) return
    st.parts.delete(f.seq)
    st.done.set(f.seq, [...Array(parts.n).keys()].map((i) => parts.got.get(i)!).join(''))
    this.#flush(peer, f.ch)
  }

  /** Deliver in order; if a message never arrives (lost on a path switch), skip it after a while. */
  #flush(peer: PeerImpl, ch: string): void {
    const st = peer.inbound.get(ch)!
    while (st.done.has(st.next)) {
      const body = st.done.get(st.next)!
      st.done.delete(st.next)
      st.next++
      let data: Payload
      try {
        data = decodePayload(body)
      } catch {
        continue
      }
      for (const h of this.#channelHandlers.get(ch) ?? []) {
        try {
          h(data, peer)
        } catch (e) {
          console.error(e)
        }
      }
    }
    if (st.gapTimer) clearTimeout(st.gapTimer)
    st.gapTimer = null
    if (st.done.size > 0) {
      st.gapTimer = setTimeout(() => {
        st.gapTimer = null
        st.next = Math.min(...st.done.keys())
        this.#flush(peer, ch)
      }, ORDER_GAP_TIMEOUT_MS)
    }
  }

  // ---- heartbeats --------------------------------------------------------------------------

  #tick(): void {
    const now = Date.now()
    for (const p of [...this.#peers.values()]) {
      if (p.dc && p.dc.readyState === 'open') {
        if (now - p.lastDirect > this.#hb.directTimeoutMs) {
          try {
            p.dc.close()
          } catch {
            /* ignore */
          }
          this.#directLost(p, p.pc)
          continue
        }
        if (now - p.lastHbSent >= this.#hb.directIntervalMs) {
          p.lastHbSent = now
          try {
            p.dc.send(JSON.stringify({ v: PROTOCOL_VERSION, t: 'hb' }))
          } catch {
            /* ignore */
          }
        }
      }
      const timeout = p.transport === 'direct' ? this.#hb.directTimeoutMs * 2 : this.#hb.relayTimeoutMs
      if (now - p.lastSeen > Math.max(timeout, this.#hb.relayTimeoutMs)) this.#drop(p, true)
    }
  }

  async leave(): Promise<void> {
    if (this.#closed) return
    this.#broadcast({ t: 'bye' })
    for (const p of [...this.#peers.values()]) {
      try {
        if (p.dc?.readyState === 'open') p.dc.send(JSON.stringify({ v: PROTOCOL_VERSION, t: 'bye' }))
      } catch {
        /* ignore */
      }
    }
    this.#closed = true
    await new Promise((r) => setTimeout(r, 50))
    for (const t of this.#timers) clearInterval(t)
    for (const p of [...this.#peers.values()]) this.#drop(p, false)
    this.#pool.close()
  }
}
