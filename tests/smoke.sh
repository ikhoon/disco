#!/usr/bin/env bash
# Smoke tests for the compiled disco binary.
#
# Verifies the binary boots, help/version/completions work, and offline error
# paths exit correctly. Does NOT touch the network or the Keychain — live reads
# need a Discord token.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DISCO="${SCRIPT_DIR}/../dist/disco"

if [[ ! -x "$DISCO" ]]; then
  echo "disco binary not found at $DISCO — run \`bun run build\` first" >&2
  exit 1
fi

PASS=0
FAIL=0
pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf '  \033[31m✗\033[0m %s\n    %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }

assert_match() {
  local desc="$1" pattern="$2" out="$3"
  if [[ "$out" == *"$pattern"* ]]; then pass "$desc"
  else fail "$desc" "expected to contain '$pattern', got: $(printf %s "$out" | head -1)"
  fi
}

assert_exit() {
  local desc="$1" want="$2"; shift 2
  "$@" >/dev/null 2>&1
  local got=$?
  if [[ "$got" -eq "$want" ]]; then pass "$desc"
  else fail "$desc" "expected exit $want, got $got"
  fi
}

echo "disco smoke tests"

# Version — must match package.json (src/version.ts is the embedded source).
# Guard against an empty parse: every string contains "", so asserting on an
# empty EXPECTED_VERSION would silently pass and hide version regressions.
EXPECTED_VERSION=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SCRIPT_DIR/../package.json" | head -1)
out=$("$DISCO" --version 2>&1)
if [[ -z "$EXPECTED_VERSION" ]]; then
  fail "--version matches package.json" "could not read version from package.json"
else
  assert_match "--version reports $EXPECTED_VERSION" "$EXPECTED_VERSION" "$out"
fi

# Help lists every subcommand.
out=$("$DISCO" --help 2>&1)
for sub in read channel thread message mention search guilds channels dms whoami auth config completions; do
  assert_match "--help lists '$sub'" "$sub" "$out"
done
assert_exit "bare invocation prints help and exits 0" 0 "$DISCO"

# Completions embed correctly into the compiled binary.
out=$("$DISCO" completions --shell zsh 2>&1)
assert_match "completions --shell zsh emits compdef" "#compdef disco" "$out"
out=$("$DISCO" completions --shell bash 2>&1)
assert_match "completions --shell bash emits complete -F" "complete -F _disco_complete disco" "$out"
assert_match "bash completion keeps \${COMP_WORDS} literal" 'cur="${COMP_WORDS[COMP_CWORD]}"' "$out"
assert_exit "completions --shell fish fails" 1 "$DISCO" completions --shell fish

# Offline error paths (no network, no Keychain).
assert_exit "unknown subcommand exits 2" 2 "$DISCO" frobnicate
assert_exit "channel with unparseable ref exits 1" 1 "$DISCO" channel "not-a-url"
assert_exit "search without a query exits 1" 1 "$DISCO" search
assert_exit "--days rejects a non-integer" 1 "$DISCO" channel 123456789012345678 --days nope
out=$("$DISCO" channel "not-a-url" 2>&1)
assert_match "unparseable ref names the input" 'could not parse "not-a-url"' "$out"

echo
echo "passed: $PASS  failed: $FAIL"
exit $(( FAIL > 0 ))
