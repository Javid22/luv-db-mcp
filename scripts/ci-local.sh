#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# ci-local.sh  — run the full CI pipeline locally before pushing
# Usage: bash scripts/ci-local.sh
# ---------------------------------------------------------------------------

set -euo pipefail

PASS=0
FAIL=0
SKIP=0

green()  { echo -e "\033[32m✔ $*\033[0m"; }
red()    { echo -e "\033[31m✘ $*\033[0m"; }
yellow() { echo -e "\033[33m⚠ $*\033[0m"; }
header() { echo -e "\n\033[1;34m══ $* ══\033[0m"; }

run_step() {
  local label="$1"
  shift
  echo -e "\n  → $label"
  if "$@"; then
    green "$label"
    PASS=$((PASS + 1))
  else
    red "$label"
    FAIL=$((FAIL + 1))
    return 1
  fi
}

# ── Job 1: Secret scan ────────────────────────────────────────────────────────
header "Job 1 · Secret Scan"

# Gitleaks (optional — install with: brew install gitleaks / choco install gitleaks)
if command -v gitleaks &>/dev/null; then
  run_step "Gitleaks secret scan" gitleaks detect --source . --config .gitleaks.toml --no-git
else
  yellow "Gitleaks not installed — skipping (install: https://github.com/gitleaks/gitleaks#installing)"
  SKIP=$((SKIP + 1))
fi

run_step "Hardcoded IPs / hosts / passwords" bash scripts/check-hardcoded.sh

# ── Job 2: Code quality ───────────────────────────────────────────────────────
header "Job 2 · Code Quality"

run_step "Install dependencies"         npm ci --silent
run_step "Audit production deps"        npm audit --omit=dev --audit-level=high
run_step "TypeScript type-check"        npm run typecheck
run_step "ESLint"                       npm run lint

# ── Job 3: Build ─────────────────────────────────────────────────────────────
header "Job 3 · Build"

run_step "Compile TypeScript"           npm run build

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  \033[32mPassed : $PASS\033[0m"
[ "$SKIP" -gt 0 ] && echo -e "  \033[33mSkipped: $SKIP\033[0m"
[ "$FAIL" -gt 0 ] && echo -e "  \033[31mFailed : $FAIL\033[0m"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$FAIL" -gt 0 ]; then
  echo -e "\033[31mCI failed locally — fix the issues above before pushing.\033[0m"
  exit 1
else
  echo -e "\033[32mAll checks passed — safe to push!\033[0m"
fi
