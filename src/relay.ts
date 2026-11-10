import type { NostrEvent } from './crypto.js'

type WS = new (url: string) => WebSocket

/** Minimal relay pool for ephemeral traffic: persistent connections, resubscribe on reconnect. */
export class RelayPool {
  readonly #urls: string[]
  readonly #ws: WS
  readonly #conns = new Map<string, { ws: WebSocket | null; open: boolean; attempt: number; timer: ReturnType<typeof setTimeout> | null }>()
  #filter: Record<string, unknown> | null = null
  #onEvent: ((e: NostrEvent) => void) | null = null
  #onOpen: (() => void) | null = null
  #closed = false
  readonly subId = `np${Math.random().toString(36).slice(2, 10)}`

  constructor(urls: readonly string[], WebSocketImpl?: WS) {
    this.#urls = [...new Set(urls)]
    const impl = WebSocketImpl ?? (globalThis.WebSocket as WS | undefined)
    if (!impl) throw new Error('nostr-p2p: no WebSocket implementation available')
    this.#ws = impl
  }

  get connected(): number {
    return [...this.#conns.values()].filter((c) => c.open).length
  }

  subscribe(filter: Record<string, unknown>, onEvent: (e: NostrEvent) => void, onOpen?: () => void): void {
    this.#filter = filter
    this.#onEvent = onEvent
    this.#onOpen = onOpen ?? null
    for (const url of this.#urls) this.#connect(url)
  }

  publish(e: NostrEvent): number {
    let sent = 0
    for (const c of this.#conns.values()) {
      if (!c.open || !c.ws) continue
      try {
        c.ws.send(JSON.stringify(['EVENT', e]))
        sent++
      } catch {
        /* ignore */
      }
    }
    return sent
  }

  #connect(url: string): void {
    if (this.#closed) return
    const st = this.#conns.get(url) ?? { ws: null, open: false, attempt: 0, timer: null }
    this.#conns.set(url, st)
    let ws: WebSocket
    try {
      ws = new this.#ws(url)
    } catch {
      return this.#retry(url)
    }
    st.ws = ws
    let torn = false
    const teardown = () => {
      if (torn) return
      torn = true
      st.open = false
      st.ws = null
      this.#retry(url)
    }
    ws.onopen = () => {
      st.open = true
      st.attempt = 0
      if (this.#filter) ws.send(JSON.stringify(['REQ', this.subId, this.#filter]))
      this.#onOpen?.()
    }
    ws.onmessage = (m: MessageEvent) => {
      if (typeof m.data !== 'string') return
      try {
        const msg = JSON.parse(m.data) as unknown[]
        if (msg[0] === 'EVENT' && msg[1] === this.subId && msg[2]) this.#onEvent?.(msg[2] as NostrEvent)
      } catch {
        /* ignore */
      }
    }
    ws.onerror = () => {
      if (!st.open) teardown()
    }
    ws.onclose = teardown
  }

  #retry(url: string): void {
    const st = this.#conns.get(url)
    if (this.#closed || !st || st.timer) return
    const base = Math.min(30_000, 1_000 * 2 ** st.attempt++)
    st.timer = setTimeout(() => {
      st.timer = null
      this.#connect(url)
    }, base / 2 + Math.random() * (base / 2))
  }

  close(): void {
    this.#closed = true
    for (const c of this.#conns.values()) {
      if (c.timer) clearTimeout(c.timer)
      try {
        c.ws?.send(JSON.stringify(['CLOSE', this.subId]))
        c.ws?.close()
      } catch {
        /* ignore */
      }
    }
  }
}
