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
| MC-313 | Apollo UI 改善 | 中 | DONE（8/6 23:47 server restart 実施・healthz ok。Keita決裁でMC-361 WIPをstash退避→クリーンツリーで反映。詳細→ tasks/MC-313.md） | Son | [[son-owns-board-reconciliation]] | [[clipitnow-exoclick-integration]] [[son-owns-board-reconciliation]] [[cxo-agent-shared-tree-concurrency]] [[cxo-agent-prod-restart-loads-worktree]] |
| MC-347 | ClipItNow ランキングLP | 中 | DONE 🔒[Keita] | Son | MC-336 / video-dl |
| MC-351 | ClipItNow 集客スプリント | 高 | DONE 🔒[Keita] | Son | MC-331/336/339と連動。※残っていたKeita操作(HNメール送信 Cowork)は2026-08-15「347以外キャンセル」で見送り＝blockers解決済 |
| MC-352 | ClipItNow ブログ配信 | 高 | DONE 🔒[Keita] | Son | 外部投稿はKeita承認済（2026-07-31）。MC-331/351と連動。※残っていたKeita操作(note→Blogger投稿 Cowork)は2026-08-15「347以外キャンセル」で見送り＝blockers解決済 |
| MC-374 | サイト別DLページ | 中 | DONE（8/15 Keita直依頼。snapany型SSR個別ページ /​<slug>-downloader を11本公開=bilibili/dailymotion/tiktok/twitter/instagram/facebook/twitch/vimeo/pornhub/xhamster/xvideos。title/h1/hreflang5言語/JSON-LD焼込み・sitemap反映・本番clipitnow.net実測200・未登録slug404。Keita直依頼のためPjD2.0のLP凍結の例外。8/15 17:32 Keita追加依頼でアダルト3サイト(Pornhub/xHamster/XVideos)をトップ「対応サイト」チップにも掲出=本番実測でチップ表示・押下時のtitle/h1/検索欄切替・#s=ディープリンクOK(video-dl a043911)。8/15夜Keita追加UX3件=見出し大型化＋ワードマーク縮小(df3e845)／ランキングを来訪文脈で一般/アダルト出し分け＋通常側の混入アダルト除去(c27e621)／手動トグル「一般/アダルト🔞」5言語localStorage固定(5950996)、いずれも本番実測。8/15 22:10 Keita追加依頼=アダルト表示時はランキングも自動でアダルト強制切替(手動一般固定より文脈優先・アダルト表示中はトグル非表示)を実装、4パターン本番実測(b57c140)。詳細→ tasks/MC-374.md） | Son | MC-336 / MC-347 / video-dl。残: xnxx等の追加はKeita判断の追加要望扱い |
| MC-354 | 毎時ワークループ | 高 | DONE 🔒[Keita] | Son | MC-353層3の常時運転化。cronがセッションを跨いで駆動 |
| MC-360 | アイデア生成の多様化 | 高 | DONE（8/3 21:12 Keita決裁OK。DoD記載済→ tasks/MC-360.md） | dev-apollo, Son | MC-359の続き。MC-363図鑑ベース。詳細→ tasks/MC-360.md |
| MC-363 | ビジネスモデル図鑑 | 高 | DONE（8/3 21:12 Keita決裁OK。DoD記載済→ tasks/MC-363.md） | Son | 開発ページに常設。MC-361の図解方針と整合 |
| MC-364 | ENランキングに一般動画混在 | 中 | DONE（8/3 ENシードへbilibili24件追加・service再起動・/api/ranking実測50件中14件bilibili。詳細→ tasks/MC-364.md） | Son | Keita依頼8/3「アダルトだけ→bilibiliとかも」。video-dl commit ffda928 |
| MC-365 | Keita待ちの決裁自動ボタン化 | 高 | DONE（8/3 blockers.json next_actor=keita→/api/decisions自動投入を機能化・本番実測でMC-352自動作成/投入済4件スキップ確認。詳細→ tasks/MC-365.md） | Son | Keita依頼8/3「一時的なものじゃなくて機能として」。決裁一覧読み出し時のlazy同期・taskId重複防止 |
| MC-366 | bilibiliサムネ表示崩れ修正 | 高 | DONE（8/3 /api/thumb中継新設・本番実測200 image/jpeg。DoD→ tasks/MC-366.md） | Son | Keita報告8/3スクショ。hdslb=http+Referer403の二重原因。video-dl commit 3c2c6c8 |
| MC-367 | LBOモデラー機能 | 高 | CANCELLED 🔒[Keita] | Son | Keita依頼8/4。/work?tab=lbo |
| MC-368 | Apolloパスワードログイン | 高 | DONE（8/4 /login フォーム＋MC_PASSWORD照合＋Cookie 400日スライド更新を実装・service restart・外形6項目実測green。auth.ts/index.ts） | fable5 | Keita依頼8/4「毎回token URLで開けなくなるのは困る、パスワード1回で永久アクセスに」。発端はCookie 30日失効による401。Bearer/token URL経路は不変 |
| MC-369 | 収益タブ期間切替 | 高 | DONE（8/7 00:20 7日/1ヶ月/3ヶ月/全期間タブ実装・両service再起動・本番実画面検証済。DoD→ tasks/MC-369.md） | Son | Keita依頼8/6「収益の期間は全期間とか1ヶ月とか株価みたいに」。video-dl days拡張＋revenueRouter range＋Revenue.tsx期間タブ。today誤表示バグも修正 |
| MC-370 | Blueairレンタル事業立上げ | 高 | CANCELLED 🔒[Keita] | Son | Keita依頼8/8「Classic Pro特化レンタル、月商10万・極力自動化」。8/23 Keita「全部閉じて」で完全クローズ→Apollo(AirRentタブ/route/view/mock)撤去・push 4b3bb70、ローカルリポ/vault は .trash/deleted-airrent-20260823 へ退避（可逆） |
| MC-372 | DL履歴の可視化 | 高 | DONE（8/9 23:05 実装・両service再起動・実画面検証済。DoD→ tasks/MC-372.md） | Son | Keita依頼8/9「何の動画がDLされたか見たい」。video-dl /api/dlhistory(ローカル限定)＋Apollo収益タブに最近DL一覧 |
| MC-373 | 受託SEO記事工場の構築 | 高 | CANCELLED 🔒[Keita]（2026-08-15 10:11 Keita指示「347以外キャンセル」。CW登録+応募は見送り。Son側成果物=writing-factory一式は記録として残置・再開時は APPLY-PACK.md から流用可。日次job_watch cron 20:45は停止。詳細→ tasks/MC-373.md） | Son | Keita指示8/11 00:22「1(SEO記事受託)の自動化を仕組化」。リポジトリ=~/projects/writing-factory・設計=DESIGN.md。P2で案件ウォッチ/WP入稿 |
| MC-375 | Kimi専用ターミナル追加 | 中 | DONE（2026-08-18 Keita依頼「kimi ai使えるようにして。専用ターミナル作って」。①OpenClaw: openclaw.jsonにmoonshotプロバイダ(api.moonshot.ai)+kimiエージェント(既定moonshot/kimi-k2.6)追加・env隔離キー・hot reload適用・実応答疎通OK。②Apolloタイル: term6-openclaw-kimi.sh(tmux openclaw-kimi→openclaw chat agent:kimi:main)+apollo-terminal-6.service(ttyd:7686 active/enabled)+config.ts TERMINALS id6+Terminal.tsx タブid6/ラベルKimi+web再ビルド(dist焼込み確認)+mission-control再起動(active)。検証: ttyd7686 Basic認証200(既存5番と同挙動)・dist内/terminal/6/&Kimi確認・mission-control active。DoD→ tasks/MC-375.md） | Son | OpenClaw moonshot/kimi-k2.6。※Terminal.tsxは他者WIP(リセット/行クリアボタン)と同居のためソース混在コミット回避＝タブ変更はdist反映済だが未コミット(WIP作者の commit に相乗り想定)。moonshot従量課金・残高切れで429 |
| MC-376 | ラボ生成の脱AIデザイン化（kimuai08記事インストール） | 中 | DONE（2026-08-19 06:45 仕上げ完了。実装=devMockupRouter.ts +52行: ①ANTI_AI_DESIGN_RULES新設（Signature1点＋業界固有材料＋カード既定禁止＋紫グラデ等の禁止パターン明示＋汎用コピー禁止）を生成/修正プロンプトに結合 ②設計(Director)段階に業界材料→Signature決定を組込 ③デザイン方針(brief)にも業界材料/Signature欄 ④自己点検＋Critique(Critic)にAI感TELL検出=削る方向で修正。8/18 23:16 build・23:17 server再起動で本番反映済。実挙動検証=8/19 02時台の生成「金物屋の在庫メモ」で設計書にSignature明記（引き出しラベルホルダー風棚番号バッジ）・実装HTMLにも反映を実画面確認、台帳クリーム×鉄紺×錆色の業界由来配色・linear-gradient 0件・紫グラデ/ガラス風/汎用文言 0件。スキル化=workspace-son/skills/design-craft・Vault=20-Knowledge/design/anti-ai-design-method.md 保存済） | Son | 2026-08-18 Keita依頼「記事の中身インストール・ラボのデザインに活かして。ClipItNow/円茶会は現状維持」。記事=Director/System/Builder/Critic 4役分離＋業界語彙→Signature 1点＋AI感TELL検出。devMockupRouterの設計/コード/自己点検プロンプトへ反映＋workspace-sonスキル化＋Vaultナレッジ保存 |
| MC-377 | ラボ: 作成中に過去成果物のプレビューが見れない | 中 | DONE（2026-08-19 02:35 実装＋本番実画面検証。原因=生成中はプレビューペインがライブ表示固定＋ポーリングの attachToEditor が起票時クロージャに固定される潜在バグ。修正=Development.tsx ①activeJobsRef 新設でポーリングの紐付け判定を都度最新化 ②handleLoad で生成中でも過去成果物を読込可＝ジョブは一覧の「作成中」カードへデタッチ退避（ライブ流し込み・完了時のエディタ上書きも動的判定で抑止）③「作成中」カード押下でライブ表示へ再アタッチ復帰。tsc/build green・apollomansion.com/dev 実測=生成中に過去成果物プレビュー表示→カード押下→ライブ復帰(158秒時点)） | Son | Keita報告2026-08-19 02:07「作成中に過去成果物のプレビューが見れない」。web/dist 反映済（静的配信・再起動不要） |
| MC-378 | ラボ: 生成が途中で止まる（API停滞で20分待ち→全滅） | 高 | DONE | Son | Keita報告2026-08-19 09:57スクショ「途中で止まるのやめて。あとこの修正再開して」。実測=8/19 9:06/9:34の修正ジョブ×2がthinking差分7分間隔の停滞→20分壁で全滅（コード0文字）。対策=①devMockupRouterにストリーム停滞ウォッチドッグ（180s完全無応答で早期打ち切り→リトライ）②生成タイムアウト20分→60分（書けてるのに遅いランを壁で殺さない。実測=10:21再投入がコード68KB書いた状態で20分壁に轢かれた）③GET /api/dev/mockup/jobs新設＋実装進捗タブに「ラボ生成ジョブ」ライブ一覧（Keita 10:23「③の進捗は実装状況から見れるようにして」。端末を跨いだ再投入ジョブも見える）。失敗した修正（顧客情報一括管理モック）を再投入し10:47完走・実画面確認済（2026-08-19） |
| MC-379 | ラボ: 進捗表示が汎用テンプレでAIっぽい（信号機3色ピル） | 中 | DONE | Son | Keita報告2026-08-19 21:53スクショ「進行の手続きのところがAIぽい」。原因=顧客情報モックの進行中カードが 完了緑/処理中黄/要対応赤 の信号機3色ピル＋薄水色お知らせボックス＋「8件中6件完了」の汎用表現。対策=①ANTI_AI_DESIGN_RULESと自己点検の禁止パターンに「信号機3色ステータスピル」「薄い色付き角丸お知らせボックス」を明示追加＋進捗も業界語彙で表現する指針 ②当該モックを修正ジョブで綴り(台帳罫線)×朱印ミニスタンプ×付箋方向へ再設計(22:04完走・status-chip使用0を確認) |
| MC-380 | ラボ: ライブ表示「AIの思考」がスクロールできない | 中 | DONE | Son | Keita報告2026-08-19 22:46。原因=Development.tsxがストリーム更新のたびに末尾へ強制スクロール→上へ戻っても数秒で引き戻され実質スクロール不能。修正=末尾付近(48px以内)にいる時だけ自動追従するstick-to-bottom方式＋折りたたみ思考/設計書にmax-h+内部スクロール。実測=思考1381→3949px成長時もscrollTop=0維持(2026-08-19 23:15) |
| MC-381 | ラボ: 生成モックにCSSが当たらない（無スタイル表示） | 高 | DONE | Son | Keita報告2026-08-19 22:59「UIあたってる？」(マニュアル作成モック)。原因=AIがCSS途中で書き直し、未完1本目＋---HTML---＋完全2本目が丸ごと保存され、未閉じstyleが後続文書を飲み込みCSS全滅。対策=①splitPlanHtmlをやり直し耐性化(マーカー/DOCTYPE複数時は最後の1本のみ採用) ②当該モックは完全版55,961字を抽出して修復保存・実画面でスタイル適用確認済。追記23:29 Keita「途中じゃない？タブも押せない」=修正版(23:27)で別形の切断が発生: 出力リミット跨ぎの継続で```フェンス+口上がJS中に混入しタブ死。→③手動縫合(node --checkでJS構文OK・全5タブ実クリック動作確認) ④splitPlanHtmlに恒久ガード追加: </html>以降の口上除去+フェンス分割を重なり検出で縫合(実データ形で単体テスト済) |
| MC-382 | ラボ: 修正保存で本文が16KBの雛形に化ける（MC-381対策の回帰） | 高 | DONE | Son | Keita報告2026-08-20 00:20「どういうこと？」(全画面プレビューが黒背景+${slides}素通し)。原因=MC-381対策①の「最後の<!DOCTYPE採用」が、PPT書き出し機能のJSテンプレートリテラル内の入れ子<!DOCTYPEを本文と誤認→外側91KB文書を捨て16KB雛形だけ保存。対応=①transcriptから完全出力91,701字を復元・切断点(names[i]===)と継続を縫合し再保存 ②継続ターンがHTML側と違うID(ppt-thumb/ppt-main)でJSを書いた不整合も修正(実DOMのppt-panel/ppt-main-slideへ) ③恒久対策: runClaudeRawがターン境界(message_start)に印を挿入→splitPlanHtmlが継続先頭の口上+フェンスを決定的に除去、<!DOCTYPE再採用はバッククォート偶奇でテンプレートリテラル内を除外。実データ2形状+合成2形状で単体テスト済・実画面で全タブ+PPTプレビュー(サムネ10枚)動作確認済(00:55) |
| MC-383 | ラボ: 完了した実装仕様書を実装進捗タブから閲覧可能に | 中 | DONE | Son | Keita指示2026-08-20 14:38「実装仕様書もできたものを見れるようにして」。従来は完了カードにラベルだけで本文を見る手段なし。対応=①実装進捗タブの完了カード(実装仕様書/コード学習)に「仕様書を開く」ボタン追加→保存済み本文(mockups/:idのimplSpec/codeLesson)を優先取得、無ければジョブ詳細にフォールバックして展開表示 ②spec/codeLessonジョブにmockupIdを付与(従来欠落)。実機で16,159字の仕様書表示を確認。なお仕様書はモックに保存済みのため開発タブで該当モックを開けば常時閲覧可。追記14:46 Keita「SupabaseとRenderは使わないように(解約済)。書き直して。仕様書をコピーできるように」→①仕様書生成プロンプトからSupabase/Render/Vercelを排除し自宅サーバ常駐(systemd+Cloudflare Tunnel)+ローカルJSON/SQLiteを既定構成に ②ManualCraft仕様書を新プロンプトで再生成(13,447字・Supabase/Render/Vercel言及0を確認) ③開発タブ仕様書欄と実装進捗完了カードに「コピー」ボタン追加(実機でコピーしました表示確認) |
| MC-384 | Laundry.jp 実働プロトタイプ（コインランドリー横断検索） | 高 | DONE | Son | Keita指示2026-08-21 07:47「実際に動くもの作ってみて」。ラボモック(391ed2f8)の次段を実アプリ化: Node+Express(:3010)+ローカルJSON12店/Leaflet+OSM実地図に最安価格ピン(空き=緑縁・クーポン=赤バッジ)/検索・7種絞込・4種並替・現在地(距離順)/店舗詳細(機器×容量×台数×料金表・空き状況・出典と名寄せ併記)/日英切替/オーナー申請・クーポン登録API/開業6社一括資料請求。laundry-jp.service常駐+Cloudflare Tunnelで https://laundry.apollomansion.com 公開。API全数curl検証+実機(390px)で地図ピン→詳細・リスト切替・絞込・EN切替の動作確認済(08:05)。repo=/home/dev/projects/laundry-jp(ローカルgit)。追記08:03 Keita「左メニューが被ってる」=ドロワーのhidden属性がdisplay:flexに負けて常時表示→[hidden]{display:none!important}で修正、静的no-cache+URLバージョニング追加。実機で初期非表示/タップ開閉を再確認(08:10)。追記08:32 Keita「仕事メニューの別タブに専用ページ作って、需要分析、収益プラン、集客プラン等考えて記載」→仕事ページにLaundry.jpタブ新設(iframe方式・プロトタイプへのリンク付)、事業計画ドラフトv1(/laundry-plan.html)作成: サマリー/需要分析(市場の追い風・困りごと表・検索ボリューム)/競合と勝ち筋/収益プラン(3収益源・6-12-24ヶ月シミュレーション・コスト構造)/集客プラン(SEO・MEO・インバウンド・オーナー獲得・SNS)/ロードマップPhase0-3/リスクと確認事項。実画面で全節表示確認(08:45)。追記10:34 Keita「タブスクロールできない、他も合わせて修正して」=Laundry.jpタブ追加でスマホ幅からタブが溢れ届かず→共通TabStripにoverflow-x-auto+no-scrollbarを付与し、Work/Chaji/Childcare/Documents/Tasks/Vault/Notebooks全ページのタブを横スクロール可能に。390px実機でスクロール→Laundry.jpタブ到達・表示を確認(10:45) |
| MC-385 | タブの長押し並び替え（全ページ共通TabStrip） | 中 | DONE | Son | Keita指示2026-08-21 10:40「長押しで順番変えられるようにして。他のメニューも同様」。共通TabStripにreorderKeyプロップ(opt-in)を追加: 長押し450msでドラッグ開始(通常スワイプは横スクロール維持・8px動いたら長押しキャンセル)、ポインタ位置で挿入位置をライブプレビュー、離した時点でlocalStorage(tabstrip-order:<key>)へ永続化。ドラッグ中はtouchmove抑止+コンテキストメニュー抑止+振動フィードバック、直後のclickは無視してタブ誤切替を防止。適用: Work/Chaji/Childcare/DocumentsTabs/TasksTabs(ページタブ)。Vault/Notebooksのモバイルペイン切替(2〜3枚のfillトグル)は並び替え対象外。390px実機で長押し→ドラッグ→順序入替→リロード後も維持→通常タップの切替も正常を確認(10:55) |
| MC-386 | Laundry.tokyo改称＋口コミランキング＋ランドリー代行 | 高 | DONE | Son | Keita指示2026-08-21 14:37「Laundry.jpはLaundry.tokyoにして。Googleマップの口コミベースのランキングも。代行サービス機能も」。(1)全面改称: プロトタイプ(タイトル/ロゴ/フッター/README)・Workタブ表示・事業計画ページ(ドメイン確認事項もlaundry.tokyoへ、v1.1)。(2)口コミランキング: 全12店にGoogleマップ出典のデモ口コミ(日英)追加、GET /api/ranking=ベイズ平均(m=50)で評価×件数を重み付け、ドロワーに新ページ(順位バッジ金銀銅・星・代表口コミ・出典表記)、店舗詳細にも口コミ欄追加。(3)ランドリー代行: 集荷→洗濯乾燥たたみ→翌日配達。S¥2,980/M¥4,480/L¥5,980+オプション(布団/スニーカー/アイロン)、合計即時計算、POST /api/agency/order(検証つき)→submissions.jsonl、受付番号発行。API正常系+異常系3種curl検証、390px実機でランキング表示→詳細口コミ→代行注文(¥8,480)→EN切替まで確認(14:55)。repo=laundry-jp(ローカル)+cxo-agent |
| MC-387 | 東京コインランドリー市場調査レポート（Laundryタブ掲載） | 高 | DONE | Son | Keita指示2026-08-21 19:22「東京のコインランドリー事情を詳しく調べて（店舗数/IT化/現金のみ/需給/5〜10年）レポートにしてLaundryタブへ」。deep-researchワークフロー(99エージェント・検索5系統→出典15件→3票反証検証)で21クレーム通過。要点: 全国は厚労省公式1996年度10,228→2013年度16,693(以降公式統計断絶)、業界推計2024年約2.5万店・市場約1,000億円(矢野2022)・参入1,047社。東京都は820店(2021タウンページ=下限)で23区内訳データ無し。IT化率/現金のみ比率の定量データは業界に不存在(=Laundry.tokyoの事業機会として明記)。将来は矢野の淘汰予測+推論シナリオ(3-5年:IT化が生存条件化・代行融合/10年:無人標準化・再編)。/laundry-market-report.html作成(公式統計/業界推計/推論の確度ラベル・棄却クレーム明示)、Workタブに事業計画/市場調査切替を追加。390px実機で切替→全8節・KPI表示確認(19:55) |
| MC-388 | Laundry.tokyo 実サイト化（実店舗データ投入・本番品質） | 高 | DONE | Son | Keita指示2026-08-21 21:33「実際のサイトも作ってくれる？」。OSM Overpassで東京都の実在コインランドリー470店を投入(取得711→判定採用470: self_service/amenity=washing_machine/店名判定でクリーニング店240除外・scripts/fetch-osm.jsで再実行可)。正直設計=料金/空き/口コミはOSMに無ければ「データ未登録」表示(デモ乱数廃止・デモ12店はstores-demo.jsonへ退避)、Leaflet.markerclusterで470ピンをクラスタリング、絞込は既定「不明を除く」+含めるトグル、ODbL出典表記(地図/フッター/詳細/GET /api/meta)。curl全数検証(正常+異常系)・本番 laundry.apollomansion.com /api/meta=470件応答・実機390pxスクショ5枚(web/public/shots/laundry-390-*.png)。Son実確認: 本番meta=470・中野q=25件応答(21:52)。残: laundry.tokyoドメイン取得=Keita決済要、料金/空きはオーナー登録で充足段階、fetch定期再実行は未cron化 |
| MC-389 | coinlaundry.tokyo ドメイン取得＋切替 | 高 | DONE | Son | Keita決定2026-08-21 23:24「coinlaundry.tokyoで」。空き実確認済(RDAP 404)。購入=Keita決済(Cowork貼付プロンプト提供)。購入後: Cloudflareゾーン追加→Tunnel切替→サイト表記/事業計画のドメイン表記更新はSon実施。あわせて laundry.jp失効ウォッチをcron化(毎日9:10 JST)。完了: Keita購入(お名前.com)→NS委譲確認(magali/maciej)→KeitaがCFログイン(埋め込みブラウザ)→SonがダッシュボードセッションAPIでCNAME2件(apex/www→tunnel)投入・パーキング由来の不要レコード111件掃除・DNS Write APIトークン発行(~/.cf-dns-token・以後のDNS操作は全自動可)。https://coinlaundry.tokyo =200・1,333店応答、www=エッジ直叩き200(ローカルはNSキャッシュ残で伝播待ち)。Workタブ/事業計画/READMEのURL表記もcoinlaundry.tokyoへ切替・web build済(01:00) |
| MC-390 | 外部ソース統合（LAUNDRICH 806店・料金・リアルタイム空き） | 高 | DONE | Son | Keita指示2026-08-21 23:52「ランドリッチとかから情報取れるよね？」。実地調査済(認証不要JSON API・robots許可・規約禁止なし)。LAUNDRICH東京806店をOSM470とマージ、マンマチャオ料金、詳細オンデマンド空き状況(60秒キャッシュ)、週1同期バッチ。出典表記必須。空き状況を目玉化するならAQUA提携打診(Keita判断)。実装完了: 最終1,333店(LAUNDRICH806+OSM新規407+マンマチャオ新規120・重複解決75)、料金100店、空き対応806店、GET /api/stores/:id/status(60秒キャッシュ)、出典3者併記、sync-all.sh用意。Son実確認: 本番meta=1,333店・3プロバイダ応答、status API動作(00:20)。スクショ=shots/mc390-*.png。週1同期cronは日曜05:30 JSTに登録 |
| MC-391 | 接続ソース最大化（チェーン全網羅・メーカー系・独立系・Google Maps検討） | 高 | DONE | Son | Keita指示2026-08-22 00:59「もっとコインランドリー接続して。可能な限り全部。グーグルマップとかメーカー独立系サイトとか」。新ソース8本接続(ピエロ294/Baluko148/ダイワ107/SmartLaundry41/WASHハウス24/デポ15/ホワイトピア6/wash+3)→総1,531店(+198)・空き対応848店(ピエロ機器稼働も接続)・出典11ソース・sync-all.sh組込。除外=NAVITIME等規約禁止・出所不明ポータル・GMapsスクレイピング。Places APIは規約制約(永続保存禁止・Google地図表示必須)で現行構成と非互換=非推奨と報告。Son実確認: 本番meta=1,531店・11プロバイダ(01:40)。スクショ=shots/mc391-map.png |
| MC-392 | マップ上で価格・時間表示（100円で何分） | 高 | DONE | Son | Keita指示2026-08-22 01:32「最初の仕様の通り、マップ上で価格と時間も分かるようにしたい。100円で何分か」。実装完了: 料金表示421店(27.5%・実測103+チェーン標準318)、乾燥コスパ指標326店、地図ピンに「100円8分」ラベル(実測=濃/標準=薄+注記)、sort=dry(コスパ順)・filters=price追加、詳細に料金の目安ボックス。チェーン標準はピエロ100円8分/WASHハウス100円8-10分(公式実確認・画像はsha256変更検知)。Baluko等5チェーンは非公表=未掲載(正直設計)。Son実確認: 本番filters=price=421件(02:00)。スクショ=shots/mc392-*.png |
| MC-393 | Google Maps連携＋料金Web採掘＋口コミ評価表示 | 高 | DONE | Son | Keita指示2026-08-22 08:46「グーグルマップでコインランドリーも調べて。料金はネット/GMaps画像/口コミから取得できるはず。口コミ評価も表示して」。実装完了・Places開通のみKeita待ち: 料金421→451店(Web採掘+30・29.5%)、Places統合(match-places.js/GET /api/stores/:id/google/詳細UI★表示・place_idのみ保存の規約遵守設計)は403待機構成で本番配置済。GMaps画像/口コミからの料金抽出は規約禁止のため不実装と報告。Keita操作=GCPコンソール>認証情報>GEMINI_API_KEYのAPI制限にPlaces API(New)追加(+API有効化)。Son実確認: 本番filters=price=451件(09:10)。スクショ=shots/mc393-*.png。追記2026-08-22 12:5x: KeitaのGCP操作完了でPlaces API開通を実測確認。match-places=place_idあり2,732/2,945店、本番でGoogle評価実応答(gp店★3.5/15件)を確認し完了(MC-396参照) |
| MC-394 | Google Maps風UIへ刷新 | 高 | DONE | Son | Keita指示2026-08-22 09:19「UIもグーグルマップみたいなUIにして」。実装完了: 全画面地図/フローティング検索バー(EN切替内蔵)/チップ8種/ボトムシート(ピーク→全展開・機器空き・料金表・Google評価枠)/このエリアで検索/一覧ピル/現在地FAB/ティアドロップ価格ピン。デスクトップ=左パネル。出典は左下常設+モーダルでODbL/LAUNDRICH視認担保。design-craft適用(Signature=100円指標)。390px/1280px実操作検証・コンソールエラー0・既存機能全互換。Son確認: 本番200・スクショ目視(09:50)。shots/mc394-*.png。残: Critic第三者採点・リスト仮想化 |
| MC-395 | 口コミ分析の反映（AI要約都度表示・評価順ソート） | 高 | DONE | Son | Keita指示2026-08-22 12:04「コメントの内容も分析して設備とか金額、ランキングに反映して」。Google規約(口コミ保存・派生DB化禁止)に適合する設計: 詳細表示時に口コミ取得→Gemini要約を都度表示(保存なし)/表示中店舗のGoogle評価順ソート/自前ランキング強化。恒久DBは合法ソースのみ。実装=laundry-jp 6ee1589(口コミAI要約都度表示・保存なし/Google評価順ソート//api/google/ratings)。MC-397実機検証で詳細シートのGoogle評価ライブ・AI口コミ要約の動作確認済につきDONE(2026-08-22 16:0x Son) |
| MC-396 | Googleマップ「コインランドリー」検索結果の店舗登録 | 高 | DONE | Son | Keita指示2026-08-22 12:20「グーグルマップでコインランドリーで検索した結果も登録して」。Places API(New)開通を実測確認(403解消=MC-393のKeita操作完了)。fetch-gplaces.js新設: 都本土を四分木分割Text Search(セル236・API486回・打ち切り残0)→ユニーク4,629件→店名判定で2,447店採用(クリーニング160/判定外684/都外1,338除外)。マージ: 既存店に同一判定1,033(place_id付与)・新規1,414 → 総2,945店(旧1,531)。match-places.jsはgplaces由来をAPI消費なしで転記する改修込みで place_idカバレッジ2,732/2,945(93%)。server.jsにレコード側place_idフォールバック・sync-all.sh週次組込(30日キャッシュ規約=週次フル再取得で遵守・評価/口コミ非保存)。Son実確認: 本番meta=2,945店・12ソース、q=中野126件(gp新規60)、gp店のGoogle評価API実応答(★3.5/15件)。laundry-jp e0ae45a/9f30932。追記12:37 Keita「サイト名はCoinLaundry.Tokyoにして」→サイト全面（title/ロゴ/フッター/README/server）＋Workタブ・事業計画・市場調査の表記を統一、フッター出典にGoogle マップ（Places API）追加、web build+laundry-jp再起動・本番title実確認済 |
| MC-397 | 地図のGoogleマップ化（Maps JavaScript API切替） | 高 | DONE | Son | Keita質問2026-08-22 12:43「地図はグーグルマップ使えないの？」→使える＋Placesデータは規約上Googleマップ表示が原則のため整合も向上。実装完了: 地図アダプタでLeaflet/Google Maps実装を切替可能化、/api/config でブラウザ用キー配布、キー未設定・認証失敗・ロード失敗時はOSMに自動フォールバック（現在この状態で本番稼働・実機でピン→詳細→Google評価★2.3実応答確認済）。キー受領(12:54)→GOOGLE_MAPS_BROWSER_KEY投入・切替済。実機検証で2件修正: (1)Maps APIがコンテナへinline position:relative強制→map高さ0崩壊をCSSで修正 (2)WebGL非対応環境はOSMへ自動フォールバック追加（いずれもcommit 6d0efb6）。残ブロッカー=キーのAPI制限にMaps JavaScript API未追加（ApiTargetBlockedMapError再現・現在はOSMフォールバックで正常稼働）→決裁 dec-d629323e で依頼→Keitaが追加(2026-08-22 13:08)→Son実機再検証OK: Googleマップ描画・価格ピン/クラスタ・ピンタップ→詳細シート（Google評価ライブ・AI口コミ要約）まで全動作確認、完了。証跡=apollomansion.com/mc397-gmap-wide.png, mc397-gmap-detail.png。費用目安=無料枠1万マップロード/月・超過$7/1000 |
| MC-398 | 地図ピンにドラム式洗濯乾燥機アイコン | 高 | DONE | Son | Keita指示2026-08-22 13:25「マップ上のコインランドリーがある場所は、ドラム式洗濯乾燥機のアイコンをつけてわかりやすくして」。実装: ドラム式洗濯機SVG(currentColor追従)を全ピンに組込。価格ピン=アイコン+料金、料金未登録店=旧ドットピン→洗濯機アイコン入り丸ピン(GMapsカテゴリピン風・24h=緑)に刷新。選択拡大・クーポンバッジ・チェーン薄色は互換維持。Son実機検証: 本番でアイコン2,381個描画・コンソールエラー0・目視OK。laundry-jp c4e8c27。証跡=apollomansion.com/mc398-pins-design.png, mc398-pins-live.png |
| MC-399 | ピン大型化・料金常時表示・密度ヒートマップ | 高 | DONE | Son | Keita指示2026-08-22 13:53。(1)洗濯機アイコン拡大: バッジ付き料金ピン+30px円形アイコンピン (2)料金既知店はz13以上でクラスタから出し常時料金表示(閾値跨ぎで再描画) (3)密度ヒートマップ+炎FABトグル: Leaflet=leaflet.heat / Google=simpleheat自前OverlayView(HeatmapLayerはMaps JS v3.65で撤去済み・constructorは残るが例外)。ハマり: simpleheatは生成時サイズをキャッシュ→リサイズ後resize()必須(欠くと_colorize旧領域のみで黒塗り化)。広域飽和は表示点数連動のmax可変で回避。laundry-jp 599dd5a。Playwright実機検証: 広域ヒート濃淡/z15料金ピン/トグルOFF/ピンtap→シート表示OK・console errors 0。証跡: apollomansion.com/mc399-heatmap-wide.png, mc399-pins-zoom.png, mc399-heat-off.png (2026-08-22) |
| MC-400 | 地図UIリニューアル(TripAdvisor風・ズーム段階集計・左パネル折畳) | 高 | DONE | Son | Keita指示2026-08-22 14:28。(1)左パネル: デスクトップはデフォルト折畳・左端タブで開閉 (2)表示単位の集計ピン: z<10=都県合計(東京都2,945)/z10-12=区市町村合計/z13+=店舗ピン。集計ピンクリックでズームイン (3)FABを+−ズームと重ならない高さに再配置 (4)TripAdvisor風: ピル型チップ(選択=紺地白字)・白ピル料金ピン・白クラスタ・角丸カードhover浮き。laundry-jp cb13d69。Playwright検証: 区市町村60ピン/都県合計/クリックズーム/パネル開閉/モバイル従来動作・errors 0。証跡: apollomansion.com/mc400-desktop-wards.png, mc400-pref-total.png, mc400-pane-open.png, mc400-mobile.png (2026-08-22) |
| MC-401 | 首都圏(神奈川・埼玉・千葉)への店舗データ拡大 | 高 | DONE | Son | Keita指示2026-08-22 14:28「東京だけじゃなくて首都圏のも出せる？」→同日完了。fetch-osm(Overpass JP-11〜14)とfetch-gplaces(首都圏bbox四分木・392セル/795call)を1都3県化、lib-source/mergeの住所正規化も都県対応。結果5,647店(東京2,972/神奈川961/千葉898/埼玉801/不明15・料金あり451・欠陥0)。再起動後/api/stores=5647。実機検証: 広域=4都県計ピン+ヒート/横浜z11=市区集計/z15=店舗ピン、console errors 0。証跡 https://apollomansion.com/mc401-prefs.png・mc401-yokohama.png・mc401-yokohama-z15.png。laundry-jp commit 5d50a07。留意: 週次sync-allのPlaces callが約795回/回に増（従来比2-4倍）。コスト重ければ隔週化可 |
| MC-402 | 地図パフォーマンス改善＋モバイルUX改善 | 高 | DONE | Son | 2026-08-22完了(laundry-jp 1f93343)。店舗ピンを表示範囲内のみ描画(全6,026件のDOM生成廃止)、一覧60件ずつ逐次表示、市区町村ラベルは範囲内・店舗数上位のみ(スマホ24/PC60)でラベル密集解消、スマホ向けCSS調整(カード/チップ拡大)。実機検証: モバイル390x844でドラッグ追従・console errors 0。証跡: apollomansion.com/mc402-mobile-final.png, mc402-mobile-list2.png |
| MC-403 | 検索修復＋集計ピン改善＋ヒートマップ既定OFF | 高 | DONE | Son | 2026-08-22完了(laundry-jp 1f93343)。検索: ヒット店へfitBounds、広域散在(「新宿」が成田市新宿等に当たる場合)と0件時は/api/geocode(Places)で地名解決して移動。実測「新宿」→新宿駅z13・「海浜幕張駅」→正座標。集計不正の真因=住所パース正規表現バグ(羽村市→「羽村」等17種)→総務省住基台帳の公式市区町村リスト最長一致方式に変更、全店cityが公式名と100%一致。座標不正(lat=0)1店除外。市区町村ピン数字なし・ヒートマップ既定OFF。証跡: apollomansion.com/mc403-search-shinjuku.png |
| MC-404 | 開業メニューに出店余地分析（需要×供給） | 高 | DONE | Son | 2026-08-22完了(laundry-jp 1f93343)。data/population.json新設(総務省住基台帳 令和7年1月・1都3県212市区町村)。/api/opportunityが人口×収録店舗数で1店舗あたり人口を算出、開業ページに人口3万以上の上位20を表示。最新1位: 葉山町(人口31,813・店舗ゼロ)、2位大磯町、3位朝霞市。証跡: apollomansion.com/mc404-opportunity-final.png |
| MC-405 | Google Places取得漏れの再確認（キーワード拡張クロール） | 中 | DONE | Son | 2026-08-22完了(laundry-jp e45f8db)。「コインランドリー」+「ランドリー」2キーワードでフルクロール(ユニーク20,821件/API2,842回)。業務用ランドリー(法人格・工場・商会等)の混入除外ルール追加。総店舗5,646→6,026(+380)。2キーワード目はAPI消費大のため--deep指定時のみ・週次同期は従来1キーワード(コスト維持)。証跡: apollomansion.com/mc405-desktop-final.png。追補2026-08-22 16:0x〜17:0x: Keita指摘（葉山CHiLL未収録・タグで判定可）→Places typesタグ(laundry)判定＋英語laundryキーワード＋35日持ち越しを実装しdeepフルクロール（採用8,585・typesタグ救済3,038・API約2,900回）。ただしGoogleはクリーニング取次にもlaundryタグを付けるため847件混入→チェーン名除外(CLEANING_CHAIN_RE)＋--pruneモードで840除外。最終: 総店舗6,026→8,264（+2,238）、葉山2店(CHiLL/Glanz)収録を本番API実測確認、opportunityの葉山町 stores0→2(popPerStore15,907)。laundry-jp 49ec8e6/880eba3 commit済（laundry-jpはリモート無しローカル正本・本番反映は再起動で実施済） |
| MC-406 | 店舗ランキング機能（独自スコア×多切り口） | 高 | DONE | Son | Keita指示2026-08-22 16:22。価格/サービス/口コミ/設備/清潔さ/立地/IT化等から独自評価スコアを算出し、全体/都道府県/市区町村/表示中地域の切り口でランキング表示。Google規約(評価・口コミの保存/派生DB化禁止)に留意し恒久スコアは自前・合法ソースのみ、Google由来は都度取得表示。2026-08-22完了(laundry-jp 569520e): 独自スコア=価格0.35/サービス0.25/設備0.25/IT化0.15(全て自前データ・Google評価は不使用・欠損軸は重み再正規化・2軸以上必須)。GET /api/ranking?scope=all|pref|city|bounds&metric=total|price|... 実測: 8,264店中1,149店スコア化・1位マンマチャオ八王子大和田東店88点・不正パラメータ400。価格軸は東京451店のみ(他県は正直に空)。Son実測でAPI応答確認。証跡=apollomansion.com/mc406-ranking.png, mc406-ranking-price.png |
| MC-407 | 独立開業向け分析の拡張（地域×出店方法×費用×売上） | 高 | DONE | Son | Keita指示2026-08-22 16:22。既存の出店余地分析(MC-404)を拡張: 地域/出店方法(FC・独立・居抜き等)/初期費用/想定売上・費用構造の切り口で開業検討者向けに表示。MC-409のリサーチ結果を数値根拠に使う。2026-08-22完了(laundry-jp 72c65d6): /api/opportunityにbiz(方式別モデルケース比較)追加。biz-params.json(MC-409実値)自動反映・無ければ仮値表示にフォールバック。実測: 独立2,500万回収約5年/FC約4年11か月(ロイヤリティ5%下限注記)/居抜き800万約1年7か月/土地オーナー型初期0円即時。楽観バイアス注記もUI表示。証跡=apollomansion.com/mc407-biz.png |
| MC-408 | 出店売上シミュレーション機能 | 高 | DONE | Son | Keita指示2026-08-22 16:22「ここに出店すると想定売り上げが分かるのとかいい」。地図上の任意地点を選ぶと商圏人口(population.json)×競合密度×立地条件から想定売上・回収期間を試算して表示。前提とロジックは画面に明示（試算であることを正直表示）。2026-08-22完了(laundry-jp 72c65d6): GET /api/simulate?lat=&lng= 商圏人口(市区町村人口の面積按分・外れ値トリム済)×競合密度(500m/1km)×biz-paramsで想定月商・費用・回収期間を試算。前提と計算式を画面明示の正直設計。実測: 中野駅=商圏1km 63,449人・競合45店→赤字判定(飽和の正直な結果)/八王子西部=黒字・回収算出/大阪=400収録エリア外。Son実測でAPI応答確認。証跡=apollomansion.com/mc408-sim.png |
| MC-409 | コインランドリー事業のビジネス分析・知見蓄積 | 高 | DONE | Son | Keita指示2026-08-22 16:22「どういうビジネスでどのくらい利益が出てるのか」。市場規模/収益構造(売上・費用・利益率)/初期投資/FC比較/成功失敗要因/業界トレンドを調査しレポート化。MC-407/408の試算パラメータの根拠とする。2026-08-22完了: laundry-jp docs/business-analysis.md(出典付き7章レポート)＋data/biz-params.json(value/range/source/confidence付きシミュ用パラメータ)。要点: 国内約2.5万店・市場約1,000億円(矢野2022)、20坪店平均月商60〜80万(稼働率10%)、利益率20〜35%、初期費用は独立20坪2,000〜3,000万/物置型950万/土地オーナー型ほぼゼロ、FC=WASHハウス加盟金50万ロイヤリティなし・mammaciao加盟金550万・ジロー売上7%、商圏=都市部300〜500m/3,000世帯以上、回収7〜10年(好条件3〜5年)。低確度: 市場規模のブレ(1,000億〜3,533億)・廃業率は公的統計なし・出典が機器メーカー/FC中心で楽観バイアス可能性→シミュは悲観シナリオ(稼働率5%)併記推奨。追記16:5x: レポートをHTML化しApollo仕事>CoinLaundry.Tokyoタブの第3ドキュメント「収益分析」として追加(cxo-agent 9f65d30)・本番200実測確認。事業計画v1.2/市場調査に自社実測節も反映(e082267) |
| MC-410 | 市区町村単位の数字表示 | 高 | DONE | Son | Keita指示2026-08-22 17:15「市区町村単位では数字出してほしい」。市区町村集計ピンに店舗数を明示＋市区町村の統計(店舗数/料金相場/1店舗あたり人口等)を見られるように。2026-08-22完了(laundry-jp 56dc0b9): z10-12市区町村ピンに店舗数バッジ(Googleマップのエリアラベル風)＋タップで統計パネル(店舗数/料金あり店数と最安値/人口/1店舗あたり人口/ランキング上位5)。店舗ズームのクラスタ円は数字なし維持(2753746指示と両立)。実測: 大田区246店・料金31店・3,010人/店。証跡=apollomansion.com/mc410-city-stats-sp.png ほか |
| MC-411 | 店舗詳細ページの作り込み | 高 | DONE | Son | Keita指示2026-08-22 17:15「店舗詳細はもっと作り込んで」。Googleマップ参考: 営業時間・設備・料金・Google評価/口コミAI要約・経路案内・共有・写真等を整理した詳細シートへ刷新。2026-08-22完了(laundry-jp a0fcc2a): ヘッダ(料金Signature/評価★/営業中)→経路案内・共有(Web Share)・Googleマップの3アクション→営業時間/空き状況/料金/設備/住所+ミニ地図/口コミAI要約/出典。#store=idディープリンク実装・直リンクで詳細が開くことを実測確認。証跡=apollomansion.com/mc411-detail-sp.png, mc411-deeplink-sp.png |
| MC-412 | 「このサイトについて」メニュー | 中 | DONE | Son | Keita指示2026-08-22 17:15。データ出典(OSM/Places等)・更新方針・免責・問い合わせ導線を掲載するAboutページ＋メニュー導線。2026-08-22完了(laundry-jp 6134e9e): 出典モーダルを「このサイトについて」に拡張(目的/出典/更新方針=週1自動・Google系都度取得非保存/免責/連絡窓口は準備中と正直表示)。日英対応。証跡=apollomansion.com/mc412-about-sp.png |
| MC-413 | 全体UIの磨き込み（Googleマップ参考） | 高 | DONE | Son | Keita指示2026-08-22 17:15「全体的にもっとUIを作り込んで。参考はグーグルマップ」。design-craftスキル適用・検索/一覧/詳細/ランキング/シミュレーションの一貫したUI刷新。2026-08-22完了(laundry-jp db3ef59): design-craft準拠で色トークン統一・タップ領域44px・一覧/ランキングカードのトーン統一。SP390x844/PC1440実機検証 console errors 0。証跡=apollomansion.com/mc413-top-sp.png |
| MC-414 | ダークモード切替 | 高 | DONE | Son | Keita指示2026-08-22 17:39。ライト/ダーク切替（地図タイル含む）。OS設定追従＋手動トグル。2026-08-22完了(laundry-jp 15964b9): OS追従＋手動トグル(localStorage・白フラッシュ防止)・CSSトークン反転＋約70箇所上書き・GoogleマップはcolorScheme付きimpl再生成/Leafletはタイルフィルタ。SP/PC×ライト/ダーク全組合せconsole errors 0。証跡=apollomansion.com/mc414-map-dark-sp.png ほか |
| MC-415 | オーナー向け清掃代行・運営代行サービス | 高 | DONE | Son | Keita指示2026-08-22 17:39「清掃代行とか運営代行もサービスに入れて。価格帯とかは考えて」。オーナーメニューにサービスとして掲載・価格帯はMC-409リサーチ＋相場から設計。2026-08-22完了(laundry-jp 64b9366): オーナー向けに清掃代行(週1 ¥22,000/月〜週3 ¥56,000)・運営代行(¥50,000/月+売上5%)・集客支援(¥3,000〜/月)を追加。根拠=MC-409リサーチ＋家事代行相場、20坪店で運営代行8〜9万/月≒相場下限。契約実績なし・問い合わせのみ受付の正直設計。README に価格表記録。証跡=apollomansion.com/mc415-services-light-sp.png |
| MC-416 | 市区町村表示のON/OFFトグル | 高 | DONE | Son | Keita指示2026-08-22 17:39「右下のヒートマップアイコンの上に切り替えアイコン入れて」。市区町村ピン/ラベルの表示切替FABを追加。2026-08-22完了(laundry-jp e96bb19): ヒートマップFAB直上に48px切替FAB(同一X軸・実測で位置確認)。OFF時は市区町村帯でも店舗クラスタ表示で空白回避・localStorage保存・aria-pressed同期。証跡=apollomansion.com/mc416-citypins-off-sp.png |
| MC-417 | 店舗詳細の再構成＋脱AI感の追い込み | 高 | DONE | Son | Keita指示2026-08-22 17:39「まだAIっぽい」「AIによる分析を上に(まず口コミ要約・スコアも表示)。空き状況とかは下で」。AI分析(口コミ要約＋独自スコア内訳)を詳細上部へ、データ未登録セクションの羅列をやめ下部へ集約/折りたたみ。design-craft再適用。2026-08-22完了(laundry-jp a40f242): AIによる分析(口コミ要約→独自スコア軸別バー・/api/stores/:idにscores追加)をアクション直下へ、実データ系はその下、未登録項目は1行集約。見出し順=AI分析→空き状況→機器と料金→営業時間を実測確認。Son目視でダーク詳細スクショ確認済。証跡=apollomansion.com/mc417-detail-dark-sp.png |
| MC-418 | オーナー向けIT化支援サービス追加 | 高 | DONE | Son | Keita指示2026-08-22 19:30。清掃/運営代行に続きIT化支援(キャッシュレス・IoT空き状況・Web集客)をサービス化・価格帯設計。2026-08-22完了: サービスメニュー4枚目カード（初期¥50,000〜＋月額¥10,000/月〜・機器費/決済手数料実費別。キャッシュレス導入支援/IoT空き状況Web公開/GBP整備等Web集客。根拠=GBP運用代行相場月1〜3万の下限、READMEに記録）。日/EN対応。commit 123e937（ローカル正本・再起動反映済）。スクショ mc418-owner-*.png |
| MC-419 | 開業シミュレーションの精緻化（需要セグメント） | 高 | DONE | Son | Keita指示2026-08-22 19:30。需要因子を精緻化: 単身世帯率・洗濯機非保有・時短(共働き)・子育て世帯・宿泊施設(Airbnb/ホテル洗濯機なし)。統計データで按分。2026-08-22完了: 需要セグメント係数導入（単身40%=47都道府県実データ2020国勢調査/IPSS令和6年推計、子育て30%・共働き15%は全国平均比1、宿泊5%/その他10%は理論配分と明示）。data/demand-params.json出典URL付き。/api/simulateに係数乗算＋内訳バー/バッジUI。例:東京1.128。commit c2f8e3c。スクショ mc419-sim-*.png |
| MC-420 | 住所のGoogleマップ補完 | 高 | DONE | Son | Keita指示2026-08-22 19:30「住所もグーグルマップからもってこれる？」。place_id突合済みgplacesデータから住所欠損店へ転記(API追加消費なし・週次更新で規約遵守)。2026-08-22完了: マージ時に住所欠損をgplaces保存済みformattedAddressから転記→残りは国土地理院逆ジオコーダで補完（API費用ゼロ）。今回実測: 欠損20→0件。sync-all.shの通常フローに組込済。commit f7b0230（MC-423と同時反映） |
| MC-421 | AI分析の見せ方強化＋サイトアイコン＋NaN修正 | 高 | DONE | Son | Keita指示2026-08-22 19:30「良い点、気になる点ももっと見やすく。派手にしていい」「サイトのアイコンも作って」。＋詳細の「出典と更新時刻 NaN/NaN」バグ修正(Son発見)。2026-08-22完了: NaN真因=8,264店中7,680店のsources.updatedAt欠落→日時不明時は出典名のみ表示（本番NaN検出0実測）。良い点=緑カード+チェックSVG/気になる点=琥珀カード+注意SVG（ライト/ダーク対応）。ドラム式洗濯機SVGアイコン→favicon/apple-touch-icon/OG画像1200x630+OGメタ（本番200確認）。commit 331e1fd。スクショ mc421-*.png |
| MC-422 | 収益性の高い出店候補地（理論値マップ） | 高 | DONE | Son | Keita指示2026-08-22 19:30「理論値でいいから今出すと収益性が高いところも出せるように」。simulateロジックを面展開し候補地ランキング/マップ表示。2026-08-22完了: /api/hotspots新設（理論商圏人口=min(人口÷(収録店+1),2万)×1人あたり支出×需要係数→理論月商/月利益/回収期間。1,741市区町村・ハードコード無し）。開業メニューにランキング表＋行タップで地図移動。免責/計算式明示。現状は大阪等の収録0店地域が上位（MC-420全国データ投入で自動精緻化）。commit 00d0d6f。スクショ mc422-hotspots-*.png |
| MC-423 | 全国展開（データ拡大） | 高 | DONE | Son | Keita指示2026-08-22 19:30「首都圏だけだけど全国に広げたい」。第1弾=OSM全国クロール＋全国人口データ(無料)。Places全国はAPI費用が大きい見込みのため見積を算出しKeita決裁へ。2026-08-22完了: 全フェッチャー全国化（OSM Overpass全国3,124店/ダイワ2,322/ピエロ733ほかチェーン各社）＋population.json全国1,741市区町村化（総務省住基台帳・build-population.js新規）＋都県/市区町村判定全国化。マージ結果15,802店・47都道府県（東京4,159/神奈川1,607/埼玉1,354/千葉1,291/大阪689/福岡489…）。座標不正12件除外・住所欠損0。本番再起動・API実測済（大阪ランキングpool689/eligible512、hotspots全国追従）。commit f7b0230。Places API全国クロールは未実施＝費用見積→Keita決裁待ち |
| MC-424 | コンサル級ナレッジ蓄積（リサーチ第2弾） | 高 | DONE | Son | Keita指示2026-08-22 19:30「コインランドリーコンサル出来るくらい知見を集めて」。機器選定/補助金/法規制(消防・用途)/保険/税務償却/オペレーション/販促/立地査定チェックリスト/失敗事例まで拡張。2026-08-22完了: laundry-jp docs/consulting-knowledge.md新規(10章＋実務チェックリスト＋biz-params追加提案＋要追加検証リスト)。要点: 機器価格序列AQUA>TOSEI>山本・リースは初期6割圧縮も割高/中途解約不可、契約前チェック=用途地域/動力200V/給水口径/排気/搬入/駐車場、一低二低は原則出店不可(茨城県一次資料)・無人営業はクリーニング業法対象外が適法根拠・乾燥機は消防届(都は17kW未満免除)、資金=公庫創業融資+持続化補助金が現実的、機械13年償却(中古2年)・簡易課税第5種、施設賠償+動産総合が最低ライン、売上8割リピーター・平日割引実例、出口=営業中譲渡>機器売却(相場300〜1,500万・毀損通常)。低確度=届出負担金/保険料相場/失敗事例数字等は付録C明示。追補: Apolloタブ化完了(web/public/laundry-consulting.html 10章+付録・確度ラベル色分け、Work.tsx 4トグル目「開業ナレッジ」、build/実機200確認、commit dde7a7c push済) |
| MC-425 | 口コミ傾向の内部分析パイプライン（マニュアル取得＋Haiku） | 高 | IN_PROGRESS | Son | Keita指示2026-08-22 20:19「両方やろうか」。公開サイトはAPI都度取得を維持（規約適合・変更なし）。内部分析用に: OpenClawブラウザ/Cowork貼り付けプロンプトで口コミをマニュアル取得→Haiku(安価モデル)で傾向分析→内部レポート化。取得データは非公開ディレクトリ保管・サイト配信/DB化しない |
| MC-426 | Smart Laundry等アプリへの誘導導線 | 高 | DONE | Son | Keita指示2026-08-22 20:32。同日完了(laundry-jp d9748bf)。Smart Laundry対応447店の詳細にアプリ案内(App Store id1313142194/Google Play jp.smart_laundry/smartlaundry.jp——全URL実在確認済。店舗別公式ページは無いため一覧リンク)。ピエロ対応店にリアルタイム空き状況表示+公式リンク追加(従来未表示の穴を修正)。出典欄にも両社リンク |
| MC-427 | オンライン決済・稼働状況対応店の広告風表示 | 高 | DONE | Son | 同日完了(d9748bf)。スマート対応判定(リアルタイム/Smart Laundry/キャッシュレス/複数決済≒4,500店)で一覧カードにバッジ+青ボーダー、一覧上部「注目のスマートランドリー」枠(表示範囲から3店)、地図ピン青ドット。広告料未受領のため「PR」でなく「スマート対応」表記+「広告料は受領していません」注記+広告案内リンクの正直設計。ライト/ダーク両対応 |
| MC-428 | 広告プラン策定（オーナー/FC/メーカー向け）＋掲載ページ | 高 | DONE | Son | 同日完了(d9748bf)。オーナー=無料/スタンダード¥3,300/PR¥9,800(月)、FC本部=リード枠¥33,000/月+成果報酬¥3,300/件、メーカー=バナー/タイアップ¥55,000/月。全プランに「受付開始段階・契約実績なし・無料掲載期間1か月」明記。各プラン→種別プリセット済み問い合わせフォーム。README に価格表記録 |
| MC-429 | 問い合わせのメール通知（keita.urano@gmail.com） | 高 | DONE | Son | 同日完了(d9748bf)。全フォームPOST+新設POST /api/contactをResend通知(from bookings@enchakai.com・reply-to=送信者・フェイルソフトでjsonlにemailSent記録)。RESEND_API_KEYは.mc.envへ追記。Aboutの「連絡窓口準備中」を実フォームに置換。テストメール実送信200・到達確認済。本番/api/contactの必須チェックもSon実測 |
| MC-430 | 店舗ライフサイクルデータ蓄積（開業/閉店/稼働履歴） | 高 | DONE | Son | 同日完了(d9748bf)。snapshot-lifecycle.js=週次同期後の店舗ID差分から開業/閉店候補イベントをdata/history/events.jsonlへ(初回ベースライン15,802店作成済・収録タイミング差ノイズはREADME明記)。sample-occupancy.js=リアルタイム対応店最大50店の空き/使用台数をoccupancy.jsonlへ(初回28店記録)。cron登録済: 日曜7:00差分/毎日8・13・20時サンプリング |
| MC-431 | 地方・全国単位のズームアウト集計表示 | 高 | DONE | Son | Keita指示2026-08-23 00:01「関東、日本単位でズームアウトしたときに数字出して」。同日完了(laundry-jp 1b5a91e・本番反映済)。/api/regions新設で都道府県→8地方＋全国重心をサーバ一元管理し配信(47都道府県ハードコードなし)。zoomTier 5段階化: z<7=全国1ピン/7-8=地方合計/9=都県/10-12=区市町村/13+=店舗。地方ピンは絞込追従・クリックでズームイン。**実画面検証(coinlaundry.tokyo・OpenClawブラウザ)**: 全国=15,802 / 地方8ピン=346,780,9030,1485,1667,682,376,1436(/api/regions一致・合計15,802で全国と整合) / 都県47ピン |
| MC-432 | 地図ズームイン/アウトの動作軽量化 | 高 | DONE | Son | Keita指示2026-08-23 00:01「ズームアウト、インするときに動作が重い」。同日完了(laundry-jp 1b5a91e・本番反映済)。①範囲判定をLatLngBounds.containsから数値bbox比較(getBoundsBox)へ ②ズームアニメ中の再描画をscheduleRenderで短デバウンスに集約し中間段階を描かない ③**gzip圧縮(compression)導入**——/api/stores全件が約19.5MBの生JSONでCloudflare Tunnel経由の初期ロードが事実上停止(40KB/30s)していた真因を特定、gzipで1.75MB(91%減)に。実測描画時間: 全国2.3ms/地方5.1ms/市区町村37ms |
| MC-433 | データソースのGoogle一本化検討（OSM廃止可否） | 高 | TODO | Son | Keita発言2026-08-23 00:01「OpenStreetから持ってくる必要ある？グーグルでいい」。現状OSM単独由来2,248店(全国に分布・Places未クロール地域の穴埋め)。全国Placesクロール費用＋Google規約(恒久保存制限)の論点を整理し決裁へ |
| MC-434 | 反映不具合の修正＋都道府県トグル＋統計情報ページ | 高 | DONE | Son | Keita指示2026-08-23 01:33。同日完了(laundry-jp 801ef77・本番反映済)。①**「反映されない」の真因=キャッシュバスタ未更新**——app.js編集時に index.html の ?v=26 を据え置きにしたため既訪問者が旧app.jsをキャッシュ再利用しMC-431の集計表示が届かず。v=26→27/css v=19→20に更新。②**右下トグルで都道府県レベルも非表示化**——cityBtnの対象をtier2(都県)へ拡大、OFFで店舗ピン表示に切替(全国/地方は常時集計)。実画面検証: OFF@z9で47集計→0(店舗8,523表示)。③**統計情報メニュー新設**——/api/stats(都道府県別/地方別店舗数・cashless等の設備決済対応を「判明分のうち対応」で正直集計)、ドロワー項目+pageStats+日英i18n。実測: 電子決済2,851/判明3,142(91%)・24時間4,486・東京4,159最多。空き状況/口コミは動的取得仕様で構造的に0のため統計から除外(注記明示) |
| MC-435 | 訴求転換・集計トグル全レベル化・統計拡張・運営会社ガイド | 高 | DONE | Son | Keita指示2026-08-23 08:32(9件)。同日完了(laundry-jp a8525a9・本番反映済/cache v28/v21)。①集計トグルを全レベル化(OFFで全国/地方/都県/市区町村の数字を全て隠し店舗クラスタ表示・実測OFF@z5=全国0/15,500店をクラスタ10集約)②ドロワーから「ランドリー代行」削除③オーナーページを課題訴求先行に(集客/清掃/IT化の悩みカード3枚→プランは控えめ見出し下)④独立ページの一括資料請求を各社公式サイトへのリンクカード化(TOSEI/AQUA/山本/ダイワ/Electrolux/WASHハウス)⑤統計にチェーン4,581/個人11,219・ブランド別・規模(機種判明1,578店のみ大中小)追加⑥統計に「主要チェーン・運営会社の特徴」ガイド新設(/api/brands+data/brands.json・調査サブエージェント出典付き=各社特徴/洗剤こだわり/洗濯機メーカー/クーポン/公式サイト/専用アプリ導線)⑦事実訂正: Smart Laundryは TOSEI でなく山本製作所×wash+のIoT(TOSEIは別アプリ「ランドリーDX」)。**残**: 店舗数乖離(2万〜2.5万報道 vs 収録15,802)はソース網羅の穴=未クロールの個人店(→MC-433の全国Placesクロールで埋まる論点)。規模データは90%不明・クーポンは登録0の制約あり |
| MC-436 | ユーザー投稿「行った/おすすめ」（任意で機器数・値段・決済） | 高 | DONE | Son | Keita指示2026-08-23 08:52。同日完了(laundry-jp b991710・本番反映済/cache v29/v22)。店舗詳細に来店投稿UI。**必須=「行った」+「おすすめ/いまいち」の2つのみ**、洗濯機の数・乾燥機の数・値段・キャッシュレスは「詳しく入力(任意)」に折りたたむシンプルUI。backend: POST /api/stores/:id/checkin(visited/recommend必須・数値は範囲クランプ)→data/visits.jsonl追記(個人情報なし・gitignore)、GET .../checkinsで集計(人数・おすすめ率・機器数/値段は中央値)。集計はメモリキャッシュ(投稿時無効化)。詳細に「N人が行った・おすすめP%」+利用者report表示。実画面検証: 投稿→お礼→集計更新、visited欠落400、範囲外null化。検証テストデータは消去し本番count=0クリーン |
| MC-437 | 「AIによる分析」を外部API不使用のローカル生成に | 高 | DONE | Son | Keita指示2026-08-23 09:28「api使わないでやってみて」。同日完了(laundry-jp a5babe9・本番反映済/cache v30)。従来=Google Places API取得→Gemini API要約の2API依存を撤廃。詳細に既にある収録データ(features/pricing/machines/独自スコア/リアルタイム対応/クーポン)からルールベースで良い点・気になる点・要約を同期生成(buildLocalInsights)。見出し「AIによる分析」→「この店の分析」に変更(AI/API非使用のため正直表記)・注記「AI・外部APIは使っていません」明示。server /api/stores/:id/insights は残置だがフロント未使用=非呼出。実画面検証: h24+cashless店で良い点4・気になる点2・要約表示、/insightsリクエスト無しをネットワークで確認 |
| MC-438 | Googleマップ口コミのローカル解析（API不使用） | 高 | DONE | Son | **解消(→MC-439)**: 取得を生Playwrightから OpenClaw ブラウザ方式へ切替で安定取得できたためBLOCKED解除。| Keita指示2026-08-23 09:34「API使わずにグーグルマップの口コミから分析」。仕組みは完成・本番反映(laundry-jp f8cf6a3/cache v31/v23)だが**取得が不安定でBLOCKED・要方針決定**。実装: scripts/build-review-insights.js=Playwright(ヘッドレス=API不使用)で口コミ取得→ローカルのキーワード解析(POS/NEG正規表現)で良い点/気になる点/要約/引用生成→data/review-insights.json蓄積(LLMも不使用)。server GET /api/stores/:id にreviewInsight同梱、front=口コミ解析あれば優先表示(引用+©Google注記)・無ければ設備ベース分析(MC-437)にフォールバック=回帰なし。**制約(実測)**: ヘッドレスのGoogle口コミ取得が不安定、系統バッチで8/8＋都心店1/1がconsent/anti-bot/DOMでblocked(プローブで1回13件取れたが再現せず)・ToSグレー。現状は事実上フォールバック動作。**判断待ち**: ①ベストエフォートのままスクレイプ(現状ほぼ0件) ②Places APIで口コミ取得＋本ローカル解析(AI無し・確実だがAPI少額課金) ③設備ベース(MC-437)のまま |
| MC-439 | 口コミ由来分析をOpenClawブラウザ取得で実現＋提供元注記の削除 | 高 | DONE | Son | Keita指示2026-08-23 10:44「AIは使っていい／従量課金APIは使いたくない／その記載は載せなくていい」。同日完了(laundry-jp a4f8849・本番反映済/cache v32)。①取得を生Playwright(同意/anti-botで0/8)→**OpenClawブラウザ方式**(実プロファイルで同意通過=従量課金APIではない)へ切替、東京ブランド店で安定取得(6/6→20件へ拡充中)。scripts/fetch-reviews-openclaw.js=openclaw browser CLIをexecFileSyncで駆動→ローカルのキーワード解析で良い点/気になる点/要約/引用生成→data/review-insights.json蓄積(サイトは読むだけ・API/LLM都度呼ばない)。②**UIの提供元/手法注記(「AI・外部APIは使っていません」等)を削除**(指示どおり非表示)。③抽出クリーニング(もっと見る/＋N/高評価/絵文字除去)。実画面検証: 口コミ由来の要約・引用・良い点表示・注記なし。口コミ未取得店は設備ベース(MC-437)にフォールバック=回帰なし。review-insights.jsonはgitignore(本番機生成)。残: 全国カバレッジは本番機でバッチ拡充(OpenClawブラウザ逐次のため段階的) |
| MC-440 | 店舗詳細のミニ地図(OSMタイル)を撤去 | 中 | DONE | Son | Keita指示2026-08-23 11:15「OpenStreetMapの画像はいらない」(スクショ=住所欄のミニ地図)。同日完了(laundry-jp 8a49c61・本番反映済/cache v33)。詳細パネル住所欄の#miniMap(Leaflet+OSMタイル小地図)とinitMiniMap呼び出しを撤去、住所テキストは残置(位置はメイン地図/「Googleマップで見る」で足りる)。実画面検証: 住所欄テキストのみ・Leafletミニ地図0 |
| MC-441 | 「Googleマップで見る」リンクを住所欄へ移動 | 中 | DONE | Son | Keita指示2026-08-23 11:17。同日完了(laundry-jp 16a3fed・本番反映済/cache v34)。Google評価行(ヘッダー付近)の「Googleマップで見る」を撤去し詳細の住所欄(ミニ地図撤去後)へ配置。初期は検索URL→評価取得後に正準URL(googleMapsUri/cid付)へ差替え。実画面検証: リンクは住所欄1個のみ・ヘッダー重複消滅 |
| MC-442 | ランキングUIのおしゃれ化 | 中 | DONE | Son | Keita指示2026-08-23 11:55「ランキングのUIをもっとおしゃれに」。同日完了(laundry-jp 5a80f1d・本番反映済/cache v35/v25)。①上位3位をメダル階層化(金/銀/銅グラデバッジ角丸＋左アクセントバー＋淡ティント、4位以降アウトライン円)②スコア強調(20px/800/navy)③軸バーをグラデ化(価格緑/サービス青/設備琥珀/IT化紫)＋角丸＋伸長アニメ④指標タブactiveをnavy→blueグラデ＋影⑤カードhoverで浮上。実画面検証: ライト/ダーク両モード確認(Keitaはダーク利用) |
| MC-439b | 口コミ分析の全面AI化(ロールアウト)＋オーナー返信の加点 | 高 | IN_PROGRESS | Son | Keita「A(全面AI化)」+「オーナー返信もプラス要素」(2026-08-23 12:44/12:51)。取得=OpenClawブラウザ(無料)→生口コミをdata/private/raw-reviews.jsonに保存→**サブエージェント(AI・従量課金APIでない)が口コミ読解**して良い点/気になる点/要約/引用を生成→review-insights.jsonにmethod:ai格納。18店をAI化(計19店)。オーナー返信検出時は「オーナーが口コミに返信しており運営が丁寧」を加点(本文からは返信除去)。実画面検証: いわき泉町店で「羽毛布団でダニ死滅ふかふか」「オーナー返信=丁寧」等の高精度分析を確認。カバレッジ拡大継続中(2026-08-23 Keita「拡大継続して」・ブランド店から順次40件バッチで全国へ) |
| MC-443 | 運営会社ガイドのアプリリンクにAndroid(Google Play)追加 | 中 | DONE | Son | Keita指示2026-08-23 13:12。同日完了(laundry-jp 8f82d24・本番反映済/cache v36)。各社のApp Store/Google Play実在URLを調査しbrands.json更新(WASHハウス/マンマチャオ/Baluko/ピエロ/wash+/Smart Laundryは両OS、ホワイトピア/デポ/LAUNDRICHはアプリ無しnull)。ガイドを「App Store」「Google Play」2ボタン化。実画面検証: 6社で両ストア表示 |
| MC-444 | 「このサイトについて」の内容更新 | 中 | DONE | Son | Keita指示2026-08-23 14:29。同日完了(laundry-jp 5036eb5・本番反映済/cache v37)。目的を首都圏→全国(約15,800店)に更新・比較項目やランキング/統計/口コミ分析に言及、「主な機能」セクション新設(検索/比較/ランキング/統計/口コミ分析/行った投稿/運営会社ガイド)、更新方針を口コミ事前解析(review-insights)の実態に修正。日英とも更新。実画面検証済 |
| MC-445 | 選択店の口コミをその場で取得・分析(オンデマンド) | 高 | DONE | Son | Keita指示2026-08-23 14:39「選択したところをその場で取れない？」。同日完了(laundry-jp b7c10dc・本番反映済/cache v38)。本番(user=dev)がOpenClawブラウザCLI(=従量課金APIでない)を叩けることを利用し、分析未取得の店を開いたら即その場取得。POST /api/stores/:id/fetch-reviews がfetch-reviews-openclaw.js --idを起動→取得→キーワード解析→review-insights.jsonキャッシュ→返却(同時1件制限・既取得は即返し)。フロントは詳細を開いてreviewInsight無ければ自動発火「取得して分析中…」→完了で口コミ由来分析に差替(失敗時は設備ベース)。解析はサーバ側=キーワード(AI読解はバッチで上書き)。実画面検証: 未分析ピエロ店→その場で3件取得→オーナー返信加点等を表示・キャッシュ化。注: 本番はユーザーブラウザとサーバブラウザが別で衝突なし(検証環境のみ共有で衝突) |
| MC-446 | 口コミ要約の日本語修正＋取得中表示を「評判を調べています」に | 中 | DONE | Son | Keita指示2026-08-23 14:55「『高いと。』は日本語おかしい／『評判を調べてます』にして」。同日完了(laundry-jp 8d24123・本番反映済/cache v39)。①キーワード要約の「…一方で料金が高いと。」を「N件の口コミから：良い点は〇〇、気になる点は△△。」の文法形に修正(ラベル末尾と好評/との声/の指摘等を除去)。既存15件もstored pros/consから再計算。AI要約は温存。②オンデマンド取得中表示を「評判を調べています…」に変更(日英)。実画面検証済 |
| MC-447 | 店舗詳細をトリップアドバイザー風に刷新＋評価分裂の明示 | 高 | DONE(一部継続) | Son | Keita指示2026-08-23 15:08「両方書いて・評価が割れてますと書く／店舗詳細がAI丸出し→トリップアドバイザー参考に／全体的にも作り変え」。詳細を完了(laundry-jp e63ee4a・本番反映済/cache v40/v26)。「良い点/気になる点」AIカードを廃止し口コミ・評判セクションへ刷新: バブル評価(5丸TA緑)・クチコミ件数+平均・自然文サマリ・よく挙がる声チップ(👍/👀)・口コミ抜粋カード。評価が割れる論点(料金/清潔さ/乾燥/混雑)をラベルから検出し両論残したうえ「〇〇については評価が分かれています」を明示。ヘッダGoogle評価にもバブル併記。ライト/ダーク検証済。**残(継続)**: 「全体的に」=一覧/検索カード等へのTA意匠展開はKeita確認のうえ順次 |
| MC-448 | ロゴ刷新(design-craft)＋サイト適用＋地図マーカー位置ピン化 | 高 | DONE | Son | Keita指示2026-08-23 15:37〜15:54。同日完了(laundry-jp c017600・本番反映済/cache v27,icon v2)。design-craft工程(Director→Builder→別AI Criticで3案採点=A76/B59/C56)で案A(位置ピン×ドラム)採用→「ドラム洗濯機感」要望でA3(フロントドラム丸窓:白ドア＋ガスケット環＋穴3＋ハブ)に改良。icon.svgに採用しヘッダー/ドロワーにマーク表示・favicon v2。地図の店舗ピン(.icon-pin)を丸+しっぽ→涙型位置ピン(border-radius 50% 50% 50% 0+rotate-45、中アイコンは逆回転で正立)にしロゴと統一。実画面/計算スタイル検証済。残: apple-touch/og PNG再生成・「全体的にTA風」の一覧カード実装(モック提示済/承認待ち MC-447継続) |
| MC-449 | サイト名の接尾辞を表示中の都道府県で動的化(.Chiba等) | 中 | DONE | Son | Keita指示2026-08-23 16:18。同日完了(laundry-jp 6ff6806・本番反映済/cache v41)。ヘッダー「CoinLaundry.Tokyo」の.以降を、地図表示範囲内で最多の都道府県に合わせ動的更新(47都道府県→ローマ字)。契機=usermove(dragend/zoomend)＋初回fetchStores。実画面検証: 千葉.Chiba/大阪.Osaka/福岡.Fukuoka/東京.Tokyo/神奈川.Kanagawa |
| MC-450 | 統計の「掲載都道府県」カード削除→チェーン店に差替 | 低 | DONE | Son | Keita指示2026-08-23 16:32「掲載都道府県はいらない」。同日完了(laundry-jp・本番反映済/cache v42)。統計サマリーの掲載都道府県カードを削除しチェーン店(4,581)に差替(2x2維持)。都道府県別テーブルは残置。モックも同様。実画面検証済 |
| MC-451 | 一覧カードをトリップアドバイザー風に実装(全画面TA化の総仕上げ) | 高 | DONE | Son | Keita指示2026-08-23 16:36「全画面で実装して」。同日完了(laundry-jp 1ec823a・本番反映済/cache v43,v28)。詳細(MC-447)/ランキング(MC-442メダル)/統計(カード)は既TA化のため残る一覧カードを実装: 左サムネ(ブランド色＋洗濯機)＋店名＋料金、エリア/距離メタ、設備をmention風チップ(スマート/クーポン/認証は青系)、空きは緑/琥珀ピル、Google評価順表示時はバブル評価併記。情報過多カード→TA風に。実画面検証63枚。残(将来): 店舗写真・詳細ヒーロー・カテゴリ別評価/評価分布は要データ |
| MC-452 | 店舗サムネをチェーン/個人で出し分け | 中 | DONE | Son | Keita指示2026-08-23「写真はチェーン店だったらチェーン店の画像、個人店だったらコインランドリーのイメージ写真に」。同日完了(laundry-jp 0b10877・本番反映済/cache v44,v29)。server: 各店舗にbrand/brandLabel付与(BRAND_BY_SOURCE)。app.js thumbHtml(): チェーン=ブランド配色タイル+チェーン名(WASHハウス/マンマチャオ/Baluko/ホワイトピア/ピエロ/wash+/デポ)、個人店=汎用コインランドリーのフラットSVG(自作・著作権フリー)。実画面検証: チェーン6/個人57出し分けOK。備考: 実写真はGemini画像生成が課金停止(dunning)で不可・従量API不使用方針のためイラストで対応。詳細ヒーローは要データで未 |
| MC-453 | フォント拡大＋TA参考の総合メディア化(改善12項目) | 高 | IN_PROGRESS | Son | Keita指示2026-08-23「全体的にフォント大きく／TA参考に改善／日本最大級コインランドリー総合メディア」。DONE分(laundry-jp 65ed6cf,837a91f,094196c・本番反映済/cache v47,v33): ①フォント全体+13%(本文15→17px) ②位置づけ=title/meta/OG/about/タグラインを『日本最大級のコインランドリー総合メディア』 ③口コミ本文リスト＋評価分布バー(TA Traveler rating風・server enrichReviewInsightで生レビュー合成) ④お気に入り♡(localStorage・カード/詳細・保存済みトグル) ⑤市内ランクバッジ『🏅◯◯市 N位/M店』(cityRankOf) ⑥パンくず(日本›県›市) ⑦この近くの店舗(半径5km) ⑧詳細CTAスティッキー ⑨設備ピクトグラム。要データ/次段で保留: サブ評価(カテゴリ別=per-review評価なし)・実写真(課金停止)・混雑時間帯(データなし)・Q&A(バックエンド要)・料金比較表(個店価格薄い)・空き台数順(一覧にvacancy無し) |
| MC-454 | コインランドリー ニュースキュレーション | 中 | DONE | Son | Keita指示2026-08-23「コインランドリーのニュースもキュレーションして」。同日完了(laundry-jp 19870d0・本番反映済/cache v48,v34)。総合メディア化の一環。server: Googleニュース無料RSS(『コインランドリー』『ランドリー 出店/開業』)取得→整形/重複排除/日付降順40件、60分TTLメモリキャッシュ＋data/news.json永続化、GET /api/news。client: ドロワー『ニュース』＋pageNewsで記事カード(見出し/媒体/相対日時・外部リンク)。従量API不使用。実画面検証40件表示。備考: 更新はTTL遅延取得(cron不要)、news.jsonはgitignore。UI: Keita指示2026-08-23参考画像(Yahoo!ニュース風)で刷新(5ba1c5d/cache v49,v35)=トップ記事ヒーロー＋見出し左/媒体カラーサムネ右/メタのリスト・NEWバッジ。記事写真はGoogleニュースのリダイレクトで個別取得不可のため媒体カラータイルで代替 → 実写真対応済(Keita指示2026-08-23「実写真にして」・2c86e4b/cache v51,v36): Googleニュースの署名(sg/ts/id)+batchexecuteで実URL復号→og:image抽出(37/40件)、テキスト即返し＋画像は背景enrich(並列5)＋news.json永続、クライアントはポーリングで差替え。ヒーローは画像優先、取得不可は媒体カラータイルにフォールバック |
| MC-455 | 市区町村ピンのタップでズーム＋ランキングTA風刷新 | 中 | DONE | Son | Keita指示2026-08-23「市区町村の数字タップでその地域のコインランドリー(アイコン)を表示」「ランキングのデザインがださい・TripAdvisor(Travelers' Choice)参考に」。同日完了(laundry-jp 39239d3・本番反映済/cache v52,v37)。①市区町村ピンのタップ挙動を統計パネル→その地域へズームイン(PRICE_ALWAYS_ZOOM=13)に変更、個別ランドリーアイコン表示(実挙動zoom11→13で洗濯機ピン63確認)。②ランキングをTravelers' Choice風に刷新: 大順位番号(緑)＋🥇🥈🥉・店名太字＋📍緑ロケ・緑バブル評価＋スコア/100＋Google評価(件の口コミ)・カテゴリバー(価格/サービス/設備/IT化)緑右寄せ数値。③MC-453市内ランクバッジの.rank-badgeクラス衝突を.city-rank-badgeに改名 |
| MC-456 | 評判分析を直近の口コミ10件で行う | 中 | DONE | Son | Keita指示2026-08-23「AIの評判のやつは口コミを直近の10件読み込んで」。同日完了(laundry-jp 0b490c3・本番反映済/cache v53,v38)。fetch-reviews-openclaw.js: 各口コミの相対日付を抽出しrecencyMinutesで新しい順に整列→直近10件に限定して保存・解析。Google Mapsの並べ替えUIクリックは検索ビューでナビゲーション誘発し口コミが消え不安定→読み込んだ口コミを日付ソートする方式に。server: 表示を新しい順維持＋date配信・上限10件。client: 口コミカードに相対日付表示。備考: 既存キャッシュ済42店は多くが口コミ≤10で実質影響なし、再取得(on-demand/バッチ)時に新方式適用 |
| MC-457 | モバイル一覧をドラッグ可能なボトムシート化 | 中 | DONE | Son | Keita指示2026-08-23「この状態(一覧全画面)から戻れないからもっとUIに自由度を高くして」。同日完了(laundry-jp 5804f63・本番反映済/cache v54,v39)。モバイルの一覧を地図の上に重なるボトムシート化: グリップのドラッグで高さ自由調整＋中間/全画面スナップ、下方向ドラッグor「地図」で地図へ戻る。地図が常に上に見え現在地/ピンを見ながら一覧操作可。展開中はFAB隠し。実挙動: 上ドラッグ→全画面/下ドラッグ→クローズ確認。※「最大10件でいいよ」(MC-456)も確認済で追加変更なし |
| MC-458 | プレミアム(ブランド掲載)プラン＋会社ロゴ カスタムアイコン | 中 | DONE | Son | Keita指示2026-08-23「オーナー向けにこのサイトへの広告も入れられるプラン作って。アイコンを会社のアイコンに変えられるとか。サンプルも作った上で。値段も適正に」。同日完了(laundry-jp 7945067・本番反映済/cache v55,v40)。オーナーページに『プレミアム(ブランド掲載)¥19,800/月』追加=会社ロゴを地図ピン/一覧サムネに表示(カスタムアイコン)・地図に常時表示のブランド広告ピン・エリア最上部固定・PR全機能。Before/Afterサンプル(通常ピン→自社ロゴピン)掲載＋お問い合わせ種別追加。実装: data/ad-icons.json(storeId→ロゴ)でadIcon付与→price-pin/icon-pin/カードサムネを会社ロゴに差替。サンプル: 自作img/sample-logo.svgをデモ店mc-160824989546に適用し実挙動確認。価格根拠: スタンダード¥3,300<PR¥9,800<プレミアム¥19,800(税込・単店月額) |
| MC-459 | 軽量アクセス計測を追加 | 低 | DONE | Son | Keita 2026-08-23「アクセスどうなってる？まだないか」。計測が皆無だったため追加(laundry-jp c8288fe・本番反映済/cache v56)。server: POST /api/hit(page＋referrer hostのみ・IP/Cookie不使用・bot正規表現除外)、GET /api/hits(total/today/日次14日/参照元top)。client: 読み込み＋ページ遷移でビーコン。data/hits.jsonl(gitignore)。現状: これまで計測なし＝実訪問ほぼ0(新規・未告知・自分の検証のみ)。今後は/api/hitsで把握可。備考: /api/hitsは公開GET(新規サイトのため許容)・必要なら管理画面化 |
| MC-460 | SEO基盤＋アクセス管理画面（集客の下地） | 中 | DONE | Son | Keita 2026-08-23「全部やろう」(アクセス可視化/CF計測/集客)。同日完了(laundry-jp a035064・本番反映済/cache v57)。①SEO: /store/:id を実URL化しSSRで店舗別title/desc/OGP/JSON-LD(DryCleaningOrLaundry)注入・/robots.txt・/sitemap.xml(15,801URL)・トップにWebSite/Organization JSON-LD＋canonical。SPAアセット絶対パス化(/store配下でapp.js404だったのを修正)・/store着地で該当店自動オープン。②管理画面/admin.html=/api/hits可視化(本日/累計/日次/参照元・noindex)。残(Keita操作要): Google Search Console登録＋sitemap送信(検証メタはplaceholder用意済)、Cloudflare公式アナリティクス(dashboardに既にトラフィックあり・要ログイン)、SNS告知(下書き提示・自動投稿はしない) |
| MC-461 | 集客の自動化（IndexNow送信・GSCはCowork試行） | 中 | IN_PROGRESS | Son | Keita 2026-08-23「Coworkで自動でやって」。①IndexNow(ログイン不要): public/<key>.txt設置＋api.indexnow.orgへトップ+厚い店舗500件通知(laundry-jp a5a5f5d)。初回403(キーファイル検証待ち)→バックグラウンド再送中。scripts/indexnow.mjs再利用可。②Google Search Console: CoworkブラウザのGoogleアカウント(clipitnownet.official@gmail.com)が『Verify it's you』2FA要求で停止＝Keita端末必須(Cowork/Sonはパスワード/2FA自動化しない方針)。要Keita: Cowork画面でGoogle本人確認を通す→以降(プロパティ追加/HTMLタグ検証/sitemap送信)はSonがCowork/CDPで自動化。③SNS: 外部送信はKeita確認必須のため下書きのみ(自動投稿しない)・アカウント要指定 |
