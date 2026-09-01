# Stack-chan Stage デモ動画台本

想定尺は2分35秒です。
日本語でナレーションを収録し、表の英語字幕を焼き込みます。
画面は1440×900以上で収録し、ブラウザ通知、ブックマークバー、個人情報が映らない状態にします。

| 時間      | 画面                                                                                             | 日本語ナレーション                                                                                                                                                                       | English subtitle                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:12 | 完成済みのフィナーレを先に見せる。背景、拍手、表情、BGMが動く。                                  | これは、人とAIが同じ舞台を演出するStack-chan Stageです。AIが台本を書き、人が確かめたあと、ロボットが演じます。                                                                           | Stack-chan Stage lets a human and an AI direct the same robot performance. The AI drafts; the human approves; the robot performs.                           |
| 0:12–0:28 | 演出画面へ戻り、15 tools表示、revision、タイムラインを順に指す。                                 | 画面を推測してクリックするのではありません。ページ自身がWebMCPで15個の操作を公開し、AIは人が見ている台本を直接読み書きします。                                                           | No visual guesswork. The page exposes 15 WebMCP tools, so the agent reads and writes the same timeline the human sees.                                      |
| 0:28–0:40 | エージェントが`stage.workspace.get`を実行。3場面、13キュー、4素材を結果で示す。                  | まず、現在のworkspaceとrevisionを取得します。演目は3場面、13キュー。背景3枚とBGMも、安定したIDで参照できます。                                                                           | First, the agent reads the workspace and revision: 3 scenes, 13 cues, and 4 source-backed assets with stable IDs.                                           |
| 0:40–1:04 | 「共同演出」を選ぶ。背景、表情、台詞・演技指示、モーションが順に変わる。revisionが0から4へ進む。 | 次に、共同演出の場面だけを推敲します。背景を切り替え、表情を笑顔にし、台詞と演技指示を書き換え、最後を拍手にします。各更新はrevisionを照合するため、古い編集で人の変更を上書きしません。 | The agent revises one scene: backdrop, expression, dialogue, direction, and motion. Optimistic revisions prevent stale writes from overwriting human edits. |
| 1:04–1:15 | 意図的な古いrevisionが拒否される結果と、続く`stage.scenario.validate`の成功を短く見せる。        | 古いrevisionの操作は明示的に拒否されます。続けて演目全体を検証し、13キューが上演可能だと確認します。                                                                                     | A stale revision is rejected clearly. Full-scenario validation then confirms that all 13 cues are ready.                                                    |
| 1:15–1:38 | 編集したCue範囲だけPreview。背景がスライドし、台詞、笑顔、拍手を舞台モニターで見せる。           | いきなり全場面は動かしません。変更した範囲だけをPreviewし、背景、台詞、表情、拍手を同じ画面で確認します。                                                                                | The agent does not run the whole show yet. It previews only the edited cue range in the shared stage monitor.                                               |
| 1:38–1:48 | Preview終了。エージェントが確認を求め、人が`Looks good. Play all scenes.`と返す。                | Previewが終わると、AIはここで止まります。人が舞台を見て、問題がないと判断してから全場面を許可します。                                                                                    | After preview, the agent stops. The human watches and explicitly approves the full performance.                                                             |
| 1:48–2:03 | 全場面Play。3枚の背景が開演、共同演出、フィナーレの順に切り替わる。                              | 承認後に、全場面を上演します。台本、素材、BGM、ロボットの動きが、ひとつのRunとして順番に実行されます。                                                                                   | Only after approval does Play All run the complete show: cues, assets, music, and robot motion in one ordered run.                                          |
| 2:03–2:20 | 素材画面の出典とライセンス、プロジェクトZIP書き出し、テスト結果をテンポよく見せる。              | デモ素材には出典とライセンスを表示し、ZIPにも本体を含めます。ハッシュ検証と5本のE2Eで、素材、画面、Preview、全場面Playまで確認しています。                                               | Assets show provenance and travel inside project ZIPs. Integrity checks and five E2E flows cover the demo through full playback.                            |
| 2:20–2:35 | ライブURL、GitHub、Apache-2.0を表示し、フィナーレで締める。                                      | ライブデモはブラウザだけで試せます。Stack-chan StageはApache 2.0で公開中です。AIに操作を隠すのではなく、人と同じ舞台を渡す。それが、私たちのWebMCPです。                                 | Try the live demo in your browser. Stack-chan Stage is Apache-2.0. WebMCP gives the agent the same stage—not a hidden automation layer.                     |

## 収録チェック

- 新しいプライベートウィンドウを使い、初期演目から始める。
- `WASM READY`を確認し、収録前に画面を一度クリックして音声を有効にする。
- エージェントの返答は要点だけが見える幅に調整し、ツールの引数と結果を読める大きさにする。
- Preview後に一度止まり、人が確認する場面を省略しない。
- BGMとナレーションの音量を分け、台詞が聞き取れるようにする。
- 書き出しは1080p、30fpsを基準にし、公開前に字幕、音声、ライブURLを通しで確認する。
