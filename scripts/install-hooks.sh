#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

command -v python3 >/dev/null 2>&1 || {
  echo "python3 is required for the privacy gate" >&2
  exit 1
}

git config core.hooksPath .githooks
chmod +x .githooks/pre-commit .githooks/pre-push scripts/sensitive_gate.py

echo "Installed privacy gate hooks (core.hooksPath=.githooks)."
echo "Add local-only names and codes to scripts/sensitive-terms.local (gitignored)."
