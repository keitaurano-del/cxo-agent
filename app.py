import anthropic
import os
import json
import time
import threading
import re
from flask import Flask, Response, request, jsonify
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))

conversations = {}

KNOWLEDGE_DIR = os.path.join(PROJECT_DIR, "knowledge")
os.makedirs(KNOWLEDGE_DIR, exist_ok=True)


def _make_knowledge_id():
    """Generate a unique knowledge item ID."""
    return f"k_{int(time.time())}_{int(time.time()*1000) % 1000:03d}"


def _migrate_knowledge(data):
    """Auto-migrate old-format knowledge (plain strings) to new rich format."""
    if not data.get("learnings"):
        return data
    migrated = False
    new_learnings = []
    for item in data["learnings"]:
        if isinstance(item, str):
            new_learnings.append({
                "id": _make_knowledge_id(),
                "text": item,
                "tags": [],
                "is_pinned": False,
                "usage_count": 0,
                "session_topic": "",
                "created_at": time.strftime("%Y-%m-%d %H:%M"),
            })
            migrated = True
            time.sleep(0.002)  # ensure unique IDs
        elif isinstance(item, dict):
            new_learnings.append(item)
    if migrated:
        data["learnings"] = new_learnings
    return data


def load_knowledge(agent_id):
    """Load accumulated knowledge for an agent, auto-migrating old format."""
    path = os.path.join(KNOWLEDGE_DIR, f"{agent_id}.json")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        # Auto-migrate old string-based learnings to new rich format
        old_learnings = data.get("learnings", [])
        has_old = any(isinstance(item, str) for item in old_learnings)
        data = _migrate_knowledge(data)
        if has_old:
            save_knowledge(agent_id, data)
        return data
    return {"learnings": [], "decisions": [], "history_summary": ""}


def save_knowledge(agent_id, knowledge):
    """Save knowledge to disk."""
    path = os.path.join(KNOWLEDGE_DIR, f"{agent_id}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(knowledge, f, ensure_ascii=False, indent=2)


def summarize_and_learn(agent_id, full_text, session_topic=""):
    """Extract structured knowledge items from agent response and accumulate."""
    knowledge = load_knowledge(agent_id)
    try:
        result = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=800,
            system="""あなたはナレッジ抽出AIです。CXOの回答から重要な学び・決定事項・知見を3つ以内で抽出してください。
各項目にはテキストと関連タグ（2〜3個）を付けてください。
必ずJSON配列で返してください。他の文字は含めないでください。

フォーマット:
[{"text": "フリーミアムモデルを推奨", "tags": ["ビジネスモデル", "収益"]}, {"text": "ロールプレイ機能が差別化の核", "tags": ["機能", "差別化"]}]""",
            messages=[{"role": "user", "content": full_text}],
        )
        text = result.content[0].text.strip()
        # Extract JSON array from response
        if "[" in text:
            json_str = text[text.index("["):text.rindex("]") + 1]
            items = json.loads(json_str)
        else:
            items = []
        existing_texts = {item["text"] for item in knowledge["learnings"] if isinstance(item, dict)}
        for item in items:
            item_text = item.get("text", "") if isinstance(item, dict) else str(item)
            if item_text and item_text not in existing_texts:
                knowledge["learnings"].append({
                    "id": _make_knowledge_id(),
                    "text": item_text,
                    "tags": item.get("tags", []) if isinstance(item, dict) else [],
                    "is_pinned": False,
                    "usage_count": 0,
                    "session_topic": session_topic,
                    "created_at": time.strftime("%Y-%m-%d %H:%M"),
                })
                existing_texts.add(item_text)
                time.sleep(0.002)  # ensure unique IDs
        # Keep last 30 learnings
        knowledge["learnings"] = knowledge["learnings"][-30:]
        save_knowledge(agent_id, knowledge)
    except Exception:
        pass


CONSOLIDATION_INTERVAL = 3  # consolidate every N sessions
CONSOLIDATION_KEY = os.path.join(PROJECT_DIR, "knowledge", "_consolidation_count.json")


def _get_consolidation_count():
    try:
        if os.path.exists(CONSOLIDATION_KEY):
            with open(CONSOLIDATION_KEY, "r") as f:
                return json.load(f).get("count", 0)
    except Exception:
        pass
    return 0


def _increment_consolidation_count():
    count = _get_consolidation_count() + 1
    with open(CONSOLIDATION_KEY, "w") as f:
        json.dump({"count": count}, f)
    return count


def consolidate_knowledge(agent_id):
    """Consolidate/abstract accumulated knowledge items into higher-level insights."""
    knowledge = load_knowledge(agent_id)
    learnings = knowledge.get("learnings", [])
    if len(learnings) < 8:
        return  # not enough to consolidate

    # Build text of all current knowledge
    items_text = "\n".join(
        f"- {item.get('text', '')} [タグ: {', '.join(item.get('tags', []))}]"
        for item in learnings if isinstance(item, dict)
    )
    pinned_ids = {item["id"] for item in learnings if item.get("is_pinned")}

    try:
        result = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1200,
            system="""あなたはナレッジ抽象化AIです。蓄積された個別の知見・学びを分析し、
上位概念に統合・抽象化してください。

ルール:
- 類似する知見をグループ化し、1つの抽象的な原則・フレームワークにまとめる
- 具体的すぎる知見は一般化して再利用しやすくする
- 矛盾する知見があれば、より正確な結論にまとめる
- 重複を排除する
- 結果は8件以内に絞る（量より質）
- 各項目にはテキストと関連タグ（2〜3個）を付ける

必ずJSON配列のみで返してください:
[{"text": "抽象化された知見", "tags": ["タグ1", "タグ2"]}]""",
            messages=[{"role": "user", "content": f"以下の{len(learnings)}件のナレッジを抽象化・統合してください:\n\n{items_text}"}],
        )
        text = result.content[0].text.strip()
        if "[" in text:
            json_str = text[text.index("["):text.rindex("]") + 1]
            consolidated = json.loads(json_str)
        else:
            return

        # Rebuild learnings: keep pinned items as-is, replace rest with consolidated
        new_learnings = []
        for item in learnings:
            if isinstance(item, dict) and item.get("id") in pinned_ids:
                new_learnings.append(item)

        for item in consolidated:
            item_text = item.get("text", "") if isinstance(item, dict) else str(item)
            if item_text:
                new_learnings.append({
                    "id": _make_knowledge_id(),
                    "text": item_text,
                    "tags": item.get("tags", []) if isinstance(item, dict) else [],
                    "is_pinned": False,
                    "usage_count": 0,
                    "session_topic": "[抽象化]",
                    "created_at": time.strftime("%Y-%m-%d %H:%M"),
                })
                time.sleep(0.002)

        knowledge["learnings"] = new_learnings
        save_knowledge(agent_id, knowledge)
    except Exception:
        pass


def _score_knowledge_item(item, topic_words):
    """Score a knowledge item's relevance to a topic by keyword matching."""
    if not topic_words:
        return 0
    text_to_match = item.get("text", "") + " " + " ".join(item.get("tags", []))
    text_lower = text_to_match.lower()
    score = sum(1 for w in topic_words if w.lower() in text_lower)
    if item.get("is_pinned"):
        score *= 2
    return score


def get_knowledge_prompt(agent_id, topic=""):
    """Build knowledge context for system prompt with optional topic-based relevance."""
    knowledge = load_knowledge(agent_id)
    learnings = knowledge.get("learnings", [])
    if not learnings:
        return ""

    if topic:
        # RAG-like: split topic into words, score each item
        topic_words = [w for w in re.split(r'[\s\u3000,.\[\]【】（）()、。]+', topic) if len(w) >= 2]
        scored = [(item, _score_knowledge_item(item, topic_words)) for item in learnings]
        # Get all pinned items
        pinned = [item for item in learnings if item.get("is_pinned")]
        # Get top 3 relevant (non-pinned) by score
        non_pinned_scored = [(item, s) for item, s in scored if not item.get("is_pinned") and s > 0]
        non_pinned_scored.sort(key=lambda x: x[1], reverse=True)
        relevant = [item for item, _ in non_pinned_scored[:3]]
        # Combine: pinned first, then relevant (dedup)
        selected_ids = set()
        selected = []
        for item in pinned + relevant:
            if item["id"] not in selected_ids:
                selected.append(item)
                selected_ids.add(item["id"])
        # Increment usage_count for injected items
        if selected:
            for item in learnings:
                if item.get("id") in selected_ids:
                    item["usage_count"] = item.get("usage_count", 0) + 1
            save_knowledge(agent_id, knowledge)
    else:
        # No topic: return all pinned + top 7 by usage_count
        pinned = [item for item in learnings if item.get("is_pinned")]
        non_pinned = [item for item in learnings if not item.get("is_pinned")]
        non_pinned.sort(key=lambda x: x.get("usage_count", 0), reverse=True)
        selected_ids = set(item["id"] for item in pinned)
        selected = list(pinned)
        for item in non_pinned:
            if len(selected) >= 10:
                break
            if item["id"] not in selected_ids:
                selected.append(item)
                selected_ids.add(item["id"])

    if not selected:
        return ""

    def _format_item(item):
        tags_str = f" [{', '.join(item.get('tags', []))}]" if item.get("tags") else ""
        pin_str = " [ピン留め]" if item.get("is_pinned") else ""
        return f"- {item['text']}{tags_str}{pin_str}"

    items = "\n".join(_format_item(item) for item in selected)
    return f"\n\n## これまでの蓄積ナレッジ\n以下はこれまでの議論で得られた知見です。これらを踏まえて回答してください:\n{items}"

CONVERSATIONS_FILE = os.path.join(PROJECT_DIR, "conversations.json")

def load_conversations_from_disk():
    if os.path.exists(CONVERSATIONS_FILE):
        with open(CONVERSATIONS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {aid: [] for aid in AGENTS}

def save_conversations_to_disk():
    with open(CONVERSATIONS_FILE, "w", encoding="utf-8") as f:
        json.dump(conversations, f, ensure_ascii=False, indent=2)

AGENTS = {
    "cso": {
        "title": "CSO",
        "name": "Nobita",
        "floor": "5F",
        "avatar": "nobita",
        "color": "#FF9800",
        "system": """あなたはApollo Mansion社のCSO（最高戦略責任者）Nobitaです。
事業戦略・競合分析・市場ポジショニングの専門家として、CEO Keitaからの指示に対応します。
性格は少しのんびりしているが、ひらめきと大局観がある。

ルール:
- CEO Keitaからの指示に対し、CSOの視点で具体的に回答してください
- 市場・競合・中長期の視点を必ず含めてください
- CEOに承認が必要な事項がある場合は【承認依頼】と明記してください
- CEOへの提案がある場合は【提案】と明記してください
- Markdown形式で回答してください
- 日本語で回答してください""",
    },
    "cfo": {
        "title": "CFO",
        "name": "Suneo",
        "floor": "4F",
        "avatar": "suneo",
        "color": "#4CAF50",
        "system": """あなたはApollo Mansion社のCFO（最高財務責任者）Suneoです。
収益モデル・価格設計・財務戦略の専門家として、CEO Keitaからの指示に対応します。
性格は数字に強く、コスト意識が高い。自慢話が好き。

ルール:
- CEO Keitaからの指示に対し、CFOの視点で具体的に回答してください
- 数字・コスト・ROIを必ず含めてください
- CEOに承認が必要な事項がある場合は【承認依頼】と明記してください
- CEOへの提案がある場合は【提案】と明記してください
- リスクがある場合は必ず警告してください
- Markdown形式で回答してください
- 日本語で回答してください""",
    },
    "cmo": {
        "title": "CMO",
        "name": "Dekisugi",
        "floor": "3F",
        "avatar": "dekisugi",
        "color": "#9C27B0",
        "system": """あなたはApollo Mansion社のCMO（最高マーケティング責任者）Dekisugiです。
マーケティング・集客・ブランディングの専門家として、CEO Keitaからの指示に対応します。
性格は万能で冷静、論理的かつ丁寧。

ルール:
- CEO Keitaからの指示に対し、CMOの視点で具体的に回答してください
- 他のCXOとの連携が必要な場合は言及してください
- CEOに承認が必要な事項がある場合は【承認依頼】と明記してください
- CEOへの提案がある場合は【提案】と明記してください
- Markdown形式で回答してください
- 日本語で回答してください""",
    },
    "cto": {
        "title": "CTO",
        "name": "Doraemon",
        "floor": "2F",
        "avatar": "doraemon",
        "color": "#0096D6",
        "system": """あなたはApollo Mansion社のCTO（最高技術責任者）Doraemonです。
技術選定・開発ロードマップ・アーキテクチャの専門家として、CEO Keitaからの指示に対応します。
性格は未来の技術に詳しく、四次元ポケットのように無限のアイデアを出す。どら焼きが好き。

ルール:
- CEO Keitaからの指示に対し、CTOの視点で具体的に回答してください
- 技術的な実現可能性・工数・リスクを必ず含めてください
- CEOに承認が必要な事項がある場合は【承認依頼】と明記してください
- CEOへの提案がある場合は【提案】と明記してください
- Markdown形式で回答してください
- 日本語で回答してください""",
    },
    "cpo": {
        "title": "CPO",
        "name": "Dorami",
        "floor": "1F",
        "avatar": "dorami",
        "color": "#FFD700",
        "system": """あなたはApollo Mansion社のCPO（最高プロダクト責任者）Doramiです。
プロダクト戦略・機能優先度・UXの専門家として、CEO Keitaからの指示に対応します。
性格はしっかり者で、ユーザー思いの優しい視点を持つ。メロンパンが好き。

ルール:
- CEO Keitaからの指示に対し、CPOの視点で具体的に回答してください
- ユーザー体験とプロダクトの観点を最優先してください
- CEOに承認が必要な事項がある場合は【承認依頼】と明記してください
- CEOへの提案がある場合は【提案】と明記してください
- CTOとの技術的な連携ポイントは明記してください
- Markdown形式で回答してください
- 日本語で回答してください""",
    },
}

PROJECTS = {
    "Logic": {
        "url_prod": "https://logic-u5wn.onrender.com",
        "description": """## プロジェクト: Logic
ビジネスパーソン向けスキルアップ学習アプリ。
- 技術: React + TypeScript + Vite（フロント）、Node.js（バック）
- 機能: 簿記3級・2級（商業・工業）レッスン/ドリル/模擬試験、ロールプレイ（職場シナリオ）、フラッシュカード、ジャーナル、XP（5段階レベル）・ストリーク、プロフィール・タスク管理
- 対象: 資格取得・スキルアップを目指すビジネスパーソン
- リポジトリ: keitaurano-del/logic""",
    },
    "千石茶道": {
        "url_prod": "https://sengoku-chakai.onrender.com/ja",
        "description": """## プロジェクト: 千石茶道
茶道体験の予約・決済サイト。
- 技術: Next.js（App Router）+ TypeScript + Prisma + PostgreSQL + Stripe
- 機能: 多言語対応（日/英）、プラン選択・日時・人数予約、Stripe決済、予約確認・キャンセル、管理画面
- 対象: 茶道体験を予約したいお客様（インバウンド観光客含む）
- リポジトリ: keitaurano-del/sengoku-chakai""",
    },
    "Apollo Mansion": {
        "url_prod": "https://symmetrical-broccoli-97pw5gv6jp94h7jjg-5000.app.github.dev/",
        "description": """## プロジェクト: Apollo Mansion
CXOエージェント管理システム（本システム）。
- 技術: Python + Flask + Server-Sent Events + Anthropic Claude API
- 機能: CXO5名（CSO/CFO/CMO/CTO/CPO）へのAI指示、円卓会議、議論結果のコピペ出力（Claude Code想定コスト付き）、ナレッジ蓄積
- 対象: CEO Keita による経営意思決定支援
- リポジトリ: keitaurano-del/cxo-agent""",
    },
}

_saved = load_conversations_from_disk()
for agent_id in AGENTS:
    conversations[agent_id] = _saved.get(agent_id, [])


@app.route("/")
def index():
    return HTML_CONTENT


@app.route("/history/<agent_id>")
def get_history(agent_id):
    if agent_id not in AGENTS:
        return "Not found", 404
    return jsonify(conversations.get(agent_id, []))


@app.route("/history_all")
def get_history_all():
    return jsonify({aid: conversations[aid] for aid in AGENTS})


@app.route("/reset", methods=["POST"])
def reset():
    for agent_id in AGENTS:
        conversations[agent_id] = []
    save_conversations_to_disk()
    # Note: knowledge is NOT reset - it accumulates forever
    return jsonify({"ok": True})


@app.route("/generate_output", methods=["POST"])
def generate_output():
    """全ラウンドのCXO議論を総括してコピペ形式で出力する。"""
    data = request.json
    round_history = data.get("roundHistory", [])
    topic = data.get("topic", "")
    projects = data.get("projects", [])

    if not round_history:
        def empty():
            yield f"data: {json.dumps({'type': 'error', 'content': 'CXOの回答がありません'}, ensure_ascii=False)}\n\n"
        return Response(empty(), mimetype="text/event-stream")

    # Build comprehensive discussion text from ALL rounds
    all_rounds_text = ""
    for r in round_history:
        rnum = r.get("round", "?")
        feedback = r.get("feedback")
        all_rounds_text += f"\n\n{'='*40}\n## Round {rnum}\n"
        if feedback:
            all_rounds_text += f"\n**CEOフィードバック:** {feedback}\n"
        for d in r.get("discussions", []):
            if d.get("text"):
                all_rounds_text += f"\n【{d['title']} {d['name']}】\n{d['text']}\n"

    project_context = ", ".join(projects) if projects else "未指定"
    total_rounds = len(round_history)

    def generate():
        try:
            with client.messages.stream(
                model="claude-sonnet-4-6",
                max_tokens=8192,
                system=f"""あなたはCXO会議のアウトプット生成AIです。
CXO全員の議論内容を分析し、Claude Codeにそのままコピペして実装を依頼できる形式でまとめてください。

重要: この議論は{total_rounds}ラウンドにわたって行われました。
各ラウンドでCEOがフィードバックを出し、CXOが改善提案を繰り返しています。
最終ラウンドだけでなく、全ラウンドの議論の経緯と最終結論を総括してまとめてください。
途中で却下・修正された案は最終版に含めず、最終合意内容を中心にまとめてください。

以下のフォーマットで出力してください:

---

## 概要
（何を実現するかを1〜2文で）

## 議論の経緯
（全{total_rounds}ラウンドの流れを簡潔にまとめる。各ラウンドでのCEOフィードバックと、それに対するCXOの改善点）

## CXO議論サマリー
（各CXOの最終的な主要意見を箇条書きで。途中で修正された意見は最終版のみ記載）

## 実装計画
### タスク一覧
（具体的な実装タスクを番号付きリストで）

### 変更が想定されるファイル
（推定されるファイルパスをリストで）

## Claude Code 想定コスト
以下の基準で見積もってください:
- Claude Sonnet: 入力$3/MTok, 出力$15/MTok
- Claude Opus: 入力$15/MTok, 出力$75/MTok
- 1トークン ≒ 日本語0.5文字, 英語0.25単語
- 1ファイル読み込み ≒ 1-3k tokens
- 1ファイル書き込み ≒ 0.5-2k tokens

| 項目 | 見積もり |
|------|---------|
| 想定作業時間 | X分 |
| 想定トークン（入力） | Xk tokens |
| 想定トークン（出力） | Xk tokens |
| Sonnet利用時の想定費用 | $X（約¥X） |
| Opus利用時の想定費用 | $X（約¥X） |

※ 複雑さ・ファイル数・修正範囲から推定した概算です

## コピペ用プロンプト
```
（Claude Codeにそのまま渡せる具体的な指示文。プロジェクト情報、実装要件、注意事項を含む。全ラウンドの議論で合意された最終仕様を反映すること）
```

---

ルール:
- Markdown形式で日本語で回答
- 実装の具体性を重視（抽象的な表現は避ける）
- コスト見積もりは現実的な範囲で
- コピペ用プロンプトは、Claude Codeが迷わず実装できるレベルの具体性で書く""",
                messages=[{"role": "user", "content": f"テーマ: {topic}\n対象プロジェクト: {project_context}\n合計ラウンド数: {total_rounds}\n\n以下の全ラウンドの議論を総括してまとめてください:\n{all_rounds_text[:12000]}"}],
            ) as s:
                for text in s.text_stream:
                    yield f"data: {json.dumps({'type': 'text', 'content': text}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)}, ensure_ascii=False)}\n\n"

    return Response(generate(), mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/knowledge/<agent_id>")
def get_knowledge(agent_id):
    if agent_id not in AGENTS:
        return "Not found", 404
    return jsonify(load_knowledge(agent_id))


@app.route("/knowledge_reset/<agent_id>", methods=["POST"])
def reset_knowledge(agent_id):
    if agent_id not in AGENTS:
        return "Not found", 404
    save_knowledge(agent_id, {"learnings": [], "decisions": [], "history_summary": ""})
    return jsonify({"ok": True})


@app.route("/roundtable", methods=["GET", "POST"])
def roundtable():
    if request.method == "POST":
        data = request.json or {}
        topic = data.get("topic", "")
        order_str = data.get("order", ",".join(AGENTS.keys()))
        projects_str = data.get("projects", "")
        feedback = data.get("feedback", "")
        prev_discussion = data.get("prev_discussion", "")
        round_num = data.get("round", "1")
    else:
        topic = request.args.get("topic", "")
        order_str = request.args.get("order", ",".join(AGENTS.keys()))
        projects_str = request.args.get("projects", "")
        feedback = request.args.get("feedback", "")
        prev_discussion = request.args.get("prev_discussion", "")
        round_num = request.args.get("round", "1")
    order = [x for x in order_str.split(",") if x in AGENTS]

    def generate():
        discussion = []
        for agent_id in order:
            agent = AGENTS[agent_id]
            prior = ""
            if discussion:
                prior = "\n\n## これまでの発言\n" + "\n\n".join(
                    f"**{AGENTS[e['id']]['title']} {AGENTS[e['id']]['name']}**:\n{e['text']}"
                    for e in discussion
                )
            proj_ctx = ""
            for pname in projects_str.split(","):
                if pname in PROJECTS:
                    proj_ctx += "\n\n" + PROJECTS[pname]["description"]

            feedback_ctx = ""
            if feedback and prev_discussion:
                feedback_ctx = f"""

## CEOからのフィードバック（Round {round_num}）
CEOが前回の議論に対して以下のフィードバックを出しました。これを踏まえて改善・修正した提案をしてください。

**CEOフィードバック:** {feedback}

## 前回の議論内容
{prev_discussion[:3000]}"""

            roundtable_system = (
                agent["system"]
                + proj_ctx
                + get_knowledge_prompt(agent_id, topic=topic)
                + f"""

## CXO円卓会議モード
CXO全員での円卓会議です。テーマについて専門的観点から発言してください。
- 他のCXOの発言があれば同意・反論・補足してください
- 300〜500文字程度で簡潔に
- {agent['title']}としての専門性を活かした発言を"""
                + feedback_ctx
            )
            msg = f"【円卓会議テーマ】{topic}{prior}\n\n{agent['title']}として発言してください。"
            yield f"data: {json.dumps({'type': 'agent_start', 'agent_id': agent_id}, ensure_ascii=False)}\n\n"
            full_text = ""
            try:
                with client.messages.stream(
                    model="claude-sonnet-4-6",
                    max_tokens=2000,
                    system=roundtable_system,
                    messages=[{"role": "user", "content": msg}],
                ) as s:
                    for text in s.text_stream:
                        full_text += text
                        yield f"data: {json.dumps({'type': 'text', 'agent_id': agent_id, 'content': text}, ensure_ascii=False)}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'agent_id': agent_id, 'content': str(e)}, ensure_ascii=False)}\n\n"
                continue
            discussion.append({"id": agent_id, "text": full_text})
            conversations[agent_id].append({"role": "user", "content": f"[円卓会議] テーマ: {topic}"})
            conversations[agent_id].append({"role": "assistant", "content": full_text})
            save_conversations_to_disk()
            threading.Thread(target=summarize_and_learn, args=(agent_id, full_text, topic), daemon=True).start()
            yield f"data: {json.dumps({'type': 'agent_done', 'agent_id': agent_id}, ensure_ascii=False)}\n\n"
        yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"

        # Check if it's time to consolidate knowledge (every N sessions)
        count = _increment_consolidation_count()
        if count % CONSOLIDATION_INTERVAL == 0:
            for aid in order:
                threading.Thread(target=consolidate_knowledge, args=(aid,), daemon=True).start()

    return Response(generate(), mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})






# --- Knowledge API ---

@app.route("/api/knowledge/<agent_id>")
def api_get_knowledge(agent_id):
    """Returns knowledge items with optional filtering."""
    if agent_id not in AGENTS:
        return jsonify([])
    knowledge = load_knowledge(agent_id)
    items = knowledge.get("learnings", [])
    pinned_only = request.args.get("pinned_only", "").lower() == "true"
    if pinned_only:
        items = [item for item in items if item.get("is_pinned")]
    # Sort: pinned first, then by usage_count desc
    items.sort(key=lambda x: (-int(x.get("is_pinned", False)), -x.get("usage_count", 0)))
    return jsonify(items)


@app.route("/api/knowledge/<agent_id>/pin/<item_id>", methods=["POST"])
def pin_knowledge(agent_id, item_id):
    """Toggle is_pinned for a knowledge item."""
    if agent_id not in AGENTS:
        return jsonify({"error": "not found"}), 404
    knowledge = load_knowledge(agent_id)
    for item in knowledge.get("learnings", []):
        if isinstance(item, dict) and item.get("id") == item_id:
            item["is_pinned"] = not item.get("is_pinned", False)
            save_knowledge(agent_id, knowledge)
            return jsonify(item)
    return jsonify({"error": "item not found"}), 404


@app.route("/api/knowledge/<agent_id>/items/<item_id>", methods=["DELETE"])
def delete_knowledge_item(agent_id, item_id):
    """Delete a specific knowledge item."""
    if agent_id not in AGENTS:
        return jsonify({"error": "not found"}), 404
    knowledge = load_knowledge(agent_id)
    original_len = len(knowledge.get("learnings", []))
    knowledge["learnings"] = [
        item for item in knowledge.get("learnings", [])
        if not (isinstance(item, dict) and item.get("id") == item_id)
    ]
    if len(knowledge["learnings"]) < original_len:
        save_knowledge(agent_id, knowledge)
        return jsonify({"ok": True})
    return jsonify({"error": "item not found"}), 404


HTML_CONTENT = r"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Apollo Mansion - CXO Agent</title>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:#F8F7F5;color:#2D2D2D}

.header{background:#1a237e;color:#fff;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 2px 8px rgba(26,35,126,0.3)}
.logo{font-size:18px;font-weight:700;letter-spacing:-0.02em}
.header-links{display:flex;gap:6px}
.header-links a,.reset-btn{color:#fff;text-decoration:none;font-size:11px;padding:5px 12px;border:1px solid rgba(255,255,255,0.2);border-radius:20px;background:none;cursor:pointer;font-family:inherit;transition:all 0.2s ease}

.main{display:flex;height:calc(100vh - 42px)}

.ceo-panel{width:340px;min-width:340px;background:linear-gradient(180deg,#1a237e,#151c6a);color:#fff;display:flex;flex-direction:column;overflow-y:auto}
.section{padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.06)}
.ceo-title{font-size:17px;font-weight:700;color:#FFD700;margin-bottom:4px;letter-spacing:-0.02em}
.ceo-sub{font-size:11px;color:rgba(255,255,255,0.45)}

.chips{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}
.chip{padding:5px 12px;border-radius:20px;font-size:11px;cursor:pointer;border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.5);background:none;font-family:inherit;transition:all 0.2s ease}
.chip.active{border-color:var(--c,#FFD700);color:var(--c,#FFD700)}
.chip-all{padding:5px 12px;border-radius:20px;font-size:11px;cursor:pointer;border:1px solid #FFD700;color:#FFD700;background:none;font-family:inherit;transition:all 0.2s ease}
.label{font-size:10px;color:rgba(255,255,255,0.3);margin-right:4px}

textarea{width:100%;min-height:80px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.15);border-radius:10px;color:#fff;padding:12px;font-size:13px;font-family:inherit;resize:vertical;transition:border-color 0.2s ease}
textarea:focus{outline:none;border-color:#FFD700}
textarea::placeholder{color:rgba(255,255,255,0.3)}

.btn-row{display:flex;gap:6px;margin-top:8px;align-items:center;justify-content:space-between}
.btn-pri{background:#FF4B4B;border:none;color:#fff;padding:10px 22px;border-radius:24px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:all 0.2s ease;box-shadow:0 2px 8px rgba(255,75,75,0.3)}
.btn-pri:disabled{opacity:0.4;cursor:not-allowed;box-shadow:none}
.hint{font-size:11px;color:rgba(255,255,255,0.3)}

.hidden{display:none}
.btn-out{width:100%;padding:10px;background:#FF4B4B;border:none;color:#fff;border-radius:24px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:all 0.2s ease;box-shadow:0 2px 8px rgba(255,75,75,0.3)}
.btn-out:disabled{opacity:0.4;cursor:not-allowed;box-shadow:none}
.btn-fb{width:100%;padding:10px;background:none;border:1px solid rgba(0,150,214,0.4);color:#4FC3F7;border-radius:24px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;margin-top:6px;transition:all 0.2s ease}
.btn-fb:disabled{opacity:0.4;cursor:not-allowed}

.round-badge{display:inline-block;background:rgba(255,75,75,0.15);color:#FF6B6B;border:1px solid rgba(255,75,75,0.3);border-radius:20px;font-size:10px;padding:2px 8px;font-weight:bold;margin-bottom:6px}

.ceo-log{max-height:140px;overflow-y:auto;margin-bottom:10px;scrollbar-width:thin}
.ceo-log:empty{display:none}
.ceo-log-item{padding:6px 8px;border-radius:8px;margin-bottom:4px;font-size:11px;line-height:1.5}
.ceo-log-item.topic{background:rgba(255,215,0,0.1);border-left:3px solid #FFD700;color:rgba(255,255,255,0.85)}
.ceo-log-item.feedback{background:rgba(79,195,247,0.08);border-left:3px solid #4FC3F7;color:rgba(255,255,255,0.75)}
.ceo-log-round{font-size:9px;color:rgba(255,255,255,0.35);font-weight:600;margin-bottom:1px}

.mansion{flex:1;overflow-y:auto;padding:20px 24px;background:#F8F7F5}
.mansion-h{font-size:20px;font-weight:700;color:#1a237e;margin-bottom:20px;padding-bottom:10px;border-bottom:2px solid #1a237e;letter-spacing:-0.02em}

.card{background:#fff;border:none;border-radius:16px;margin-bottom:14px;overflow:hidden;box-shadow:0 1px 3px rgba(166,156,143,0.12),0 4px 12px rgba(166,156,143,0.08);transition:box-shadow 0.2s ease}
.card-h{display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid #f0eeeb;background:#fafaf8}
.card-floor{font-size:11px;font-weight:700;color:#fff;min-width:26px;height:26px;display:flex;align-items:center;justify-content:center;background:#8B7355;border-radius:8px}
.card-title{font-size:14px;font-weight:700;letter-spacing:-0.01em}
.card-name{font-size:12px;color:#6B6B7B}
.card-st{margin-left:auto;font-size:10px;color:#9B9BA7;display:flex;align-items:center;gap:4px}
.dot{width:6px;height:6px;border-radius:50%;background:#ccc}
.dot.working{background:#0096D6;animation:pulse 1s infinite}
.dot.done{background:#4CAF50}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}

.card-body{padding:14px 16px;font-size:12.5px;line-height:1.75;color:#3D3D4D;min-height:36px;max-height:300px;overflow-y:auto}
.card-body h1,.card-body h2,.card-body h3{color:#2D2D2D;margin:8px 0 4px}
.card-body h1{font-size:14px} .card-body h2{font-size:13px} .card-body h3{font-size:12px}
.card-body p{margin:3px 0} .card-body ul,.card-body ol{padding-left:16px;margin:3px 0}
.card-body table{border-collapse:collapse;width:100%;margin:4px 0;font-size:11px}
.card-body th{background:#F5F3F0;padding:3px 6px;border:1px solid #e0ddd8;text-align:left}
.card-body td{padding:3px 6px;border:1px solid #e0ddd8}
.card-body code{background:#F5F3F0;padding:1px 3px;border-radius:4px;font-size:11px}
.card-body pre{background:#F5F3F0;padding:8px;border-radius:8px;overflow-x:auto;margin:4px 0}
.card-body strong{color:#333} .card-body hr{border:none;border-top:1px solid #eee;margin:6px 0}
.typing{display:inline-block;width:2px;height:12px;background:#0096D6;animation:blink .8s infinite;vertical-align:middle;margin-left:2px}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
.placeholder{color:#ccc}
.rt-tag{display:inline-block;background:#e3f2fd;color:#0096D6;border:1px solid #bbdefb;border-radius:10px;font-size:10px;padding:2px 8px;margin-bottom:4px;font-weight:600}

.card-foot{padding:6px 16px 10px;font-size:10px;color:#9B9BA7;display:flex;gap:10px;position:relative}
.kbtn{background:none;border:none;color:#8B7355;font-size:10px;cursor:pointer;font-family:inherit}
.kbtn:hover{color:#5D4037}
.kpop{position:absolute;bottom:calc(100% + 4px);right:14px;width:240px;background:#fff;border:1px solid #eeebe7;border-radius:12px;box-shadow:0 4px 16px rgba(166,156,143,0.15);padding:8px 10px;z-index:100;font-size:11px;line-height:1.5;color:#3D3D4D;max-height:200px;overflow-y:auto;display:none}
.kpop-title{font-size:10px;font-weight:bold;color:#8B7355;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
.kpop-item{padding:6px 0;border-bottom:1px solid #f0eeeb;display:flex;align-items:flex-start;gap:6px}
.kpop-item:last-child{border-bottom:none}
.kpop-pin{background:none;border:none;cursor:pointer;font-size:14px;padding:0;line-height:1;flex-shrink:0}
.kpop-pin.pinned{color:#FFD700}
.kpop-pin:not(.pinned){color:#ccc}
.kpop-text{flex:1;font-size:11px;color:#444;line-height:1.4}
.kpop-tags{display:flex;gap:3px;flex-wrap:wrap;margin-top:2px}
.kpop-tag{font-size:9px;padding:1px 4px;border-radius:6px;background:#F0EDE8;color:#6B6B7B}
.kpop-meta{font-size:9px;color:#bbb;margin-top:2px}
.kpop-del{background:none;border:none;color:#ddd;cursor:pointer;font-size:11px;padding:0 2px;flex-shrink:0}
.kpop-del:hover{color:#f44336}

.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(4px)}
.modal{background:#fff;border-radius:20px;width:700px;max-width:92vw;max-height:85vh;overflow-y:auto;padding:24px;box-shadow:0 8px 32px rgba(0,0,0,0.15)}
.modal-title{font-size:18px;font-weight:700;color:#1a237e;margin-bottom:14px;letter-spacing:-0.02em}
.modal-body{background:#FAF9F7;border:1px solid #eeebe7;border-radius:12px;padding:16px;font-size:12px;line-height:1.8;max-height:55vh;overflow-y:auto}
.modal-body h1,.modal-body h2,.modal-body h3{color:#1a237e;margin:10px 0 4px}
.modal-body h1{font-size:15px} .modal-body h2{font-size:13px} .modal-body h3{font-size:12px}
.modal-body p{margin:3px 0} .modal-body ul,.modal-body ol{padding-left:16px;margin:3px 0}
.modal-body table{border-collapse:collapse;width:100%;margin:6px 0;font-size:11px}
.modal-body th{background:#EDEAF6;color:#1a237e;padding:3px 6px;border:1px solid #e0ddd8;text-align:left}
.modal-body td{padding:3px 6px;border:1px solid #e0ddd8}
.modal-body code{background:#F0EDE8;padding:1px 3px;border-radius:4px;font-size:11px}
.modal-body pre{background:#263238;color:#eee;padding:10px;border-radius:8px;overflow-x:auto;margin:6px 0}
.modal-body pre code{background:none;color:inherit}
.modal-body strong{color:#333} .modal-body hr{border:none;border-top:1px solid #ddd;margin:8px 0}
.modal-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
.btn-copy{background:#FF4B4B;border:none;color:#fff;padding:10px 22px;border-radius:24px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:all 0.2s ease;box-shadow:0 2px 8px rgba(255,75,75,0.25)}
.btn-close{background:none;border:1px solid #e0ddd8;color:#6B6B7B;padding:10px 18px;border-radius:24px;font-size:12px;cursor:pointer;font-family:inherit;transition:all 0.2s ease}

@media(max-width:768px){
  .main{flex-direction:column;height:auto;min-height:calc(100vh - 48px)}
  .ceo-panel{width:100%;min-width:0;max-height:none}
  .mansion{min-height:300px;padding:16px}
  .header{padding:10px 14px;flex-wrap:wrap;gap:6px}
  .logo{font-size:16px}
  .header-links{gap:4px}
  .header-links a,.reset-btn{font-size:10px;padding:4px 10px}
  .card-body{max-height:200px}
  .modal{max-width:96vw;max-height:90vh;padding:16px;border-radius:16px}
  .modal-body{max-height:60vh}
  .kpop{width:220px;right:0}
  .btn-pri{width:100%;text-align:center}
}

.header-links a:hover,.reset-btn:hover{background:rgba(255,255,255,0.1);border-color:rgba(255,255,255,0.4)}
.card:hover{box-shadow:0 2px 6px rgba(166,156,143,0.16),0 8px 20px rgba(166,156,143,0.12)}
.chip:hover{border-color:var(--c,rgba(255,255,255,0.4))}
.chip-all:hover{background:rgba(255,215,0,0.1)}
.btn-pri:hover:not(:disabled){background:#E63E3E;box-shadow:0 4px 12px rgba(255,75,75,0.4);transform:translateY(-1px)}
.btn-out:hover:not(:disabled){background:#E63E3E;transform:translateY(-1px)}
.btn-fb:hover:not(:disabled){background:rgba(0,150,214,0.05)}
.btn-copy:hover{background:#E63E3E;transform:translateY(-1px)}
.btn-close:hover{background:#F8F7F5;color:#2D2D2D}
.mansion::-webkit-scrollbar,.card-body::-webkit-scrollbar,.modal-body::-webkit-scrollbar{width:6px}
.mansion::-webkit-scrollbar-track,.card-body::-webkit-scrollbar-track{background:transparent}
.mansion::-webkit-scrollbar-thumb{background:#d4d0c8;border-radius:3px}
.mansion::-webkit-scrollbar-thumb:hover{background:#b8b4ac}
::selection{background:rgba(255,75,75,0.15);color:#2D2D2D}
</style>
</head>
<body>

<div class="header">
  <div class="logo">&#127970; Apollo Mansion Inc.</div>
  <div class="header-links">
    <a href="https://logic-u5wn.onrender.com" target="_blank">Logic</a>
    <a href="https://sengoku-chakai.onrender.com/ja" target="_blank">&#21315;&#30707;&#33590;&#36947;</a>
    <button class="reset-btn" onclick="resetAll()">&#12522;&#12475;&#12483;&#12488;</button>
  </div>
</div>

<div class="main">
  <div class="ceo-panel">
    <div class="section">
      <div class="ceo-title">&#128081; Keita</div>
      <div class="ceo-sub">CEO / Founder &#8212; Penthouse</div>
      <div class="chips">
        <button class="chip-all" onclick="toggleAll()">ALL</button>
        <button class="chip active" data-id="cso" style="--c:#FF9800" onclick="toggleTarget(this)">Nobita</button>
        <button class="chip active" data-id="cfo" style="--c:#4CAF50" onclick="toggleTarget(this)">Suneo</button>
        <button class="chip active" data-id="cmo" style="--c:#9C27B0" onclick="toggleTarget(this)">Dekisugi</button>
        <button class="chip active" data-id="cto" style="--c:#0096D6" onclick="toggleTarget(this)">Doraemon</button>
        <button class="chip active" data-id="cpo" style="--c:#FFD700" onclick="toggleTarget(this)">Dorami</button>
      </div>
      <div class="chips" style="margin-top:6px">
        <span class="label">&#23550;&#35937;:</span>
        <button class="chip" data-project="Logic" onclick="toggleProject(this)">Logic</button>
        <button class="chip" data-project="&#21315;&#30707;&#33590;&#36947;" onclick="toggleProject(this)">&#21315;&#30707;&#33590;&#36947;</button>
        <button class="chip" data-project="Apollo Mansion" onclick="toggleProject(this)">Apollo Mansion</button>
      </div>
    </div>
    <div class="section">
      <textarea id="ceoInput" placeholder="&#35696;&#35542;&#12486;&#12540;&#12510;&#12434;&#20837;&#21147;..."></textarea>
      <div class="btn-row">
        <span class="hint">Ctrl+Enter</span>
        <button class="btn-pri" id="startBtn" onclick="startRoundtable()">&#128483; &#20870;&#21331;&#20250;&#35696;&#12434;&#38283;&#22987;</button>
      </div>
    </div>
    <div class="section hidden" id="actionPanel">
      <div class="round-badge" id="roundBadge">Round 1</div>
      <div class="ceo-log" id="ceoLog"></div>
      <button class="btn-out" id="outputGenBtn" onclick="generateOutput()">&#128203; &#12467;&#12500;&#12506;&#29992;&#20986;&#21147;&#12434;&#29983;&#25104;</button>
      <div style="margin-top:10px">
        <textarea id="feedbackInput" placeholder="&#12501;&#12451;&#12540;&#12489;&#12496;&#12483;&#12463;&#12434;&#20837;&#21147;... &#20363;: &#12467;&#12473;&#12488;&#38754;&#12434;&#12418;&#12387;&#12392;&#28145;&#25496;&#12426;&#12375;&#12390;&#12289;&#31478;&#21512;&#12392;&#12398;&#27604;&#36611;&#12434;&#36861;&#21152;&#12375;&#12390;" style="min-height:60px"></textarea>
        <button class="btn-fb" id="feedbackBtn" onclick="submitFeedback()">&#128260; &#12501;&#12451;&#12540;&#12489;&#12496;&#12483;&#12463;&#12375;&#12390;&#20877;&#35696;&#35542;</button>
      </div>
    </div>
  </div>

  <div class="mansion">
    <div class="mansion-h">&#127970; Apollo Mansion &#8212; &#12501;&#12525;&#12450;&#19968;&#35239;</div>
    <div id="floors"></div>
  </div>
</div>

<div id="outputModal" class="modal-bg" style="display:none" onclick="if(event.target===this)closeOutputModal()">
  <div class="modal">
    <div class="modal-title">&#128203; CXO&#35696;&#35542;&#12414;&#12392;&#12417; &#8212; &#12467;&#12500;&#12506;&#29992;&#20986;&#21147;</div>
    <div class="modal-body" id="outputModalBody"></div>
    <div class="modal-foot">
      <button class="btn-close" onclick="closeOutputModal()">&#38281;&#12376;&#12427;</button>
      <button class="btn-copy" onclick="copyOutput()">&#128203; &#12467;&#12500;&#12540;</button>
    </div>
  </div>
</div>

<script>
const AGENTS={
  cso:{title:"CSO",name:"Nobita",floor:"5F",color:"#FF9800",icon:"\uD83D\uDC66"},
  cfo:{title:"CFO",name:"Suneo",floor:"4F",color:"#4CAF50",icon:"\uD83D\uDC68"},
  cmo:{title:"CMO",name:"Dekisugi",floor:"3F",color:"#9C27B0",icon:"\uD83E\uDDD1\u200D\uD83C\uDF93"},
  cto:{title:"CTO",name:"Doraemon",floor:"2F",color:"#0096D6",icon:"\uD83E\uDD16"},
  cpo:{title:"CPO",name:"Dorami",floor:"1F",color:"#FFD700",icon:"\uD83D\uDC67"}
};
const ORDER=["cso","cfo","cmo","cto","cpo"];
const rawTxt=JSON.parse(localStorage.getItem('apollo-rawTxt')||'{}');
function saveRawTxt(){localStorage.setItem('apollo-rawTxt',JSON.stringify(rawTxt));}
let currentTopic=localStorage.getItem('apollo-topic')||'';
let roundNum=parseInt(localStorage.getItem('apollo-round')||'0');
let outputRaw='';
let roundHistory=JSON.parse(localStorage.getItem('apollo-rounds')||'[]');
function saveRoundHistory(){localStorage.setItem('apollo-rounds',JSON.stringify(roundHistory));}
let ceoLog=JSON.parse(localStorage.getItem('apollo-ceolog')||'[]');
function saveCeoLog(){localStorage.setItem('apollo-ceolog',JSON.stringify(ceoLog));}
function renderCeoLog(){
  const el=document.getElementById('ceoLog');
  if(!el)return;
  el.innerHTML=ceoLog.map(e=>`<div class="ceo-log-item ${e.type}"><div class="ceo-log-round">Round ${e.round}</div>${esc(e.text)}</div>`).join('');
  el.scrollTop=el.scrollHeight;
}

function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}

function createFloors(){
  const el=document.getElementById('floors');
  for(const id of ORDER){
    const a=AGENTS[id];if(!rawTxt[id])rawTxt[id]='';
    el.innerHTML+=`
      <div class="card" id="card-${id}">
        <div class="card-h">
          <span class="card-floor">${a.floor}</span>
          <span class="card-title" style="color:${a.color}">${a.icon} ${a.title}</span>
          <span class="card-name">${a.name}</span>
          <div class="card-st"><div class="dot" id="dot-${id}"></div><span id="st-${id}">\u5F85\u6A5F\u4E2D</span></div>
        </div>
        <div class="card-body" id="body-${id}"><span class="placeholder">\u2615 ${a.name}\u306F\u90E8\u5C4B\u3067\u5F85\u6A5F\u4E2D...</span></div>
        <div class="card-foot"><span id="ch-${id}">0\u6587\u5B57</span><button class="kbtn" onclick="toggleK('${id}')">&#128218; \u30CA\u30EC\u30C3\u30B8</button><div class="kpop" id="kp-${id}"></div></div>
      </div>`;
  }
}

function getTargets(){return[...document.querySelectorAll('.chip.active[data-id]')].map(c=>c.dataset.id);}
function toggleTarget(el){el.classList.toggle('active');}
function toggleAll(){const c=document.querySelectorAll('.chip[data-id]');const all=[...c].every(x=>x.classList.contains('active'));c.forEach(x=>all?x.classList.remove('active'):x.classList.add('active'));}
function toggleProject(el){el.classList.toggle('active');}
function getProjects(){return[...document.querySelectorAll('.chip.active[data-project]')].map(c=>c.dataset.project);}

function getPrevDiscussion(){
  return ORDER.map(id=>{
    const t=rawTxt[id];
    return t?`【${AGENTS[id].title} ${AGENTS[id].name}】\n${t}`:'';
  }).filter(Boolean).join('\n\n');
}

function startRoundtable(feedback){
  const input=document.getElementById('ceoInput');
  const topic=input.value.trim()||currentTopic;
  if(!topic){alert('\u30C6\u30FC\u30DE\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044');return;}
  const targets=getTargets();
  if(!targets.length){alert('\u5BFE\u8C61CXO\u3092\u9078\u629E');return;}

  currentTopic=topic;localStorage.setItem('apollo-topic',topic);
  roundNum++;localStorage.setItem('apollo-round',String(roundNum));
  // Log CEO instruction
  if(!feedback){
    ceoLog.push({round:roundNum,type:'topic',text:topic});
  } else {
    ceoLog.push({round:roundNum,type:'feedback',text:feedback});
  }
  saveCeoLog();renderCeoLog();
  document.getElementById('startBtn').disabled=true;
  document.getElementById('actionPanel').classList.add('hidden');

  const projects=getProjects();
  const fullTopic=projects.length?`[${projects.join(', ')}] ${topic}`:topic;
  const prevDisc=feedback?getPrevDiscussion():'';

  for(const id of targets){
    rawTxt[id]='';
    document.getElementById(`body-${id}`).innerHTML=`<span class="rt-tag">\uD83D\uDDE3 Round ${roundNum} \u2014 \u5F85\u6A5F\u4E2D</span>`;
    document.getElementById(`dot-${id}`).className='dot';
    document.getElementById(`st-${id}`).textContent='\u5F85\u6A5F\u4E2D';
  }
  input.value='';

  function handleSSE(line){
    if(!line.startsWith('data: '))return;
    try{
      const d=JSON.parse(line.slice(6));
      if(d.type==='agent_start'){
        const id=d.agent_id;
        document.getElementById(`dot-${id}`).className='dot working';
        document.getElementById(`st-${id}`).textContent='\u767A\u8A00\u4E2D...';
        rawTxt[id]='';
        document.getElementById(`body-${id}`).innerHTML=`<span class="rt-tag">\uD83D\uDDE3 Round ${roundNum}</span><span class="typing"></span>`;
      }
      if(d.type==='text'){
        const id=d.agent_id;const body=document.getElementById(`body-${id}`);
        rawTxt[id]+=d.content;
        body.innerHTML=`<span class="rt-tag">\uD83D\uDDE3 Round ${roundNum}</span>`+marked.parse(rawTxt[id])+'<span class="typing"></span>';
        body.scrollTop=body.scrollHeight;
        document.getElementById(`ch-${id}`).textContent=`${rawTxt[id].length}\u6587\u5B57`;
      }
      if(d.type==='agent_done'){
        const id=d.agent_id;
        document.getElementById(`body-${id}`).innerHTML=`<span class="rt-tag">\uD83D\uDDE3 Round ${roundNum}</span>`+marked.parse(rawTxt[id]);
        document.getElementById(`dot-${id}`).className='dot done';
        document.getElementById(`st-${id}`).textContent='\u767A\u8A00\u6E08';
        saveRawTxt();
      }
      if(d.type==='done'){
        // Save this round's discussions to history
        const thisRound=ORDER.map(id=>({title:AGENTS[id].title,name:AGENTS[id].name,text:rawTxt[id]||''})).filter(d=>d.text);
        roundHistory.push({round:roundNum,feedback:feedback||null,discussions:thisRound});saveRoundHistory();
        document.getElementById('startBtn').disabled=false;
        document.getElementById('feedbackBtn').disabled=false;
        const panel=document.getElementById('actionPanel');
        panel.classList.remove('hidden');
        document.getElementById('roundBadge').textContent=`Round ${roundNum} \u5B8C\u4E86`;
        document.getElementById('outputGenBtn').disabled=false;
        document.getElementById('feedbackInput').value='';
      }
      if(d.type==='error'){
        const id=d.agent_id;
        document.getElementById(`body-${id}`).innerHTML+=`<div style="color:#f44336;font-size:11px">Error: ${esc(d.content)}</div>`;
      }
    }catch(e){}
  }

  if(!feedback){
    // GET with EventSource for initial round (short URL)
    const url=`/roundtable?topic=${encodeURIComponent(fullTopic)}&order=${targets.join(',')}&projects=${encodeURIComponent(projects.join(','))}&round=${roundNum}`;
    const es=new EventSource(url);
    es.onmessage=(e)=>handleSSE('data: '+e.data);
    es.addEventListener('done',()=>es.close());
    es.onerror=()=>{es.close();document.getElementById('startBtn').disabled=false;document.getElementById('feedbackBtn').disabled=false;};
  } else {
    // POST with fetch for feedback rounds (long prev_discussion)
    fetch('/roundtable',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({topic:fullTopic,order:targets.join(','),projects:projects.join(','),round:String(roundNum),feedback,prev_discussion:prevDisc})
    }).then(res=>{
      const reader=res.body.getReader();
      const dec=new TextDecoder();
      let buf='';
      function read(){
        reader.read().then(({done,value})=>{
          if(done)return;
          buf+=dec.decode(value);
          const lines=buf.split('\n');
          buf=lines.pop();
          for(const line of lines)handleSSE(line);
          read();
        });
      }
      read();
    }).catch(()=>{document.getElementById('startBtn').disabled=false;document.getElementById('feedbackBtn').disabled=false;});
  }
}

function submitFeedback(){
  const fb=document.getElementById('feedbackInput').value.trim();
  if(!fb){alert('\u30D5\u30A3\u30FC\u30C9\u30D0\u30C3\u30AF\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044');return;}
  document.getElementById('feedbackBtn').disabled=true;
  startRoundtable(fb);
}

async function generateOutput(){
  const btn=document.getElementById('outputGenBtn');
  btn.disabled=true;btn.textContent='\u29D7 \u751F\u6210\u4E2D...';
  if(!roundHistory.length){btn.textContent='\uD83D\uDCCB \u30B3\u30D4\u30DA\u7528\u51FA\u529B\u3092\u751F\u6210';btn.disabled=false;return;}
  document.getElementById('outputModal').style.display='flex';
  const body=document.getElementById('outputModalBody');
  body.innerHTML='<span style="color:#aaa">\u29D7 \u751F\u6210\u4E2D...</span>';outputRaw='';
  try{
    const res=await fetch('/generate_output',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roundHistory,topic:currentTopic,projects:getProjects()})});
    const reader=res.body.getReader();const dec=new TextDecoder();
    function read(){reader.read().then(({done,value})=>{
      if(done)return;
      for(const line of dec.decode(value).split('\n')){
        if(!line.startsWith('data: '))continue;
        try{
          const d=JSON.parse(line.slice(6));
          if(d.type==='text'){outputRaw+=d.content;body.innerHTML=marked.parse(outputRaw);}
          if(d.type==='done'){body.innerHTML=marked.parse(outputRaw);btn.textContent='\uD83D\uDCCB \u30B3\u30D4\u30DA\u7528\u51FA\u529B\u3092\u751F\u6210';btn.disabled=false;}
          if(d.type==='error'){body.innerHTML+=`<div style="color:#f44336">Error: ${d.content}</div>`;btn.textContent='\uD83D\uDCCB \u30B3\u30D4\u30DA\u7528\u51FA\u529B\u3092\u751F\u6210';btn.disabled=false;}
        }catch(e){}
      }
      body.scrollTop=body.scrollHeight;read();
    });}
    read();
  }catch(e){body.innerHTML=`<div style="color:#f44336">Error: ${e.message}</div>`;btn.textContent='\uD83D\uDCCB \u30B3\u30D4\u30DA\u7528\u51FA\u529B\u3092\u751F\u6210';btn.disabled=false;}
}

function copyOutput(){
  navigator.clipboard.writeText(outputRaw).then(()=>{
    const b=document.querySelector('.btn-copy');const o=b.textContent;
    b.textContent='\u2713 \u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F\uFF01';
    setTimeout(()=>b.textContent=o,2000);
  });
}
function closeOutputModal(){document.getElementById('outputModal').style.display='none';}

async function resetAll(){
  if(!confirm('\u30EA\u30BB\u30C3\u30C8\u3057\u307E\u3059\u304B\uFF1F'))return;
  await fetch('/reset',{method:'POST'});
  for(const id of ORDER){
    rawTxt[id]='';
    document.getElementById(`body-${id}`).innerHTML=`<span class="placeholder">\u2615 ${AGENTS[id].name}\u306F\u90E8\u5C4B\u3067\u5F85\u6A5F\u4E2D...</span>`;
    document.getElementById(`dot-${id}`).className='dot';
    document.getElementById(`st-${id}`).textContent='\u5F85\u6A5F\u4E2D';
    document.getElementById(`ch-${id}`).textContent='0\u6587\u5B57';
  }
  document.getElementById('actionPanel').classList.add('hidden');
  currentTopic='';roundNum=0;roundHistory=[];saveRoundHistory();saveRawTxt();ceoLog=[];saveCeoLog();renderCeoLog();localStorage.removeItem('apollo-topic');localStorage.removeItem('apollo-round');
}

document.addEventListener('keydown',(e)=>{if(e.ctrlKey&&e.key==='Enter'){e.preventDefault();startRoundtable();}});

async function toggleK(id){
  const pop=document.getElementById(`kp-${id}`);
  if(pop.style.display==='block'){pop.style.display='none';return;}
  pop.innerHTML='<span style="color:#aaa">\u8AAD\u307F\u8FBC\u307F\u4E2D...</span>';
  pop.style.display='block';
  document.querySelectorAll('.kpop').forEach(p=>{if(p!==pop)p.style.display='none';});
  const res=await fetch(`/api/knowledge/${id}`);
  const items=await res.json();
  if(!items.length){
    pop.innerHTML='<div class="kpop-title">\u84C4\u7A4D\u30CA\u30EC\u30C3\u30B8</div><span style="color:#aaa">\u307E\u3060\u306A\u3044</span>';
    return;
  }
  pop.innerHTML=`<div class="kpop-title">\u84C4\u7A4D\u30CA\u30EC\u30C3\u30B8 (${items.length})</div>`+
    items.map(k=>`<div class="kpop-item">
      <button class="kpop-pin ${k.is_pinned?'pinned':''}" onclick="pinK('${id}','${k.id}',this)">
        ${k.is_pinned?'\u2605':'\u2606'}
      </button>
      <div>
        <div class="kpop-text">${esc(k.text)}</div>
        ${k.tags&&k.tags.length?`<div class="kpop-tags">${k.tags.map(t=>`<span class="kpop-tag">${esc(t)}</span>`).join('')}</div>`:''}
        <div class="kpop-meta">\u6D3B\u7528${k.usage_count||0}\u56DE</div>
      </div>
      <button class="kpop-del" onclick="delK('${id}','${k.id}')">\u00D7</button>
    </div>`).join('');
}

async function pinK(agentId, itemId, btn){
  const res=await fetch(`/api/knowledge/${agentId}/pin/${itemId}`,{method:'POST'});
  const item=await res.json();
  btn.className='kpop-pin '+(item.is_pinned?'pinned':'');
  btn.textContent=item.is_pinned?'\u2605':'\u2606';
}

async function delK(agentId, itemId){
  await fetch(`/api/knowledge/${agentId}/items/${itemId}`,{method:'DELETE'});
  toggleK(agentId);
}
document.addEventListener('click',(e)=>{if(!e.target.closest('.card-foot'))document.querySelectorAll('.kpop').forEach(p=>p.style.display='none');});

createFloors();
// Restore card content from localStorage on page load
(function restoreCards(){
  for(const id of ORDER){
    if(rawTxt[id]){
      document.getElementById(`body-${id}`).innerHTML=`<span class="rt-tag">\uD83D\uDDE3 Round ${roundNum}</span>`+marked.parse(rawTxt[id]);
      document.getElementById(`dot-${id}`).className='dot done';
      document.getElementById(`st-${id}`).textContent='\u5B8C\u4E86';
      document.getElementById(`ch-${id}`).textContent=`${rawTxt[id].length}\u6587\u5B57`;
    }
  }
  if(roundHistory.length){
    document.getElementById('actionPanel').classList.remove('hidden');
    document.getElementById('roundBadge').textContent=`Round ${roundNum} \u5B8C\u4E86`;
    document.getElementById('outputGenBtn').disabled=false;
    renderCeoLog();
  }
})();
</script>
</body>
</html>"""

if __name__ == "__main__":
    print("\nApollo Mansion CXO Agent Office starting...")
    print("Open http://localhost:5000 in your browser\n")
    app.run(debug=True, port=5000, threaded=True)
