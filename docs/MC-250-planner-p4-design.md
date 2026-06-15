# MC-250 設計書 — オートプランナー P4（優先度の多段化・安定性・集中枠・溢れの扱い）

作成: 2026-06-16 Son（駆動・設計）／Keita 指示「一旦任せるので設計書作って」
前提: MC-245（設計）/ MC-247(P1) / MC-248(P2) / MC-249(P3) は実装・反映済み。
ステータス: DESIGN（要 Keita レビュー → 確定後に実装）

## 0. 背景（競合リサーチの示唆／2026-06-15 deep-research）

世のAIスケジューリング運用を調査した結論（出典は §7）:
- **完全自動リスケ（Motion 等）への最大の不満は「コントロール喪失・予定が予測不能に動く」**（あるユーザーは1日11回組み替え）。逆に手動派（Akiflow 等）は毎回の再計画が負担。
- **王道は「提案→承認→反映」＋安定性（みだりに動かさない）**。我々の P2/P3（提示→承認→書き戻し）はこの正解に既に沿っている＝**この路線を強化する**のが P4。
- Reclaim 流の要点: **多段優先度（P1〜P4、低優先は溢れ＝overbook を許容）**、優先度だけでなく**締切・柔軟性を総合**（締切が近ければ優先度を上書き）、**習慣／集中時間枠を先取り確保**、所要時間・締切・優先度はユーザー入力＋AI補助。
- 空き判定は freebusy（busy の補集合）が王道＝現行設計どおり。

→ P4 のテーマは **「賢く・安定して・人が主導権を持てる」プランナー**。

## 1. ゴール

現行の決定的プランナー（MC-248）に、次の4本柱を足す:
1. **優先度の多段化＋締切との総合判断**（どれを置きどれを溢れさせるかを賢く）
2. **安定性（再プランで“みだりに動かさない”）＋ロック**（コントロール喪失を防ぐ）
3. **集中時間／習慣枠の先取り確保**
4. **未配置（溢れ）の意味づけ**（「正常な後回し」と「締切に間に合わない＝要対応」を分離）

非ゴール: 自動（無確認）リスケは**やらない**（不満の元）。再プランは常にユーザー起点・承認制を維持。

## 2. 現状の土台（変更対象）

- `server/src/plannerEngine.ts` … 決定的配置（(due, priority, est) で整列→最早フィット貪欲）。
- `server/src/plannerEstimate.ts` … 見積り（手動 > AI(claude haiku,キャッシュ) > ヒューリスティック）。priority は high/med/low。
- `server/src/plannerStore.ts` … `PlannerConfig` / `TaskMeta`（estMinutes/priority/preferredDaypart/**splittable**/**locked**/**fixedStartIso** は型に既存・配置では一部未使用）。
- `web/src/views/Schedule.tsx` … プラン提示・登録/クリア・設定モーダル。
- 既定: 稼働 09:00–21:00、blackout 00–07/22–24、dailyMax 480、buffer 15、horizon **14**、defaultTaskMinutes 30。

## 3. 設計（4本柱）

### P4-1. 優先度の多段化＋締切との総合判断
- **優先度を4段**に拡張: `P1 Critical / P2 High / P3 Medium / P4 Low`（現行 high/med/low からの移行マップ: high→P2, med→P3, low→P4。Critical=P1 は手動指定 or 締切超過直前で昇格）。
- **配置スコア = f(締切の切迫度, 優先度段, 柔軟性)**。
  - 締切が近いタスクは**実効優先度を引き上げ**、優先度が低くても先に置く（締切が優先度を上書き）。
  - **P4(Low) は容量が足りなければ溢れさせる（overbook 許容＝置けないのが正常）**。高優先の枠を侵食しない。
- **高優先のための容量確保（任意）**: 1日のうち一定割合を P1/P2 用に温存し、P4 で先に埋め尽くさない（Reclaim の overbook 思想）。config: `reserveHighPriorityRatio`（既定 0＝無効、段階導入）。
- データ: `TaskMeta.priority` を 'P1'|'P2'|'P3'|'P4' に拡張（後方互換: high/med/low も受理しマップ）。AI見積りプロンプトも4段に更新。

### P4-2. 安定性（sticky 再プラン）＋ロック
- **ロック**: `TaskMeta.locked=true` / `fixedStartIso` のブロックは再プランで**絶対に動かさない**（型は既存・エンジンで尊重を徹底）。UI にブロックのロックトグル。
- **着手/承認の自動ロック**: 「カレンダーに登録(apply)」したブロックは以後の再プランで既定ロック扱い（動かさない）。タスク完了でブロック消去（§P4-4 完了連携）。
- **sticky 配置（churn 最小化）**: `/plan` に**前回プラン**(previousBlocks)を渡せるようにし、エンジンは
  1. まだ有効（締切内・衝突なし）な前回ブロックは**その位置を維持**、
  2. 新規/破綻したものだけ再配置する。
  → 「毎回ガラッと変わる」のを防ぐ（コントロール喪失対策の核）。
- UI: 「再プラン」時に *動いたブロック数* を表示（"3件だけ動かしました" 等）＝予測可能性。

### P4-3. 集中時間／習慣枠の先取り
- config に **`focusBlocks`（習慣枠）** を追加: `{ title, daysOfWeek:number[], start:'HH:MM', durationMin, priority }[]`（例: 平日 09:00 から120分のディープワーク）。
- エンジンは**タスク配置の前に focusBlocks を空き時間に確保**（busy 扱いに近いが、深い作業向きの枠としてマーク）。P1/P2 のディープワーク系タスクはこの枠を優先的に使う（`preferredDaypart`/種別と整合）。
- UI: 設定で習慣枠の追加/編集（最小: 1〜2個の定義で可）。

### P4-4. 未配置（溢れ）の意味づけ＋完了連携
- unplaced を**理由カテゴリ**で分離:
  - `deadline-miss`（**締切に間に合わない＝要対応**・赤で強調・先頭表示）
  - `no-capacity`（期間内に空きが無い＝**正常な後回し**・低優先から溢れる・控えめ表示）
  - `no-due-overflow`（期日なしの後回し）
- UI: 「⚠️ 締切に間に合わないN件」を上に目立たせ、低優先の溢れは折りたたみ。
- **完了連携**: タスクが Google Tasks 側で完了 → 対応するプランブロック（plannerTaskId 紐付け）を次回プラン/クリアで除去。apply 済みのカレンダーイベントも完了タスク分は plan-clear 系で消せるよう plannerTaskId で選択削除を追加（任意）。

### P4-5. 原則（維持・明文化）
- **無確認の自動リスケはしない。** 再プランは常にユーザー起点、書き戻しは承認後、変更は最小（sticky）。これが競合の最大不満を回避する我々の設計上の強み。

## 4. データモデル / API 変更
- `PlannerConfig` 追加: `focusBlocks[]`, `reserveHighPriorityRatio`（任意・既定0）。
- `TaskMeta.priority`: 'P1'|'P2'|'P3'|'P4'（旧 high/med/low 後方互換）。
- `POST /api/planner/plan` 入力に `previousBlocks?`（sticky 用）と、出力 unplaced に `category`（deadline-miss/no-capacity/no-due-overflow）と `movedCount`（再プランで動いた数）を追加。
- 既存 `/config`・`/task-meta`・apply/clear はおおむね流用（completion 連携で plannerTaskId 指定削除を足す程度）。

## 5. フェーズ分割（P4 内）
- **P4a**: 未配置のカテゴリ分け＋UI強調（deadline-miss を目立たせる）。＝小さく価値・低リスク。
- **P4b**: ロック徹底＋apply済みの自動ロック＋sticky 再プラン（previousBlocks）＋movedCount 表示。＝安定性の核。
- **P4c**: 優先度4段化＋締切総合スコア＋（任意で高優先容量温存）。
- **P4d**: 集中時間／習慣枠。
- **P4e（任意）**: 完了連携（Google Tasks 完了→ブロック除去）。

## 6. リスク・留意
- 4段優先度の移行は後方互換マップで吸収（既存メタ・AIキャッシュは段階移行）。
- sticky は「前回プランの受け渡し」を要する（クライアント保持 or サーバに直近プラン保存）。サーバ保存にすると単純。
- 習慣枠を busy 扱いにしすぎると一般タスクの空きが減る＝“深い作業向き枠”として柔らかく扱う。
- 完了連携は Google Tasks の完了取得（現在 readonly で取得済み）と plannerTaskId 突合で実現。誤削除防止に plannerManaged タグ＋taskId の二重一致。
- いずれも**承認制・最小変更**を崩さない。

## 7. 出典（競合リサーチ 2026-06-15）
- Reclaim 優先度の仕組み: https://help.reclaim.ai/en/articles/8291694
- Reclaim 自動管理: https://help.reclaim.ai/en/articles/6207587
- Motion 自動スケジューリング: https://www.usemotion.com/help/time-management/auto-scheduling
- Motion vs Akiflow（自動 vs 承認・コントロール喪失の不満）: https://www.morgen.so/blog-posts/akiflow-vs-motion
- Google freebusy API: https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query
- Google カレンダー タスク時間ブロック(2025/11): https://workspaceupdates.googleblog.com/2025/11/

## 8. 起票
- MC-250（本設計・親）。確定後 P4a〜P4e を順次実装（レーン=Apollo/cxo-agent＝ソラ or Son 駆動 subagent）。関連 MC-245/248/249。
