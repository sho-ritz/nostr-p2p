import { type AddressInfo, WebSocketServer, type WebSocket } from 'ws'
import { matchFilters, type Filter } from 'nostr-tools/filter'

/** In-process relay that forwards (does not store) events, like relays do for ephemeral kinds. */
export class MockRelay {
  readonly seen: Array<{ kind: number; content: string; tags: string[][] }> = []
  #wss: WebSocketServer | null = null
  #port = 0
  readonly #subs = new Map<WebSocket, Map<string, Filter[]>>()
  get url() {
    return `ws://127.0.0.1:${this.#port}`
  }
  async start() {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: this.#port })
    await new Promise<void>((r) => wss.once('listening', () => r()))
    this.#port = (wss.address() as AddressInfo).port
    this.#wss = wss
    wss.on('connection', (ws) => {
      this.#subs.set(ws, new Map())
      ws.on('close', () => this.#subs.delete(ws))
      ws.on('message', (raw) => {
        const [type, a, ...rest] = JSON.parse(raw.toString()) as [string, unknown, ...unknown[]]
        if (type === 'REQ') {
          this.#subs.get(ws)!.set(a as string, rest as Filter[])
          ws.send(JSON.stringify(['EOSE', a]))
        } else if (type === 'CLOSE') this.#subs.get(ws)!.delete(a as string)
        else if (type === 'EVENT') {
          const e = a as { id: string; kind: number; content: string; tags: string[][] }
          this.seen.push(e)
          ws.send(JSON.stringify(['OK', e.id, true, '']))
          for (const [c, subs] of this.#subs) for (const [id, f] of subs) if (matchFilters(f, e as never)) c.send(JSON.stringify(['EVENT', id, e]))
        }
      })
    })
    return this
  }
  async stop() {
    const w = this.#wss
    this.#wss = null
    if (!w) return
    for (const c of w.clients) c.terminate()
    await new Promise<void>((r) => w.close(() => r()))
  }
}

export async function until(cond: () => boolean, ms = 8000, label = 'condition') {
  const t = Date.now()
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}
