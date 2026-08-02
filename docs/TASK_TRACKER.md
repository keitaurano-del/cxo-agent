# TASK_TRACKER — cxo-agent / Apollo

task-manager エージェントが管理するタスク台帳の正本。
ステータス: TODO / IN_PROGRESS / BLOCKED / REVIEW / DONE / CANCELLED
更新は必ずこのファイルに反映する。実装は dev-logic / designer に委譲（task-manager は実装しない）。
完了タスクは docs/archive/TASK_TRACKER-2026H1.md へ退避（2026-08-02〜）

承認済みプラン全文: `/home/dev/.claude/plans/snazzy-hopping-spindle.md`

---

## プロダクト概要 — Apollo（開発状況リアルタイム可視化ダッシュボード）

> 製品名: **Apollo**（旧称 Mission Control）。`MC-xx` の ID プレフィックスは内部識別子としてそのまま維持。

logic / en-chakai / 西丸町(nishimaru-chokai) / ai-pmo / cxo-agent / プライベート + 全14エージェントの
「誰が今何をしてるか・誰が止まってるか・タスク進捗/滞留・エージェント同士の会話」を1画面で
リアルタイム可視化する常駐ダッシュボード。Vultr サーバ常駐。

- データ源泉（ハイブリッド）: markdown タスク台帳 + `~/.claude/projects/**/subagents/**/agent-*.jsonl` 解析
- スタック: ai-pmo 流用。backend Node22 + Express5 + TS / frontend React18 + Vite5 + Tailwind3 + react-router-dom6 + react-markdown + remark-gfm / ライブ更新 chokidar watch → SSE（+ 12秒ポーリングfallback）
- ホスティング: `web/dist` を server が静的配信、systemd 常駐、token/Basic 認証で保護。スマホ向けトンネルは follow-up。

### 委譲・品質ゲート方針
- 着手登録は task-manager に通し本ファイルを正本化。コード実装は dev-logic、ビジュアルは designer。
- 各フェーズ後に **reviewer / test-smoke** で品質ゲート（生成→レビュー→統合）。
- push・本番デプロイ・Vultr 常駐化判断は **Keita 承認必須**。

---

## バッチ: 2026-05-30 Apollo 新規構築（Phase 0〜4）

ID 採番: **MC-0x（Phase0）/ MC-1x（Phase1）/ MC-2x（Phase2）/ MC-3x（Phase3）/ MC-4x（Phase4）/ MC-Gx（品質ゲート）**。

> **実態反映（2026-05-30）**: server/src・web/ が実装済みで、サーバは :4317 で稼働中（systemd `apollo.service` 経由、node PID 確認）。web/dist もビルド済み（`index-sF0N5r2g.js`）。実ファイルの実在を根拠に、完了相当タスクを DONE、検証未完を REVIEW に更新。判断保留は REVIEW + 確認メモ。

| ID | タイトル | 優先度 | フェーズ | ステータス | 担当 | 依存 |
|----|---------|--------|---------|-----------|------|------|

---

## Phase 0 — scaffold（担当 dev-logic）

## Phase 1 — backend collectors + REST API（担当 dev-logic）

## Phase 2 — frontend 4ビュー（担当 dev-logic + designer）

## Phase 3 — SSE + chokidar watch + Feed ライブ化（担当 dev-logic）

## Phase 4 — Vultr systemd 常駐 + 認証（担当 dev-logic + Keita 承認）

## 品質ゲート（reviewer + test-smoke）

各フェーズ完了時に必ず通す。生成しっぱなしにしない（生成→レビュー→統合）。

> **実態(2026-05-30)**: 実装は全フェーズ揃って稼働中だが、各ゲートの **検証エビデンス（tsc/eslint/Playwright smoke の実行ログ）** が台帳に残っていないため、ゲートは全て **REVIEW** 据え置き。reviewer + test-smoke を回して green を確認した時点で各ゲートを DONE 化する。

- **MC-G0（Phase0）** [DONE 2026-05-31]: scaffold が両 tsc green（server `tsc --noEmit` EXIT0／web `tsc -b` EXIT0）・dev 起動（`/api/healthz`→`{"ok":true}`・systemd active）。eslint は本リポ未設定で N/A（型ゲートは tsc が担保）。
- **MC-G1（Phase1）** [DONE 2026-05-31 reviewer 関]: 本番 :4317 で /api/agents(180KB)・/api/tasks(53KB)・/api/narrative(17KB)・/api/roster(5KB)・/api/overview が全て 200＋実データ JSON 返却。トークン無しは 401（auth gate）。server `tsc --noEmit` EXIT0。
- **MC-G2（Phase2）** [DONE 2026-05-31 reviewer 関]: SPA が `/` で 200＋`<div id="root">`＋ハッシュ済み bundle 配信。/api/overview の KPI が実数（agentsTotal 220・tasksReview 21 等）。web `tsc -b && vite build` EXIT0（311 modules）。views/*.tsx ハードコード hex 0・UI chrome 絵文字 0。
- **MC-G3（Phase3）** [DONE 2026-05-31 reviewer 関]: 本番 /api/stream を購読し `event: ping`→`event: update {types:[agents]}` がライブで連続発火（chokidar watch→broadcast 数秒以内）。frontend `web/src/lib/useLiveData.ts:103-148` に EventSource＋polling fallback(setInterval)＋onerror 明示再接続(5s) 実装を確認。
- **MC-G4（Phase4）** [DONE 2026-05-31 reviewer 関]: 認証 401 を /api/agents・/api/vault/tree 両方で確認（token 無し→401）。常駐は systemd `mission-control.service`（loaded/active/running/enabled・Restart=always）で稼働、再起動自動復帰可（WantedBy=multi-user.target）。全 API＋SPA＋vault が認証越しに 200 で E2E smoke green。

各ゲート未通過のフェーズは次フェーズへ進めない（依存で表現済み）。実装先行で稼働済みのため、ゲートは「後追い検証」として回す。

---

## リスク・留意（台帳注記）

1. **agentId↔subagent_type マッチング（MC-12）が最難所**。親セッション Task tool_use の先頭 user message 照合＋cwd フォールバックで頑健化。マッチ率を内部メトリクス化して検証。Feed（MC-34）と roster（MC-16）がこれに依存するため、ここが崩れると複数画面が劣化する。
2. **per-server で本機の活動しか見えない**。jsonl は走っているサーバ単位。Vultr 2台目（本機）以外のセッションは映らない。API レスポンスに `source(hostname)` を明示し「全社ではなく本機ビュー」と誤読させない。将来は各サーバから集約 push する拡張余地（今回スコープ外）。
3. **滞留しきい値は8分未満で切らない**（reference_subagent_slow_not_dead）。short kill は進行中エージェントの誤検知＝事故。stall.ts の境界値テストを必須化。
4. **プライベート/個人の projectMap 割当**（obsidian 10-Tasks 等→private）。漏れると unknown 多発。
5. **シークレット管理**（MC-42）。認証トークンを env 管理、誤コミット防止＋rotate 手順。
6. **CANCELLED の Kanban 表示方針**（MC-24）。プランは5列だが status は6語。置き場を決める要確認点。
7. **本台帳自身もパース対象**（MC-14）。Apollo が自分のタスクを映すドッグフーディング。プラン明記外なので注記。

---

## 抜けもれ提言サマリ

プランに明示されていなかったがサブタスク/注記として台帳化したもの:

- **MC-14**: tasks collector のパース対象に **本ファイル（cxo-agent/docs/TASK_TRACKER.md）自身**を追加（ドッグフーディング）。logic 台帳の2系統フォーマット（テーブル＋見出し）両対応。
- **MC-12 / MC-16**: agentMap のマッチ不能時の `unknown` フォールバックを各画面で「固まらない」設計に（Feed/roster の連鎖劣化防止）。マッチ率メトリクス。
- **MC-22/23/24/26**: アクセシビリティ＝状態色は語ラベル/aria 併記（色のみ依存禁止）。デザイン制約＝ハードコード hex 禁止・CSS変数/トークン・UI chrome は SVG のみ（emoji 不可）。
- **MC-24**: CANCELLED の Kanban 置き場（5列 vs 6 status）を要確認点として明示。
- **MC-13 / リスク3**: 8分しきい値の境界値テストを test-smoke 必須項目に。
- **MC-17**: collector 部分劣化設計（1台帳破損で全 API ダウンしない、try/catch＋`{error}`）。
- **MC-42**: SSE への認証適用（EventSource のヘッダ制約→クエリトークン/Cookie）。シークレット rotate 手順。
- **MC-43**: 常駐先サーバ（Vultr 2台目 167.179.64.231 か）の確定が Keita 確認点。
- **i18n**: 本プロダクトは内部ツール（Keita のみ）想定のため i18n 両言語化は対象外と判断（必要なら追加）。← Keita 確認点。
- **両OS**: 本プロダクトは Web ダッシュボード（Capacitor/ネイティブ無し）→両OS確認は非該当。スマホは MC-45 のブラウザ閲覧のみ。

---

## 次アクション

> **2026-05-30 実態整合更新**: Phase0〜4 は実装が出揃い、Apollo は :4317 で稼働中。残りは「検証エビデンスの後追い」と「Keita 追認」。

1. **品質ゲートの後追い検証**（最優先）: MC-G0〜G4・MC-G5 を reviewer + test-smoke で実行し green を確認 → 各ゲートと REVIEW タスク（MC-12/26/43/44/51）を DONE に昇格。
   - MC-12: agentMap マッチ率メトリクス（matched/total）を実データで計測。
   - MC-51/MC-G5: パストラバーサル境界値 smoke（`..%2f`/二重エンコード/NULL/symlink）。
   - MC-44: `systemctl is-enabled apollo.service` と再起動復帰・認証越し全画面 E2E。
2. **MC-43**: `deploy/README.md`（install/start/logs/rotate/token rotate 手順）の整備を確認 → DONE。
3. **Keita 追認点**:
   - (a) 常駐先＝本機（Vultr）で確定でよいか（既に稼働中、追認）。
   - (b) 製品名 Apollo 表記の最終確認（本台帳は Apollo に統一済み）。
   - (c) i18n 両言語化は不要（内部ツール）でよいか。
4. **MC-45（スマホ向けトンネル）** は follow-up のまま。常駐の安定確認後に着手。

---

## バッチ: 2026-05-30 Obsidian Vault 一元化ビュー（MC-5x / MVP=読む専用）

承認済みプラン全文: `/home/dev/.claude/plans/snazzy-hopping-spindle.md`

### 背景・目的
現状ダッシュボードは obsidian-vault の一部（10-Tasks のタスク、50-Daily の briefing/inspection/feedback、60-Agents 台帳）しか取り込んでいない。Keita の要望で「Obsidian の内容もこっちで一元化」＝**Vault 全体**（00-Inbox / 10-Tasks / 20-Knowledge / 20-Projects / 40-Resources / 50-Daily / 60-Agents / 90-Templates 等）をダッシュボード上で**閲覧**できる新ビュー「Vault」を追加する。

### スコープ（MVP）
- **読む専用**（read-only）が当初 MVP スコープ。編集は MC-58 で follow-up 起票し、後に実装・検証完了（2026-06-07 DONE、commit 2e740bf）。
- backend: vault collector ＋ 4 API（tree / note / search / attachment）＋ wikilink→パス解決。**パストラバーサル防止が最重要セキュリティ要件**。
- frontend: 新ビュー「Vault」（左フォルダツリー / 中央ノート本文レンダリング / 上部全文検索）。Obsidian 記法対応。
- 既存 token 認証が全体（/api/vault/* 含む）に効くこと（追加認証は不要、MC-42 の延長）。

ID 採番: **MC-5x（Vault 一元化）/ MC-G5（品質ゲート）**。Phase 1（backend）→ Phase 2（frontend）に概ね対応するが、既存 Phase 完了を待たず独立バッチとして管理（依存は下表参照）。

> **実態反映(2026-05-30)**: Vault バックエンド（`server/src/collectors/vault.ts` + `server/src/lib/vaultPath.ts`）と 4 API（tree/note/search/attachment、`/api/vault/*` 稼働）、frontend（`web/src/views/Vault.tsx` + `components/ObsidianMarkdown.tsx` + `components/VaultTree.tsx` + `lib/obsidian.ts`）が実装済み。wikilink 解決（MC-54）は独立 `wikilink.ts` ではなく `vault.ts` 内に集約されている（タイトル索引キャッシュ + `resolveWikilink` 相当）。

| ID | タイトル | 優先度 | 層 | ステータス | 担当 | 依存 |
|----|---------|--------|-----|-----------|------|------|

---

## リスク・留意（MC-5x 追記）

1. **パストラバーサル＝最重要セキュリティ（MC-51）**。realpath ベースで vault root 配下限定、文字列 prefix 一致だけに頼らない。全 4 API（tree/note/search/attachment）が例外なくガードを通す。URL エンコード/二重エンコード/NULL バイト/symlink 脱出を境界値テストで封じる。1 本でも素通しがあると穴。
2. **Vault が大きいとツリー/検索が重い（MC-52/55）**。ツリーは遅延ロード（初回1〜2階層）、検索はまず計測→必要なら index/キャッシュ化。wikilink 解決 index も起動時/キャッシュ構築で毎リクエスト全 scan しない。
3. **機微情報（Vault は Keita 本人の内容）**。認証必須で保護＝既存 token 認証（MC-42）が /api/vault/* 全体に効くことを MC-G5 で 401 確認。検索結果・添付配信も認証配下。
4. **wikilink 同名衝突解決（MC-54）**。Obsidian の basename リンク解決ルール（同フォルダ優先→最短パス）を踏襲。未解決は null＝壊れリンク表示で固まらせない。
5. **編集（MC-58）＝当初 MVP スコープ外→後に実装・DONE**。read-only MVP の後、obsidian-git 同期競合対策（pull --rebase → 競合検知 409 → .conflict 退避、破壊的 git 禁止）を組み込んで編集機能を実装・検証完了（2026-06-07、commit 2e740bf）。

---

## 抜けもれ提言サマリ（MC-5x 追記）

プランに明示されていたものを台帳化＋暗黙タスクを先回りで起票したもの:

- **MC-51 を独立タスク化**: パストラバーサル防御を「各 API に書く注意」ではなく**共用ガード lib として1本に集約**（全 API が必ず通す。素通し穴防止）。最重要セキュリティとして P0 単独起票。
- **MC-54 wikilink 解決を独立タスク化**: `[[wikilink]]` クリック遷移は同名衝突解決が地雷。Obsidian 準拠ルール＋index キャッシュを明記。frontend と backend どちらで解決するか設計を1つに決める要確認点。
- **MC-56 SVG 添付の XSS 注記**: 画像配信で SVG はインライン script リスク → sanitize/CSP/Content-Disposition を検討項目に。
- **MC-57 react-markdown の sanitize/外部リンク rel**: 既存 MC-25 と同方針で XSS・外部遷移を安全側に。callout/embed のカスタムレンダラ実装が必要（react-markdown 素では Obsidian 記法非対応）。
- **MC-G5 にパストラバーサル境界値 smoke を必須化**: 単体テスト（MC-51）＋統合 smoke（MC-G5）の二重化。URL エンコード/二重エンコード/NULL バイト/symlink を網羅。
- **遅延ロード/キャッシュ要否を計測で裏取り**（MC-52/55）: 「重そう」で勝手に作り込まず、まず計測→必要なら index 化（efficiency 観点）。
- **認証カバレッジ確認**（MC-G5）: 新 /api/vault/* が既存 token 認証配下に確実に入るか 401 テストで担保（追加認証は不要＝MC-42 の延長で OK の前提を検証）。
- **i18n / 両OS**: 本ビューも内部ツール（Keita のみ）想定のため i18n 両言語化は対象外、Web ダッシュボードなので両OS非該当（既存バッチと同方針）。
- **編集 follow-up を1件だけ起票**（MC-58）: スコープ拡大防止のため当初は単独 follow-up 化。後に obsidian-git 競合対策込みで実装・検証完了（2026-06-07 DONE、commit 2e740bf）。

---

## 次アクション（MC-5x）

1. **着手前の Keita 確認点**:
   - (a) MVP = read-only でよいか（当時の確認点。後に編集 MC-58 を実装・DONE 化＝解決済み）。
   - (b) wikilink 解決を backend 集中（解決済み path を返す）か frontend 解決（index を渡す）か — 設計を1つに寄せたい。
   - (c) vault root の絶対パス（env override）確定（MC-02 の vault root 定数と一致させる）。
2. 確認後 **MC-51（パストラバーサル防御 lib）から着手**。これが全 API の前提なので最初。dev-logic に委譲、workflow で生成→reviewer→統合。
3. backend（MC-51〜56）→ MC-G5 のうち API 部分通過 → frontend（MC-57）→ MC-G5 統合 smoke の順。各段で品質ゲート。
4. ~~MC-58 は BLOCKED 据え置き~~ → **解決済み**: 後に編集機能を実装・検証完了（2026-06-07 DONE、commit 2e740bf）。
5. task-manager は各完了報告を受けて DoD 検証→DONE/REVIEW 差し戻し＋本台帳更新。

---

## バッチ: 2026-05-30 自律林ドライバ（autonomous-rin）

### 概要・目的
駆動役（対話セッションの林）がいなくてもタスクが**自律前進**する仕組み。30 分毎の cron で headless 林（`claude --print`）を起動し、着手可能タスクを「1ティック1タスク」だけ前進させる。green ゲート（テスト/型/lint 通過）を満たす限り **deploy まで全自律**（Keita 承認済み 2026-05-30）。

ID 採番: **AR-0x**。

| ID | タイトル | 優先度 | ステータス | 担当 | 依存 |
|----|---------|--------|-----------|------|------|

## バッチ: 2026-05-31 ドッグフーディング feedback トリアージ（運用ミス1件）

ソース: 社内ドッグフーディング(dogfood)で投入した feedback 全20件のトリアージ中に検出した Apollo 運用上の不整合1件。logic 系の actionable は `logic/docs/TASK_TRACKER.md` のバッチ「2026-05-31 ドッグフーディング feedback トリアージ」（FB-01〜FB-10＋既存 DF-F 系への dedup 寄せ）に登録済み。本ファイルには Apollo 運用ミス1件のみ。ID は既存 MC-01〜58/G0〜G5・AR-0x と衝突しない **MC-59**。

### MC-59 — inbox.jsonl の消し込み漏れ修正（フェルミCTA件）
- 優先度: P2（重大度: 低）/ ステータス: DONE（2026-06-01 cxo ティック 林）/ 担当: dev-logic（蓮）
  - DoD(1) 表示整合は既に充足: GET /api/inbox（`server/src/inbox.ts:392-396` handleList）が inbox-consumed.jsonl を `readConsumedIds` で突合し consumed を pending から除外済み＝フェルミCTA件（id `2026-05-30T22-51-15...`）含む既消費分は UI に pending として出ない（DoD の「または inbox-consumed との突合で pending 表示が消える」を満たす）。inbox.jsonl の status フィールドは追記専用の監査データで表示には未使用のため書き換えない（並行書き込みレース回避）。
  - 恒久対策（再発防止）実装: 即タスク化（taskId 付与）成功時にサーバ自身が当該 id を inbox-consumed.jsonl へ自動追記するようにした（`appendConsumed()` 新設、handlePost で taskId 確定時のみ呼出・失敗は握り潰し 201 非ブロック）。これでボード登録済みなのに inbox pending が滞留する構造を解消。即タスク化失敗（taskId 無し）は従来どおり pending を残し autonomous-rin の後方互換フローに委ねる。
  - 検証: server `tsc --noEmit` EXIT0 / 新規 `inbox.autoConsume.test.ts` 4/4 / 全 test files green（normStatus 31・ticks・approvals 9・summaryTable 3・priority 16）。林が独立に裏取り。ローカル commit `0338706`。**本番反映は apollo.service restart＝Keita 承認待ち（restart まで実挙動は未変化。push も Keita 承認領域）。**
- 詳細: フェルミCTA件（inbox id `2026-05-30T22-51-15...`）は logic 側で UI-14 として実装・push（commit `d05e454`）・本番 deploy まで完了済みなのに、`cxo-agent/data/inbox.jsonl` 側の当該レコードが `status: pending` のまま残っている。実体は consumed 済み（自律林が `inbox-consumed.jsonl` に id 追記する運用＝project_autonomous_rin）なので台帳と実態が乖離している。
- DoD: 当該 inbox レコードの status が consumed 済み実態と整合する（`status: pending` 解消、または `inbox-consumed.jsonl` との突き合わせで pending 表示が消える）。さらに、実装・deploy 完了時に inbox 側を自動で消し込む処理が入っていれば再発しない。
- 関連: `cxo-agent/data/inbox.jsonl`、`cxo-agent/data/inbox-consumed.jsonl`、logic UI-14（実装済 commit `d05e454`）、自律林の消費ロジック（project_autonomous_rin）
- 依存: なし
- 提言・抜けもれ:
  - 単発の手動 status 更新で済ませると同種の漏れが再発する。実装完了/deploy フックで inbox を consumed に落とす自動消し込みをセットで検討（恒久対策）。
  - 過去の inbox 全体に同様の取り残し（実装済みなのに pending）が他にないか棚卸しすると良い。
  - 回帰: 自動消し込みを入れる場合、まだ実装中の pending を誤って消さないこと（consumed 判定の根拠を明確に）。
  - 破壊的編集に注意（data/ は自律林・Apollo が書く共有ファイル。名指し編集で）。
- note: 2026-05-31 ドッグフーディング(dogfood)で検出。社内ドッグフーディング投入データ（source=dogfood）由来の運用上の不整合であり、外部実ユーザ起票ではない。
- 更新日: 2026-05-31

#### 抜けもれ提言サマリ（MC-59）
- inbox.jsonl の status 管理は手動消し込み運用だと乖離が再発する。実装/deploy 完了と連動した自動消し込みを恒久対策として検討すべき。

#### 次アクション（MC-59）
- 完了（2026-06-01）。表示整合は consumed 突合で既充足、恒久対策＝即タスク化時のサーバ自動消し込みを実装・green・ローカル commit `0338706`。残は apollo.service restart（Keita 承認領域）で本番反映するのみ。

---

## バッチ: 2026-05-31 Apollo タスク中心ドリルダウン強化（MC-6x）

ソース: Keita 2026-05-31 決定。Apollo を「タスク中心のドリルダウン」に強化する。タスクをクリックしたら、その詳細の中で「進捗・workflow・エージェント会話」が一望できるようにする。スコープは「フル」。タスク↔workflow↔会話の紐付けは「軽い案＝ID 文字列マッチ」を採用。

採番: 既存 MC-01〜59 / MC-G0〜G5 / AR-0x と衝突しない **MC-60〜MC-65**。MC-60〜62 がコア（優先度 高〜中）、MC-63〜65 がおまけ（優先度 中〜低）。

> **実装着手タイミング（全件共通）**: 着手は「人格 workflow 着地後」。それまでは全件 TODO で起票のみ（今回は登録・構造化が目的、実装はしない）。実装は dev-logic に委譲（UX 検討は designer 併走）。

> **既存実装との関係（重複回避の整理）**:
> - 会話 Feed は既に `web/src/views/Feed.tsx`（MC-34）＋ `/api/agents/:id/feed`（agent-*.jsonl を user/assistant/tool_use で時系列化）で実装済み。MC-61 のタスク詳細内「紐づくエージェント会話」は**この既存 Feed の該当スレッドを埋め込む＝既存拡張**であり、会話解析を新規実装しない。
> - タスクボードは既に `web/src/views/Tasks.tsx`（MC-24、5列 Kanban）で実装済み。MC-61 のカードクリック→ドロワー/詳細は**既存 Tasks ビューへのドリルダウン追加＝既存拡張**。Kanban 自体を作り直さない。
> - workflow 実行ログ（`subagents/workflows/wf_*/`）は現状どの API でも拾われていない＝ MC-60 でコレクタ新規。

| ID | タイトル | 優先度 | 区分 | ステータス | 担当 | 依存 |
|----|---------|--------|------|-----------|------|------|

---

## 抜けもれ提言サマリ（MC-6x）
- 全件 server コード変更を伴うため反映に `sudo systemctl restart mission-control.service` が必要（生 tsx 起動禁止・ポート4317 単一 bind）。web 変更は `npm run build`。各タスクの DoD に「restart/build で実反映」を含めること。
- 既存 API（agents/tasks/narrative/roster/usage/inbox + SSE）は**全て非破壊で追加**。既存レスポンス型を変えない。新 API も既存 token/Basic 認証配下に入れる（認証バイパスの新口を作らない）。
- 会話 Feed（MC-34）とタスク Kanban（MC-24）は**既存を拡張**。新規で会話解析や Kanban を作り直さない（重複回避）。MC-61 はこの2つの上に詳細ドリルダウンを乗せるだけ。
- モバイルレスポンシブ維持（390px 横溢れ0）・ハードコード hex 禁止・UI chrome は SVG アイコンのみ（emoji 不可）・文言は中立的丁寧体 — Apollo 既存方針を全 UI 追加で踏襲。
- SSE ライブ反映を活かすなら、workflow（wf_*）も chokidar watch（MC-31）対象に含める検討が要る。MC-60/61 の実装時に watch 対象拡張の所在を決める。
- MC-62 の紐付けは「運用ルール（prompt/label に ID 必須）」が成否を握る。林の workflow 起動手順への組み込み＋ memory 化が必要。task-manager 側も「workflow 流すタスクは ID を prompt 明記」を運用化。
- MC-63（しきい値・ERROR ソース）と MC-64（deploy↔タスク紐付けの鍵）は要件が曖昧なまま着手しない。確定してから IN_PROGRESS。曖昧なら BLOCKED + 確認。

## 次アクション（MC-6x）
- 今回は起票のみ完了（全件 TODO）。実装着手は「人格 workflow 着地後」。それまで凍結。
- 着手解禁後の順序: MC-60（workflow コレクタ＋API）→ MC-61（タスク詳細ドリルダウン）→ MC-62（紐付け）。MC-63〜65 はコア完了後におまけとして優先度判断。
- MC-62 着手前に「workflow/agent 起動時の prompt/label に対象タスク ID を必ず入れる」運用ルールを林・task-manager で確定（紐付け精度の前提）。
- 実装は dev-logic に委譲（designer は MC-61 の UX 併走）。各フェーズ後に reviewer / test-smoke で品質ゲート。

---

最終更新: 2026-05-31 / 管理: task-manager（2026-05-31 Apollo タスク中心ドリルダウン強化 MC-60〜65 起票。旧: ドッグフーディング MC-59 追記、Apollo リネーム＋MC-0x〜MC-5x 実装反映＋autonomous-rin 追記）

---

## バッチ: 2026-05-31 Apollo inbox 起票

## バッチ: 2026-05-31 Apollo 承認ビュー & 優先度手動操作（MC-68/69）

## バッチ: 2026-05-31 Apollo カイロソフト風UI刷新

## バッチ: 2026-05-31 Apollo タスク手動 編集/削除（MC-71）

## バッチ: 2026-05-31 Apollo 投入時の優先度指定（MC-72）

> ⚠ 採番訂正: 林から「MC-71」で渡された投入時優先度指定の件は、別セッション/autonomous-rin が先に MC-71（Apollo タスク手動 編集/削除）を消費済みで衝突していたため、next-task-id.sh の実在最大+1＝MC-72 で起票し直した（MC-64/65 衝突と同型、reference-task-id-numbering 参照）。重複起票は回避済み。

## バッチ: 2026-05-31 Apollo 全文検索（MC-73）

## バッチ: 2026-05-31 Apollo tasks collector バグ修正（MC-74）

## バッチ: 2026-05-31 Apollo 要望6件（MC-75〜MC-80 / Keita 2026-05-31）

> Keita 2026-05-31 の Apollo 6 要望をまとめて起票。MC-66↔MC-77（inbox 即時タスク化）と MC-68↔MC-79（承認ビュー）は本バッチで発展統合する関係（旧票は集約先へ相互参照、二重実装を避ける）。採番は next-task-id.sh で MC-75〜MC-80 を一括予約済み（目視数えなし、pull --rebase 後採番）。

## バッチ: 2026-05-31 Keita 要望4件（MC-83〜86）

> Keita 直依頼（2026-05-31）。タスク詳細表示・投入時優先度・開発エージェントの自律並行稼働・アイドルエージェント起動の4件。MC-83/84 はプロダクト改善（dev-logic+designer）、MC-85/86 は林の設計判断を要するインフラ拡張。MC-84←MC-72 集約。MC-85↔MC-86 は機構が重なる（headless 起動・並行プロセス管理）ため統合設計で重複実装を避ける。

### MC-88/MC-89 共通 — collector status 正本一本化（夜目方針(B)、MC-88 と束ねた1本）

| フィールド | 値 |
|---|---|
| 対象 | MC-88 機序③＋MC-89 機序②（同一 ID の別表現/別表から status が揺れる構造）の collector 側修正 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 実装 | `cxo-agent/server/src/collectors/tasks.ts` の `parseTrackerString` を「status の正本＝正準サマリ表（ID 列見出しが `ID` の表）の status 列」に一本化。**(1) 非タスク表の行ごと除外**: ID 列見出しが `ID` でない別表（`\| タスク \| 旧状態 \| 新状態 \| 反映内容 \|` ＝判断反映サマリ等）を `inNonTaskTable` フラグで検出し、その表の行を一切 task 化しない。これで「別表の旧/新状態列を status ソースに誤採用してフラッピング」を**表の出現順に依存せず決定的に**塞ぐ（旧実装は seen 先勝ちで別表をスキップしていたが、正準表が必ず先という順序前提に依存し脆かった＝夜目機序②の seen 揺れの根本）。判定＝1列目が `タスク/task/項目/対象/名称` かつ他セルに `旧状態/新状態/変更前/変更後/遷移/反映内容/before/after` を含む。 |
| MC-89 既存対策との重複回避 | MC-89 DONE（commit `3bc0139`）は **approvals.ts の (A) decided ID 除外**＝承認キュー算出の冪等化（承認系専用の二重防御レイヤー）。本修正は **tasks collector の status 正本化(B)**＝別レイヤーで重複なし。夜目調査(L1290)が「(B) 同一 ID 多重表現の正規化は別途」と明記した未実装部分を埋めるもの。approvals 系の APPROVAL_TAG_WORDS / 決定ログ除外には一切手を入れていない。 |
| 検証 | 改修後 collector で実台帳 logic/TASK_TRACKER を再パース＝DF-F4/T-U/AM-N は現状値（再リコンサイル前なので全 TODO）で安定、重複 ID なし、同一入力の2回パースが一致（決定的）。再リコンサイル後を模し正準表を BLOCKED 化＋別表残置→3件とも BLOCKED 保持（別表の TODO に巻き戻されない）。別表を正準表より前に置いた破綻順序＝改修前は UNKNOWN に倒れたが改修後は正準表の値（REVIEW/DONE）を保持。回帰テスト `tasks.summaryTable.test.ts` 新設（3 case group＋実台帳決定性チェック、全 pass）。server `tsc --noEmit` 0 errors、既存 `normStatus` 31/31 維持。 |
| 残 | cxo-agent server（mission-control.service）restart で live 反映＝作業ツリー安定後に林がクリーンに実施（reference-apollo-restart-stale-routes の教訓）。push は Keita 承認領域。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

## バッチ: 2026-06-01 Apollo inbox 棚卸し（未消化検出・バグ確定）

> 2026-06-01 の Apollo inbox（cxo-agent/data/inbox.jsonl 全17件）の consumed 突合で、未消化が滞留していることを検出。調査で根因（cxo スコープの自律ループが cron 未登録＝inbox が誰にも消費されない）を確定し MC-90 を起票。inbox 由来の他3件（承認再湧き／タスク詳細記載／停滞タスク再開）は MC-77 の inbox 即タスク化機構により既に taskId 紐付き済み（MC-89 / MC-82 / MC-87）で、本棚卸しでは新規採番せず既存スタブを調査結果で充実させた（重複起票回避）。

## バッチ: 2026-06-01 Apollo Web ターミナル（林との同期・双方向対話をブラウザから）

> Keita 指示（2026-06-01）「このターミナルでできるのと同じこと（林との対話）を Apollo 上でやりたい。方向は A: Web ターミナル（最速）」。Vultr 箱の tmux `main` に常駐する林 CLI セッションを、Apollo 経由でブラウザ（スマホ含む）から同期・双方向にフル操作できるようにする。受信箱（非同期・片方向）に対する同期・双方向版。

## バッチ: 2026-06-01 Apollo Web ターミナル文字化け修正（MC-92 の回帰）

> Keita が実機で /terminal を開くと、ブラウザに文字化けバイナリが表示されターミナルが実質使えない状態。MC-92（Web ターミナル新設・コピペ改善）で入った未コミット差分の selfHandleResponse 化が、上流 ttyd の gzip 圧縮 body を壊して content-encoding ヘッダも消すため、ブラウザが壊れた gzip を平文表示している。根因確定済み。dev-logic が server/src/terminalProxy.ts を修正中（台帳は task-manager 管轄＝dev-logic はコードのみ）。

## バッチ: 2026-06-01 Apollo ターミナル PC コピペ修正 / 画像添付 / レスキュー画面

> Keita 要望3件（2026-06-01）。MC-94=MC-92 の積み残し（PC ブラウザ Ctrl+V が実機で効かない）の根因確定→修正、dev-logic 実機検証で DoD クリア＝DONE（2026-06-01）。MC-95=ターミナルから画像を林に渡せるようにする feature。MC-96=Apollo が落ちても開ける独立レスキュー画面（設計 Keita 確認中）。台帳は task-manager（棚町）管轄、dev-logic はコードのみ触る取り決め。採番は next-task-id.sh で MC-94/95/96 確定済み（pull --rebase 後、MC-90〜93 既存を裏取り、再採番なし）。

## バッチ: 2026-06-01 Apollo ターミナル モバイルタップで TUI 選択肢が選べない（MC-104）

> Keita 報告（2026-06-01）: Apollo ターミナル（ttyd→tmux main の claude=林 TUI）で、claude が選択肢メニュー（矢印キー選択や数字選択の UI）を出した時、PC のマウスクリックは効くがモバイルのタップが反応せず「どうしようもない」＝モバイルで実質操作不能。台帳は task-manager（棚町）管轄、dev-logic はコードのみ触る取り決め。採番は next-task-id.sh で MC-104 確定（pull --rebase 後）。

## バッチ: 2026-06-01 Apollo ターミナル スクロール不能（MC-104 回帰疑い） / ダッシュボード全タイル詳細表示

> Keita 報告・要望2件（2026-06-01）。MC-105=ターミナルがスクロールできない不具合（直前の MC-104 タッチ→マウス変換でスワイプがスクロールバックに流れなくなった回帰疑い）。MC-106=ダッシュボードの全タイルをクリックで詳細表示（MC-67 の司令塔カード詳細を全タイルへ展開）。台帳は task-manager（棚町）管轄、dev-logic はコードのみ触る取り決め。採番は next-task-id.sh で MC-105/MC-106 確定（pull --rebase 後）。

## バッチ: 2026-06-01 autonomous-worker の cxo フィールド表カード誤パース根本修正（MC-107）

> 2026-06-01 MC-90 で autonomous-cxo を有効化したところ autonomous-worker.sh が cxo の TASK_TRACKER（フィールド表カード形式）を誤パースし、MC-66〜MC-104 の 33 カードが汚染（commit f0bac30）、commit 07e23df で git 履歴から修復済み。MC-88 の対症ガードでは根本解決にならず、autonomous-cxo は kill-switch で停止中。本タスク完了が再稼働の前提。台帳は task-manager（棚町）管轄。採番は next-task-id.sh で MC-107 確定。

## バッチ: 2026-06-01 Apollo ターミナル PageUp/PageDown キースクロール（MC-108）

> Keita 報告（2026-06-01）。ターミナルで PageUp/PageDown キーでスクロールできない。MC-105 でスワイプ・マウスホイールのスクロールは直したが、キーボードの PageUp/PageDown は素通りしている。claude TUI は alternate screen ＋ mouse reporting で本来のスクロールバックが無効なため、MC-105 と同様に「PageUp/PageDown を wheel シーケンス（数行分）に変換して TUI に送る」方式でスクロールさせる。通常シェル（mouse mode 無効）時は xterm ネイティブのページスクロール。台帳は task-manager（棚町）管轄、dev-logic はコードのみ触る取り決め。採番は next-task-id.sh で MC-108 確定（pull --rebase 後）。

## バッチ: 2026-06-01 roster 活動表示修正（MC-109）

> Keita 依頼（2026-06-01）。Apollo の /api/roster で hayashi-rin と apollo の「活動なし」表示を修正。roster.ts に mergeLiveHayashiRin（親 session jsonl 最新 mtime → lastActivity/liveStatus）と mergeLiveApollo（systemctl is-active → liveStatus/lastActivity）を追加。commit cab3b68 で実装・本番反映済み。tsc green・restart 後 healthz 200・/api/roster で hayashi-rin liveStatus=active・lastActivity 実時刻・apollo liveStatus=active 確認済み。[[feedback-review-agent-verify-then-done]] 方針で DONE。

## バッチ: 2026-06-03 OpenClaw 秘書 Masayoshi 業務移管

背景: Keita が OpenClaw 秘書「Masayoshi」（Apollo ターミナル4、tmux 'openclaw'、`openclaw chat`、claude-sonnet-4-6 OAuth）に業務を任せる方針を決定（2026-06-03 対話）。林との棲み分け＝Masayoshi は Keita 個人付きの実務秘書ドメイン、林は開発オーケストレーション。MC-128 でターミナル4の器は完成済み（DONE）、本バッチはその中身（職掌・連携・cron 駆動移管）を埋める。

群分け: A群=追加設定ゼロで即着手可、B群=要セットアップ＋Keita 操作あり（一部 BLOCKED 要素）、C群=既存 cron を Masayoshi(openclaw)駆動へ即・全面置き換え（Keita 承認済の方針）。

C群共通方針: 既存 cron スクリプトの「LLM ドライバ部分（`claude --print`）」だけを `openclaw agent --agent main`（Masayoshi）に差し替える。実作業 bash（Playwright/curl/Supabase/vault push）は流用。apollo-watchdog（cron */3 の純 bash 死活probe→restart）は LLM 非依存のセーフティネットとして bash のまま維持（置き換え対象外）。穴を作らぬよう、各ジョブ openclaw 版を1回 smoke→OK で claude 版を停止する。

---

## バッチ: 2026-06-05 Android クローズドテスト進行管理

| ID | タイトル | 優先度 | ステータス | 担当 |
|----|---------|--------|-----------|------|

## バッチ: 2026-06-06 Apollo server restart（フォルダアップロード新コード反映）

| ID | タイトル | 優先度 | ステータス | 担当 |
|----|---------|--------|-----------|------|

## Phase X — タスク詳細タイムライン（担当 dev-logic）

## Phase 1/2/3 — RAG 品質改善（MC-183/184/185）

## バッチ: 2026-06-19 開発ページ Figma ワイヤーフレーム連携（4段フロー）

### MC-265 — PDFエディターを独立Webサービスとして一般公開＋収益化（広告）＋データPDCA＋アプリ化

| ID | MC-265 |
|---|---|
| タイトル | PDFエディター(MC-264)を独立Webサービスとして公開・広告収益化・データ活用・アプリ化 |
| 優先度 | 中〜高（Keita 発案・2026-07-04） |
| ステータス | CANCELLED（2026-07-21 Son棚卸しでクローズ: PDF.ai は 2026-07-20 Keita「pdf.ai.com は外して大丈夫だよ。もう使わないので」により公開終了・完全撤去済〔MC-316〕。本票の「一般公開・広告収益化・アプリ化」計画は前提消滅につき取り下げ。計画書 docs/pdf-editor-launch-plan.md・business-plan は記録として残置。元TODO: 計画書作成済み・方針決定待ち。**Apollo独立タブ化 完了/2026-07-04**＝サイドメニュー「公開計画」(/launch-plan)。**収益シミュレーション(週次/月次・3シナリオ・対話型計算機)＋コスト(初期/ランニング・純損益・損益分岐)搭載**。**市場分析(Fable5・トップダウンTAM→SAM→SOM)反映済**＝Sonライブ調査データ(iLovePDF月2.38億visits等)を基に §8全面書換。**事業計画(Fable5)＋独立タブ「事業計画」(/business-plan)新設/2026-07-04**＝収益性/訪問者数/事業者(競合二極構造＋世界SMB3.6-4億社)/GTM/KPI/リスク/ロードマップ・docs/pdf-editor-business-plan.md・公開計画も6箇所整合修正。両タブに対話型計算機） |
| 担当 | Son（計画）／実装は Fable5/Son |
| 背景/方針 | Keita「まずWebで公開したい。広告収益・無料・その後データでPDCA→Android/iOSアプリ化。できる限り全自動でリリースまで」。**計画書**: `docs/pdf-editor-launch-plan.md`。 |
| 要点 | 現行は完全クライアントサイド(PDF非送信)＝静的CDNで激安・スケール無限・プライバシーが売り。Phase0=Apollo依存を剥がし独立SPA化→独自ドメイン+Cloudflare Pages+CI/CD全自動+広告(AdSense)+法務(PP/規約/CMP同意)+計測(Plausible)+LP/SEO。Phase1=匿名イベント(中身は取らない)でPDCA。Phase2=PWA→Capacitor/Flutterで両OS(iOSはクラウドMacビルド)。**律速=ドメイン確定・広告審査・法務承認の3つ**。 |
| 要決定(Keita) | ①サービス名/ブランド ②対象地域(JP/英語圏) ③事業主体(個人/法人) ④広告NW(AdSense/Ezoic) ⑤ホスティング(Cloudflare Pages可否) ⑥予算感。詳細は計画書§5。 |
| 次アクション | 方針決定後: (a)ドメイン候補提示 (b)独立SPA切り出し起票・実装 (c)PP/規約ドラフト (d)CI/CD雛形。 |
| 依存 | MC-264（機能本体・作り込み継続中）。 |
| 更新日 | 2026-07-04 |

---

## バッチ: 2026-07-05 PDF.ai 一般公開への残タスク分解（MC-265 の子タスク / Keita「全て起票してできるところから」）

> 親: **MC-265**（PDFエディターを独立Webサービスとして公開・広告収益化）。本バッチは公開までの残作業を実行単位に分解。
> 実装は **Fable 5 / Son**。**着手可**＝依存・外部アカウント不要で即進行、**BLOCKED**＝Keita決定/外部手続き待ち。
> クリティカルパス: MC-266（公開配信）→ MC-270/271/273（法務）→ MC-269（AdSense審査）。

| ID | タイトル | 優先 | ステータス | 担当 | 依存/備考 |
|---|---|---|---|---|---|

> **運用インシデント記録 2026-07-06（Son・ボード棚卸しで検出→即復旧）**: `pdfdotai.com` が全URL **HTTP 500**（`web/dist/site/index.html` ENOENT＝ダッシュボードbuildが dist/site を消したまま未再build。記憶 pdf-site-build-order-dist-wipe の通り）。`npm run build:site`（99静的p＋sitemap・11言語）で再生成→ルート/ja/sitemap/ads.txt=200・保護境界(tasks404/apollo401)無傷を実測復旧。サーバ再起動不要（毎リクエスト stat）。**根因の恒久対策が未了**＝ダッシュボードbuild後にサイト再buildを強制する運用/スクリプト化は MC-281 で要対応。**併せて要Keita判断**: PDF.ai本番変更が working-tree に**117ファイル未コミット**（他agent WIP混在で一括commit不可・/tmp/pdfai-backup-20260706 退避）＝ツリーreset/checkoutで消失リスク。正式commitはチーム調整要。

### 追加: 2026-07-05 公開後グロース（DL計測・海外SEO）

| ID | タイトル | 優先 | ステータス | 担当 | 備考 |
|---|---|---|---|---|---|

### 追加: 2026-07-06 解析ファネル・国別DL・同意ベース収集

| ID | タイトル | 優先 | ステータス | 担当 | 備考 |
|---|---|---|---|---|---|
| MC-290 | 共有ツリー未コミット整理 | 中 | TODO（残尾=D判定 BottomNav/icons.tsx のソラ意図確認・resume docx削除はKeita確認待ち。詳細→ tasks/MC-290.md） | Son | 依存=共有ツリー整理（[[cxo-agent-shared-tree-concurrency]]相当）。棚卸しで挙げた117ファイル未コミット問題と同根 |
| MC-313 | Apollo UI 改善 | 中 | IN_PROGRESS（8/2 タブ共通化DONEで🟢全消化。残=🟡要一声/🔴承認のみ→夜まとめで提案。詳細→ tasks/MC-313.md） | Son | [[son-owns-board-reconciliation]] | [[clipitnow-exoclick-integration]] [[son-owns-board-reconciliation]] [[cxo-agent-shared-tree-concurrency]] [[cxo-agent-prod-restart-loads-worktree]] |
| MC-331 | ClipItNow 海外プロモ | 高 | IN_PROGRESS（Show HN承認済→Son火/水夜投稿。Keita残=Reddit/SaaSHub登録。詳細→ tasks/MC-331.md） | Son | 外部送信はKeita確認必須（SOUL境界） |
| MC-347 | ClipItNow ランキングLP | 中 | IN_PROGRESS（LP第1〜4弾公開済→bilibiliクラスタtitle調整・第5弾はGSC/Bing反応待ち。詳細→ tasks/MC-347.md） | Son | MC-336 / video-dl |
| MC-351 | ClipItNow 集客スプリント | 高 | IN_PROGRESS（夜間PDCA自動運転・Bing順位/GSC反応を観測中。詳細→ tasks/MC-351.md） | Son | MC-331/336/339と連動 |
| MC-352 | ClipItNow ブログ配信 | 高 | IN_PROGRESS（8/2 Tumblr開設成功=clipitnow.tumblr.com・メール認証のみKeita待ち→次=投稿。詳細→ tasks/MC-352.md） | Son | 外部投稿はKeita承認済（2026-07-31）。MC-331/351と連動 |
| MC-354 | 毎時ワークループ | 高 | IN_PROGRESS（毎時ワークループ稼働中 crontab 08-23時JST 毎時15分。詳細→ tasks/MC-354.md） | Son | MC-353層3の常時運転化。cronがセッションを跨いで駆動 |
| MC-355 | デイリーニュース改善 | 高 | DONE（全スコープ完了・実画面確認済 2026-08-02。詳細→ tasks/MC-355.md） | Son | 詳細→ tasks/MC-355.md |
| MC-357 | Keita操作キュー常設 | 高 | DONE（keita-actions.md運用開始＋ボード「⏱ Keita今日の2分」カード本番反映・実画面確認済 2026-08-02。詳細→ tasks/MC-357.md） | Son | なし |
| MC-358 | タスクボード再構築 | 高 | DONE（P1設計〜P4 Keitaキューカードまで全4層完了・本番反映・実画面確認済 2026-08-02。詳細→ tasks/MC-358.md） | Son | MC-357 |
| MC-359 | アイデア生成の修理 | 高 | DONE（commit b2f634d push済 2026-08-02。実機3回8〜10sでdone確認済。詳細→ tasks/MC-359.md） | dev-apollo | fast opts(--tools ''/中立cwd/短system-prompt/思考オフ)＋IDEA_TIMEOUT 90→120s＋シード刷新 |
| MC-360 | アイデア生成の多様化 | 高 | REVIEW（2026-08-02 実装・実機検証済。詳細→ tasks/MC-360.md） | dev-apollo | MC-359の続き。詳細→ tasks/MC-360.md |
| MC-361 | モックアップに図解を標準化 | 高 | IN_PROGRESS（林→dev-apollo委譲。詳細→ tasks/MC-361.md） | dev-apollo | MC-360依存。詳細→ tasks/MC-361.md |
| MC-362 | 完了ボタン動作確認 | 低 | TODO（ボードのワンタップ完了ボタンのE2E検証用） | Son | なし |
