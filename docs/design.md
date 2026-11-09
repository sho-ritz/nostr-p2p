# 設計の決定事項

2026-11-09 の設計インタビューで決めた内容です。

## 1. 通信経路

- `transport: 'auto' | 'direct' | 'relay'`。デフォルトは `auto`
  - `auto`: シグナリングはrelay。データは直接つながればWebRTC、つながらなければrelay経由
  - `direct`: シグナリングはrelay（必須）。データはWebRTCのみ。つながらなければ `DIRECT_CONNECT_FAILED`
  - `relay`: WebRTCを一切使わない
- `auto` でWebRTCが使えない環境では、警告を1回だけ出して `relay` で動く
- `direct` でWebRTCが使えない環境では、`joinRoom` の時点で `RTC_UNAVAILABLE` エラーにする
- 参加者同士のモードが違う場合は接続せず、`TRANSPORT_MISMATCH` を通知する
- 内部では経路をpeerごとに持つ（将来、相手ごとに異なるモードを使えるようにするため）

## 2. 接続モデル

- ルーム型 `joinRoom(appId, roomName, options)`: v0.1
- 宛先指定型 `createPeer()` / `peer.connect(npub)`: v0.2。内部では1対1のルームとして実装する

## 3. 鍵

- ルーム型: 毎回使い捨てのセッション鍵
- 宛先指定型: 鍵を自動で保存する（ブラウザはlocalStorage、Node.jsはファイル）。保存先は差し替え可能
- `secretKey` / `signer`（NIP-07）を受け付ける
- 身元を表す鍵は、セッション鍵の証明に1回だけ署名する。シグナリングにはセッション鍵を使う

## 4. 実行環境

- ブラウザを最優先にする。Node.jsやReact Nativeでは `rtc: { RTCPeerConnection }` を渡す
- Node 22以上（WebSocketが標準で入っているため）、ESMのみ

## 5. relay

- 候補リストの中から、`sha256(roomId|relay)` の順に5台を選ぶ。同じルームの参加者は同じrelayを使う
- `relays` で上書きできる
- 送信はすべてのrelayに行い、受信した重複は取り除く
- 公開relayの確認は、通常のCIとは別の定期実行ジョブで行う

## 6. データ

- `room.channel(name)` を基本にし、`room.send` / `room.on('message')` をデフォルトチャンネルの省略形にする
- JSONにできる値と `Uint8Array` を送れる
- 自動で分割し、受信側で組み立てる。どちらの経路でも順番どおりに届ける
- `peer.transport` と `transport` イベントで、現在の経路が分かる
- relay経由の上限: `relayLimits.maxMessageSize`（デフォルト64KiB）。超えたら `MESSAGE_TOO_LARGE`
- 今後: 上限を上げた場合に、relay経由でも分割と速度調整をして送れるようにする

## 7. 暗号化（常に有効。無効にする設定はない）

| 通信 | 方法 |
|---|---|
| 参加のあいさつ、全員への送信（relay経由） | ルームの共通鍵（appId、ルーム名、パスワードから作る） |
| シグナリング、特定の相手への送信（relay経由） | NIP-44（セッション鍵同士） |
| WebRTCの直接通信 | DTLS（二重には暗号化しない） |

- パスワードなしのルームでは、ルーム名を知っている人は全員宛てのメッセージを読める。このことをドキュメントに明記する

## 8. 参加者の出入り

- 参加時はあいさつと返事、退出時はさようならを送る
- ハートビート: 直接接続は5秒間隔で15秒届かなければ退出扱い、relay経由は30秒間隔で90秒届かなければ退出扱い（設定で変更可能）
- セッション鍵が同じなら同じpeerとして扱い、自動で再接続する（`state: 'reconnecting'`、その間の送信は待機させる）

## 9. 人数

- フルメッシュ。`maxPeers` のデフォルトは10。超えたら `ROOM_FULL`
- 今後: 大人数向けの中継

## 10. STUN/TURN

- STUNは公開サーバーをデフォルトで組み込む。TURNは利用者が指定したときだけ使う

## 11. 実装

- 暗号処理には `nostr-tools`（`pure`、`nip44`）を使い、relayとの通信は自作する
- TypeScriptで書き、1つのパッケージにする。gzip後30KB以下を目標にする

## 12. プロトコル

- ephemeral eventのkindを1つだけ使い、種類の区別は暗号化した中身の中で行う
- タグにはハッシュ化したルームIDだけを入れる
- 中身にプロトコルのバージョンを入れる。合わなければ `PROTOCOL_MISMATCH`
- 仕様は `PROTOCOL.md` に書く

## 13. テスト

1. 単体テスト（Vitest）。NIP-44は公式のテストベクタで確認する
2. ローカルのrelayを使った結合テスト。障害を意図的に起こすケースを含める
3. Playwrightでのブラウザテスト（Chromium、Firefox、WebKit、およびNode.jsとの間）
4. 公開relayの定期チェック（通常のCIとは分ける）

## リリース計画

- **v0.1**: ルーム型と、上に書いた機能（使い捨ての鍵のみ）
- **v0.2**: 宛先指定型、鍵の保存、外部の鍵
- **それ以降**: relay経由での分割送信、二重暗号化のオプション、大人数向けの中継、相手ごとに異なるモード、本物のNAT環境の自動テスト、NIPとしての提案
