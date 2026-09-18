#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
.venv/bin/python -m pytest
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/python scripts/generate_showcase.py --check
npm --prefix apps/web run lint
npm --prefix apps/web run typecheck
npm --prefix apps/web run format:check
NEXT_TELEMETRY_DISABLED=1 npm --prefix apps/web run build
echo "Offline checks and production build passed. Browser tests: cd apps/web && npm run test:e2e"
