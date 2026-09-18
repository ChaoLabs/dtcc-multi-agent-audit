#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

task_python="${PYTHON_BIN:-python3}"
command -v "$task_python" >/dev/null || { echo "Install Python 3.12–3.14 first."; exit 1; }
command -v node >/dev/null || { echo "Install Node.js 24 LTS first."; exit 1; }
command -v npm >/dev/null || { echo "npm is required."; exit 1; }
"$task_python" -c 'import sys; assert (3, 12) <= sys.version_info[:2] < (3, 15), "Use Python 3.12, 3.13 or 3.14"'
node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if (!(major===24 || major===22 && minor>=14)) { console.error("Use Node 24 LTS or Node 22.14+"); process.exit(1); }'
if [[ ! -d .venv ]]; then
  "$task_python" -m venv .venv
fi
.venv/bin/python -c 'import sys; assert (3, 12) <= sys.version_info[:2] < (3, 15), "Existing .venv uses an unsupported Python; create a fresh clone instead"'
.venv/bin/python -m pip --version >/dev/null 2>&1 || .venv/bin/python -m ensurepip --upgrade
.venv/bin/python -m pip install -r requirements-dev.lock
npm ci --prefix apps/web --no-fund
echo "Setup complete. No AWS key is required. Run: bash scripts/check.sh"
