import anthropic
import os
import json
import time
import queue
import threading
from flask import Flask, Response, request, jsonify, send_from_directory

app = Flask(__name__)
client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))

conversations = {}
ceo_inbox = queue.Queue()
ceo_clients = []

KNOWLEDGE_DIR = os.path.join(PROJECT_DIR, "knowledge")
os.makedirs(KNOWLEDGE_DIR, exist_ok=True)


def load_knowledge(agent_id):
    """Load accumulated knowledge for an agent."""
    path = os.path.join(KNOWLEDGE_DIR, f"{agent_id}.json")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"learnings": [], "decisions": [], "history_summary": ""}


def save_knowledge(agent_id, knowledge):
    """Save knowledge to disk."""
    path = os.path.join(KNOWLEDGE_DIR, f"{agent_id}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(knowledge, f, ensure_ascii=False, indent=2)


def summarize_and_learn(agent_id, full_text):
    """Extract key learnings from agent response and accumulate."""
    knowledge = load_knowledge(agent_id)
    try:
        result = client.messages.create(
            model="claude-sonnet-4-5-20250514",
            max_tokens=500,
            system="あなたはナレッジ抽出AIです。CXOの回答から重要な学び・決定事項・知見を3つ以内で簡潔に抽出してください。JSON配列で返してください。例: [\"フリーミアムモデルを推奨\", \"ロールプレイ機能が差別化の核\"]",
            messages=[{"role": "user", "content": full_text}],
        )
        text = result.content[0].text
        match = json.loads(text) if text.strip().startswith("[") else []
        for item in match:
            if item not in knowledge["learnings"]:
                knowledge["learnings"].append(item)
        # Keep last 30 learnings
        knowledge["learnings"] = knowledge["learnings"][-30:]
        save_knowledge(agent_id, knowledge)
    except Exception:
        pass


def get_knowledge_prompt(agent_id):
    """Build knowledge context for system prompt."""
    knowledge = load_knowledge(agent_id)
    if not knowledge["learnings"]:
        return ""
    items = "\n".join(f"- {l}" for l in knowledge["learnings"])
    return f"\n\n## これまでの蓄積ナレッジ\n以下はこれまでの議論で得られた知見です。これらを踏まえて回答してください:\n{items}"

TASKS_FILE = os.path.join(PROJECT_DIR, "tasks.json")


def load_tasks():
    if os.path.exists(TASKS_FILE):
        with open(TASKS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def save_tasks(tasks):
    with open(TASKS_FILE, "w", encoding="utf-8") as f:
        json.dump(tasks, f, ensure_ascii=False, indent=2)


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

for agent_id in AGENTS:
    conversations[agent_id] = []


def save_to_file(agent_id, instruction, response_text):
    agent = AGENTS[agent_id]
    filename = f"output_{agent_id}.md"
    filepath = os.path.join(PROJECT_DIR, filename)
    header = f"# {agent['title']} - {agent['name']}\n\n"
    content = header
    for i in range(0, len(conversations[agent_id]), 2):
        ceo_msg = conversations[agent_id][i]["content"] if i < len(conversations[agent_id]) else ""
        agent_msg = conversations[agent_id][i + 1]["content"] if i + 1 < len(conversations[agent_id]) else ""
        turn = i // 2 + 1
        content += f"---\n\n## CEO指示 #{turn}\n\n> {ceo_msg}\n\n## {agent['title']}回答 #{turn}\n\n{agent_msg}\n\n"
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)
    return filename


def extract_ceo_items(agent_id, text):
    items = []
    for line in text.split("\n"):
        if "\u3010\u627f\u8a8d\u4f9d\u983c\u3011" in line:
            items.append({"type": "approval", "agent": agent_id, "title": AGENTS[agent_id]["title"], "name": AGENTS[agent_id]["name"], "content": line.replace("\u3010\u627f\u8a8d\u4f9d\u983c\u3011", "").strip()})
        elif "\u3010\u63d0\u6848\u3011" in line:
            items.append({"type": "proposal", "agent": agent_id, "title": AGENTS[agent_id]["title"], "name": AGENTS[agent_id]["name"], "content": line.replace("\u3010\u63d0\u6848\u3011", "").strip()})
    return items


@app.route("/")
def index():
    return HTML_CONTENT


@app.route("/send", methods=["POST"])
def send_instruction():
    data = request.json
    instruction = data.get("instruction", "")
    targets = data.get("targets", list(AGENTS.keys()))
    for agent_id in targets:
        if agent_id in AGENTS:
            conversations[agent_id].append({"role": "user", "content": instruction})
    return jsonify({"ok": True, "targets": targets})


@app.route("/stream/<agent_id>")
def stream(agent_id):
    if agent_id not in AGENTS:
        return "Not found", 404
    agent = AGENTS[agent_id]
    def generate():
        try:
            system_with_knowledge = agent["system"] + get_knowledge_prompt(agent_id)
            with client.messages.stream(
                model="claude-sonnet-4-5-20250514",
                max_tokens=4096,
                system=system_with_knowledge,
                messages=conversations[agent_id],
            ) as s:
                full_text = ""
                for text in s.text_stream:
                    full_text += text
                    yield f"data: {json.dumps({'type': 'text', 'content': text}, ensure_ascii=False)}\n\n"
                conversations[agent_id].append({"role": "assistant", "content": full_text})
                filename = save_to_file(agent_id, "", full_text)
                # Learn from this response in background
                threading.Thread(target=summarize_and_learn, args=(agent_id, full_text), daemon=True).start()
                items = extract_ceo_items(agent_id, full_text)
                if items:
                    yield f"data: {json.dumps({'type': 'ceo_items', 'items': items}, ensure_ascii=False)}\n\n"
                yield f"data: {json.dumps({'type': 'done', 'file': filename})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)}, ensure_ascii=False)}\n\n"
    return Response(generate(), mimetype="text/event-stream")


@app.route("/respond_to_agent", methods=["POST"])
def respond_to_agent():
    data = request.json
    agent_id = data.get("agent_id")
    response = data.get("response", "")
    if agent_id in AGENTS:
        conversations[agent_id].append({"role": "user", "content": response})
    return jsonify({"ok": True})


@app.route("/history/<agent_id>")
def get_history(agent_id):
    if agent_id not in AGENTS:
        return "Not found", 404
    return jsonify(conversations.get(agent_id, []))


@app.route("/reset", methods=["POST"])
def reset():
    for agent_id in AGENTS:
        conversations[agent_id] = []
    # Note: knowledge is NOT reset - it accumulates forever
    return jsonify({"ok": True})


@app.route("/secretary/summarize", methods=["POST"])
def secretary_summarize():
    """Shizuka summarizes all CXO discussions."""
    all_responses = {}
    for agent_id, agent in AGENTS.items():
        if conversations[agent_id]:
            last_msgs = [m for m in conversations[agent_id] if m["role"] == "assistant"]
            if last_msgs:
                all_responses[agent["name"]] = last_msgs[-1]["content"][:1500]

    if not all_responses:
        return jsonify({"summary": "まだCXOからの回答がありません。"})

    context = "\n\n".join(f"### {name}\n{text}" for name, text in all_responses.items())

    def generate():
        try:
            with client.messages.stream(
                model="claude-sonnet-4-5-20250514",
                max_tokens=2048,
                system="""あなたはApollo Mansion社の秘書Shizukaです。
優秀で気配りができ、要点を的確にまとめる能力がある。
CEO Keitaのために、全CXOの議論を分かりやすく整理してください。

フォーマット:
1. 全体サマリー（3行以内）
2. 各CXOの要点（箇条書き）
3. CXO間で一致している点
4. CXO間で意見が分かれている点
5. CEOが判断すべき事項

Markdown形式・日本語で回答してください。""",
                messages=[{"role": "user", "content": f"以下の各CXOの回答を要約・整理してください:\n\n{context}"}],
            ) as s:
                for text in s.text_stream:
                    yield f"data: {json.dumps({'type': 'text', 'content': text}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)}, ensure_ascii=False)}\n\n"

    return Response(generate(), mimetype="text/event-stream")


@app.route("/tasks", methods=["GET"])
def get_tasks():
    return jsonify(load_tasks())


@app.route("/tasks", methods=["POST"])
def add_task():
    data = request.json
    tasks = load_tasks()
    task = {
        "id": int(time.time() * 1000),
        "text": data.get("text", ""),
        "assignee": data.get("assignee", ""),
        "status": "todo",
        "created": time.strftime("%Y-%m-%d %H:%M"),
    }
    tasks.append(task)
    save_tasks(tasks)
    return jsonify(task)


@app.route("/tasks/<int:task_id>", methods=["PATCH"])
def update_task(task_id):
    data = request.json
    tasks = load_tasks()
    for t in tasks:
        if t["id"] == task_id:
            t.update({k: v for k, v in data.items() if k in ("status", "text", "assignee")})
            break
    save_tasks(tasks)
    return jsonify({"ok": True})


@app.route("/tasks/<int:task_id>", methods=["DELETE"])
def delete_task(task_id):
    tasks = load_tasks()
    tasks = [t for t in tasks if t["id"] != task_id]
    save_tasks(tasks)
    return jsonify({"ok": True})


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


HTML_CONTENT = r"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Apollo Mansion Inc. - CXO Agent Office</title>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700;900&family=Nunito:wght@700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Noto Sans JP',sans-serif; background:#87CEEB; min-height:100vh; display:flex; flex-direction:column; }

  /* === HEADER === */
  .header { background:linear-gradient(135deg,#1a237e,#0d47a1); padding:12px 24px; display:flex; align-items:center; justify-content:space-between; box-shadow:0 2px 10px rgba(0,0,0,0.3); position:relative; z-index:10; }
  .header-left { display:flex; align-items:center; gap:14px; }
  .logo { font-family:'Nunito',sans-serif; font-size:22px; font-weight:900; color:#fff; }
  .logo span { color:#FFD700; }
  .header-links { display:flex; gap:8px; align-items:center; }
  .header-link { padding:5px 14px; border-radius:6px; font-size:12px; font-weight:600; text-decoration:none; border:1px solid rgba(255,255,255,0.2); color:#fff; transition:all 0.2s; }
  .header-link:hover { background:rgba(255,255,255,0.1); transform:translateY(-1px); }
  .reset-btn { background:transparent; border:1px solid rgba(255,255,255,0.2); color:rgba(255,255,255,0.6); padding:5px 14px; border-radius:6px; font-size:12px; cursor:pointer; font-family:inherit; transition:all 0.2s; }
  .reset-btn:hover { border-color:#f44336; color:#f44336; }

  /* === MAIN === */
  .main { display:flex; flex:1; overflow:hidden; }

  /* === CEO PANEL === */
  .ceo-panel { width:360px; min-width:360px; background:linear-gradient(180deg,#1a237e 0%,#283593 100%); border-right:3px solid #FFD700; display:flex; flex-direction:column; }
  .ceo-header { padding:20px; border-bottom:1px solid rgba(255,255,255,0.1); }
  .ceo-profile { display:flex; align-items:center; gap:12px; margin-bottom:12px; }
  .ceo-avatar-wrap { position:relative; }
  .ceo-avatar { width:56px; height:56px; border-radius:50%; background:#FFD700; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:900; color:#1a237e; border:3px solid #FFD700; }
  .ceo-crown { position:absolute; top:-10px; left:50%; transform:translateX(-50%); font-size:18px; }
  .ceo-name { font-size:20px; font-weight:900; color:#FFD700; font-family:'Nunito',sans-serif; }
  .ceo-role { font-size:11px; color:rgba(255,255,255,0.6); }
  .ceo-floor-badge { background:rgba(255,215,0,0.15); color:#FFD700; padding:2px 10px; border-radius:10px; font-size:11px; font-weight:700; border:1px solid rgba(255,215,0,0.3); display:inline-block; margin-top:4px; }

  .target-select { display:flex; gap:5px; flex-wrap:wrap; margin-top:10px; }
  .target-chip { padding:4px 10px; border-radius:14px; font-size:11px; cursor:pointer; border:1px solid rgba(255,255,255,0.2); color:rgba(255,255,255,0.5); background:transparent; font-family:inherit; transition:all 0.2s; user-select:none; }
  .target-chip.active { border-color:var(--c); color:var(--c); background:rgba(var(--cr),0.15); }
  .target-chip-all { padding:4px 10px; border-radius:14px; font-size:11px; cursor:pointer; border:1px solid #FFD700; color:#FFD700; background:rgba(255,215,0,0.1); font-family:inherit; user-select:none; }

  .project-select { display:flex; gap:6px; margin-top:10px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.08); }
  .project-select-label { font-size:10px; color:rgba(255,255,255,0.3); align-self:center; margin-right:2px; }
  .project-chip { padding:4px 12px; border-radius:14px; font-size:11px; cursor:pointer; border:1px solid rgba(255,255,255,0.15); color:rgba(255,255,255,0.4); background:transparent; font-family:inherit; transition:all 0.2s; user-select:none; }
  .project-chip.active.logic { border-color:#4facfe; color:#4facfe; background:rgba(79,172,254,0.12); }
  .project-chip.active.sengoku { border-color:#81c784; color:#81c784; background:rgba(129,199,132,0.12); }

  .ceo-input-area { padding:16px 20px; border-bottom:1px solid rgba(255,255,255,0.1); }
  .ceo-textarea { width:100%; min-height:90px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.15); border-radius:10px; color:#fff; padding:12px; font-size:13px; font-family:inherit; resize:vertical; line-height:1.6; }
  .ceo-textarea:focus { outline:none; border-color:#FFD700; }
  .ceo-textarea::placeholder { color:rgba(255,255,255,0.3); }
  .send-row { display:flex; justify-content:space-between; align-items:center; margin-top:10px; }
  .send-hint { font-size:11px; color:rgba(255,255,255,0.3); }
  .send-btn { background:#FFD700; border:none; color:#1a237e; padding:10px 28px; border-radius:8px; font-size:14px; font-weight:900; cursor:pointer; font-family:inherit; transition:all 0.2s; }
  .send-btn:hover { transform:translateY(-1px); box-shadow:0 4px 15px rgba(255,215,0,0.4); }
  .send-btn:disabled { opacity:0.4; cursor:not-allowed; transform:none; }

  .ceo-inbox { flex:1; overflow-y:auto; padding:12px; scrollbar-width:thin; scrollbar-color:rgba(255,255,255,0.1) transparent; }
  .ceo-inbox::-webkit-scrollbar { width:5px; }
  .ceo-inbox::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.1); border-radius:3px; }
  .inbox-title { font-size:11px; font-weight:700; color:rgba(255,255,255,0.3); text-transform:uppercase; letter-spacing:1px; padding:8px 8px 12px; }
  .inbox-item { background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:10px; padding:12px; margin-bottom:10px; }
  .inbox-item-header { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
  .inbox-badge { font-size:10px; padding:2px 8px; border-radius:10px; font-weight:700; }
  .inbox-badge.approval { background:rgba(255,152,0,0.2); color:#FF9800; }
  .inbox-badge.proposal { background:rgba(0,150,214,0.2); color:#0096D6; }
  .inbox-from { font-size:12px; font-weight:600; color:rgba(255,255,255,0.7); }
  .inbox-content { font-size:12px; line-height:1.6; color:rgba(255,255,255,0.8); margin-bottom:10px; }
  .inbox-actions { display:flex; gap:6px; }
  .inbox-btn { padding:5px 14px; border-radius:6px; font-size:11px; cursor:pointer; font-family:inherit; font-weight:600; border:none; transition:all 0.2s; }
  .inbox-btn.approve { background:rgba(76,175,80,0.2); color:#4CAF50; }
  .inbox-btn.approve:hover { background:rgba(76,175,80,0.4); }
  .inbox-btn.reject { background:rgba(244,67,54,0.2); color:#f44336; }
  .inbox-btn.reject:hover { background:rgba(244,67,54,0.4); }
  .inbox-btn.comment { background:rgba(0,150,214,0.2); color:#0096D6; }
  .inbox-btn.comment:hover { background:rgba(0,150,214,0.4); }
  .inbox-reply-input { width:100%; margin-top:8px; padding:8px 10px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.15); border-radius:6px; color:#fff; font-size:12px; font-family:inherit; display:none; }
  .inbox-reply-input:focus { outline:none; border-color:#FFD700; }

  /* === SHIZUKA === */
  .shizuka-panel { border-bottom:1px solid rgba(255,255,255,0.1); }
  .shizuka-header { padding:12px 20px; display:flex; align-items:center; gap:10px; border-bottom:1px solid rgba(255,255,255,0.05); }
  .shizuka-avatar { width:36px; height:36px; border-radius:50%; background:#FFE0F0; border:2px solid #FF69B4; display:flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0; }
  .shizuka-name { font-size:14px; font-weight:700; color:#FF69B4; }
  .shizuka-role { font-size:10px; color:rgba(255,255,255,0.4); }
  .shizuka-btn { margin-left:auto; background:rgba(255,105,180,0.15); border:1px solid rgba(255,105,180,0.3); color:#FF69B4; padding:4px 12px; border-radius:6px; font-size:11px; font-weight:600; cursor:pointer; font-family:inherit; transition:all 0.2s; }
  .shizuka-btn:hover { background:rgba(255,105,180,0.3); }
  .shizuka-body { padding:10px 20px; max-height:200px; overflow-y:auto; font-size:12px; line-height:1.7; color:rgba(255,255,255,0.8); scrollbar-width:thin; }
  .shizuka-body::-webkit-scrollbar { width:4px; }
  .shizuka-body::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.1); border-radius:2px; }
  .shizuka-body .placeholder { color:rgba(255,255,255,0.25); font-size:11px; }
  .shizuka-body h1,.shizuka-body h2,.shizuka-body h3 { color:#FF69B4; margin:8px 0 4px; font-weight:700; }
  .shizuka-body h1 { font-size:14px; } .shizuka-body h2 { font-size:12px; } .shizuka-body h3 { font-size:11px; }
  .shizuka-body p { margin:3px 0; } .shizuka-body ul,.shizuka-body ol { padding-left:16px; margin:3px 0; }
  .shizuka-body strong { color:#fff; }
  .shizuka-body table { border-collapse:collapse; width:100%; font-size:10px; margin:4px 0; }
  .shizuka-body th { background:rgba(0,0,0,0.2); color:#FF69B4; padding:3px 6px; border:1px solid rgba(255,255,255,0.1); text-align:left; }
  .shizuka-body td { padding:3px 6px; border:1px solid rgba(255,255,255,0.1); }
  .shizuka-body hr { border:none; border-top:1px solid rgba(255,255,255,0.1); margin:6px 0; }

  .shizuka-tasks { padding:8px 20px 12px; border-top:1px solid rgba(255,255,255,0.05); }
  .tasks-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
  .tasks-title { font-size:11px; font-weight:700; color:rgba(255,255,255,0.3); text-transform:uppercase; letter-spacing:1px; }
  .task-add-btn { background:rgba(255,105,180,0.15); border:1px solid rgba(255,105,180,0.3); color:#FF69B4; width:22px; height:22px; border-radius:50%; font-size:14px; cursor:pointer; display:flex; align-items:center; justify-content:center; font-family:inherit; }
  .task-input-row { display:flex; gap:6px; margin-bottom:6px; }
  .task-input { flex:1; padding:5px 8px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.15); border-radius:4px; color:#fff; font-size:11px; font-family:inherit; }
  .task-input:focus { outline:none; border-color:#FF69B4; }
  .task-assignee { padding:5px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.15); border-radius:4px; color:#fff; font-size:10px; font-family:inherit; }
  .task-list { max-height:150px; overflow-y:auto; scrollbar-width:thin; }
  .task-list::-webkit-scrollbar { width:4px; }
  .task-list::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.1); border-radius:2px; }
  .task-item { display:flex; align-items:center; gap:6px; padding:4px 0; font-size:11px; color:rgba(255,255,255,0.7); border-bottom:1px solid rgba(255,255,255,0.03); }
  .task-check { width:14px; height:14px; border-radius:3px; border:1px solid rgba(255,255,255,0.3); background:transparent; cursor:pointer; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:9px; color:#4CAF50; }
  .task-check.done { background:rgba(76,175,80,0.2); border-color:#4CAF50; }
  .task-text { flex:1; }
  .task-text.done { text-decoration:line-through; opacity:0.4; }
  .task-assignee-badge { font-size:9px; padding:1px 6px; border-radius:8px; background:rgba(255,255,255,0.08); color:rgba(255,255,255,0.5); }
  .task-del { background:none; border:none; color:rgba(255,255,255,0.2); cursor:pointer; font-size:10px; padding:0 2px; }
  .task-del:hover { color:#f44336; }

  /* === MANSION === */
  .mansion-area { flex:1; overflow-y:auto; display:flex; justify-content:center; padding:20px; background:linear-gradient(180deg,#87CEEB 0%,#B0E0E6 60%,#90EE90 95%,#228B22 100%); }
  .mansion-area::-webkit-scrollbar { width:8px; }
  .mansion-area::-webkit-scrollbar-thumb { background:rgba(0,0,0,0.15); border-radius:4px; }

  .mansion { width:100%; max-width:800px; display:flex; flex-direction:column; }

  /* Roof */
  .mansion-roof { background:linear-gradient(135deg,#8B0000,#B22222); height:40px; border-radius:8px 8px 0 0; position:relative; display:flex; align-items:center; justify-content:center; box-shadow:0 -2px 10px rgba(0,0,0,0.2); }
  .mansion-roof::before { content:''; position:absolute; top:-15px; left:50%; transform:translateX(-50%); width:0; height:0; border-left:60px solid transparent; border-right:60px solid transparent; border-bottom:18px solid #8B0000; }
  .mansion-name { font-family:'Nunito',sans-serif; font-size:14px; font-weight:900; color:#FFD700; letter-spacing:2px; text-shadow:0 1px 3px rgba(0,0,0,0.5); }

  /* Floor */
  .floor { background:linear-gradient(180deg,#F5F5DC 0%,#FFFDE7 100%); border-left:6px solid #8B7355; border-right:6px solid #8B7355; border-bottom:4px solid #A0926B; display:flex; min-height:120px; position:relative; transition:all 0.3s; }
  .floor.active { background:linear-gradient(180deg,#FFF9C4 0%,#FFFDE7 100%); box-shadow:inset 0 0 30px rgba(var(--fc-rgb),0.1); }

  .floor-label { width:48px; display:flex; align-items:center; justify-content:center; font-family:'Nunito',sans-serif; font-size:16px; font-weight:900; color:#8B7355; background:rgba(0,0,0,0.05); border-right:2px solid #D2C5A0; flex-shrink:0; }

  .floor-resident { display:flex; align-items:flex-start; gap:12px; padding:12px 16px; flex:1; overflow:hidden; }

  /* Character Avatars */
  .char-avatar { width:52px; height:52px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:24px; flex-shrink:0; border:3px solid; position:relative; margin-top:4px; }
  .char-avatar.nobita { background:#FFF3E0; border-color:#FF9800; }
  .char-avatar.suneo { background:#E8F5E9; border-color:#4CAF50; }
  .char-avatar.dekisugi { background:#F3E5F5; border-color:#9C27B0; }
  .char-avatar.doraemon { background:#E1F5FE; border-color:#0096D6; }
  .char-avatar.dorami { background:#FFFDE7; border-color:#FFD700; }

  .char-info { flex:1; min-width:0; overflow:hidden; }
  .char-top { display:flex; align-items:center; gap:8px; margin-bottom:4px; }
  .char-title { font-size:14px; font-weight:900; color:var(--fc); }
  .char-name { font-size:12px; color:#8B7355; font-weight:500; }
  .char-status { display:flex; align-items:center; gap:4px; font-size:10px; color:#aaa; margin-left:auto; padding:2px 8px; border-radius:10px; background:rgba(0,0,0,0.05); }
  .status-dot { width:6px; height:6px; border-radius:50%; background:#ccc; }
  .status-dot.waiting { background:#ccc; }
  .status-dot.working { background:#0096D6; animation:pulse 1s infinite; }
  .status-dot.done { background:#4CAF50; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

  .char-body { font-size:12px; line-height:1.7; color:#555; max-height:300px; overflow-y:auto; scrollbar-width:thin; }
  .char-body::-webkit-scrollbar { width:4px; }
  .char-body::-webkit-scrollbar-thumb { background:#D2C5A0; border-radius:2px; }
  .char-body .placeholder { color:#ccc; font-size:12px; }

  /* Markdown in floor */
  .char-body h1,.char-body h2,.char-body h3 { color:#333; margin:10px 0 4px; font-weight:700; }
  .char-body h1 { font-size:15px; border-bottom:1px solid #D2C5A0; padding-bottom:4px; }
  .char-body h2 { font-size:13px; }
  .char-body h3 { font-size:12px; }
  .char-body p { margin:4px 0; }
  .char-body ul,.char-body ol { padding-left:18px; margin:4px 0; }
  .char-body table { border-collapse:collapse; width:100%; margin:6px 0; font-size:11px; }
  .char-body th { background:#F5F5DC; color:var(--fc); padding:4px 6px; text-align:left; border:1px solid #D2C5A0; }
  .char-body td { padding:3px 6px; border:1px solid #D2C5A0; }
  .char-body code { background:#F5F5DC; padding:1px 4px; border-radius:3px; font-size:11px; color:#1a237e; }
  .char-body pre { background:#F5F5DC; padding:8px; border-radius:6px; overflow-x:auto; margin:6px 0; border:1px solid #D2C5A0; }
  .char-body pre code { padding:0; background:none; }
  .char-body strong { color:#333; }
  .char-body hr { border:none; border-top:1px solid #D2C5A0; margin:8px 0; }
  .char-body .ceo-instruction { background:rgba(26,35,126,0.06); border-left:3px solid #1a237e; padding:6px 10px; border-radius:0 6px 6px 0; margin-bottom:8px; font-size:11px; color:#666; }
  .typing-cursor { display:inline-block; width:2px; height:12px; background:var(--fc); animation:blink 0.8s infinite; vertical-align:middle; margin-left:2px; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }

  .char-footer { font-size:9px; color:#bbb; margin-top:4px; display:flex; gap:12px; }

  /* Ground */
  .mansion-ground { height:16px; background:linear-gradient(180deg,#8B7355,#6B5344); border-radius:0 0 4px 4px; }

  /* Clouds */
  .cloud { position:fixed; color:rgba(255,255,255,0.6); font-size:40px; animation:float 20s infinite linear; pointer-events:none; z-index:0; }
  .cloud:nth-child(1) { top:15%; animation-duration:25s; }
  .cloud:nth-child(2) { top:30%; animation-duration:35s; animation-delay:-10s; font-size:30px; }
  .cloud:nth-child(3) { top:8%; animation-duration:30s; animation-delay:-5s; font-size:50px; }
  @keyframes float { 0%{left:-10%} 100%{left:110%} }

  @media(max-width:900px) { .ceo-panel{width:300px;min-width:300px;} }
</style>
</head>
<body>

<div class="cloud">&#9729;</div>
<div class="cloud">&#9729;</div>
<div class="cloud">&#9729;</div>

<div class="header">
  <div class="header-left">
    <div class="logo"><span>Apollo Mansion</span> Inc.</div>
  </div>
  <div class="header-links">
    <a class="header-link" href="https://logic-u5wn.onrender.com" target="_blank">Logic</a>
    <a class="header-link" href="https://sengoku-chakai.onrender.com/ja" target="_blank">&#21315;&#30707;&#33590;&#36947;</a>
    <button class="reset-btn" onclick="resetAll()">&#12522;&#12475;&#12483;&#12488;</button>
  </div>
</div>

<div class="main">
  <!-- CEO Panel -->
  <div class="ceo-panel">
    <div class="ceo-header">
      <div class="ceo-profile">
        <div class="ceo-avatar-wrap">
          <div class="ceo-crown">&#128081;</div>
          <div class="ceo-avatar">K</div>
        </div>
        <div>
          <div class="ceo-name">Keita</div>
          <div class="ceo-role">CEO / Founder</div>
          <div class="ceo-floor-badge">&#127968; Penthouse</div>
        </div>
      </div>
      <div class="target-select">
        <button class="target-chip-all" onclick="toggleAll()">ALL</button>
        <button class="target-chip active" data-id="cso" style="--c:#FF9800;--cr:255,152,0" onclick="toggleTarget(this)">Nobita</button>
        <button class="target-chip active" data-id="cfo" style="--c:#4CAF50;--cr:76,175,80" onclick="toggleTarget(this)">Suneo</button>
        <button class="target-chip active" data-id="cmo" style="--c:#9C27B0;--cr:156,39,176" onclick="toggleTarget(this)">Dekisugi</button>
        <button class="target-chip active" data-id="cto" style="--c:#0096D6;--cr:0,150,214" onclick="toggleTarget(this)">Doraemon</button>
        <button class="target-chip active" data-id="cpo" style="--c:#FFD700;--cr:255,215,0" onclick="toggleTarget(this)">Dorami</button>
      </div>
      <div class="project-select">
        <span class="project-select-label">&#23550;&#35937;:</span>
        <button class="project-chip logic" onclick="toggleProject(this)">Logic</button>
        <button class="project-chip sengoku" onclick="toggleProject(this)">&#21315;&#30707;&#33590;&#36947;</button>
      </div>
    </div>
    <div class="ceo-input-area">
      <textarea class="ceo-textarea" id="ceoInput" placeholder="CXO&#12408;&#12398;&#25351;&#31034;&#12434;&#20837;&#21147;..."></textarea>
      <div class="send-row">
        <span class="send-hint">Ctrl+Enter</span>
        <button class="send-btn" id="sendBtn" onclick="sendInstruction()">&#25351;&#31034;&#12434;&#20986;&#12377;</button>
      </div>
    </div>
    <!-- Shizuka Secretary Panel -->
    <div class="shizuka-panel">
      <div class="shizuka-header">
        <div class="shizuka-avatar">&#127804;</div>
        <div>
          <div class="shizuka-name">Shizuka</div>
          <div class="shizuka-role">Secretary</div>
        </div>
        <button class="shizuka-btn" onclick="askShizukaSummary()">&#35201;&#32004;</button>
      </div>
      <div class="shizuka-body" id="shizukaBody">
        <span class="placeholder">&#9749; &#12362;&#25163;&#20253;&#12356;&#12391;&#12365;&#12427;&#12371;&#12392;&#12364;&#12354;&#12428;&#12400;&#12362;&#30003;&#12375;&#20184;&#12369;&#12367;&#12384;&#12373;&#12356;</span>
      </div>
      <div class="shizuka-tasks">
        <div class="tasks-header">
          <span class="tasks-title">Tasks</span>
          <button class="task-add-btn" onclick="showTaskInput()">+</button>
        </div>
        <div class="task-input-row" id="taskInputRow" style="display:none">
          <input class="task-input" id="taskInput" placeholder="&#12479;&#12473;&#12463;&#12434;&#20837;&#21147;..." onkeydown="if(event.key==='Enter')addTask()">
          <select class="task-assignee" id="taskAssignee">
            <option value="">&#25285;&#24403;</option>
            <option value="Nobita">Nobita</option>
            <option value="Suneo">Suneo</option>
            <option value="Dekisugi">Dekisugi</option>
            <option value="Doraemon">Doraemon</option>
            <option value="Dorami">Dorami</option>
          </select>
        </div>
        <div class="task-list" id="taskList"></div>
      </div>
    </div>

    <div class="ceo-inbox" id="ceoInbox">
      <div class="inbox-title">Inbox</div>
    </div>
  </div>

  <!-- Mansion -->
  <div class="mansion-area">
    <div class="mansion">
      <div class="mansion-roof"><div class="mansion-name">APOLLO MANSION</div></div>
      <div id="floors"></div>
      <div class="mansion-ground"></div>
    </div>
  </div>
</div>

<script>
const AGENTS = {
  cso:  { title:"CSO", name:"Nobita",    floor:"5F", avatar:"nobita",    color:"#FF9800", icon:"\uD83D\uDC53" },
  cfo:  { title:"CFO", name:"Suneo",     floor:"4F", avatar:"suneo",     color:"#4CAF50", icon:"\uD83D\uDCB0" },
  cmo:  { title:"CMO", name:"Dekisugi",  floor:"3F", avatar:"dekisugi",  color:"#9C27B0", icon:"\u2B50" },
  cto:  { title:"CTO", name:"Doraemon",  floor:"2F", avatar:"doraemon",  color:"#0096D6", icon:"\uD83D\uDC31" },
  cpo:  { title:"CPO", name:"Dorami",    floor:"1F", avatar:"dorami",    color:"#FFD700", icon:"\uD83C\uDF38" },
};
const FLOOR_ORDER = ["cso","cfo","cmo","cto","cpo"];
const agentFullContent = {};
const agentRawTexts = {};
let activeStreams = 0;

function hexToRgb(h){return[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)].join(',');}

function createFloors(){
  const container = document.getElementById('floors');
  for(const id of FLOOR_ORDER){
    const a = AGENTS[id];
    const rgb = hexToRgb(a.color);
    agentFullContent[id] = '';
    agentRawTexts[id] = '';
    container.innerHTML += `
      <div class="floor" id="card-${id}" style="--fc:${a.color};--fc-rgb:${rgb}">
        <div class="floor-label">${a.floor}</div>
        <div class="floor-resident">
          <div class="char-avatar ${a.avatar}">${a.icon}</div>
          <div class="char-info">
            <div class="char-top">
              <span class="char-title">${a.title}</span>
              <span class="char-name">${a.name}</span>
              <div class="char-status"><div class="status-dot waiting" id="dot-${id}"></div><span id="stxt-${id}">&#24453;&#27231;&#20013;</span></div>
            </div>
            <div class="char-body" id="body-${id}"><span class="placeholder">&#9749; ${a.name}&#12399;&#37096;&#23627;&#12391;&#24453;&#27231;&#20013;...</span></div>
            <div class="char-footer"><span id="chars-${id}">0&#25991;&#23383;</span><span id="file-${id}"></span></div>
          </div>
        </div>
      </div>`;
  }
}

function getSelectedTargets(){return[...document.querySelectorAll('.target-chip.active')].map(c=>c.dataset.id);}
function toggleTarget(el){el.classList.toggle('active');}
function toggleAll(){const c=document.querySelectorAll('.target-chip');const all=[...c].every(x=>x.classList.contains('active'));c.forEach(x=>all?x.classList.remove('active'):x.classList.add('active'));}
function toggleProject(el){el.classList.toggle('active');}
function getSelectedProjects(){return[...document.querySelectorAll('.project-chip.active')].map(c=>c.textContent.trim());}

async function sendInstruction(){
  const input=document.getElementById('ceoInput');
  const text=input.value.trim();
  if(!text)return;
  const targets=getSelectedTargets();
  if(!targets.length){alert('Select CXO targets');return;}
  document.getElementById('sendBtn').disabled=true;
  const projects=getSelectedProjects();
  const projectLabel=projects.length?` [${projects.join(', ')}]`:'';
  const fullInstruction=projects.length?`[対象プロジェクト: ${projects.join(', ')}]\n\n${text}`:text;
  await fetch('/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({instruction:fullInstruction,targets})});
  for(const id of targets){
    const body=document.getElementById(`body-${id}`);
    agentFullContent[id]+=`<div class="ceo-instruction"><strong>CEO Keita${escapeHtml(projectLabel)}:</strong> ${escapeHtml(text)}</div>`;
    body.innerHTML=agentFullContent[id]+'<span class="typing-cursor"></span>';
    body.scrollTop=body.scrollHeight;
  }
  input.value='';
  activeStreams=targets.length;
  for(const id of targets){streamAgent(id);}
}

function streamAgent(id){
  const body=document.getElementById(`body-${id}`);
  const dot=document.getElementById(`dot-${id}`);
  const stxt=document.getElementById(`stxt-${id}`);
  const charsEl=document.getElementById(`chars-${id}`);
  const card=document.getElementById(`card-${id}`);
  dot.className='status-dot working';
  stxt.textContent='\u5206\u6790\u4e2d...';
  card.classList.add('active');
  agentRawTexts[id]='';
  const evtSource=new EventSource(`/stream/${id}`);
  evtSource.onmessage=(e)=>{
    const data=JSON.parse(e.data);
    if(data.type==='text'){
      agentRawTexts[id]+=data.content;
      body.innerHTML=agentFullContent[id]+marked.parse(agentRawTexts[id])+'<span class="typing-cursor"></span>';
      body.scrollTop=body.scrollHeight;
      charsEl.textContent=`${agentRawTexts[id].length}\u6587\u5b57`;
    }
    if(data.type==='ceo_items'){for(const item of data.items){addInboxItem(item);}}
    if(data.type==='done'){
      evtSource.close();
      agentFullContent[id]+=marked.parse(agentRawTexts[id]);
      body.innerHTML=agentFullContent[id];
      body.scrollTop=body.scrollHeight;
      dot.className='status-dot done';
      stxt.textContent='\u5b8c\u4e86';
      card.classList.remove('active');
      activeStreams--;
      if(activeStreams<=0)document.getElementById('sendBtn').disabled=false;
    }
    if(data.type==='error'){
      evtSource.close();
      body.innerHTML+=`<div style="color:#f44336;padding:8px">Error: ${data.content}</div>`;
      dot.style.background='#f44336';
      stxt.textContent='\u30a8\u30e9\u30fc';
      activeStreams--;
      if(activeStreams<=0)document.getElementById('sendBtn').disabled=false;
    }
  };
  evtSource.onerror=()=>{evtSource.close();};
}

function addInboxItem(item){
  const inbox=document.getElementById('ceoInbox');
  const div=document.createElement('div');
  div.className='inbox-item';
  const tl=item.type==='approval'?'\u627f\u8a8d\u4f9d\u983c':'\u63d0\u6848';
  const tc=item.type==='approval'?'approval':'proposal';
  const iid='inbox-'+Date.now()+Math.random().toString(36).slice(2,5);
  div.innerHTML=`
    <div class="inbox-item-header"><span class="inbox-badge ${tc}">${tl}</span><span class="inbox-from">${item.name} (${item.title})</span></div>
    <div class="inbox-content">${escapeHtml(item.content)}</div>
    <div class="inbox-actions">
      <button class="inbox-btn approve" onclick="respondToAgent('${item.agent}','\u627f\u8a8d\u3057\u307e\u3059\u3002\u9032\u3081\u3066\u304f\u3060\u3055\u3044\u3002',this)">\u627f\u8a8d</button>
      <button class="inbox-btn reject" onclick="respondToAgent('${item.agent}','\u5374\u4e0b\u3057\u307e\u3059\u3002\u518d\u691c\u8a0e\u3057\u3066\u304f\u3060\u3055\u3044\u3002',this)">\u5374\u4e0b</button>
      <button class="inbox-btn comment" onclick="showReplyInput('${iid}')">Comment</button>
    </div>
    <input class="inbox-reply-input" id="${iid}" placeholder="..." onkeydown="if(event.key==='Enter'){respondToAgent('${item.agent}',this.value,this);this.style.display='none';}">`;
  inbox.appendChild(div);
  inbox.scrollTop=inbox.scrollHeight;
}

function showReplyInput(id){const el=document.getElementById(id);el.style.display='block';el.focus();}

async function respondToAgent(agentId,message,btnEl){
  await fetch('/respond_to_agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agent_id:agentId,response:`CEO Keita: ${message}`})});
  const item=btnEl.closest('.inbox-item');
  item.querySelectorAll('.inbox-btn').forEach(b=>{b.disabled=true;b.style.opacity='0.3';});
  item.innerHTML+=`<div style="font-size:11px;color:#4CAF50;margin-top:6px">\u2713 ${escapeHtml(message)}</div>`;
  const body=document.getElementById(`body-${agentId}`);
  agentFullContent[agentId]+=`<div class="ceo-instruction"><strong>CEO Keita:</strong> ${escapeHtml(message)}</div>`;
  body.innerHTML=agentFullContent[agentId]+'<span class="typing-cursor"></span>';
  activeStreams=1;
  document.getElementById('sendBtn').disabled=true;
  streamAgent(agentId);
}

async function resetAll(){
  if(!confirm('\u30ea\u30bb\u30c3\u30c8\u3057\u307e\u3059\u304b\uff1f'))return;
  await fetch('/reset',{method:'POST'});
  for(const id of FLOOR_ORDER){
    agentFullContent[id]='';agentRawTexts[id]='';
    document.getElementById(`body-${id}`).innerHTML=`<span class="placeholder">\u2615 ${AGENTS[id].name}\u306f\u90e8\u5c4b\u3067\u5f85\u6a5f\u4e2d...</span>`;
    document.getElementById(`dot-${id}`).className='status-dot waiting';
    document.getElementById(`stxt-${id}`).textContent='\u5f85\u6a5f\u4e2d';
    document.getElementById(`chars-${id}`).textContent='0\u6587\u5b57';
    document.getElementById(`file-${id}`).innerHTML='';
    document.getElementById(`card-${id}`).classList.remove('active');
  }
  document.getElementById('ceoInbox').innerHTML='<div class="inbox-title">Inbox</div>';
}

function escapeHtml(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
document.addEventListener('keydown',(e)=>{if(e.ctrlKey&&e.key==='Enter'){e.preventDefault();sendInstruction();}});
// === SHIZUKA ===
function askShizukaSummary(){
  const body=document.getElementById('shizukaBody');
  body.innerHTML='<span style="color:#FF69B4">&#10024; &#12414;&#12392;&#12417;&#12390;&#12356;&#12414;&#12377;...</span>';
  fetch('/secretary/summarize',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
    .then(r=>{
      const reader=r.body.getReader();
      const decoder=new TextDecoder();
      let raw='';
      function read(){
        reader.read().then(({done,value})=>{
          if(done)return;
          const chunk=decoder.decode(value);
          for(const line of chunk.split('\n')){
            if(!line.startsWith('data: '))continue;
            try{
              const d=JSON.parse(line.slice(6));
              if(d.type==='text'){raw+=d.content;body.innerHTML=marked.parse(raw);}
              if(d.type==='done'){body.innerHTML=marked.parse(raw);}
              if(d.type==='error'){body.innerHTML=`<span style="color:#f44336">Error: ${d.content}</span>`;}
            }catch(e){}
          }
          body.scrollTop=body.scrollHeight;
          read();
        });
      }
      read();
    });
}

// === TASKS ===
function showTaskInput(){
  const row=document.getElementById('taskInputRow');
  row.style.display=row.style.display==='none'?'flex':'none';
  if(row.style.display==='flex')document.getElementById('taskInput').focus();
}

async function addTask(){
  const input=document.getElementById('taskInput');
  const assignee=document.getElementById('taskAssignee');
  const text=input.value.trim();
  if(!text)return;
  await fetch('/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,assignee:assignee.value})});
  input.value='';
  assignee.value='';
  loadTasks();
}

async function toggleTask(id,currentStatus){
  const newStatus=currentStatus==='todo'?'done':'todo';
  await fetch(`/tasks/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:newStatus})});
  loadTasks();
}

async function deleteTask(id){
  await fetch(`/tasks/${id}`,{method:'DELETE'});
  loadTasks();
}

async function loadTasks(){
  const res=await fetch('/tasks');
  const tasks=await res.json();
  const list=document.getElementById('taskList');
  list.innerHTML=tasks.map(t=>`
    <div class="task-item">
      <div class="task-check ${t.status}" onclick="toggleTask(${t.id},'${t.status}')">${t.status==='done'?'\u2713':''}</div>
      <span class="task-text ${t.status}">${escapeHtml(t.text)}</span>
      ${t.assignee?`<span class="task-assignee-badge">${escapeHtml(t.assignee)}</span>`:''}
      <button class="task-del" onclick="deleteTask(${t.id})">\u00d7</button>
    </div>`).join('');
}

loadTasks();
createFloors();
</script>
</body>
</html>"""


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    print("\nApollo Mansion CXO Agent Office starting...")
    print(f"Open http://localhost:{port} in your browser\n")
    app.run(debug=False, host="0.0.0.0", port=port, threaded=True)
