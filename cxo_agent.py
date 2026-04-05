import anthropic
import os

client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

def run_agent(role, system_prompt, task):
    print(f"\n{'='*50}")
    print(f"🤖 {role}")
    print('='*50)
    response = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=4096,
        system=system_prompt,
        messages=[{"role": "user", "content": task}]
    )
    result = response.content[0].text
    print(result)
    return result

task = "Logicというビジネス学習アプリのマネタイズ戦略を考えてください。対象はビジネスパーソン。機能はロジカルシンキング、簿記、PM、ロールプレイです。"

# CMO Agent
cmo = run_agent(
    "CMO Agent",
    "あなたは優秀なCMOです。マーケティング・集客・ブランディングの観点からアドバイスします。",
    task
)

# CFO Agent
cfo = run_agent(
    "CFO Agent",
    "あなたは優秀なCFOです。収益モデル・価格設計・財務戦略の観点からアドバイスします。",
    task
)

# CPO Agent
cpo = run_agent(
    "CPO Agent",
    "あなたは優秀なCPOです。プロダクト戦略・機能優先度・UXの観点からアドバイスします。",
    task
)

# CSO Agent
cso = run_agent(
    "CSO Agent（戦略）",
    "あなたは優秀なCSO（最高戦略責任者）です。事業戦略・競合分析・市場ポジショニング・中長期成長戦略の観点からアドバイスします。",
    task
)

# CTO Agent
cto = run_agent(
    "CTO Agent（開発）",
    "あなたは優秀なCTOです。技術選定・開発ロードマップ・システムアーキテクチャ・開発体制・スケーラビリティの観点からアドバイスします。",
    task
)

print("\n" + "="*50)
print("✅ CXO Agent 完了")
print("="*50)