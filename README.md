# Stack-chan Stage

Stack-chan Stageは、複数の役と場面を編集し、ブラウザ内のｽﾀｯｸﾁｬﾝまたは実機へ上演する演出コンソールです。

ScenarioとCastから実行時のRunPlanを確定し、Cueの完了イベントを待って次のCueへ進みます。
音声は有界のRolling prefetchで準備し、ブラウザではWeb Speech API、実機ではOpusストリームを使用します。

## 実装範囲

- Scene、Role、Cue、Cast、素材をブラウザで編集できます。
- Scene単位または全場面を、1 Laneの直列Runとして上演できます。
- WASM Actorは、固定したstack-chan SimulatorとStage MODをブラウザ内で実行します。
- 実機Actorは、Local GatewayのControl経路とMedia経路を分離して接続します。
- WebMCPは、取得、検証、Scene/Cue編集、素材取込、Cast変更、Preview、Play、Stopの15ツールを登録します。
- Scenario、Cast、素材、生成音声をIndexedDBへ保存します。

## 構成

| 層                     | 責務                                              |
| ---------------------- | ------------------------------------------------- |
| `packages/domain`      | Schema、Cast解決、Run compile、Runtime reducer    |
| `packages/application` | Workspace command、音声先読み、effect実行         |
| `packages/adapters`    | WASM、実機、Browser Stage、TTS、IndexedDB、WebMCP |
| `apps/web`             | 演出、配役、素材、上演のUI                        |
| `apps/gateway`         | Browserと実機のWebSocket中継、認証、backpressure  |
| `firmware`             | WASM/実機で共有するStage MODと実機音声受信        |

外部入力は各adapterの境界でZod Schemaへ通します。
対象は保存データ、WebMCP入力、Gateway protocol、TTS応答、Host.Stageイベント、音声provider dataです。
検証Schemaは、Standard Schemaの`~standard`契約に対応するZod 4へ統一しています。

## 必要な環境

- Node.js 22以上
- npm 10以上
- Chromium（E2Eテストを実行する場合）

通常の開発とWASM上演には、Moddable SDKやEmscriptenは不要です。
固定済みのSimulator runtimeとStage MODをリポジトリに含めています。

## 起動

```console
npm ci
npm run dev
```

Web UIは`http://127.0.0.1:5173/`、Local Gatewayは`ws://127.0.0.1:8787`で起動します。
WASM Actorだけを使う場合、Gatewayの接続設定は不要です。

Gatewayは起動時に一時pairing tokenを表示します。
実機を使う場合は、そのtokenをUIの「配役」から開くLocal Gateway設定へ入力します。

## 検証

```console
npm run check
npx playwright install chromium
npm run test:e2e
```

`npm run check`はformat、型、unit/property/contract/integration test、Simulator assetのハッシュ、production buildを検査します。
E2EはWASM起動、画面ピクセル、Cue入力検証、Host.Stageの往復、終演、モバイル表示に加え、WebMCPによる台本の取得・追記・推敲とUI反映をChromiumで確認します。

## Local Gatewayと実機

Gatewayを単独で起動する場合は、固定tokenを環境変数へ設定できます。

```console
STAGE_GATEWAY_HOST=0.0.0.0 \
STAGE_GATEWAY_PORT=8787 \
STAGE_GATEWAY_TOKEN='replace-with-a-long-random-token' \
npm run dev --workspace=@stackchan-stage/gateway
```

実機用MODは、Moddable SDK 9.0.0と対象stack-chan hostに合わせてビルドします。
次の例では、設定値を`mod/config`へ埋め込みます。

```console
mcrun -m -p esp32/m5stackchan_cores3 -t build \
  firmware/mods/stackchan-stage-client/manifest.json \
  gatewayUrl='ws://192.168.1.10:8787' \
  token='replace-with-the-gateway-token' \
  sessionId='stage' \
  actorId='stage-left' \
  actorName='舞台上手'
```

生成したXSAはstack-chanのMOD managerから実機へインストールします。
tokenはXSAへ格納されるため、第三者へ配布するarchiveには本番tokenを入れないでください。

実機はOpus 24 kHz、mono、20 ms frameを受信し、再生終了後に`cue.completed`を返します。
Gatewayはpacket creditを超えた送信、64 KiBを超えるmessage、不正Schema、session/Actor不一致を拒否します。

## TTS

TTS endpointを指定しない場合、ブラウザのSpeech Synthesisを使います。
実機SpeechにはOpus packetが必要なため、UIのLocal Gateway設定へOpus生成endpointを入力します。
認証付きendpointではtokenをOpus TTS tokenへ入力します。tokenはBearer headerで送信し、URLやrequest bodyには含めません。
endpoint応答はformat、packet数、packetサイズ、base64をSchemaで検証してからcacheへ保存します。
Speech Synthesisを提供しない埋込みブラウザでは、WebMCPの`stage.performance.preview`へ`speechMode: "skip"`を明示するとセリフを除外した視覚試演ができます。
この場合は成功結果に`warnings`と`skippedCueIds`が含まれ、音声を再生したものとは扱いません。

## Simulator成果物の再生成

通常の開発では再生成しません。
Stage MODを変更した場合だけ、次を実行します。

```console
MODDABLE=/path/to/moddable npm run build:stage-mod
```

WASM native hostを変更した場合は、固定したstack-chan checkout、Moddable SDK、Emscripten、fontbmを用意して次を実行します。

```console
MODDABLE=/path/to/moddable \
STACKCHAN_STAGE_UPSTREAM=/path/to/stack-chan \
EMSDK=/path/to/emsdk \
npm run build:stage-wasm-host
```

要求する版と成果物のSHA-256は[`vendor/stack-chan-simulator/UPSTREAM.md`](vendor/stack-chan-simulator/UPSTREAM.md)に記録しています。

## 現在の制約

- Runtimeは1 Laneを直列実行します。
- ブラウザ既定TTSは音声データを生成しないため、実機上演にはOpus生成endpointが必要です。
- このリポジトリの自動テストは実機への書込み、サーボ動作、実スピーカー再生を実行しません。

設計の背景とMVP条件は[`stack-chan-stage-overview-design.md`](stack-chan-stage-overview-design.md)を参照してください。
第三者成果物の出典とライセンスは[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)に記載しています。
