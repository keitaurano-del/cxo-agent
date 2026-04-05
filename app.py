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

# Global conversation history per agent
conversations = {}
# Queue for CXO -> CEO messages (proposals, approvals)
ceo_inbox = queue.Queue()
# SSE clients for CEO inbox
ceo_clients = []

AGENTS = {
    "cmo": {
        "title": "CMO",
        "name": "Tanaka Misaki",
        "emoji": "📣",
        "color": "#E91E63",
        "system": """あなたはLogic社のCMO（最高マーケティング責任者）田中美咲です。
マーケティング・集客・ブランディングの専門家として、CEO柴田からの指示に対応します。

ルール:
- CEO柴田からの指示に対し、CMOの視点で具体的に回答してください
- 他のCXOとの連携が必要な場合は言及してください
- CEOに承認が必要な事項がある場合は【承認依頼】と明記してください
- CEOへの提案がある場合は【提案】と明記してください
- 予算に関わる判断は必ずCFOとの連携を示唆してください
- Markdown形式で回答してください
- 日本語で回答してください""",
    },
    "cfo": {
        "title": "CFO",
        "name": "Sato Kenichi",
        "emoji": "💰",
        "color": "#4CAF50",
        "system": """あなたはLogic社のCFO（最高財務責任者）佐藤健一です。
収益モデル・価格設計・財務戦略の専門家として、CEO柴田からの指示に対応します。

ルール:
- CEO柴田からの指示に対し、CFOの視点で具体的に回答してください
- 数字・コスト・ROIを必ず含めてください
- CEOに承認が必要な事項がある場合は【承認依頼】と明記してください
- CEOへの提案がある場合は【提案】と明記してください
- リスクがある場合は必ず警告してください
- Markdown形式で回答してください
- 日本語で回答してください""",
    },
    "cpo": {
        "title": "CPO",
        "name": "Suzuki Yoko",
        "emoji": "🎨",
        "color": "#9C27B0",
        "system": """あなたはLogic社のCPO（最高プロダクト責任者）鈴木陽子です。
プロダクト戦略・機能優先度・UXの専門家として、CEO柴田からの指示に対応します。

ルール:
- CEO柴田からの指示に対し、CPOの視点で具体的に回答してください
- ユーザー体験とプロダクトの観点を最優先してください
- CEOに承認が必要な事項がある場合は【承認依頼】と明記してください
- CEOへの提案がある場合は【提案】と明記してください
- CTOとの技術的な連携ポイントは明記してください
- Markdown形式で回答してください
- 日本語で回答してください""",
    },
    "cso": {
        "title": "CSO",
        "name": "Takahashi Daisuke",
        "emoji": "♟️",
        "color": "#FF9800",
        "system": """あなたはLogic社のCSO（最高戦略責任者）高橋大輔です。
事業戦略・競合分析・市場ポジショニングの専門家として、CEO柴田からの指示に対応します。

ルール:
- CEO柴田からの指示に対し、CSOの視点で具体的に回答してください
- 市場・競合・中長期の視点を必ず含めてください
- CEOに承認が必要な事項がある場合は【承認依頼】と明記してください
- CEOへの提案がある場合は【提案】と明記してください
- データや根拠に基づいた分析を心がけてください
- Markdown形式で回答してください
- 日本語で回答してください""",
    },
    "cto": {
        "title": "CTO",
        "name": "Yamada Takuya",
        "emoji": "⚙️",
        "color": "#2196F3",
        "system": """あなたはLogic社のCTO（最高技術責任者）山田拓也です。
技術選定・開発ロードマップ・アーキテクチャの専門家として、CEO柴田からの指示に対応します。

ルール:
- CEO柴田からの指示に対し、CTOの視点で具体的に回答してください
- 技術的な実現可能性・工数・リスクを必ず含めてください
- CEOに承認が必要な事項がある場合は【承認依頼】と明記してください
- CEOへの提案がある場合は【提案】と明記してください
- CPOとの機能面での連携ポイントは明記してください
- Markdown形式で回答してください
- 日本語で回答してください""",
    },
}

# Initialize conversations
for agent_id in AGENTS:
    conversations[agent_id] = []


def save_to_file(agent_id, instruction, response_text):
    """Save agent output to a markdown file in the project directory."""
    agent = AGENTS[agent_id]
    filename = f"output_{agent_id}.md"
    filepath = os.path.join(PROJECT_DIR, filename)

    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    header = f"# {agent['emoji']} {agent['title']} - {agent['name']}\n\n"

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
    """Extract proposals and approval requests from agent response."""
    items = []
    for line in text.split("\n"):
        if "【承認依頼】" in line:
            items.append({"type": "approval", "agent": agent_id, "title": AGENTS[agent_id]["title"], "content": line.replace("【承認依頼】", "").strip()})
        elif "【提案】" in line:
            items.append({"type": "proposal", "agent": agent_id, "title": AGENTS[agent_id]["title"], "content": line.replace("【提案】", "").strip()})
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
            with client.messages.stream(
                model="claude-sonnet-4-5-20241022",
                max_tokens=4096,
                system=agent["system"],
                messages=conversations[agent_id],
            ) as s:
                full_text = ""
                for text in s.text_stream:
                    full_text += text
                    yield f"data: {json.dumps({'type': 'text', 'content': text}, ensure_ascii=False)}\n\n"

                # Save assistant response to conversation
                conversations[agent_id].append({"role": "assistant", "content": full_text})

                # Save to file
                filename = save_to_file(agent_id, "", full_text)

                # Extract CEO items
                items = extract_ceo_items(agent_id, full_text)
                if items:
                    yield f"data: {json.dumps({'type': 'ceo_items', 'items': items}, ensure_ascii=False)}\n\n"

                yield f"data: {json.dumps({'type': 'done', 'file': filename})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)}, ensure_ascii=False)}\n\n"

    return Response(generate(), mimetype="text/event-stream")


@app.route("/respond_to_agent", methods=["POST"])
def respond_to_agent():
    """CEO responds to an agent's proposal/approval request."""
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
    return jsonify({"ok": True})


HTML_CONTENT = r"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CXO Agent Office - Logic Inc.</title>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700;900&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Noto Sans JP', sans-serif;
    background: #0a0f1a;
    color: #e0e0e0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  /* ===== HEADER ===== */
  .header {
    background: linear-gradient(135deg, #111827 0%, #0a0f1a 100%);
    border-bottom: 1px solid #1e293b;
    padding: 16px 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .header-left { display: flex; align-items: center; gap: 16px; }

  .logo {
    font-size: 22px;
    font-weight: 900;
    color: #fff;
    letter-spacing: -0.5px;
  }

  .logo span { color: #4facfe; }

  .header-badge {
    background: rgba(79, 172, 254, 0.1);
    border: 1px solid rgba(79, 172, 254, 0.3);
    color: #4facfe;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 500;
  }

  .header-links {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .header-link {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 14px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    text-decoration: none;
    border: 1px solid #333;
    transition: all 0.2s;
  }

  .header-link:hover { transform: translateY(-1px); }
  .header-link.logic { color: #4facfe; border-color: rgba(79,172,254,0.3); }
  .header-link.logic:hover { background: rgba(79,172,254,0.1); }
  .header-link.sengoku { color: #81c784; border-color: rgba(129,199,132,0.3); }
  .header-link.sengoku:hover { background: rgba(129,199,132,0.1); }

  .reset-btn {
    background: transparent;
    border: 1px solid #333;
    color: #888;
    padding: 6px 16px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
    transition: all 0.2s;
  }
  .reset-btn:hover { border-color: #f44336; color: #f44336; }

  /* ===== MAIN LAYOUT ===== */
  .main {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  /* ===== CEO PANEL (LEFT) ===== */
  .ceo-panel {
    width: 380px;
    min-width: 380px;
    background: #111827;
    border-right: 1px solid #1e293b;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  .ceo-header {
    padding: 20px;
    border-bottom: 1px solid #1e293b;
  }

  .ceo-profile {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }

  .ceo-avatar {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: linear-gradient(135deg, #4facfe, #00f2fe);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    font-weight: 900;
    color: #0a0f1a;
    flex-shrink: 0;
  }

  .ceo-name {
    font-size: 18px;
    font-weight: 700;
    color: #fff;
  }

  .ceo-role {
    font-size: 12px;
    color: #4facfe;
    font-weight: 500;
  }

  .target-select {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 10px;
  }

  .target-chip {
    padding: 4px 10px;
    border-radius: 14px;
    font-size: 11px;
    cursor: pointer;
    border: 1px solid #333;
    color: #888;
    background: transparent;
    font-family: inherit;
    transition: all 0.2s;
    user-select: none;
  }

  .target-chip.active {
    border-color: var(--c);
    color: var(--c);
    background: rgba(var(--cr), 0.1);
  }

  .target-chip-all {
    padding: 4px 10px;
    border-radius: 14px;
    font-size: 11px;
    cursor: pointer;
    border: 1px solid #4facfe;
    color: #4facfe;
    background: rgba(79,172,254,0.1);
    font-family: inherit;
    transition: all 0.2s;
    user-select: none;
  }

  /* CEO Input */
  .ceo-input-area {
    padding: 16px 20px;
    border-bottom: 1px solid #1e293b;
  }

  .ceo-textarea {
    width: 100%;
    min-height: 100px;
    background: #0a0f1a;
    border: 1px solid #1e293b;
    border-radius: 10px;
    color: #e0e0e0;
    padding: 12px 14px;
    font-size: 14px;
    font-family: inherit;
    resize: vertical;
    line-height: 1.6;
    transition: border-color 0.2s;
  }

  .ceo-textarea:focus {
    outline: none;
    border-color: #4facfe;
  }

  .ceo-textarea::placeholder { color: #444; }

  .send-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 10px;
  }

  .send-hint { font-size: 11px; color: #444; }

  .send-btn {
    background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
    border: none;
    color: #0a0f1a;
    padding: 10px 28px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
    transition: all 0.2s;
  }

  .send-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 15px rgba(79,172,254,0.3); }
  .send-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; box-shadow: none; }

  /* CEO Inbox */
  .ceo-inbox {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    scrollbar-width: thin;
    scrollbar-color: #1e293b #111827;
  }

  .ceo-inbox::-webkit-scrollbar { width: 5px; }
  .ceo-inbox::-webkit-scrollbar-track { background: #111827; }
  .ceo-inbox::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }

  .inbox-title {
    font-size: 12px;
    font-weight: 700;
    color: #555;
    text-transform: uppercase;
    letter-spacing: 1px;
    padding: 8px 8px 12px;
  }

  .inbox-item {
    background: #0a0f1a;
    border: 1px solid #1e293b;
    border-radius: 10px;
    padding: 12px 14px;
    margin-bottom: 10px;
    transition: border-color 0.2s;
  }

  .inbox-item:hover { border-color: #333; }

  .inbox-item-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .inbox-badge {
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 10px;
    font-weight: 700;
  }

  .inbox-badge.approval { background: rgba(255,152,0,0.15); color: #FF9800; }
  .inbox-badge.proposal { background: rgba(79,172,254,0.15); color: #4facfe; }

  .inbox-from { font-size: 12px; font-weight: 600; color: #aaa; }

  .inbox-content { font-size: 13px; line-height: 1.6; color: #ccc; margin-bottom: 10px; }

  .inbox-actions {
    display: flex;
    gap: 6px;
  }

  .inbox-btn {
    padding: 5px 14px;
    border-radius: 6px;
    font-size: 11px;
    cursor: pointer;
    font-family: inherit;
    font-weight: 600;
    border: none;
    transition: all 0.2s;
  }

  .inbox-btn.approve { background: rgba(76,175,80,0.15); color: #4CAF50; }
  .inbox-btn.approve:hover { background: rgba(76,175,80,0.3); }
  .inbox-btn.reject { background: rgba(244,67,54,0.15); color: #f44336; }
  .inbox-btn.reject:hover { background: rgba(244,67,54,0.3); }
  .inbox-btn.comment { background: rgba(79,172,254,0.15); color: #4facfe; }
  .inbox-btn.comment:hover { background: rgba(79,172,254,0.3); }

  .inbox-reply-input {
    width: 100%;
    margin-top: 8px;
    padding: 8px 10px;
    background: #111827;
    border: 1px solid #1e293b;
    border-radius: 6px;
    color: #e0e0e0;
    font-size: 12px;
    font-family: inherit;
    display: none;
  }

  .inbox-reply-input:focus { outline: none; border-color: #4facfe; }

  /* ===== OFFICE AREA (RIGHT) ===== */
  .office-area {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    scrollbar-width: thin;
    scrollbar-color: #1e293b #0a0f1a;
  }

  .office-area::-webkit-scrollbar { width: 6px; }
  .office-area::-webkit-scrollbar-track { background: #0a0f1a; }
  .office-area::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }

  .office-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(480px, 1fr));
    gap: 16px;
  }

  /* Agent Card */
  .agent-card {
    background: #111827;
    border-radius: 12px;
    border: 1px solid #1e293b;
    overflow: hidden;
    transition: all 0.3s;
  }

  .agent-card.active {
    border-color: var(--agent-color);
    box-shadow: 0 0 25px rgba(var(--agent-color-rgb), 0.1);
  }

  .agent-top {
    padding: 14px 18px;
    display: flex;
    align-items: center;
    gap: 12px;
    border-bottom: 1px solid #1e293b;
  }

  .agent-avatar {
    width: 42px;
    height: 42px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    background: rgba(var(--agent-color-rgb), 0.12);
    border: 2px solid var(--agent-color);
    flex-shrink: 0;
  }

  .agent-info { flex: 1; }
  .agent-title { font-size: 15px; font-weight: 700; color: var(--agent-color); }
  .agent-name { font-size: 11px; color: #667; margin-top: 1px; }

  .agent-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #667;
    padding: 3px 10px;
    border-radius: 16px;
    background: #0a0f1a;
  }

  .status-dot { width: 7px; height: 7px; border-radius: 50%; background: #333; }
  .status-dot.waiting { background: #333; }
  .status-dot.working { background: #4facfe; animation: pulse 1s infinite; }
  .status-dot.done { background: #4CAF50; }

  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

  .agent-body {
    padding: 14px 18px;
    height: 380px;
    overflow-y: auto;
    font-size: 13px;
    line-height: 1.8;
    scrollbar-width: thin;
    scrollbar-color: #1e293b #111827;
  }

  .agent-body::-webkit-scrollbar { width: 5px; }
  .agent-body::-webkit-scrollbar-track { background: #111827; }
  .agent-body::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }

  .agent-body .placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #333;
    font-size: 13px;
  }

  .agent-body .turn-label {
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    color: #0a0f1a;
    background: var(--agent-color);
    padding: 2px 8px;
    border-radius: 4px;
    margin: 16px 0 8px 0;
  }

  .agent-body .turn-label:first-child { margin-top: 0; }

  .agent-body .ceo-instruction {
    background: rgba(79,172,254,0.08);
    border-left: 3px solid #4facfe;
    padding: 8px 12px;
    border-radius: 0 6px 6px 0;
    margin-bottom: 12px;
    font-size: 12px;
    color: #8899aa;
  }

  /* Markdown in agent body */
  .agent-body h1,.agent-body h2,.agent-body h3 { color: #fff; margin: 14px 0 6px; font-weight: 700; }
  .agent-body h1 { font-size: 17px; border-bottom: 1px solid #1e293b; padding-bottom: 5px; }
  .agent-body h2 { font-size: 14px; }
  .agent-body h3 { font-size: 13px; }
  .agent-body p { margin: 5px 0; }
  .agent-body ul,.agent-body ol { padding-left: 20px; margin: 5px 0; }
  .agent-body li { margin: 2px 0; }
  .agent-body table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 11px; }
  .agent-body th { background: #0a0f1a; color: var(--agent-color); padding: 5px 8px; text-align: left; border: 1px solid #1e293b; }
  .agent-body td { padding: 4px 8px; border: 1px solid #1e293b; }
  .agent-body code { background: #0a0f1a; padding: 1px 5px; border-radius: 3px; font-size: 11px; color: #4facfe; }
  .agent-body pre { background: #0a0f1a; padding: 10px; border-radius: 6px; overflow-x: auto; margin: 8px 0; border: 1px solid #1e293b; }
  .agent-body pre code { padding: 0; background: none; }
  .agent-body strong { color: #fff; }
  .agent-body hr { border: none; border-top: 1px solid #1e293b; margin: 10px 0; }

  .typing-cursor {
    display: inline-block;
    width: 2px;
    height: 13px;
    background: var(--agent-color);
    animation: blink 0.8s infinite;
    vertical-align: middle;
    margin-left: 2px;
  }

  @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }

  .agent-footer {
    padding: 8px 18px;
    border-top: 1px solid #1e293b;
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    color: #445;
  }

  .file-link {
    color: #4facfe;
    cursor: pointer;
    text-decoration: none;
  }
  .file-link:hover { text-decoration: underline; }
</style>
</head>
<body>

<!-- HEADER -->
<div class="header">
  <div class="header-left">
    <div class="logo"><span>Logic</span> Inc.</div>
    <div class="header-badge">CXO Agent Office</div>
  </div>
  <div class="header-links">
    <a class="header-link logic" href="http://localhost:5173" target="_blank">Logic</a>
    <a class="header-link sengoku" href="http://localhost:3000" target="_blank">千石茶道</a>
    <button class="reset-btn" onclick="resetAll()">リセット</button>
  </div>
</div>

<!-- MAIN -->
<div class="main">
  <!-- CEO PANEL -->
  <div class="ceo-panel">
    <div class="ceo-header">
      <div class="ceo-profile">
        <div class="ceo-avatar">S</div>
        <div>
          <div class="ceo-name">Shibata</div>
          <div class="ceo-role">CEO / Founder</div>
        </div>
      </div>
      <div class="target-select">
        <button class="target-chip-all" onclick="toggleAll()">ALL</button>
        <button class="target-chip active" data-id="cmo" style="--c:#E91E63;--cr:233,30,99" onclick="toggleTarget(this)">CMO</button>
        <button class="target-chip active" data-id="cfo" style="--c:#4CAF50;--cr:76,175,80" onclick="toggleTarget(this)">CFO</button>
        <button class="target-chip active" data-id="cpo" style="--c:#9C27B0;--cr:156,39,176" onclick="toggleTarget(this)">CPO</button>
        <button class="target-chip active" data-id="cso" style="--c:#FF9800;--cr:255,152,0" onclick="toggleTarget(this)">CSO</button>
        <button class="target-chip active" data-id="cto" style="--c:#2196F3;--cr:33,150,243" onclick="toggleTarget(this)">CTO</button>
      </div>
    </div>

    <div class="ceo-input-area">
      <textarea class="ceo-textarea" id="ceoInput" placeholder="CXOへの指示を入力...&#10;&#10;例: マネタイズ戦略を考えてください&#10;例: ロールプレイ機能のMVPを2ヶ月で出したい"></textarea>
      <div class="send-row">
        <span class="send-hint">Ctrl+Enter で送信</span>
        <button class="send-btn" id="sendBtn" onclick="sendInstruction()">指示を出す</button>
      </div>
    </div>

    <div class="ceo-inbox" id="ceoInbox">
      <div class="inbox-title">Inbox - CXOからの報告</div>
    </div>
  </div>

  <!-- OFFICE AREA -->
  <div class="office-area">
    <div class="office-grid" id="officeGrid"></div>
  </div>
</div>

<script>
const AGENTS = {
  cmo: { title: "CMO", name: "Tanaka Misaki", emoji: "\u{1F4E3}", color: "#E91E63" },
  cfo: { title: "CFO", name: "Sato Kenichi", emoji: "\u{1F4B0}", color: "#4CAF50" },
  cpo: { title: "CPO", name: "Suzuki Yoko", emoji: "\u{1F3A8}", color: "#9C27B0" },
  cso: { title: "CSO", name: "Takahashi Daisuke", emoji: "\u265F\uFE0F", color: "#FF9800" },
  cto: { title: "CTO", name: "Yamada Takuya", emoji: "\u2699\uFE0F", color: "#2196F3" },
};

// track accumulated markdown per agent across multiple turns
const agentFullContent = {};
const agentRawTexts = {};
let activeStreams = 0;

function hexToRgb(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)].join(',');
}

function createCards() {
  const grid = document.getElementById('officeGrid');
  for (const [id, a] of Object.entries(AGENTS)) {
    const rgb = hexToRgb(a.color);
    agentFullContent[id] = '';
    agentRawTexts[id] = '';
    grid.innerHTML += `
      <div class="agent-card" id="card-${id}" style="--agent-color:${a.color};--agent-color-rgb:${rgb}">
        <div class="agent-top">
          <div class="agent-avatar">${a.emoji}</div>
          <div class="agent-info">
            <div class="agent-title">${a.title}</div>
            <div class="agent-name">${a.name}</div>
          </div>
          <div class="agent-status">
            <div class="status-dot waiting" id="dot-${id}"></div>
            <span id="stxt-${id}">待機中</span>
          </div>
        </div>
        <div class="agent-body" id="body-${id}">
          <div class="placeholder">CEO Shibataからの指示を待っています...</div>
        </div>
        <div class="agent-footer">
          <span id="chars-${id}">0 文字</span>
          <span id="file-${id}"></span>
        </div>
      </div>`;
  }
}

function getSelectedTargets() {
  return [...document.querySelectorAll('.target-chip.active')].map(c => c.dataset.id);
}

function toggleTarget(el) {
  el.classList.toggle('active');
}

function toggleAll() {
  const chips = document.querySelectorAll('.target-chip');
  const allActive = [...chips].every(c => c.classList.contains('active'));
  chips.forEach(c => allActive ? c.classList.remove('active') : c.classList.add('active'));
}

async function sendInstruction() {
  const input = document.getElementById('ceoInput');
  const text = input.value.trim();
  if (!text) return;

  const targets = getSelectedTargets();
  if (targets.length === 0) { alert('送信先のCXOを選択してください'); return; }

  document.getElementById('sendBtn').disabled = true;

  // Send to server
  await fetch('/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction: text, targets }),
  });

  // Show instruction in each targeted agent
  for (const id of targets) {
    const body = document.getElementById(`body-${id}`);
    // Add CEO instruction to accumulated content
    agentFullContent[id] += `<div class="ceo-instruction"><strong>CEO:</strong> ${escapeHtml(text)}</div>`;
    body.innerHTML = agentFullContent[id] + '<span class="typing-cursor"></span>';
    body.scrollTop = body.scrollHeight;
  }

  input.value = '';

  // Start streaming for each target
  activeStreams = targets.length;
  for (const id of targets) {
    streamAgent(id, text);
  }
}

function streamAgent(id, instruction) {
  const body = document.getElementById(`body-${id}`);
  const dot = document.getElementById(`dot-${id}`);
  const stxt = document.getElementById(`stxt-${id}`);
  const charsEl = document.getElementById(`chars-${id}`);
  const fileEl = document.getElementById(`file-${id}`);
  const card = document.getElementById(`card-${id}`);

  dot.className = 'status-dot working';
  stxt.textContent = '分析中...';
  card.classList.add('active');

  agentRawTexts[id] = '';

  const evtSource = new EventSource(`/stream/${id}`);

  evtSource.onmessage = (e) => {
    const data = JSON.parse(e.data);

    if (data.type === 'text') {
      agentRawTexts[id] += data.content;
      body.innerHTML = agentFullContent[id] + marked.parse(agentRawTexts[id]) + '<span class="typing-cursor"></span>';
      body.scrollTop = body.scrollHeight;
      charsEl.textContent = `${agentRawTexts[id].length} 文字`;
    }

    if (data.type === 'ceo_items') {
      for (const item of data.items) {
        addInboxItem(item);
      }
    }

    if (data.type === 'done') {
      evtSource.close();
      // Save the completed markdown to accumulated content
      agentFullContent[id] += marked.parse(agentRawTexts[id]);
      body.innerHTML = agentFullContent[id];
      body.scrollTop = body.scrollHeight;
      dot.className = 'status-dot done';
      stxt.textContent = '完了';
      card.classList.remove('active');
      if (data.file) {
        fileEl.innerHTML = `<span class="file-link">${data.file}</span>`;
      }
      activeStreams--;
      if (activeStreams <= 0) {
        document.getElementById('sendBtn').disabled = false;
      }
    }

    if (data.type === 'error') {
      evtSource.close();
      body.innerHTML += `<div style="color:#f44336;padding:10px">Error: ${data.content}</div>`;
      dot.style.background = '#f44336';
      stxt.textContent = 'エラー';
      activeStreams--;
      if (activeStreams <= 0) {
        document.getElementById('sendBtn').disabled = false;
      }
    }
  };

  evtSource.onerror = () => { evtSource.close(); };
}

function addInboxItem(item) {
  const inbox = document.getElementById('ceoInbox');
  const div = document.createElement('div');
  div.className = 'inbox-item';
  const typeLabel = item.type === 'approval' ? '承認依頼' : '提案';
  const typeClass = item.type === 'approval' ? 'approval' : 'proposal';
  const itemId = 'inbox-' + Date.now() + Math.random().toString(36).slice(2,5);

  div.innerHTML = `
    <div class="inbox-item-header">
      <span class="inbox-badge ${typeClass}">${typeLabel}</span>
      <span class="inbox-from">${item.title} より</span>
    </div>
    <div class="inbox-content">${escapeHtml(item.content)}</div>
    <div class="inbox-actions">
      <button class="inbox-btn approve" onclick="respondToAgent('${item.agent}', '承認します。進めてください。', this)">承認</button>
      <button class="inbox-btn reject" onclick="respondToAgent('${item.agent}', '却下します。再検討してください。', this)">却下</button>
      <button class="inbox-btn comment" onclick="showReplyInput('${itemId}')">コメント</button>
    </div>
    <input class="inbox-reply-input" id="${itemId}" placeholder="コメントを入力してEnter..."
      onkeydown="if(event.key==='Enter'){respondToAgent('${item.agent}', this.value, this); this.style.display='none';}">
  `;
  inbox.appendChild(div);
  inbox.scrollTop = inbox.scrollHeight;
}

function showReplyInput(id) {
  const el = document.getElementById(id);
  el.style.display = 'block';
  el.focus();
}

async function respondToAgent(agentId, message, btnEl) {
  // Send CEO response to agent
  await fetch('/respond_to_agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: agentId, response: `CEO柴田からの返答: ${message}` }),
  });

  // Disable buttons in this inbox item
  const item = btnEl.closest('.inbox-item');
  item.querySelectorAll('.inbox-btn').forEach(b => { b.disabled = true; b.style.opacity = '0.3'; });
  item.innerHTML += `<div style="font-size:11px;color:#4CAF50;margin-top:6px">✓ 返答済み: ${escapeHtml(message)}</div>`;

  // Stream agent's follow-up response
  const body = document.getElementById(`body-${agentId}`);
  agentFullContent[agentId] += `<div class="ceo-instruction"><strong>CEO:</strong> ${escapeHtml(message)}</div>`;
  body.innerHTML = agentFullContent[agentId] + '<span class="typing-cursor"></span>';

  activeStreams = 1;
  document.getElementById('sendBtn').disabled = true;
  streamAgent(agentId, message);
}

async function resetAll() {
  if (!confirm('会話をリセットしますか？')) return;
  await fetch('/reset', { method: 'POST' });
  for (const id of Object.keys(AGENTS)) {
    agentFullContent[id] = '';
    agentRawTexts[id] = '';
    document.getElementById(`body-${id}`).innerHTML = '<div class="placeholder">CEO Shibataからの指示を待っています...</div>';
    document.getElementById(`dot-${id}`).className = 'status-dot waiting';
    document.getElementById(`stxt-${id}`).textContent = '待機中';
    document.getElementById(`chars-${id}`).textContent = '0 文字';
    document.getElementById(`file-${id}`).innerHTML = '';
    document.getElementById(`card-${id}`).classList.remove('active');
  }
  // Clear inbox
  const inbox = document.getElementById('ceoInbox');
  inbox.innerHTML = '<div class="inbox-title">Inbox - CXOからの報告</div>';
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// Ctrl+Enter to send
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    sendInstruction();
  }
});

createCards();
</script>
</body>
</html>"""


if __name__ == "__main__":
    print("\nCXO Agent Office starting...")
    print("Open http://localhost:5000 in your browser\n")
    app.run(debug=False, port=5000, threaded=True)
