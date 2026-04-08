# Apollo Mansion redesign — harness 統合版

2026-04-08。Logic 側で Planner/Generator/Evaluator + 5 CXO subagents の harness を導入したことに伴い、Apollo Mansion の役割を再定義した。

## 何が変わったか

| | 旧 | 新 |
|---|---|---|
| アーキ | Flask 1 ファイル (1,900 行) に HTML/CSS/JS 全部 inline | Flask = API only (978 行)、frontend は `static/` の素 ES module |
| エントリ | `app.py:440 return HTML_CONTENT` | `send_from_directory(STATIC_DIR, "index.html")` |
| ビルド | なし (HTML_CONTENT 文字列) | なし (素 JS。npm/vite 不要) |
| 見た目 | light blue CEO panel + 4色 CXO カード | Editorial Journal (Shippori Mincho + 朱 #C84B31 + paper #F6F2EA)、CXO は枠線スタイルで識別 |
| タブ | 円卓 / デザイン / 事業計画 | **円卓 / 書庫 / 書斎** |

### タブの中身
- **円卓**: 議題入力 → SSE で `/roundtable` → Phase 1/2 timeline。5 CXO カードはストロークだけで識別 (実線/破線/二重線/点線/朱縦罫)
- **書庫**: `/api/knowledge/<agent>` を read-only で閲覧。ピン留めとそれ以外を分離表示
- **書斎**: 円卓セッションを Logic harness の `active.md` フォーマットに変換、コピー/ダウンロード

## harness との関係

Apollo Mansion の `/roundtable` SSE と harness の `~/.claude/agents/cxo-roundtable.md` は **同じ knowledge/*.json を共有**。Apollo Mansion は「人間が議論を可視化・育成する場」、harness は「Logic Planner が裏で戦略相談する場」として役割分担。書斎タブの export は両者を繋ぐブリッジ。

## 削除した/触らなかったもの

- `HTML_CONTENT` (旧 1,400 行) — まるごと削除
- `/api/design-preview` `/api/summarize` `/api/business-summary` — endpoint は残置 (UI からは到達不能)。次 sprint で削除候補
- `tasks.json` `tickets.json` — 未使用、放置

## やらないこと (BACKLOG)

- knowledge 編集 UI (race 回避のため read-only で出発)
- 事業計画タブ復活 → Logic 側の責務
- design-preview iframe → frontend-design skill が代替
- vector DB 化 / 認証 / multi-tenant

## 検証手順
```
python app.py
open http://localhost:5000/
```

円卓タブで「Logic に streak 機能追加すべきか」と入力 → 5 CXO の Phase 1 (独立意見) → Phase 2 (相互反論) が timeline で流れる → 書斎タブで `active.md` を copy。
