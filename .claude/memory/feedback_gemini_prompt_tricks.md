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
