# nostr-p2p

> 🚧 開発中（v0.1未リリース）。APIは変わる可能性があります。

nostr relayを使って、**サーバーを立てずに**P2P通信ができるライブラリです。

- WebRTCで直接つながり、つながらないときは**暗号化したrelay経由の通信に自動で切り替え**ます
- 通信は**常に暗号化**されます（無効にする設定はありません）
- ブラウザでは依存なしで動きます。Node.jsやReact Nativeでは、WebRTCの実装を渡して使えます

## 使い方（予定）

```js
import { joinRoom } from 'nostr-p2p'

const room = joinRoom('my-app', 'room-123', { password: 'secret' })

room.on('join', (peer) => console.log('参加:', peer.id))
room.on('leave', (peer) => console.log('退出:', peer.id))

const chat = room.channel('chat')
chat.on((data, peer) => console.log(peer.id, data))
await chat.send('こんにちは')
```

### 通信経路の選択

```js
joinRoom('my-app', 'room-123', { transport: 'auto' })   // デフォルト: WebRTC、だめならrelay
joinRoom('my-app', 'room-123', { transport: 'direct' }) // WebRTCのみ
joinRoom('my-app', 'room-123', { transport: 'relay' })  // relayのみ
```

### Node.js

```js
import { RTCPeerConnection } from 'node-datachannel/polyfill'
joinRoom('my-app', 'room-123', { rtc: { RTCPeerConnection } })
```

WebRTCの実装を渡さない場合は、relay経由で通信します。

## プライバシーについて

- WebRTCで直接つながると、**相手とSTUNサーバーにあなたのIPアドレスが見えます**。避けたい場合は `transport: 'relay'` を使ってください
- パスワードなしのルームは、ルーム名を知っている人なら誰でも参加でき、全員宛てのメッセージを読めます。推測されにくいルーム名か、パスワードを使ってください

## ドキュメント

- [設計の決定事項](docs/design.md)
- [プロトコル仕様（下書き）](PROTOCOL.md)

## ライセンス

MIT
