#!/usr/bin/env bash
# Pilot run: fetch -> screen -> pick a paper -> draft script -> render plan.
# Generates artefacts under data/. The actual video generation and posting
# steps are performed by a Pixa MCP-aware agent or by hand.
set -euo pipefail

cd "$(dirname "$0")/.."

cxo fetch --since-days 30
cxo screen --top-n 10

echo
echo "Open data/candidates/<today>.md, copy a paper id, then run:"
echo "  cxo script <paper_id>"
echo "Review data/scripts/<id>.md, then move it to data/approved/<id>.md"
echo "Finally:"
echo "  cxo render <paper_id>"
