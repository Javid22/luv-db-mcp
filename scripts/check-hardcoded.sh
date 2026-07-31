#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# check-hardcoded.sh
# Scans src/ for hardcoded IPs, hostnames, passwords, and API-like strings.
# Exits 1 if any violations are found (blocks CI).
# ---------------------------------------------------------------------------

set -euo pipefail

SCAN_DIR="src"
ERRORS=0

red()   { echo -e "\033[31m[FAIL]\033[0m $*"; }
green() { echo -e "\033[32m[ OK ]\033[0m $*"; }

# ── 1. Private IP addresses ──────────────────────────────────────────────────
echo "Checking for hardcoded private IP addresses..."
if grep -rn \
  --include="*.ts" \
  -E "(\"|\`|')(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)[0-9]+\.[0-9]+" \
  "$SCAN_DIR"; then
  red "Hardcoded private IP address found. Use env vars (DB_HOST) instead."
  ERRORS=$((ERRORS + 1))
else
  green "No hardcoded private IPs."
fi

# ── 2. Hardcoded port numbers in connection strings ──────────────────────────
echo "Checking for hardcoded DB port numbers in strings..."
if grep -rn \
  --include="*.ts" \
  -E "(\"|\`|')(3306|5432|6446|27017|6379)(\"|\`|')" \
  "$SCAN_DIR"; then
  red "Hardcoded DB port found. Use env vars (DB_PORT) instead."
  ERRORS=$((ERRORS + 1))
else
  green "No hardcoded DB ports."
fi

# ── 3. Inline passwords / secrets ────────────────────────────────────────────
echo "Checking for hardcoded password-like strings..."
if grep -rn \
  --include="*.ts" \
  -E "password\s*[:=]\s*(\"[^\"]{4,}\"|'[^']{4,}'|\`[^\`]{4,}\`)" \
  "$SCAN_DIR" | grep -v "process\.env" | grep -v "args\?" | grep -v "string"; then
  red "Hardcoded password value found."
  ERRORS=$((ERRORS + 1))
else
  green "No hardcoded passwords."
fi

# ── 4. API keys / tokens (common patterns) ───────────────────────────────────
echo "Checking for hardcoded API keys / tokens..."
if grep -rn \
  --include="*.ts" \
  -E "(api_key|apikey|api-key|bearer|authorization)\s*[:=]\s*(\"[A-Za-z0-9+/=_\-]{16,}\"|'[A-Za-z0-9+/=_\-]{16,}')" \
  "$SCAN_DIR" | grep -iv "process\.env"; then
  red "Hardcoded API key or token found."
  ERRORS=$((ERRORS + 1))
else
  green "No hardcoded API keys."
fi

# ── 5. TODO / FIXME security notes ───────────────────────────────────────────
echo "Checking for security-flagged TODOs..."
if grep -rn \
  --include="*.ts" \
  -iE "TODO.*(security|secret|password|credential|token|key)" \
  "$SCAN_DIR"; then
  red "Unresolved security-related TODO found."
  ERRORS=$((ERRORS + 1))
else
  green "No security TODOs."
fi

# ── Result ───────────────────────────────────────────────────────────────────
echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo -e "\033[31m$ERRORS check(s) failed. Fix the issues above before deploying.\033[0m"
  exit 1
else
  echo -e "\033[32mAll hardcoded-value checks passed.\033[0m"
fi
