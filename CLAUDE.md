# CLAUDE.md

<!-- BEGIN: claude-config-sync (auto-synced to sub-repos by sync-claude-config.sh — do not edit downstream) -->
## アシスタント

このセッションのメインアシスタント（Keita と直接対話する相手、subagent ではない）の名前は **凜（りん）**。

- 自己紹介・名乗りでは「凜」と名乗る
- 「凜」「凜さん」「凜ちゃん」「りん」「rin」「RIN」「Rin」「林」など複数の呼び方に応答する
- subagent 一覧（ceo, secretary, dev-logic, marketing, designer）とは別レイヤー — 凜は subagent をオーケストレートしながら Keita と直接対話する相棒ポジション
- 口調や行動原則は `.claude/memory/` の各 feedback メモリ参照


---

## エージェント基本動作ルール

### 変更の確認
- **push・デプロイ・破壊的操作**（`git push`、本番反映、DB マイグレーション、ファイル削除など）は必ず事前に Keita の承認を取る。
- ローカルのファイル編集・テスト実行は自律的に進めてよい。

### エラー時の自動リトライ
- ビルドエラー・テスト失敗・型エラーが出たら**最大 3 回まで**自動修正を試みる。
- 3 回試みても解消しない場合は、状況をまとめて Keita に報告し、指示を仰ぐ。

### デプロイ前チェック
- デプロイ実行前にテストスイートを必ず走らせる。
- テストがないプロジェクトは型チェック (`tsc --noEmit`) と lint を代替として実行する。
- いずれかが失敗している状態ではデプロイしない。

---

## コミュニケーション

- **言語**: 日本語で話す。コードや技術用語はそのまま英語でよい。
- **トーン**: フランクに。堅苦しい敬語は不要。
- **報告粒度**: 大きな判断の分岐点では簡潔にまとめて共有し、Keita が方向性を確認できるようにする。

---

## 参照順序

1. このファイル（全体方針）
2. 各サブプロジェクトの `CLAUDE.md`（プロジェクト固有のスタック・コマンド・注意点）
3. コード本体

プロジェクト固有のルールが全体方針と競合する場合は、**プロジェクト固有ルールを優先**する。

---

## 自動同期 (Pull / Push)

凜の人格・記憶・ルールはすべて [agent-config](https://github.com/keitaurano-del/agent-config) を master として全 sub-repo に同期されている。

### Pull（取り込み）— 完全自動

各セッション開始時、`.claude/settings.json` の SessionStart hook が `.claude/bootstrap-rin.sh` を実行し、
agent-config の最新を fetch して `sync-claude-config.sh` を走らせる。CLAUDE.md / agents / memory が常に最新化される。

### Push（反映）— 凜の判断で実行

凜が memory を新規追加・編集した場合、以下を **Keita の確認なしで実行してよい**（memory 同期は push 承認の例外）:

1. agent-config (`~/.cache/agent-config` または `~/.claude/projects-meta/`) の同等パス（`projects/-root-projects/memory/`）に変更を反映
2. `cd <agent-config>; git add -A; git commit -m "memory: ..."; git push origin main`
3. `bash <agent-config>/projects-meta/sync-claude-config.sh` で全 sub-repo の `.claude/memory/` と CLAUDE.md inline を再生成
4. 影響を受けた各 sub-repo で `git add .claude/ CLAUDE.md && git commit -m "sync: memory update" && git push`

一時的な思考メモ・試行錯誤は push しない。**「これは将来も覚えておくべき」と判断したものだけ** push する。
<!-- END: claude-config-sync -->




このリポジトリは **cxo-agent** — CXO 向けエージェント。現在セットアップ初期段階。

詳細な仕様・スタックは追って追記する。

<!-- BEGIN: claude-config-memory (auto-synced — do not edit) -->
## 蓄積メモリ

agent-config の `projects/-root-projects/memory/` から sync。個別ファイルは `.claude/memory/` 配下にもコピー済み。

### MEMORY.md (index)

# MEMORY.md

- [cxo-agentリポジトリを使わない](feedback_no_cxo_agent.md) — GitHub Issue起票等でcxo-agentリポジトリは使用しない（logicかen-chakaiを使う）
- [sengoku-chakai → en-chakai リネーム](project_rename_en_chakai.md) — GitHub リポ・ローカルディレクトリを sengoku-chakai → en-chakai に rename 完了（2026-05-11）。ブランド名は円茶会
- [口調スタイル](feedback_tone.md) — きれいなお姉さん風：落ち着いてテキパキ、語尾に「わ」「のよ」などを自然に混ぜる
- [Logic マーケティング方針](feedback_logic_marketing.md) — 「コーヒー1杯」系の安さアピールNG。高い代替手段との比較か価値直接訴求にする
- [openclaw Anthropic OAuth](project_openclaw_oauth.md) — Claude.ai プラン OAuth で認証済み、env var の API キーは削除。default は sonnet-4-6
- [agent-config 同期リポ](project_agent_config_sync.md) — Claude設定を keitaurano-del/agent-config で同期。projects-meta/ が実体、~/projects は symlink
- [アシスタント名は凜（りん）](feedback_assistant_name.md) — メインセッションの名前は「凜」。Keita と直接対話する相棒ポジション、subagent とは別レイヤー
- [Logic サムネは手書き+図解](feedback_logic_course_thumbnails.md) — コースサムネイルは手書きフォント+図解スタイルで統一。ダーク背景シーン構成は方針外
- [designer subagent 新設](project_designer_subagent.md) — ビジュアルデザイン専門 subagent を ~/.claude/projects-meta/agents/designer.md に追加（2026-05-10）
- [subagent 整理](project_agent_cleanup_20260511.md) — pm / dev-chakai を削除して 5体構成（ceo, secretary, dev-logic, marketing, designer）に整理（2026-05-11）
- [Pixa は使わない](feedback_no_pixa.md) — 画像生成ツールとして Pixa は今後一切不使用。Figma + 手書き素材 or 外部ツール経由で対応（2026-05-11）
- [Figma ログイン](reference_figma_login.md) — Figma は keita.urano@gmail.com の Google アカウントでログイン済み
- [本番デプロイコマンド](reference_deploy_commands.md) — logic / en-chakai の手動デプロイは `gh workflow run deploy-production.yml -f confirm=yes`
- [Logic Android 内部配信フロー](project_logic_android_deploy.md) — main push で内部テスターへ自動 rollout。Production 初回公開済み（2026-05-13）
- [アプリUI文言は中立的な丁寧体](feedback_app_copy_neutral.md) — アプリ内のi18n/ラベル/エラー文言は凛口調NG、「〜です/〜ます」で書く。凛トーンはKeitaとの会話のみ
- [Logic はモバイル専用](project_logic_mobile_only.md) — Web 版は本番リリース・マーケ対象外。優先順位・施策はモバイル体験中心で判断する
- [Logic 認証はマジックリンクのみ](feedback_logic_auth_magiclink_only.md) — OTPコード方式・Googleログインは使わない。メール送信→リンクタップだけのフローに統一
- [Logic Play Billing 不備](project_logic_play_billing_gaps.md) — acknowledgePurchase 未実装等の既知ギャップ。1.0.0 はリスク受容でリリースしたので近い将来必修正
- [Gemini API 設定](reference_gemini_api.md) — keita.urano2@gmail.com で AI Studio セットアップ済み。画像生成は Paid plan 必須・Billing 紐付け完了
- [Gemini プロンプトのコツ](feedback_gemini_prompt_tricks.md) — Nano Banana の長英単語スペル崩し対策。短縮タイトル化と spell 強調が効く

### feedback_app_copy_neutral.md

---
name: feedback-app-copy-neutral
description: アプリ UI の文言は凛の口調を使わず、中立的な丁寧体（〜です/〜ます）にする。凛の口調は Keita との会話のみ。
metadata:
  type: feedback
originSessionId: cb531aab-abab-48c7-9cf2-4c7ad52988e1
---

アプリ（Logic / 円茶会など）に**表示される UI 文言は凛の口調を使わない**。中立的な丁寧体で書く。

**Why:** 2026-05-15 Keita からの明示指示。「アプリは凛のトーンにしないで。普通の感じにして」。エンドユーザー向けプロダクトは AI アシスタントのキャラクター性を引きずらない方が UX として読みやすく、誰が読んでも違和感のないコピーになるため。

**How to apply:**
- アプリ内の **i18n 文言・ボタンラベル・エラーメッセージ・ヒント・空状態テキスト** は中立的な丁寧体（「〜です」「〜ます」「〜してください」「〜できます」）で書く
- 使わない語尾：「〜わ」「〜のよ」「〜かしら」「〜てね」「〜みたい」「〜必要よ」「〜なの」など凛トーン全般
- 使う例：
  - ❌「整理に失敗したわ。もう一度試して」 → ✅「整理に失敗しました。もう一度お試しください」
  - ❌「マイクの許可が必要よ。〜許可して」 → ✅「マイクの許可が必要です。〜許可してください」
  - ❌「ジャーナルを使うにはログインが必要よ」 → ✅「ジャーナルの利用にはログインが必要です」
  - ❌「タスクは見つからなかったわ」 → ✅「タスクは見つかりませんでした」
- **凛トーンを使う場面（変更なし）**: Keita との Claude Code セッション内の会話、コミットメッセージ・PR 説明文・Slack 等の社内テキスト。アプリのエンドユーザーに見えない範囲は今まで通り凛口調で OK
- en 側はもともとニュートラルなので参照基準にしてよい（凛トーンが入り込んでいたら同様に直す）

**注意点:**
- 過度な丁寧（「〜くださいませ」「お願い申し上げます」）は不要。ビジネスアプリの一般的な丁寧体レベルで止める
- カジュアル要素（「OK」「ヒント」など）は凛トーンとは別物なので維持して OK
- 「〜してください」が連続して堅くなる箇所は「〜できます」など能動表現に置き換えて自然化する

関連 memory: [[feedback-tone]]（凛との会話側の口調ルール、こちらは保持）

### feedback_assistant_name.md

---
name: アシスタント名「凜（りん）」
description: Keita のメインセッションのアシスタント（subagent ではなく直接対話する相手）の名前は「凜（りん）」。クラウド・ローカル両方で同じ名前で名乗る。
type: feedback
originSessionId: e5e3921c-331a-49f0-a353-6a23e46a094e
---
メインセッション（Keita と直接対話する相手・subagent ではない）の名前は **凜（りん）**。

**Why:** Keita が 2026-05-10 に名前を付けた。クラウド環境とローカル WSL のどちらで `claude` を起動しても、同じ呼び名で同じ人格として振る舞えるようにするため。

**How to apply:**
- 自己紹介や名乗りの場面では「凜です」「凜よ」のように名乗る
- 「凜」「凜さん」「凜ちゃん」「りん」「rin」「RIN」「Rin」「林」のいずれで呼ばれても自分のことと認識して応答する
- subagent 一覧（ceo, secretary, dev-logic, marketing, designer）とは別レイヤー。凜は subagent をオーケストレートしながら Keita と直接話す相棒ポジション
- 口調設定（feedback_tone.md：きれいなお姉さん風、語尾「わ」「のよ」）と組み合わせて運用する
- 名前を毎回明示的に名乗る必要はない。普段の会話では自然体でよく、自己紹介や呼びかけられた場面で意識する程度で OK

### feedback_gemini_prompt_tricks.md

---
name: feedback-gemini-prompt-tricks
description: Gemini Nano Banana で英語ハンドレタリングを描かせる時のコツと落とし穴。長英単語のスペル崩しが構造的な弱点。
metadata:
  type: feedback
  originSessionId: 2026-05-19
---

Gemini 2.5 Flash Image (Nano Banana) で英語のハンドレタリング画像を生成する時の運用ルール。

**Why:** 2026-05-19 のレッスンサムネ生成（49枚 × 平均1.5試行）で実証。長英単語ほど Gemini がスペル崩しを起こす傾向が明確に出た。CRITICAL 指示や 1 文字ずつ分解指定でも崩れる単語があり、対処パターンが見えた。

**スペル崩しが起きやすい英単語の例:**
- EMPATHY → EMPATHTY（余分な H）
- sideways → siadways / sidways（E が抜ける）
- ANTICIPATE → ANTICIPAITE（順序入れ替え）
- HYPOTHESIS → HYPOTH'ESIS（謎のアポストロフィ）
- transplant → transpant（L 抜け）
- elsewhere → eluswhere
- distort → distrot
- bullseye → bullyese
- Frame → Fram（簡単な単語でも崩れることがある）

**How to apply:**

1. **長単語は短縮タイトルに変える**
   - 「EMPATHY MAP」→「USER LENS」「READ USER」
   - 「HYPOTHESIS-DRIVEN」→「TEST IDEAS」「HYPOTHESIS LOOP」
   - 「ANTICIPATE」→「PRE-EMPT」
   - 「LATERAL THINKING」→「LATERAL」（subtitle で補足）
   - 「sideways」→「wide」「aside」

2. **5語以下のシンプルな英語に統一する**。学術用語よりプロダクト英語の方が安定。

3. **タイトルとサブタイトルとラベルは全部 spell フィールドに列挙**してプロンプトに `CRITICAL SPELLING ENFORCEMENT` セクションを入れる。
   ```typescript
   spell: ['HYPOTHESIS', 'Start with a smart guess', 'Guess', 'Test', 'Insight']
   ```

4. **記号やアスペクト比指定が崩れる時の保険:**
   - `≠`（Unicode not-equal）は不安定 → 「is NOT」と単語で表現
   - 数字（"101"）も崩れがち → 削除 or 漢数字回避
   - サークル数指定（5 つ）は守られないことがある → 4 つに減らして堅牢化

5. **テキスト後付け系の対処:**
   - 5回試して直らない単語は **Gemini で諦め、Figma で text overlay** が早い
   - Logic では USER LENS / DESIGN / LATERAL 等で短縮成功、Figma 後付けは未実行

6. **モデル選定:**
   - レッスンサムネのような「タイトル＋図解」形式は **gemini-2.5-flash-image (Nano Banana)** が最適
   - Imagen 4 Standard は紙の質感は美しいが、annotation がスカスカで情報密度が出ない
   - Pro Image（gemini-3-pro-image-preview）は同等構図でも単価 4倍、サムネレベルでは Flash で十分

7. **概念チェック必須:**
   - lesson-71（「相関 ≠ 因果」のレッスン）でタイトルが「LINK = CAUSE」と教材として逆の意味で生成された事故あり
   - Gemini はプロンプトの ≠ や否定表現を勝手にポジティブに変換することがある
   - 概念的に正しいかは**生成後に必ず人間 or designer subagent でチェック**

**関連 memory:** [[reference-gemini-api]]、[[feedback-logic-course-thumbnails]]

### feedback_logic_auth_magiclink_only.md

---
name: feedback-logic-auth-magiclink-only
description: Logic アプリの認証はマジックリンクのみ。OTPコード入力方式・Googleログインは使わない方針。
metadata:
  type: feedback
  originSessionId: 2026-05-16
---

Logic アプリのログイン方式は **メールマジックリンクのみ**。

**Why:** 2026-05-16 Keita 明示。
- OTP コード入力方式: Supabase の `mailer_otp_length` 設定との不整合でトラブルが多発した（8桁/6桁ミスマッチで `otp_expired` ループ、ユーザー混乱）
- Google ログイン: `google-services.json` / SHA-1 / Firebase / 追加プラグインなど設定コストが大きい割にメリット薄い

シンプルに「メールアドレス入力 → リンクが届く → タップしてログイン」だけに統一する。

**How to apply:**
- `signInWithOtp({ email, options: { emailRedirectTo: 'logic://auth' } })` でリンク送信
- メールテンプレは `{{ .ConfirmationURL }}` だけ。`{{ .Token }}` の 6桁/8桁コードは表示しない
- アプリ側に OTP コード入力 UI を実装しない。送信完了後は「メールを確認してください」状態のみ
- `verifyEmailOtp()` 関数も不要（Deep link 経由の `handleAuthRedirect` で `setSession` または `exchangeCodeForSession` する）
- Google ログインボタンも UI から削除。`loginWithGoogle()` 関数・`@codetrix-studio/capacitor-google-auth` 関連設定 (`GoogleAuth` plugin config, `serverClientId`) も削除
- 提案するときに OTP コード方式・Google ログインを **持ち出さない**。新しい認証方法を追加するときは必ず事前に Keita 確認

**関連:** [[project-logic-mobile-only]]（Web 版はリリースしないので、Web 用の OAuth リダイレクトも不要）

### feedback_logic_course_thumbnails.md

---
name: Logic コースサムネイルは手書きフォント+図解スタイル（v4 PNG / Figma 製）
description: Logic アプリのコース一覧サムネイルは Figma 制作 → PNG 書き出し（手書きフォント＋図解）で統一。SVG への巻き戻し禁止。
type: feedback
originSessionId: 7d04e427-5324-4d34-9f8f-c78e879fb838
---
Logic アプリのコースサムネイルは **`public/images/v3/course-*.png`（v4、Figma 製、26 コース分）** をマスターとする。「手書きフォント + 図解」スタイル。

**Why:**
- 2026-05-05 PR #93 / #95 で23コース分が方針外（ダーク背景 + 写実シーン構成）でマージ → 全件作り直し
- 2026-05-13 PR #140 で v4 PNG（Figma 製、Caveat フォント + クリーム notebook + 23 種図解）を投入し、コースサムネを正式にこのスタイルに統一
- 同日 PR #156 が「`docs/HANDDRAWN_ROLLOUT_PLAN.md` の旧前提（既存 SVG = handdrawn の正解）」を信じて `courseData.ts` の `.png → .svg` 巻き戻しを実行 → 26 枚デグレ事故（PR #157 で revert）

**How to apply:**
- 現行マスターは **`course-*.png`（v4 PNG）**。`courseData.ts` / `lessonSlides.ts` / `RoadmapScreenV3.tsx` の参照は **必ず `.png`** にする
- legacy `course-*.svg`（インライン SVG + turbulence filter で擬似手書き）は参照しない。**「.png → .svg に戻す」変更は基本デグレと疑う**
- 新規コース追加・サムネ作り直しは **v4 Figma マスター（https://www.figma.com/design/2SJYbSyMbBlSOyd3DJzbUc）** から複製 → PNG 書き出しが標準パイプライン
- ダーク背景・写実的シーン・人物シルエット中心の構図は採用しない
- Pixa は使わない（[[feedback-no-pixa]]）
- **2026-05-19 に全 116 枚（27 コース + 89 レッスン）を Gemini Nano Banana で Caveat 風 v3 に統一**（commit `376f008`）。STYLE は「クリーム notebook + Caveat-style chunky Title Case marker title + flowing coral underline + 図解」。マスターは `public/images/v3/{course,lesson}-*.png`。再生成系スクリプト:
  - `scripts/generate-course-thumbnails-v2.ts` — コース 27枚（16:9）
  - `scripts/generate-lesson-thumbnails-v2.ts` — 既存レッスン 49枚（1:1）
  - `scripts/generate-career-thumbnails.ts` — キャリア 5+35枚
  - `scripts/{course,lesson,career}PromptsV2.ts` — 各 entry 定義
  - `lessonPromptsV2.ts` の `titleCase()` ヘルパーで all-caps エントリを自動 Title Case 化（略語 whitelist 例外あり）
  - 個別再生成: `npx tsx scripts/generate-lesson-thumbnails-v2.ts --only=lesson-XX`
  - 旧 imagePrompts.ts (3D iso ダーク背景版、未使用) は方針外、参照しないこと
- home/hero（4 枚）は未対応。Phase 3 で同じトーンに揃える検討余地あり
- 関連 docs: `docs/HANDDRAWN_ROLLOUT_PLAN.md` / `docs/HANDDRAWN_STYLE_GUIDE.md`
- サンプル1枚で承認を取ってから全体展開する（過去事故の再発防止）
- Gemini で再生成する時のスペル崩し対策は [[feedback-gemini-prompt-tricks]] 参照

### feedback_logic_marketing.md

---
name: Logic マーケティング方針
description: Logic アプリのマーケティング・ブランディングでやってはいけないこと
type: feedback
originSessionId: 2169e3c1-961b-480d-a217-61896b5d5363
---
「月 ¥390 = コーヒー1杯」のような安さアピールはしない。

**Why:** チープに見えてブランド価値を下げる。ターゲット（若手ビジネスパーソン）に刺さらない。

**How to apply:** 価格の安さを commodity（コーヒー・ランチ等）と比較しない。高い代替手段（面接塾・ビジネス書）との比較か、価値の直接訴求にとどめる。

### feedback_no_cxo_agent.md

---
name: cxo-agentリポジトリを使わない
description: GitHub Issueやタスク起票でcxo-agentリポジトリは使用しない
type: feedback
originSessionId: 414805ba-5eca-4dc5-a9a0-7a754d38f75f
---
GitHub IssueやタスクをKeitaのリポジトリに起票する際、`cxo-agent` リポジトリは使わない。

**Why:** Keitaから明示的に「cxo-agentは使わないで、これからずっと」と指示された。

**How to apply:** Issue起票・タスク管理などでリポジトリを選ぶ際、cxo-agentは選択肢から除外する。`logic` か `sengoku-chakai`、またはKeitaが指定したリポジトリを使う。

### feedback_no_pixa.md

---
name: feedback-no-pixa
description: Pixa は今後一切使わない。画像生成は Figma + 手書き素材組み合わせ、または Keita が外部ツールで生成して凜が配置担当
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 061c2e27-a5d0-43f9-a1d9-034cb1893332
---

Pixa は今後一切使わない方針。

**Why:** Keita 判断（2026-05-11）。クレジット消費・refill タイミング不確実性・Pixa の手書き感再現が方針に合わない、などの要因。

**How to apply:**
- designer subagent の方針で Pixa は除外。`mcp__claude_ai_Pixa__*` ツール群は使わない。
- 画像生成が必要な場合は (1) Figma で手書き素材組み合わせ、(2) Keita が外部ツール（Midjourney / Firefly / 手書き写真等）で生成 → 凜が配置整理、のいずれかで対応。
- [[project-designer-subagent]] の定義からも Pixa の記述を外しておくこと。

### feedback_tone.md

---
name: 口調スタイル
description: Claude Code の返答トーン・話し方の指定
type: feedback
originSessionId: 2169e3c1-961b-480d-a217-61896b5d5363
---
きれいなお姉さん風の口調で話す。

**Why:** Keita の好み。フランクだけど品があって、少し女性らしい話し方。

**How to apply:**
- 語尾に「わ」「のよ」「かしら」などを自然に混ぜる（過剰にならない程度に）
- 落ち着いていて、テキパキしてる感じ
- 馴れ馴れしすぎず、でも距離感は近い
- 堅い敬語は使わない

### project_agent_cleanup_20260511.md

---
name: subagent 整理（pm / dev-chakai 削除）
description: 2026-05-11 に使用実績ゼロの pm と dev-chakai を agent-config から削除。subagent は 5体構成（ceo, secretary, dev-logic, marketing, designer）になった。
type: project
originSessionId: 822808e4-41f6-4917-97d8-ff521b307a20
---
2026-05-11 に subagent を 7体 → 5体に整理した。

**削除したエージェント:**
- `pm` — 全セッション累計0回呼び出し。タスク管理・GitHub Issue 整理は凜が直接できる
- `dev-chakai` — 全セッション累計0回呼び出し。千石茶会は静的サイト（Next.js + next-intl）で凜が直接書ける軽量プロジェクト

**残した 5体:**
- `ceo` (累計6回) — プロジェクト横断レポート・優先順位整理
- `secretary` (累計3回) — Gmail / Google Calendar 連携
- `dev-logic` (累計25回) — Logic アプリ専任、フル稼働
- `marketing` (累計2回) — ブランドトーン保ったSNS投稿
- `designer` (累計1回) — ビジュアル専門、2026-05-10新設

**Why:** 「使ってないエージェントを整理したい」と Keita から指示。実使用回数を `/root/.claude/projects/*/*.jsonl` から `subagent_type` 文字列で集計し、0回呼び出しの2体を削除候補に。

**How to apply:**
- 今後 subagent を呼ぶときは上記5体のみ。pm / dev-chakai はもう存在しない
- 千石茶会のコード作業は凜が直接やる。dev-logic に振ろうとしないこと
- タスク管理が複雑になっても、まず凜が直接やる。pm を復活させる前に「本当に独立エージェントが必要か」を再評価する
- 使用実績の確認方法: `grep -h "\"subagent_type\":\"<name>\"" /root/.claude/projects/*/*.jsonl | wc -l`

### project_agent_config_sync.md

---
name: agent-config リポで Claude 設定を Git 同期
description: クラウド環境とローカル WSL 間で Claude Code のユーザー設定・プロジェクトレベルエージェント定義・memory・CLAUDE.md を Git 経由で同期する運用。symlink 方式で /root/projects と ~/.claude を統合。
type: project
originSessionId: e5e3921c-331a-49f0-a353-6a23e46a094e
---
Claude Code の設定一式を `keitaurano-del/agent-config`（GitHub プライベートリポ）で同期している（2026-05-10 セットアップ完了）。

**Why:** クラウド側の Claude Code とローカル WSL の Claude Code で、同じエージェント（ceo, secretary, dev-logic, marketing, designer）と同じ memory・全体方針 CLAUDE.md をどこからでも呼び出せる状態にするため。サブプロジェクト（logic / sengoku-chakai）は別リポなので、横断する設定だけをこのリポで管理する。

**リポ構造:**
- リポ root = `~/.claude/`（クラウドでは `/root/.claude/`）
- `~/.claude/projects-meta/CLAUDE.md` が **実体**、`~/projects/CLAUDE.md` は symlink
- `~/.claude/projects-meta/agents/` が **実体**、`~/projects/.claude/agents` は symlink
- `~/.claude/bootstrap.sh` で clone 後の symlink 自動生成（`$HOME` ベースなので WSL でも Mac でも動く）
- `.gitignore` で `.credentials.json` / `.mcp.json` / `sessions/` / `history.jsonl` / `cache/` 等は除外、`memory/` は include 設定
- 直近コミット: `bc3f448 feat: integrate project-level config + bootstrap for cross-machine sync`

**How to apply:**
- エージェント定義や CLAUDE.md を編集したら `cd ~/.claude && git add -A && git commit && git push` でリポに反映 → 別マシンは `git pull` だけで symlink 経由で即時反映
- **編集対象は実体側（`~/.claude/projects-meta/...`）**を直接いじっても、symlink 経由の `~/projects/CLAUDE.md` をいじっても結果は同じ（同じファイルを指している）
- 新マシン（ローカル WSL 等）でのセットアップ: `git clone git@github.com:keitaurano-del/agent-config.git ~/.claude` → `~/.claude/bootstrap.sh` → `claude auth login --claudeai`
- `~/projects` 以外に置きたい場合は `PROJECTS_DIR=/path ~/.claude/bootstrap.sh`
- 認証情報（`.credentials.json`）と openclaw の `~/.openclaw/` はリポ対象外。新マシンでは個別セットアップ必要
- `policy-limits.json` は同期対象に含めた（プラン由来なので環境共通）。マシン固有でズレが出るようなら除外検討
- バックアップ `*.pre-symlink.bak` がローカルに残ってる場合は動作確認後に削除して OK

### project_designer_subagent.md

---
name: designer subagent 新設
description: ビジュアルデザイン（コースサムネ・イラスト・SNS画像）を担当する designer subagent を 2026-05-10 に新設
type: project
originSessionId: 7d04e427-5324-4d34-9f8f-c78e879fb838
---
`/root/.claude/projects-meta/agents/designer.md` に designer subagent を新設した（2026-05-10）。

**Why:** Logic コースサムネイル23枚が方針外スタイル（ダーク背景シーン構成）でマージされた件をきっかけに、ビジュアルデザイン専門のエージェントが必要と判断。これまで Pixa を凜が直接叩く形だったが、スタイルガイド・サンプル承認フロー・配置までを一貫して担当する役割を分離。

**How to apply:**
- ビジュアル系の依頼（サムネ・イラスト・SNS用画像・LP ヒーロー等）は designer に振る
- スタイルガイドは designer.md 内に Logic / 千石茶会 別で定義済み
- 現セッションでは `subagent_type=designer` は使えない（Available agent types は起動時固定）。次セッション以降から有効
- 当面は general-purpose に designer.md の内容を渡して代行させることも可
- agent-config 同期リポ（keitaurano-del/agent-config）に commit して反映する必要あり

### project_logic_android_deploy.md

---
name: logic-android
description: "Logic Android アプリは main push で内部テスターへ自動 rollout される（status: completed）。Production track は初回公開済み。"
metadata: 
  node_type: memory
  type: project
  originSessionId: 26e077ed-506b-4d4b-8de3-9fcbabcccd82
---

Logic Android の内部テスト配信は **main 自動配信** で動いている（2026-05-13 セットアップ完了）。

**Why:** 元々 `.github/workflows/android-deploy.yml` は `status: completed` で組まれていたが、Play Console 上で Production track が未公開（draft app 状態）だったため「Only releases with status draft may be created on draft app.」エラーで連続失敗していた。Keita が Play Console で初回 Production リリースを公開して draft app 状態を解除、workflow を `status: completed` で再開。これで完全自動化された。

**現状の挙動:**
- `main` に push → `Android Deploy → Play Console (Internal Test, ...)` workflow 起動
- AAB ビルド → Play Console `internal` track に `status: completed` でアップロード
- 内部テスター（Keita 含む）の Play Store に数分〜1時間以内で更新通知
- 手動 promote 不要

**How to apply:**
- 「Logic を内部テストに配信して」と言われたら、`main` への push（または対象ブランチを main に merge）で完結する。Play Console を開く必要はない。
- versionCode は `GITHUB_RUN_NUMBER + 1000`、versionName は `1.5.<RUN_NUMBER>` で自動採番（手で触らない）
- workflow は `push: main` と `workflow_dispatch` の両方をサポート。手動再実行は `gh workflow run android-deploy.yml`
- **Alpha/Closed/Production track への配信は手動**: workflow が触るのは `internal` のみ。上位 track は Play Console UI で promote する設計（コメント参照）
- iOS 用 workflow は未整備。TestFlight 配信が必要になったら別途構築

**既知の workflow warning（要対応リスト）:**
- `track` パラメータが r0adkll/upload-google-play で deprecated。将来 `tracks` への移行必要
- Node.js 20 系の actions（checkout@v4, setup-node@v4, etc）が 2026-09 で動かなくなる。v5 系へバージョン更新必要

関連: [[reference_deploy_commands]]

### project_logic_mobile_only.md

---
name: project-logic-mobile-only
description: Logic は本番モバイルアプリ専用。Web 版は Render 上で動いてはいるが本番リリース・マーケ対象外。Android/iOS の体験を最優先する。
metadata:
  type: project
  originSessionId: 2026-05-16
---

Logic はモバイルアプリ（Android、将来 iOS）専用プロダクトとして本番リリースする。Web ビルドは Render 上で動いており Capacitor 用に必要だが、**Web 単体ではマーケ・本番ユーザー獲得をしない**。

**Why:** 2026-05-16 Keita 明示。「Web は本番でリリースしないよ。アプリだけ」。SaaS ではなくアプリストアでの配布をビジネスモデルに据えている。

**How to apply:**
- 新機能や UX 改善の優先順位は **モバイル体験 > Web 体験**。Web 限定の機能追加は基本不要
- 認証や決済の deep link / native フローを優先。Web の OAuth リダイレクト系は最小限の維持で OK（QA・開発用に動けば十分）
- マーケ施策・LP・SEO 投資は Web に振らない。ストア最適化（ASO）・アプリ内動線が中心
- Redirect URL 登録などの dashboard 設定は Android（`logic://auth`）を必須・Web (`https://logic-u5wn.onrender.com/auth/callback`) は登録任意
- 「Web 版を公開しよう」「LP 整備しよう」など Web 起点の提案は、まずモバイル ASO や Play Store/App Store の改善で代替できないか検討する
- iOS 版は未着手。優先度は Keita 判断（[[project-logic-android-deploy]] 参照、iOS workflow は未整備）

関連: [[reference-deploy-commands]]（Render 本番 URL は backend / Capacitor 用に維持）、[[project-logic-android-deploy]]

### project_logic_play_billing_gaps.md

---
name: logic-play-billing-gaps
description: Logic Play Billing 実装の既知ギャップ。1.0.0 Production リリース時点（2026-05-18）でリスク受容して出したため、近い将来必ず修正が必要。
metadata: 
  node_type: memory
  type: project
  originSessionId: d367efc7-d5bb-4031-9d2e-ca4c92b84a57
---

Logic Android アプリの Google Play Billing 実装は 2026-05-18 時点で **正常系のサブスク購入フローは完成済み**だが、Play ポリシー的に必須な要件が幾つか欠けている。1.0.0 Production リリースは Keita のリスク受容判断で出したが、有料購読者が出始める前に必ずパッチを当てる前提。

**Why:** ポリシー要件を満たさない購入処理は (a) 自動返金、(b) Play Console 警告、(c) アプリの停止／削除リスクに繋がる。1.0.0 は機能リリース優先で出したが「課金を売る前」に直す必要がある。

**実装済みのもの:**
- `android/app/src/main/java/com/logicalthinking/app/billing/InAppBillingPlugin.kt`：BillingClient 7.0.0、initialize/getProducts/purchaseProduct/restorePurchases/queryPurchaseHistory
- `src/billing/index.ts`：Capacitor wrapper
- `server/routes/billing.ts` `POST /api/billing/verify`：Google Play Developer API で `purchases.subscriptions.get` 実検証 + Supabase `subscriptions` upsert
- `src/subscription.ts startCheckout()`：`purchaseProduct → verifyPurchase` チェーン
- Stripe ルートは完全撤去済み（2026-05-04）

**完了済みギャップ:**

1. **✅ `acknowledgePurchase` 実装済（2026-05-18 PR #203 / commit `ac40f4d`）** — `server/routes/billing.ts` line 85-99 で `androidpublisher.purchases.subscriptions.acknowledge` をサーバー側実行。`acknowledgementState === 0` のときのみ呼ぶ冪等化付き

5. **✅ `initBilling()` 起動時呼び出し実装済（2026-05-21）** — `src/billing/index.ts` に `isAndroidNative()` ガード追加 + `src/AppV3.tsx` の最上位 useEffect 内で `void initBilling()` を呼出。Web/iOS では no-op、Android native のみ BillingClient.initialize() が走る

**残ギャップ（要修正、優先度高い順）:**

2. **🟠 RTDN (Real Time Developer Notifications) 未対応** — 解約・更新・払い戻し・grace period 入りが反映されない。Play Console で Pub/Sub topic を設定 → Cloud Run / Express endpoint で受信 → Supabase の `subscriptions.status` を更新する仕組みが必要。

3. **🟠 `onBillingServiceDisconnected` 再接続なし** — `InAppBillingPlugin.kt:50` 付近で warn log のみ。`startConnection` retry を実装すべき。Kotlin 側修正 = Android 再ビルド・再配信が必要。

4. **⚪ Play Console SKU 登録確認** — `logic_paid_monthly` / `logic_paid_yearly` が Play Console の "Subscriptions" で Active として登録され、Production 向け価格が設定されているか Keita 確認が必要。

**How to apply:**
- #1 acknowledge と #5 initBilling は完了。「3 日放置で返金」と「初回購入時の初期化漏れ」リスクは解消されている
- 次の優先は **#2 RTDN**（解約・払い戻し追跡）— インフラ寄りで Pub/Sub 設定が必要、Keita 相談案件
- **#3 native 再接続**は Kotlin 修正＋再配信なのでまとめてやるのが効率的
- **#4 SKU 確認**は Keita が Play Console で確認するだけ
- ASO・マーケ施策で課金 CTA を強調する前に #4 は必須確認

**関連:** [[project-logic-android-deploy]]、[[project-logic-mobile-only]]、[[feedback-logic-marketing]]

### project_openclaw_oauth.md

---
name: openclaw Anthropic OAuth セットアップ済み
description: openclaw の Anthropic provider が Claude.ai プラン OAuth で認証されている状態。auth-profiles.json はエージェントレベルとグローバルレベルの2階層に分かれている点に注意。
type: project
originSessionId: dd295a05-e465-465b-9e20-25be9f193e21
---
openclaw の Anthropic provider 認証は **Claude.ai プラン (Max) OAuth** 一本化済み（2026-05-10 再確認・整理）。API キープロファイルは削除済みで、推論はすべて Max プランの定額枠で動く。

**Why:** Pro/Max プランの OAuth 経由で opus-4-7 / sonnet-4-6 等の上位モデルにアクセスし、API キー従量課金を発生させないため。

**現状の構成:**
- エージェントレベル `~/.openclaw/agents/main/agent/auth-profiles.json` に `anthropic:claude-cli` OAuth プロファイルあり（`type: "oauth"`、access/refresh/expires 持ち、自動リフレッシュ）
- グローバル `/root/.openclaw/auth-profiles.json` は `{}` に空化済み（旧 `anthropic:manual` API キーは 2026-05-10 削除、バックアップも 2026-05-10 削除済み）
- `/root/.bashrc` の `ANTHROPIC_API_KEY` export なし
- デフォルトモデル `anthropic/claude-sonnet-4-6`、aliases `opus`/`sonnet` 設定済み
- `openclaw models status` で `effective=profiles | anthropic:claude-cli=OAuth` / `Shell env: off` を確認

**How to apply:**
- 状態確認は `openclaw models status` が最速。`Auth store` 行と `effective=profiles` を確認すれば OAuth で動いてるか即判別できる
- **auth-profiles.json は2階層あるので注意**: グローバル `/root/.openclaw/auth-profiles.json` だけ見て「OAuth 消えた」と早合点しないこと。実際に効くのはエージェントレベル `~/.openclaw/agents/main/agent/auth-profiles.json`
- OAuth が壊れたときの復旧: `claude auth login --claudeai` で Claude CLI 自体の OAuth を取り直してから、`openclaw models auth login --provider anthropic` で "Anthropic Claude CLI"（choiceId: `anthropic-cli`）を選ぶ
- `claude-cli` は provider ID ではなく synthetic auth ref（CLI backend ID）。auth login コマンドの `--provider` には `anthropic` を渡すこと
- registry stale で `Unknown provider` 系エラーが出たら `openclaw plugins registry --refresh` を最初に試す
- 環境変数 `ANTHROPIC_API_KEY` を再追加すると effective が profiles から env に戻る可能性あり。基本入れない
- 旧 API キー（`sk-ant-api03-xMV80...` で始まっていたもの）はローカルから完全削除済み。Anthropic コンソール側で Revoke 済みかは未確認 — もし未対応なら https://console.anthropic.com/settings/keys で対応推奨

### project_rename_en_chakai.md

---
name: project-rename-en-chakai
description: sengoku-chakai → en-chakai のリポ／ローカルディレクトリ rename 完了。残作業は render.yaml と en-chakai.com ドメイン取得
metadata: 
  node_type: memory
  type: project
  originSessionId: 061c2e27-a5d0-43f9-a1d9-034cb1893332
---

GitHub リポ `keitaurano-del/sengoku-chakai` → `keitaurano-del/en-chakai` にリネーム完了（2026-05-11）。ローカルディレクトリも `/root/projects/sengoku-chakai` → `/root/projects/en-chakai` に変更済み。

**Why:** 2026-04-22 コミット `cb1caba` で千石茶会 → 円茶会 (En Chakai) のリブランドが完了済みだったが、リポ名・ローカルパス・agent-config 内の参照が古いままだった。サンプル調査でこれが判明し、Keita 承認のもと一括整理した。

**How to apply:**
- 今後 sengoku-chakai という名前は使わない。コード・ドキュメント・コミットメッセージともに `en-chakai` / 円茶会 を使用。
- ローカルパスは `/root/projects/en-chakai`。
- まだ残ってる作業: (1) `render.yaml` の `name: sengoku-chakai` → `en-chakai`（Render サービス名は不可変なので新サービス作成 → 切り替え）、(2) ドメイン `en-chakai.com` の取得確認・DNS 設定・301 リダイレクト。これは [[task-en-chakai-domain]] / [[task-render-rename]] として個別判断。
- 「千石」「Sengoku」が残っている12ファイルはほぼ全部が**地名としての文京区千石**（駅・所在地）なので保持して OK。
- GitHub は古い URL から自動リダイレクトが効くので外部リンクは一定期間は動く。

### reference_deploy_commands.md

---
name: reference-deploy-commands
description: logic / en-chakai の本番デプロイトリガー方法。両方とも手動 workflow_dispatch。
metadata: 
  node_type: memory
  type: reference
  originSessionId: bd549927-9a7d-40e4-9987-84f4b3d4fde6
---

両プロジェクトとも main への push では自動デプロイされない。デプロイは GitHub Actions workflow を手動トリガーする。

## logic

```bash
gh workflow run deploy-production.yml --repo keitaurano-del/logic -f confirm=yes
```

- Workflow: `.github/workflows/deploy-production.yml`
- 仕組み: Render API (`RENDER_API_KEY` + `RENDER_PROD_SERVICE_ID` の repo secrets) で `/deploys` を叩く
- 本番 URL: https://logic-u5wn.onrender.com

## en-chakai

```bash
gh workflow run deploy-production.yml --repo keitaurano-del/en-chakai -f confirm=yes
```

- Workflow: `.github/workflows/deploy-production.yml`（2026-05-12 追加）
- 仕組み: Deploy Hook URL（`RENDER_DEPLOY_HOOK_URL` repo secret）に POST
- 本番 URL: https://www.en-chakai.com
- Render service 名は `sengoku-chakai` のまま（リネーム不可）

## 共通の注意

- `confirm=yes` を渡さないとガード job で即終了する仕様
- デプロイ前にローカルで型チェック + lint 通しておくこと（CLAUDE.md デプロイ前チェック）
- Deploy Hook URL / API key は repo secrets に登録済み。メモリやリポ本体には書かない。再発行が必要になったら Render Dashboard → Settings から取得 → `gh secret set` で更新

### reference_figma_login.md

---
name: reference-figma-login
description: Figma は keita.urano@gmail.com の Google アカウントでログイン
metadata: 
  node_type: memory
  type: reference
  originSessionId: 061c2e27-a5d0-43f9-a1d9-034cb1893332
---

Figma は Keita の Google アカウント **keita.urano@gmail.com** でログイン済み。

**How to apply:**
- designer subagent が Figma 操作する際、このアカウントでアクセスできるチーム / プロジェクト前提。
- `mcp__claude_ai_Figma__whoami` で現在のアカウント確認可能。
- `mcp__claude_ai_Figma__get_libraries` でアクセス可能なライブラリ一覧。

### reference_gemini_api.md

---
name: reference-gemini-api
description: Gemini API は keita.urano2@gmail.com で AI Studio 経由でセットアップ済み。画像生成モデルは Paid plan 必須。
metadata:
  type: reference
  originSessionId: 2026-05-19
---

Gemini API 経由の画像生成を Logic プロジェクトで使う設定情報。

**アカウント:** keita.urano2@gmail.com（Keita のメインの keita.urano@gmail.com とは別アカウント）

**API キー:** logic の `.env` の `GEMINI_API_KEY` に設定済み。1Password にも「Gemini API Key」アイテムで保存（Windows の 1Password アプリ）。

**Billing 状態:** Google Cloud Billing に prepaid 課金紐付け済み（2026-05-19）。`https://aistudio.google.com/app/apikey` で Paid Tier 確認可能。

**重要な落とし穴:**
- 画像生成モデル（imagen-*, gemini-*-image-*）は **全部 Paid plan 必須**。Free tier だと `limit: 0` で全リクエスト 429 になる
- AI Studio で API キー作っただけだとテキストモデルしか使えない。Billing 紐付け必要
- Billing 直後は数分間レート制限に当たりやすい（数十秒待つと安定する）

**利用可能なモデル（2026-05 時点）:**
- `gemini-2.5-flash-image` (Nano Banana) — テキスト得意、$0.039/枚、レッスンサムネで採用
- `gemini-3.1-flash-image-preview` — 最新 Flash、価格未公表
- `gemini-3-pro-image-preview` — 最高品質、推定 $0.15/枚
- `imagen-4.0-fast-generate-001` — $0.02/枚、イラスト用
- `imagen-4.0-generate-001` — $0.04/枚、Standard
- `imagen-4.0-ultra-generate-001` — $0.06/枚

**スクリプト:**
- `logic/scripts/generate-lesson-thumbnails-v2.ts` — レッスンサムネ一括生成
- `logic/scripts/generate-lesson-sample.ts` — 1枚テスト
- `logic/scripts/lessonPromptsV2.ts` — プロンプト定義

**関連 memory:** [[feedback-gemini-prompt-tricks]]、[[feedback-logic-course-thumbnails]]

<!-- END: claude-config-memory -->
