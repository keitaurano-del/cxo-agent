# MC-290 共有ツリー未コミット変更の仕分け（2026-08-01・Son）

読み取り専用の棚卸し。git 状態は一切変更していない（add/commit/stash/restore 無し）。
対象: `git status --porcelain` の変更 31 件＋未追跡 51 エントリ（HEAD = 6a3707c）。

検証: `server` `npm run typecheck` **PASS** / `web` `npx tsc --noEmit` **PASS**（未追跡ソース込みの現ツリーで型エラーなし）。

コミット可能性: A=単独でコミット可能な完結した塊 / B=依存あり要注意 / C=破棄・コミット見送り候補 / D=作者確認要

## 1. サマリ表

### 変更（tracked, 31件）

| ファイル | 帰属タスク | カテゴリ | 可否 | 根拠 |
|---|---|---|---|---|
| server/src/collectors/tasks.ts | ClipItNow(videodl)台帳統合 | 設定/サーバ | A | video-dl の TASK_TRACKER をパース対象に追加のみ |
| server/src/config.ts | 同上 | 設定 | A | videodlTracker パス追加のみ |
| server/src/lib/projectMap.ts | 同上 | 設定 | A | ProjectName に videodl 追加 |
| server/src/lib/taskTrackerWrite.ts | 同上 | サーバ | A | videodl/TASK_TRACKER の書込先解決追加 |
| web/src/components/TaskDetail.tsx | 同上 | UI | A | EDITABLE_SOURCE_PREFIXES に videodl/ 追加（1行） |
| web/src/index.css | 同上 | UI | A | --mc-proj-videodl 色変数追加 |
| web/src/lib/meta.ts | 同上 | UI | A | videodl のラベル/色/順序追加 |
| web/src/lib/types.ts | 同上 | UI | A | 型に videodl 追加 |
| web/src/views/Ticks.tsx | 同上 | UI | A | scopeToProject に videodl 追加 |
| web/src/views/Usage.tsx | 同上 | UI | A | PROJECT_ACCENTS に videodl 追加 |
| web/src/views/Activity.tsx | videodl＋ティック非表示(2026-07-03 Keita指示) | UI | B | videodl 対応と SHOW_TICKS=false の2論理変更が同居 |
| web/src/views/Feed.tsx | UX改善（会話一覧の検索） | UI | A | メニュー内検索ボックス追加・自己完結 |
| server/src/devMockupRouter.ts | MC-343/MC-344 | サーバ | B | アイデアプロンプト刷新（コメントに指示日明記）。geminiText.ts(未追跡)を import＝同時コミット必須 |
| server/src/lib/devMockupStore.ts | MC-260 | サーバ | A | モックアップ修正履歴(versions)API。自己完結 |
| web/src/views/Development.tsx | MC-288 | UI | A | アイデア生成ジョブの localStorage 永続化・自己完結 |
| server/src/terminalUpload.ts | ターミナル大容量チャンクUP＋MC-310同根のtmux完全一致修正 | サーバ | B | /api/terminal/upload-chunk 新設。web/Terminal.tsx のクライアント側と対で運用 |
| web/src/views/Terminal.tsx | MC-330（履歴コピー）＋チャンクUP＋タブURL化 | UI | B | ANSI整形コピー(MC-330)・upload-chunk 呼出（server 側と対）・useParams 導入 |
| web/src/lib/UploadContext.tsx | 成果物の大容量チャンクUP（MC-118系） | UI | A | /api/deliverables/upload-chunk（既存API）への4MB分割送信。単独で完結 |
| web/src/views/Deliverables.tsx | 成果物UIレイアウト修正 | UI | A | min-h-0/flex-col の3箇所のみ |
| web/src/main.tsx | 堅牢化（preloadError自動リロード＋ErrorBoundary） | UI | B | 未追跡 web/src/components/ErrorBoundary.tsx に依存＝同時コミット必須 |
| web/src/components/BottomNav.tsx | MC-350（Cowork埋め込み）布石とみられる | UI | D | external プロパティ追加だが現状どこからも未使用。作者（ソラ?）確認要 |
| web/src/components/icons.tsx | 同上 | UI/アイコン | D | ClaudeIcon 追加・未使用。BottomNav と同じ布石か確認要 |
| web/src/lib/agentAvatars.ts | アバターV4刷新（2026-07-19 Keita指示・PD-CA=MC-312含む） | UI | B | v2 gif→v4 png へ全差替。web/public/avatars/*-v4.png（未追跡24枚）と同時コミット必須 |
| web/src/views/BabyDiary.tsx | MC-290記載のMC-289 web一式の残り（ぴよログ化・-1656行） | UI | A | カレンダー/GoogleTasks を撤去しぴよログ取込＋グラフに整理。型チェック通過・他と依存なし |
| web/src/views/Childcare.tsx | MC-348 | UI | B | 月齢別ガイドの参考メディア表示。childcareMonthlyGuide.ts と対 |
| web/src/views/childcareMonthlyGuide.ts | MC-348 | データ | B | StageMedia データ追加。Childcare.tsx と対 |
| web/src/views/workPivotDiagrams.tsx | MC-289（仕事タブ教材・リポジトリ残置方針） | UI | A | 応用図解の追記のみ。Work.tsx から未参照でも残置が正式方針（Work.tsx冒頭コメント） |
| web/src/views/workPivotGuide.ts | 同上 | データ | A | ガイド本文追記 |
| server/src/workChatRouter.ts | 仕事ツール壁打ち「クレア」（PMO/ECL） | サーバ | A | できる/できない線引きのシステムプロンプト追記のみ |
| web/public/fable-progress.html | Fable5進捗ページ（都度上書きの一時物） | 一時物 | C | 進捗配信用で毎回上書き運用。コミット価値低（コミットしても実害なし） |
| web/tsconfig.tsbuildinfo | — | ビルド生成物 | C | tsc インクリメンタルキャッシュ。差分は破棄＋.gitignore 追加を提案 |

### 未追跡（51エントリ）

| パス | 帰属タスク | カテゴリ | 可否 | 根拠 |
|---|---|---|---|---|
| server/src/lib/geminiText.ts | MC-343/344（開発ページ用Geminiテキスト） | サーバ | B | devMockupRouter.ts が import。塊2に必須（無いとビルド断） |
| web/src/components/ErrorBoundary.tsx | main.tsx 堅牢化 | UI | B | main.tsx が import。塊6に必須 |
| web/src/views/workCostPivotGuide.ts / workCostPivotDiagrams.tsx / workPwcGuide.ts | MC-289（仕事タブ教材・残置方針） | UI/データ | A | Work.tsx コメントで「リポジトリに残置」と明記。型チェック通過 |
| web/public/avatars/*-v4.png（24枚, 計~14MB内） | アバターV4刷新 | アイコン/アセット | B | agentAvatars.ts の参照先。塊3に必須 |
| docs/service-*.md（10本, 2026-07-06 Fable5分析run） | 新サービス案出し（PDF.ai後継検討） | ドキュメント | A | ideas-100/ai-era/bold/top・revenue・buildplan 一式。ドキュメントのみで安全 |
| artifacts/mc188-design/（画像4枚＋gen.ts＋pomodoro.html） | MC-188（CANCELLED・ただし台帳に「削除しない」明記） | データ/アセット | D | 保全指定ありコミット妥当だが、pomodoro.html/gen.ts の混在は要確認 |
| artifacts/expense-advisor/index.html | 不明（モックアップ試作の書き出し?） | データ | D | 由来タスク不明。作者確認要 |
| tmp/（mc288-*.mjs ×5＋mc288-shots/） | MC-288 検証スクリプト | ゴミ/一時 | C | 検証用ワンショット。破棄＋tmp/ を .gitignore 提案 |
| _avatar-archive-20260719/（旧v3 png 26枚, 5.2MB） | アバターV4刷新の退避 | ゴミ/退避 | C | 旧版アーカイブ。git 管理不要（必要なら Vault へ） |
| web/public/shibata-resume-pwc-iag*.docx（3本） | Keita私物（履歴書） | ゴミ/私物 | C | **個人情報。絶対にコミットしない**。配信済みなら削除提案 |
| web/public/mc325-before-dl.png / mc325-playing.png | MC-325 検証スクショ | ゴミ/一時 | C | ダッシュボード配信用の検証証跡。コミット不要 |
| web/public/progress-tab-v1.png / son-verify-mob-v1.png | 検証スクショ | ゴミ/一時 | C | 同上 |
| web/public/mc331-post-drafts.html | MC-331 投稿ドラフト配信 | 一時物 | C | 一時配信物。コミット不要 |
| web/public/transcribe-progress.html | 進捗ページ | 一時物 | C | 同上 |

## 2. 今日コミット可能な塊（提案・実行はしていない）

依存の向きに注意（B のペアは必ず同一コミットに入れる）。順不同で独立。

1. **ClipItNow(videodl) プロジェクト登録**（11ファイル）
   server: collectors/tasks.ts, config.ts, lib/projectMap.ts, lib/taskTrackerWrite.ts / web: TaskDetail.tsx, index.css, meta.ts, types.ts, Ticks.tsx, Usage.tsx, Activity.tsx
   注: Activity.tsx はティック非表示(SHOW_TICKS)の変更が同居。メッセージに併記して丸ごと入れるのが現実的。
   案: `ClipItNow(videodl)をプロジェクト登録: video-dl台帳のパース/編集・色/ラベル対応（Activityのティック非表示 2026-07-03 Keita指示を同梱）`

2. **開発モックアップ改善一式**（devMockupRouter.ts, devMockupStore.ts, Development.tsx, ＋未追跡 server/src/lib/geminiText.ts）
   案: `MC-260/288/343/344: モックアップ修正履歴(versions)・アイデアジョブ永続化・アイデアプロンプトを潜在市場×フェルミ推定へ刷新・Geminiテキストラッパー追加`

3. **エージェントアバターV4刷新**（agentAvatars.ts ＋未追跡 web/public/avatars/*-v4.png 24枚）
   案: `アバターV4へ総入替（2026-07-19 Keita指示・人ベース3Dちび）＋PD-CA(MC-312)アバター追加`

4. **ターミナル: 大容量チャンクアップロード＋履歴コピー**（server/src/terminalUpload.ts ＋ web/src/views/Terminal.tsx）
   案: `ターミナル: 1GB級チャンクアップロード(/api/terminal/upload-chunk)・MC-330履歴コピー(ANSI整形)・tmux完全一致ターゲット(MC-310同根)・タブURL化`

5. **成果物アップロード改善**（web/src/lib/UploadContext.tsx, web/src/views/Deliverables.tsx）
   案: `成果物: 4MBチャンク分割アップロード(進捗表示・冪等再送)＋一覧レイアウトのmin-h修正`

6. **フロント堅牢化**（web/src/main.tsx ＋未追跡 web/src/components/ErrorBoundary.tsx）
   案: `web: ErrorBoundary導入＋vite:preloadError時の自動リロード（再デプロイ後の真っ黒画面対策）`

7. **育児: 月齢別ガイドのメディア**（web/src/views/Childcare.tsx, childcareMonthlyGuide.ts）
   案: `MC-348: 月齢別ガイドに参考動画(YouTube nocookie)・図解・外部リンクを追加`

8. **BabyDiary ぴよログ化**（web/src/views/BabyDiary.tsx）
   案: `MC-289/290: 成長日記をぴよログ取込＋グラフ中心に整理（カレンダー/GoogleTasks撤去・-1656行）`

9. **仕事タブ教材の残置分**（workPivotDiagrams.tsx, workPivotGuide.ts ＋未追跡 workCostPivotGuide.ts / workCostPivotDiagrams.tsx / workPwcGuide.ts）
   案: `MC-289: 仕事タブ教材（ピボット応用図解・課題管理費・PwCガイド）をリポジトリ残置方針でコミット`

10. **クレア（仕事壁打ち）プロンプト**（server/src/workChatRouter.ts）
    案: `仕事壁打ち: できること/できないことの線引きをシステムプロンプトに明記（空回り防止）`

11. **サービス案ドキュメント**（docs/service-*.md 10本）
    案: `docs: 新サービス案分析一式（100選/AI時代/大胆案/収益分析/ビルドプラン, 2026-07-06 Fable5 run）`

12. **Feed 検索**（web/src/views/Feed.tsx）
    案: `会話一覧にメニュー内検索を追加`

## 3. 破棄・コミット見送り候補（提案のみ・未実行）

- `web/tsconfig.tsbuildinfo` — ビルド生成物。差分破棄＋ `.gitignore` に追加提案。
- `tmp/`（mc288-*.mjs, mc288-shots/）— MC-288 の使い捨て検証スクリプト。破棄＋ `tmp/` を `.gitignore` に。
- `_avatar-archive-20260719/` — 旧 v3 アバター退避（5.2MB）。git 外で保管（必要なら Vault）。
- `web/public/shibata-resume-pwc-iag{,-v2,-v3}.docx` — **私物・個人情報。コミット厳禁**。配信済みならファイル自体の削除を Keita に確認。
- `web/public/mc325-*.png`, `progress-tab-v1.png`, `son-verify-mob-v1.png` — 検証スクショ（ダッシュボード配信の証跡）。コミット不要。
- `web/public/mc331-post-drafts.html`, `transcribe-progress.html` — 一時配信ページ。コミット不要。
- `web/public/fable-progress.html`（tracked の差分）— 都度上書きの進捗ページ。コミットせず放置で可（chore で入れても無害）。

## 4. 判断できなかったもの（作者確認要）

- `web/src/components/BottomNav.tsx`（external プロパティ）＋ `icons.tsx`（ClaudeIcon）— どこからも未参照。MC-350（Cowork埋め込み）の布石に見えるが、対応する App.tsx 側の変更が無い。作者（ソラ?）に意図確認してからコミット。
- `artifacts/mc188-design/` — MC-188 は CANCELLED だが台帳に「削除しない・再開時流用」と明記。コミットして保全するか、Vault のみで保全するか要判断。gen.ts / pomodoro.html の混在物も要確認。
- `artifacts/expense-advisor/index.html` — 由来タスク不明のモックアップ書き出し。作者確認要。

## 5. 集計

- 変更(tracked) 31 ＋ 未追跡 51 エントリ（うちアバターpng 24・docs 10・退避26枚は各1塊）
- A: 22 / B: 11（すべて上記塊内でペア解消可） / C: 13 / D: 4
- 今日コミット可能な塊: **12**（塊1〜12。D 3件と C 群を除き全変更をカバー）
