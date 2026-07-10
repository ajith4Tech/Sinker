#!/usr/bin/env bash
# Runs once when the Codespace (or any devcontainer) is first created.
# Installs both the Node and Python dependencies and points the app at the
# freshly-created virtualenv, so the only thing left to do is `npm run dev`.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

npm install

python3 -m venv .venv
.venv/bin/pip install --quiet -r scripts/requirements.txt

if [ ! -f .env ]; then
  cp .env.example .env
fi
sed -i "s#^PYTHON_BIN=.*#PYTHON_BIN=\"$(pwd)/.venv/bin/python3\"#" .env

echo ""
echo "Setup complete. Run: npm run dev"
