import anthropic
import os
import json
import time
import threading
import re
from flask import Flask, Response, request, jsonify, send_from_directory
from dotenv import load_dotenv

load_dotenv()

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="/static")
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
        "category": "B2C SaaS",
        "status": "MVP公開中・有料化準備",
        "tech": "React 19 + Vite + TypeScript + localStorage + Express + Anthropic SDK + Stripe",
        "monetization": "¥500/月 or ¥3,500/年 (7日無料トライアル)",
        "monthly_cost": 1000,
        "monthly_revenue": 0,
        "mau": 0,
        "description": """## プロジェクト: Logic
ビジネスパーソン向けロジカルシンキング学習アプリ。
- 技術: React 19 + Vite + TypeScript + localStorage + Express + Anthropic SDK
- 機能: ロジカルシンキングレッスン(MECE/ロジックツリー/So What・Why So/ピラミッド原則)、フラッシュカード、AI問題生成(無料1日10問/プレミアム月300問)、デイリー問題、偏差値スコア
- BETA(管理者モードのみ): 簿記3級/2級、PMBOK、模擬試験
- 課金: 7日無料トライアル → ¥500/月 or ¥3,500/年
- 対象: ロジカルシンキング・論理的思考力を鍛えたいビジネスパーソン
- リポジトリ: keitaurano-del/logic""",
    },
    "千石茶道": {
        "url_prod": "https://sengoku-chakai.onrender.com/ja",
        "category": "B2C 予約サイト",
        "status": "本番稼働中",
        "tech": "Next.js 16 + TypeScript + Prisma + PostgreSQL + Stripe + i18n",
        "monetization": "予約決済 (1回 ¥9,000〜¥25,000)",
        "monthly_cost": 2000,
        "monthly_revenue": 0,
        "mau": 0,
        "description": """## プロジェクト: 千石茶道
インバウンド外国人向け本格茶道体験の予約・決済サイト。
- 技術: Next.js 16 (App Router) + TypeScript + Prisma + PostgreSQL + Stripe
- 機能: 多言語対応(日/英/中)、松竹梅プラン(¥9,000/¥15,000/¥25,000)、Stripe決済、管理画面
- 対象: インバウンド観光客 (Viator/GetYourGuide流入想定)
- リポジトリ: keitaurano-del/sengoku-chakai""",
    },
    "Apollo Mansion": {
        "url_prod": "https://symmetrical-broccoli-97pw5gv6jp94h7jjg-5000.app.github.dev/",
        "category": "内部ツール",
        "status": "Keita専用稼働中",
        "tech": "Python + Flask + Anthropic SDK + JSON永続化",
        "monetization": "(内部ツール)",
        "monthly_cost": 500,
        "monthly_revenue": 0,
        "mau": 1,
        "description": """## プロジェクト: Apollo Mansion
CXOエージェント管理システム(本システム)。
- 技術: Python + Flask 単一ファイル + SSE + Anthropic Claude API
- 機能: CXO5名(CSO/CFO/CMO/CTO/CPO)円卓会議、フィードバックループ、コピペ出力生成、デザインプレビュー、ナレッジ蓄積
- 対象: CEO Keita による経営意思決定支援
- リポジトリ: keitaurano-del/cxo-agent""",
    },
}

_saved = load_conversations_from_disk()
for agent_id in AGENTS:
    conversations[agent_id] = _saved.get(agent_id, [])


@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


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

        # ============================================================
        # Phase 1: 初期意見表明 (Opening positions)
        # 各 CXO が構造的な主張を出す。空気を読まず独立した立場で。
        # ============================================================
        opening_instructions = f"""

## 円卓会議モード — Phase 1 / 初期意見表明

あなたは {{title}} として、テーマに対して**独立した立場**で意見を述べます。

### 必須の構造 (この見出しを必ず使ってください)
**【主張】** 1〜2 文で結論
**【根拠 1】** 専門領域の観点から
**【根拠 2】** データ/事実/前例から
**【根拠 3】** リスク/コスト/制約から
**【見落とされがちなリスク】** 他の CXO が触れない可能性のある盲点を 1 つ
**【新しい角度】** 既存の議論パターンや先入観を打ち破る、独自のアイデアを 1 つ

### 厳守ルール
- **他の CXO の発言に同意も反論もしない**: Phase 1 はあくまで独立した意見表明。後で Phase 2 で議論する
- 既存ナレッジから「過去にこう言ったから今回もこう言う」という慣性を排除する
- 「みんな同じ結論」を避けるため、自分の専門性で**独自の角度**を必ず出す
- 700〜1000 文字
- {{title}}としての専門性を全面に出す
- 抽象論で逃げない: 数字/期間/具体ファイル名/具体プロジェクト名を入れる
"""

        discussion = []
        # ---------- Phase 1 ----------
        yield f"data: {json.dumps({'type': 'phase', 'phase': 1, 'label': '初期意見表明'}, ensure_ascii=False)}\n\n"
        for agent_id in order:
            agent = AGENTS[agent_id]
            roundtable_system = (
                agent["system"]
                + proj_ctx
                + get_knowledge_prompt(agent_id, topic=topic)
                + opening_instructions.format(title=agent["title"])
                + feedback_ctx
            )
            # NOTE: Phase 1 では他の CXO の発言を見せない (空気読み防止)
            msg = f"【円卓会議テーマ】{topic}\n\n上記テーマについて、{agent['title']}として独立した意見を、上記の必須構造に従って述べてください。"
            yield f"data: {json.dumps({'type': 'agent_start', 'agent_id': agent_id, 'phase': 1}, ensure_ascii=False)}\n\n"
            full_text = ""
            try:
                with client.messages.stream(
                    model="claude-sonnet-4-6",
                    max_tokens=2200,
                    system=roundtable_system,
                    messages=[{"role": "user", "content": msg}],
                ) as s:
                    for text in s.text_stream:
                        full_text += text
                        yield f"data: {json.dumps({'type': 'text', 'agent_id': agent_id, 'content': text}, ensure_ascii=False)}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'agent_id': agent_id, 'content': str(e)}, ensure_ascii=False)}\n\n"
                continue
            discussion.append({"id": agent_id, "phase": 1, "text": full_text})
            conversations[agent_id].append({"role": "user", "content": f"[円卓会議 Phase 1] テーマ: {topic}"})
            conversations[agent_id].append({"role": "assistant", "content": full_text})
            yield f"data: {json.dumps({'type': 'agent_done', 'agent_id': agent_id, 'phase': 1}, ensure_ascii=False)}\n\n"

        # ============================================================
        # Phase 2: 相互反論ラウンド (Debate)
        # 各 CXO が他の CXO の意見を見て、最低 1 つは反論し、新角度を追加
        # ============================================================
        yield f"data: {json.dumps({'type': 'phase', 'phase': 2, 'label': '相互反論'}, ensure_ascii=False)}\n\n"

        all_openings = "\n\n".join(
            f"### {AGENTS[e['id']]['title']} {AGENTS[e['id']]['name']} の意見\n{e['text']}"
            for e in discussion
        )

        debate_instructions = """

## 円卓会議モード — Phase 2 / 相互反論

Phase 1 で全員が独立した意見を出しました。今度はそれらを批判的に検討します。
**CEO の判断を待たず、CXO 同士で建設的に議論してください。**

### 必須の構造
**【最も同意できない点】** 他の CXO 1 名 (氏名を明記) の主張のうち、最も筋が通らない/前提が怪しい/見落としがある点を具体的に指摘 (3〜5 文)
**【その理由】** なぜ筋が通らないか。データ/論理/経験から
**【代替案】** その点に対する自分の代替提案
**【別の CXO の見落とし】** さらに別の 1 名の発言で見落とされている要素を 1 つ
**【自分の主張のアップデート】** Phase 1 の自分の意見を、他の CXO の発言を踏まえてどう修正/強化するか
**【全員が見落としている可能性】** 5 名全員が触れていない、本当の盲点を 1 つ提案

### 厳守ルール
- **必ず他の CXO の固有名詞を出して批判する**: 「のび太の主張は…」のように具体的に
- **同意で終わらない**: 「全員の意見に賛成」は禁止。最低 1 つは明確な不同意を示す
- **空気を読まない**: 多数派に流されず、自分の専門性に基づいて孤立してでも反論する
- **新しい角度を入れる**: Phase 1 で自分が出したのとは別の新しい論点を最低 1 つ追加
- 700〜1000 文字
- 反論は人格批判ではなく論理批判。建設的に
"""

        for agent_id in order:
            agent = AGENTS[agent_id]
            debate_system = (
                agent["system"]
                + proj_ctx
                + get_knowledge_prompt(agent_id, topic=topic)
                + debate_instructions
                + feedback_ctx
            )
            msg = f"""【円卓会議テーマ】{topic}

## Phase 1 で全員が出した意見
{all_openings}

あなたは {agent['title']} {agent['name']} です。
Phase 1 の他の CXO の意見を批判的に読み、上記の必須構造に従って反論してください。
固有名詞 (のび太/スネ夫/出木杉/ドラえもん/ドラミ) を必ず出してください。"""

            yield f"data: {json.dumps({'type': 'agent_start', 'agent_id': agent_id, 'phase': 2}, ensure_ascii=False)}\n\n"
            full_text = ""
            try:
                with client.messages.stream(
                    model="claude-sonnet-4-6",
                    max_tokens=2200,
                    system=debate_system,
                    messages=[{"role": "user", "content": msg}],
                ) as s:
                    for text in s.text_stream:
                        full_text += text
                        yield f"data: {json.dumps({'type': 'text', 'agent_id': agent_id, 'content': text}, ensure_ascii=False)}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'agent_id': agent_id, 'content': str(e)}, ensure_ascii=False)}\n\n"
                continue
            discussion.append({"id": agent_id, "phase": 2, "text": full_text})
            conversations[agent_id].append({"role": "user", "content": f"[円卓会議 Phase 2] テーマ: {topic}"})
            conversations[agent_id].append({"role": "assistant", "content": full_text})
            save_conversations_to_disk()
            threading.Thread(target=summarize_and_learn, args=(agent_id, full_text, topic), daemon=True).start()
            yield f"data: {json.dumps({'type': 'agent_done', 'agent_id': agent_id, 'phase': 2}, ensure_ascii=False)}\n\n"

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


@app.route("/api/health")
def api_health():
    return jsonify({"ok": True, "ts": time.time()})


@app.route("/api/projects")
def api_projects():
    """Return all project metadata for the business plan tab."""
    return jsonify([
        {
            "name": name,
            "url": p.get("url_prod", ""),
            "category": p.get("category", ""),
            "status": p.get("status", ""),
            "tech": p.get("tech", ""),
            "monetization": p.get("monetization", ""),
            "monthly_cost": p.get("monthly_cost", 0),
            "monthly_revenue": p.get("monthly_revenue", 0),
            "mau": p.get("mau", 0),
        }
        for name, p in PROJECTS.items()
    ])


@app.route("/api/business-summary", methods=["POST"])
def api_business_summary():
    """Generate AI business summary based on financial inputs.
    Note: Keita builds everything alone — NO labor costs."""
    data = request.json or {}
    mau = data.get("mau", 100)
    conv_rate = data.get("convRate", 20)
    monthly_price = data.get("monthlyPrice", 500)
    yearly_price = data.get("yearlyPrice", 3500)
    monthly_ratio = data.get("monthlyRatio", 70)
    api_cost = data.get("apiCostPerProblem", 1.5)
    problems_per_user = data.get("problemsPerUser", 50)
    hosting = data.get("hosting", 0)

    # Calculate metrics (no labor cost)
    paid_users = mau * conv_rate / 100
    monthly_users = paid_users * monthly_ratio / 100
    yearly_users = paid_users * (100 - monthly_ratio) / 100
    revenue = (monthly_users * monthly_price) + (yearly_users * yearly_price / 12)
    ai_cost = paid_users * problems_per_user * api_cost
    stripe_fee = revenue * 0.036
    var_cost = ai_cost + stripe_fee + hosting
    profit = revenue - var_cost

    metrics_text = f"""【現在の財務指標】
- MAU: {int(mau)}人
- トライアル→有料転換率: {conv_rate}%
- 有料ユーザー: {int(paid_users)}人 (月額{int(monthly_users)} / 年額{int(yearly_users)})
- 月次売上: ¥{int(revenue):,}
- 月次AIコスト: ¥{int(ai_cost):,}
- 月次Stripe手数料: ¥{int(stripe_fee):,}
- 月次変動費合計: ¥{int(var_cost):,}
- 月次粗利: ¥{int(profit):,}

※ Keita 1人で全プロジェクトを開発しているため人件費はゼロ。"""

    def generate():
        try:
            with client.messages.stream(
                model="claude-sonnet-4-5",
                max_tokens=1500,
                system="""あなたはCEO Keita専属の事業アドバイザーAIです。
Keitaは1人で複数のプロダクトを開発しているソロプレナー。人件費はゼロです。
財務指標を見て、以下のフォーマットで簡潔に回答してください:

## 📊 現状診断 (3行以内)
(数字から見える現在の事業状態を率直に)

## ⚠️ 最優先で直すべき1点
(最もインパクトのある改善点を1つだけ)

## 🎯 来週やるべき1アクション
(「フェーズ2で〜」のような未来への先送りは禁止。来週中にKeitaが具体的に着手できる1つだけ)

ルール:
- 人件費・人月・外注費の項目は一切含めない
- 「数ヶ月後に〜」という発言は禁止
- 具体的な数字とアクションで語る
- Markdown形式で簡潔に""",
                messages=[{"role": "user", "content": metrics_text}],
            ) as s:
                for text in s.text_stream:
                    yield f"data: {json.dumps({'type': 'text', 'content': text}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)}, ensure_ascii=False)}\n\n"

    return Response(generate(), mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/api/summarize", methods=["POST"])
def api_summarize():
    data = request.json or {}
    text = data.get("text", "")
    if not text or len(text) < 30:
        return jsonify({"summary": text})
    try:
        result = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=100,
            system="ユーザーの入力テキストを1〜2文（50文字以内）で要約してください。要約のみを返してください。",
            messages=[{"role": "user", "content": text}],
        )
        return jsonify({"summary": result.content[0].text.strip()})
    except Exception:
        return jsonify({"summary": text[:50] + "..."})


@app.route("/api/design-preview", methods=["POST"])
def api_design_preview():
    data = request.json or {}
    discussion = data.get("discussion", "")
    feedback = data.get("feedback", "")
    previous_html = data.get("previous_html", "")

    parts = []
    if discussion:
        parts.append(f"## CXO議論内容\n{discussion[:6000]}")
    if previous_html:
        parts.append(f"## 前回のデザイン\n```html\n{previous_html[:4000]}\n```")
    if feedback:
        parts.append(f"## CEOフィードバック\n{feedback}")

    def generate():
        try:
            with client.messages.stream(
                model="claude-sonnet-4-6",
                max_tokens=16000,
                system="""あなたはUIデザイナーAIです。CXOの議論内容に基づいて、提案されたUI/デザイン変更のHTMLモックアップを生成してください。

ルール:
- 完全に自己完結したHTMLを生成（inline CSSのみ、外部依存なし）
- モバイル対応のレスポンシブデザイン
- 日本語のUIテキスト
- シンプルで美しいデザイン
- <!DOCTYPE html>から</html>まで完全なHTMLドキュメントを必ず返す
- 必ず</html>で終わらせる（途中で止めない）
- コードブロックやマークダウンで囲まず、生のHTMLのみを返す
- 簡潔に：1ページのモックアップを完結させることを優先""",
                messages=[{"role": "user", "content": "\n\n".join(parts)}],
            ) as s:
                for text in s.text_stream:
                    yield f"data: {json.dumps({'type': 'text', 'content': text}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)}, ensure_ascii=False)}\n\n"

    return Response(generate(), mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})



# ============================================================
# Workflow tab — visualize harness Agent invocations
# ============================================================

import glob as _glob

PROJECTS_DIR = os.path.expanduser("~/.claude/projects/-workspaces-cxo-agent")
EDIT_LOG_PATH = os.path.expanduser("~/.claude/file-history/logic-edits.log")
ACTIVE_SPRINT_PATH = "/workspaces/logic/.claude/sprints/active.md"

_workflow_cache = {}  # path -> (mtime, size, parsed_dict)


def _list_jsonl_sessions():
    if not os.path.isdir(PROJECTS_DIR):
        return []
    files = _glob.glob(os.path.join(PROJECTS_DIR, "*.jsonl"))
    out = []
    for p in files:
        try:
            st = os.stat(p)
            out.append({
                "session_id": os.path.basename(p).replace(".jsonl", ""),
                "mtime": st.st_mtime,
                "size": st.st_size,
            })
        except OSError:
            continue
    out.sort(key=lambda x: x["mtime"], reverse=True)
    return out


def _latest_jsonl():
    sessions = _list_jsonl_sessions()
    if not sessions:
        return None
    return os.path.join(PROJECTS_DIR, sessions[0]["session_id"] + ".jsonl")


def _trim(s, n=240):
    if s is None:
        return ""
    s = str(s)
    if len(s) <= n:
        return s
    return s[:n] + "…"


def _parse_workflow(path):
    """Parse a Claude Code session .jsonl and extract Agent tool_use/tool_result pairs."""
    try:
        st = os.stat(path)
    except OSError:
        return None
    key = path
    cached = _workflow_cache.get(key)
    if cached and cached[0] == st.st_mtime and cached[1] == st.st_size:
        return cached[2]

    agents_by_id = {}  # tool_use_id -> agent dict
    order = []

    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                msg = obj.get("message") or {}
                ts = obj.get("timestamp") or ""
                content = msg.get("content")
                if not isinstance(content, list):
                    continue
                for block in content:
                    if not isinstance(block, dict):
                        continue
                    btype = block.get("type")
                    if btype == "tool_use" and block.get("name") == "Agent":
                        tid = block.get("id")
                        inp = block.get("input") or {}
                        sub = inp.get("subagent_type") or "general-purpose"
                        desc = inp.get("description") or ""
                        prompt = inp.get("prompt") or ""
                        if tid and tid not in agents_by_id:
                            agents_by_id[tid] = {
                                "id": tid,
                                "subagent_type": sub,
                                "description": desc,
                                "prompt_preview": _trim(prompt, 260),
                                "started_at": ts,
                                "ended_at": None,
                                "status": "running",
                                "result_preview": "",
                                "depth": 0,
                            }
                            order.append(tid)
                    elif btype == "tool_result":
                        tid = block.get("tool_use_id")
                        if tid and tid in agents_by_id:
                            a = agents_by_id[tid]
                            a["ended_at"] = ts
                            is_error = bool(block.get("is_error"))
                            a["status"] = "error" if is_error else "done"
                            rc = block.get("content")
                            if isinstance(rc, list):
                                parts = []
                                for rb in rc:
                                    if isinstance(rb, dict) and rb.get("type") == "text":
                                        parts.append(rb.get("text", ""))
                                a["result_preview"] = _trim("\n".join(parts), 260)
                            elif isinstance(rc, str):
                                a["result_preview"] = _trim(rc, 260)
    except OSError:
        return None

    agents = [agents_by_id[i] for i in order]
    result = {
        "session_id": os.path.basename(path).replace(".jsonl", ""),
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(st.st_mtime)),
        "agents": agents,
    }
    _workflow_cache[key] = (st.st_mtime, st.st_size, result)
    return result


def _read_edit_log(n=15):
    if not os.path.isfile(EDIT_LOG_PATH):
        return []
    try:
        with open(EDIT_LOG_PATH, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except OSError:
        return []
    out = []
    for line in lines[-n:]:
        parts = line.strip().split(None, 2)
        if len(parts) >= 3:
            out.append({"ts": parts[0], "tool": parts[1], "path": parts[2]})
        elif parts:
            out.append({"ts": "", "tool": "", "path": line.strip()})
    return out


def _read_active_sprint():
    if not os.path.isfile(ACTIVE_SPRINT_PATH):
        return {"exists": False, "title": None, "criteria_total": 0, "criteria_done": 0}
    try:
        with open(ACTIVE_SPRINT_PATH, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
    except OSError:
        return {"exists": False, "title": None, "criteria_total": 0, "criteria_done": 0}
    if not text.strip():
        return {"exists": False, "title": None, "criteria_total": 0, "criteria_done": 0}
    title = None
    m = re.search(r"^#\s*(?:Sprint:\s*)?(.+)$", text, re.MULTILINE)
    if m:
        title = m.group(1).strip()
    total = len(re.findall(r"^\s*- \[[ x?]\]", text, re.MULTILINE))
    done = len(re.findall(r"^\s*- \[x\]", text, re.MULTILINE))
    return {"exists": True, "title": title, "criteria_total": total, "criteria_done": done}


# ---------- Direct Planner / CXO task (bypass roundtable) ----------

PLANNER_TASKS_FILE = os.path.join(PROJECT_DIR, "planner-tasks.json")
UI_VERSIONS_FILE = os.path.join(PROJECT_DIR, "ui-versions.json")

PLANNER_SYSTEM_BASE = """あなたは Logic プロジェクトの Planner です。CEO Keita からの 1〜4 行の指示を受け、Logic ハーネスの sprint contract (active.md) 形式に落とし込みます。

# 責務
- 指示の意図を汲み、実装可能な scope に分解する
- 「何を作るか」だけを書く。「どう実装するか」には踏み込まない
- Acceptance criteria を検証可能な checkbox 形式で列挙する（最低 5 項目、最大 15 項目）
- Out of scope も必ず書く

# 出力フォーマット
Markdown のみ。前置きなし。

```
# Sprint: <タイトル>
Date: YYYY-MM-DD
Goal: <1 文>

## Scope
- ...

## Acceptance criteria
### Type & build
- [ ] `npx tsc -b --noEmit` exits 0
- [ ] `npm run build` exits 0
### <カテゴリ>
- [ ] ...

## Out of scope
- ...
```

日本語で書くこと。簡潔に。"""


def _load_json_safe(path, default):
    if not os.path.isfile(path):
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _save_json_safe(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


@app.route("/api/direct-task", methods=["POST"])
def api_direct_task():
    """User instructs Planner or a specific CXO directly, bypassing the full roundtable."""
    data = request.json or {}
    instruction = (data.get("instruction") or "").strip()
    agent_id = data.get("agent_id") or "planner"
    if not instruction:
        return jsonify({"error": "instruction required"}), 400

    if agent_id == "planner":
        system = PLANNER_SYSTEM_BASE + get_knowledge_prompt("planner", topic=instruction[:200])
        display = "Planner"
    elif agent_id in AGENTS:
        a = AGENTS[agent_id]
        system = (
            a["system"]
            + get_knowledge_prompt(agent_id, topic=instruction[:200])
            + "\n\n# 今回のモード\nCEO Keita から直接タスクが割り当てられました。会議を経由せず、単独で具体的に回答してください。"
        )
        display = f"{a['title']} {a['name']}"
    else:
        return jsonify({"error": f"unknown agent: {agent_id}"}), 400

    try:
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2500,
            system=system,
            messages=[{"role": "user", "content": instruction}],
        )
        result = resp.content[0].text if resp.content else ""
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    task = {
        "id": "t_" + str(int(time.time() * 1000)),
        "agent_id": agent_id,
        "display": display,
        "instruction": instruction,
        "result": result,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    tasks = _load_json_safe(PLANNER_TASKS_FILE, [])
    tasks.append(task)
    tasks = tasks[-100:]
    _save_json_safe(PLANNER_TASKS_FILE, tasks)

    # 成長: 回答から学びを抽出して knowledge/{agent_id}.json に蓄積
    threading.Thread(
        target=summarize_and_learn,
        args=(agent_id, result, instruction[:80]),
        daemon=True,
    ).start()
    return jsonify(task)


@app.route("/api/planner-tasks")
def api_planner_tasks_list():
    return jsonify(_load_json_safe(PLANNER_TASKS_FILE, []))


@app.route("/api/planner-tasks/<task_id>", methods=["DELETE"])
def api_planner_tasks_delete(task_id):
    tasks = _load_json_safe(PLANNER_TASKS_FILE, [])
    tasks = [t for t in tasks if t.get("id") != task_id]
    _save_json_safe(PLANNER_TASKS_FILE, tasks)
    return jsonify({"ok": True})


# ---------- UI versions (Logic 画面の修正案を版管理) ----------

@app.route("/api/ui-versions")
def api_ui_versions_list():
    return jsonify(_load_json_safe(UI_VERSIONS_FILE, []))


@app.route("/api/ui-fix", methods=["POST"])
def api_ui_fix():
    """ドラミ (CPO/デザイナー) が指定箇所への修正案を生成し、自動でバージョンとして保存する。"""
    data = request.json or {}
    comment = (data.get("comment") or "").strip()
    screen = (data.get("screen") or "").strip()
    base_url = (data.get("url") or "").strip()
    pin_x = data.get("x")
    pin_y = data.get("y")
    base_version_id = data.get("base_version_id")
    if not comment:
        return jsonify({"error": "comment required"}), 400

    base_note = ""
    if base_version_id:
        base = next((v for v in _load_json_safe(UI_VERSIONS_FILE, []) if v.get("id") == base_version_id), None)
        if base:
            base_note = f"\n\n（前バージョン「{base['title']}」への追加修正として扱ってください。既存メモ: {base.get('notes', '')[:300]}）"

    cpo = AGENTS.get("cpo", {})
    system = cpo.get("system", "") + get_knowledge_prompt("cpo", topic=comment[:200]) + """

# 今回のモード — UI デザイナーとしての修正指示
CEO Keita が Apollo Mansion の UI プレビュー上でコメントピンを立て、特定箇所の修正を依頼しました。
あなたは Logic アプリの UX / UI デザイナーとして、その箇所だけを直します。

# 出力フォーマット（厳密な JSON。前後に説明文を付けない）
{
  "title": "20 文字以内の短いタイトル",
  "description": "1 文で変更概要",
  "notes": "修正の詳細メモ（箇条書き可、150 文字程度）。何を・どこを・なぜ変えるか",
  "html_snippet": "変更後の該当部分の HTML/JSX 断片（短く。100-300 文字。実装の参考用）"
}
"""
    coord_str = f"(x={pin_x}%, y={pin_y}%)" if pin_x is not None and pin_y is not None else "（座標情報なし）"
    user_msg = f"""【対象画面】{screen or "/"}（{base_url or "Logic live"}）
【コメント位置】{coord_str}
【CEO のコメント】
{comment}{base_note}

上記コメントに対して、ドラミとして UX / UI 修正案を JSON で返してください。他の箇所は一切変更しないこと。"""

    try:
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1500,
            system=system,
            messages=[{"role": "user", "content": user_msg}],
        )
        raw = resp.content[0].text if resp.content else ""
        m = re.search(r"\{[\s\S]*\}", raw)
        if not m:
            return jsonify({"error": "no JSON in response", "raw": raw}), 500
        parsed = json.loads(m.group(0))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    notes_full = (parsed.get("notes") or "") + "\n\n---\n【元コメント】\n" + comment
    if parsed.get("html_snippet"):
        notes_full += "\n\n【修正スニペット】\n" + parsed["html_snippet"]

    version = {
        "id": "v_" + str(int(time.time() * 1000)),
        "title": parsed.get("title") or "ドラミによる修正案",
        "description": parsed.get("description") or "",
        "notes": notes_full,
        "screen": screen,
        "url": "",  # 現行 URL を継承
        "parent_id": base_version_id,
        "pin": {"x": pin_x, "y": pin_y} if pin_x is not None else None,
        "comment": comment,
        "author": "ドラミ（CPO/デザイナー）",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    versions = _load_json_safe(UI_VERSIONS_FILE, [])
    versions.append(version)
    _save_json_safe(UI_VERSIONS_FILE, versions)

    # 成長: ドラミの UI 修正回答からも学びを蓄積
    learn_text = f"【コメント】{comment}\n【修正案タイトル】{parsed.get('title', '')}\n【メモ】{parsed.get('notes', '')}"
    threading.Thread(
        target=summarize_and_learn,
        args=("cpo", learn_text, comment[:80]),
        daemon=True,
    ).start()
    return jsonify(version)


@app.route("/api/ui-versions", methods=["POST"])
def api_ui_versions_create():
    data = request.json or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "title required"}), 400
    version = {
        "id": "v_" + str(int(time.time() * 1000)),
        "title": title,
        "description": (data.get("description") or "").strip(),
        "notes": (data.get("notes") or "").strip(),
        "screen": (data.get("screen") or "").strip(),
        "url": (data.get("url") or "").strip(),
        "parent_id": data.get("parent_id"),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    versions = _load_json_safe(UI_VERSIONS_FILE, [])
    versions.append(version)
    _save_json_safe(UI_VERSIONS_FILE, versions)
    return jsonify(version)


@app.route("/api/ui-versions/<version_id>", methods=["PATCH"])
def api_ui_versions_update(version_id):
    data = request.json or {}
    versions = _load_json_safe(UI_VERSIONS_FILE, [])
    updated = None
    for v in versions:
        if v.get("id") == version_id:
            for k in ("title", "description", "notes", "screen", "url"):
                if k in data:
                    v[k] = (data[k] or "").strip()
            updated = v
            break
    if not updated:
        return jsonify({"error": "not found"}), 404
    _save_json_safe(UI_VERSIONS_FILE, versions)
    return jsonify(updated)


@app.route("/api/ui-versions/<version_id>", methods=["DELETE"])
def api_ui_versions_delete(version_id):
    versions = _load_json_safe(UI_VERSIONS_FILE, [])
    versions = [v for v in versions if v.get("id") != version_id]
    _save_json_safe(UI_VERSIONS_FILE, versions)
    return jsonify({"ok": True})


@app.route("/api/consultant-review", methods=["POST"])
def api_consultant_review():
    """External consultant evaluates the 5 CXOs' performance in the just-finished discussion."""
    data = request.json or {}
    topic = data.get("topic", "")
    discussion = data.get("discussion", {})  # { cso: "...", cfo: "...", ... }
    if not topic or not discussion:
        return jsonify({"error": "topic and discussion required"}), 400

    discussion_text = "\n\n".join(
        f"### {AGENTS[aid]['title']} {AGENTS[aid]['name']}\n{text}"
        for aid, text in discussion.items()
        if aid in AGENTS
    )

    system = """あなたは Apollo Mansion に外部委託された戦略コンサルタントです。社内の人間関係・忖度・過去の貢献は一切考慮せず、今回の会議での発言だけを冷徹に評価します。

評価の 5 項目（各 0-5 点）:
1. sharpness — 論点の鋭さ（本質を突いているか、抽象論で逃げていないか）
2. originality — 独自性（他の CXO と差別化されているか、専門性が出ているか）
3. evidence — 根拠の強さ（データ・数字・具体名で裏づけされているか）
4. risk — リスク把握（盲点・副作用・コストへの言及があるか）
5. feasibility — 実行可能性（実際に動かせる提案か）

必ず差をつけること。全員 5 点満点は禁止。忖度禁止。
"""
    user_msg = f"""【議題】{topic}

【各 CXO の発言】
{discussion_text}

上記発言だけを基に、各 CXO を評価してください。必ず以下の厳密な JSON フォーマットで出力してください（前後に説明文を付けない）:

{{
  "reviews": [
    {{"agent_id": "cso", "scores": {{"sharpness": 0, "originality": 0, "evidence": 0, "risk": 0, "feasibility": 0}}, "total": 0, "strengths": "", "weaknesses": "", "advice": ""}},
    {{"agent_id": "cfo", ...}},
    {{"agent_id": "cmo", ...}},
    {{"agent_id": "cto", ...}},
    {{"agent_id": "cpo", ...}}
  ],
  "overall": ""
}}

strengths / weaknesses / advice はそれぞれ 1 文で具体的に日本語で書くこと。overall は 2-3 文。"""

    try:
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2500,
            system=system,
            messages=[{"role": "user", "content": user_msg}],
        )
        raw = resp.content[0].text if resp.content else ""
        # strip any stray fences
        m = re.search(r"\{[\s\S]*\}", raw)
        if not m:
            return jsonify({"error": "no JSON in response", "raw": raw}), 500
        parsed = json.loads(m.group(0))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # 成長: 外部コンサルの指摘を各 CXO の knowledge に書き戻す
    try:
        for rev in parsed.get("reviews", []):
            aid = rev.get("agent_id")
            if aid not in AGENTS:
                continue
            weakness = rev.get("weaknesses", "").strip()
            advice = rev.get("advice", "").strip()
            if not weakness and not advice:
                continue
            learn_text = f"外部コンサル指摘: {weakness} → 改善: {advice}"
            k = load_knowledge(aid)
            existing = {it.get("text") for it in k.get("learnings", []) if isinstance(it, dict)}
            if learn_text not in existing:
                k["learnings"].append({
                    "id": _make_knowledge_id(),
                    "text": learn_text,
                    "tags": ["外部評価", "改善点"],
                    "is_pinned": False,
                    "usage_count": 0,
                    "session_topic": topic[:80],
                    "created_at": time.strftime("%Y-%m-%d %H:%M"),
                })
                k["learnings"] = k["learnings"][-30:]
                save_knowledge(aid, k)
                time.sleep(0.002)
    except Exception:
        pass
    return jsonify(parsed)


@app.route("/api/workflow/sessions")
def api_workflow_sessions():
    return jsonify(_list_jsonl_sessions())


@app.route("/api/workflow")
def api_workflow():
    session_id = request.args.get("session")
    if session_id:
        path = os.path.join(PROJECTS_DIR, session_id + ".jsonl")
        if not os.path.isfile(path):
            return jsonify({"error": "session not found"}), 404
    else:
        path = _latest_jsonl()
        if not path:
            return jsonify({
                "session_id": None,
                "updated_at": None,
                "agents": [],
                "file_edits": _read_edit_log(),
                "active_sprint": _read_active_sprint(),
            })
    parsed = _parse_workflow(path)
    if parsed is None:
        return jsonify({"error": "failed to parse"}), 500
    parsed = dict(parsed)
    parsed["file_edits"] = _read_edit_log()
    parsed["active_sprint"] = _read_active_sprint()
    return jsonify(parsed)


# ---------- Logic spec data sync (1 day stale check) ----------

LOGIC_SPEC_FILE = os.path.join(PROJECT_DIR, "static", "js", "logic-spec-data.js")
LOGIC_SPEC_TTL_SEC = 24 * 3600  # 24 時間


def _maybe_refresh_logic_spec():
    """logic-spec-data.js が無いか 24h 以上古ければ sync_logic_spec を実行する。"""
    try:
        needs_refresh = True
        if os.path.isfile(LOGIC_SPEC_FILE):
            age = time.time() - os.path.getmtime(LOGIC_SPEC_FILE)
            needs_refresh = age > LOGIC_SPEC_TTL_SEC
        if not needs_refresh:
            return
        # スタンドアロンスクリプトを subprocess で叩く（import 衝突回避）
        import subprocess
        script = os.path.join(PROJECT_DIR, "scripts", "sync_logic_spec.py")
        if os.path.isfile(script):
            subprocess.run(["python", script], check=False, timeout=15)
    except Exception as e:
        print(f"[logic-spec sync] skipped: {e}")


# 起動時に 1 度実行（バックグラウンドで、HTTP 起動はブロックしない）
threading.Thread(target=_maybe_refresh_logic_spec, daemon=True).start()


@app.route("/api/spec/refresh", methods=["POST"])
def api_spec_refresh():
    """手動再同期用エンドポイント。Logic 側を更新した直後に叩くと即反映される。"""
    try:
        import subprocess
        script = os.path.join(PROJECT_DIR, "scripts", "sync_logic_spec.py")
        result = subprocess.run(
            ["python", script], capture_output=True, text=True, timeout=15
        )
        return jsonify({
            "ok": result.returncode == 0,
            "stdout": result.stdout,
            "stderr": result.stderr,
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


if __name__ == "__main__":
    print("\nApollo Mansion CXO Agent Office starting...")
    print("Open http://localhost:5000 in your browser\n")
    app.run(host="0.0.0.0", debug=True, port=5000, threaded=True)
