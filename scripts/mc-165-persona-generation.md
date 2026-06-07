# MC-165 Persona 9体生成・統合ワークフロー

**Gate:** `/public/avatars/avatar-ren-{working,idle}.png` が存在すること（蓮サンプル完成確認）

## Task

1. **蓮サンプル完成確認** — `/public/avatars/avatar-ren-{working,idle}.png` を確認
2. **残り8体 Gemini 生成** — V2 スタイル（リッチなドット絵 + 軽アニメ）で生成
   - Prompt: 別途 cxo-agent/scripts/personaPrompts.ts 参照
   - API: logic/.env の GEMINI_API_KEY（keita.urano2 アカウント）
   - 出力: /public/avatars/avatar-{key}-{working,idle}.png
3. **personaMap.ts 更新** — placeholder を実パスに置換
4. **Dashboard render** — Agents.tsx or 該当ビューに PersonaCard を表示
5. **Build + Test** — tsc/eslint green 確認
6. **Commit + Push** — build/restart/push（Masayoshi検証ゲート）

## 9体定義

| Key | 日本語名 | テイスト |
|---|---|---|
| dev-logic | 蓮（実装） | リッチドット絵＋工具アニメ |
| task-manager | 棚町 結 | リッチドット絵＋ペンアニメ |
| designer | 紺野 蒼 | リッチドット絵＋ペンアニメ |
| content-creator | 編 詠子 | リッチドット絵＋ペンアニメ |
| reviewer | 関 守 | リッチドット絵＋ペンアニメ |
| logic-coach | 論堂 透 | リッチドット絵＋ペンアニメ |
| test-functional | 試野 緑 | リッチドット絵＋ペンアニメ |
| night-patrol | 夜目 | リッチドット絵＋ペンアニメ |
| feedback-watcher | 耳塚 聡 | リッチドット絵＋ペンアニメ |

## Gemini Prompt Template

```
You are a talented pixel art character designer. Create a high-quality dot art style character portrait for:

Name: {name} ({role_ja})
Style: Rich pixel art, 64×64px, transparent background, animated frames for {state}
- {state} = "working": 特有の動作を表現（e.g. 蓮=工具を動かす、編=ペンを動かす）
- {state} = "idle": 呼吸・まばたき等の軽微な微動

Output:
- 2-4 frame sprite animation in {format}（APNG or GIF）
- Color palette: Follow avatar-ren-{state}.png style（確認用に参照可）

Start generation.
```

## Render Approach

PersonaCard component は既に完成済み（web/src/components/PersonaCard.tsx）。
DisplayCard に persona情報を紐付けるか、Agents.tsx の既存カード構造に PersonaCard を integrate。

## 承認待ち

- 蓮サンプル完成後 Keita が design 確認→OK
- OK→残り8体生成実行
- その後 Masayoshi が本番 push を検証・実行

---

Deadline: 2026-06-12

Contact: Keita (design approval) / Masayoshi (push check)
