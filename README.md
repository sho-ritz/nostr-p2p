# nostr-p2p

> v0.1 / 実験的。API とプロトコルは変わる可能性があります。

nostr relayを使って、**サーバーを立てずに**P2P通信ができるライブラリです。

- WebRTCで直接つながり、つながらないときは**暗号化したrelay経由の通信に自動で切り替え**ます
- 通信は**常に暗号化**されます（無効にする設定はありません）
- ブラウザでは依存なしで動きます。Node.jsやReact Nativeでは、WebRTCの実装を渡して使えます

## 使い方

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

## 仕組み

- 同じ `appId`・ルーム名・パスワードの参加者は、同じハッシュ値（ルーム ID）を Nostr の ephemeral イベント（kind 25050、リレーは保存しない）のタグにして、あいさつ・シグナリングをやり取りします
- 低い公開鍵の側が WebRTC のオファーを出し、データチャネルが開いたら `transport` が `relay` → `direct` に切り替わります
- `auto` では、接続直後からリレー経由で送れ、直接接続が切れたらリレーに戻り、裏で張り直します
- メッセージは自動で分割・組み立てされ、チャンネルごとに順番どおりに届きます（経路の切り替え中に失われたものは 10 秒待って飛ばします）

## プライバシーについて

- WebRTCで直接つながると、**相手とSTUNサーバーにあなたのIPアドレスが見えます**。避けたい場合は `transport: 'relay'` を使ってください
- パスワードなしのルームは、ルーム名を知っている人なら誰でも参加でき、全員宛てのメッセージを読めます。推測されにくいルーム名か、パスワードを使ってください

## ドキュメント

- [設計の決定事項](docs/design.md)
- [プロトコル仕様](PROTOCOL.md)

## 開発

```sh
npm test              # 単体＋模擬リレーと実 WebRTC（node-datachannel）での結合テスト
npm run smoke:public  # 公開リレー＋公開 STUN で実際に直接接続できるか確認
```

## ライセンス

MIT
