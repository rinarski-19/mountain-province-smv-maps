#!/usr/bin/env bash
# Author: Rinar M. Dengwas — Mountain Province Land Value Map
#
# Verifies a GitHub token can do what the Publish button needs, BEFORE you
# paste it into Vercel — so a bad token shows up here instead of as a
# confusing 502 in the print panel.
#
#   bash scripts/check-github-token.sh
# The token is typed, never echoed, never stored, never sent anywhere
# except api.github.com.
set -u
OWNER="rinarski-19"
REPO="mountain-province-smv-maps"

read -rsp "Paste your GitHub token (input hidden), then press Enter: " TOKEN
echo

api() { curl -sS -o /tmp/gh_body.$$ -w "%{http_code}" -H "Authorization: Bearer $TOKEN" \
        -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "$@"; }

echo "1. Can the token see the repo?"
CODE=$(api "https://api.github.com/repos/$OWNER/$REPO")
if [ "$CODE" = "200" ]; then
  PUSH=$(python3 -c "import json;print(json.load(open('/tmp/gh_body.$$'))['permissions']['push'])" 2>/dev/null)
  echo "   OK (200). Write access: $PUSH"
  [ "$PUSH" = "True" ] || echo "   ^ PROBLEM: no write access. Give it Contents: Read and write."
else
  echo "   FAILED ($CODE) — token is wrong, expired, or cannot see this repo."
  cat "/tmp/gh_body.$$"; rm -f "/tmp/gh_body.$$"; exit 1
fi

echo "2. Can it read the data directory the app writes to?"
CODE=$(api "https://api.github.com/repos/$OWNER/$REPO/contents/public/data?ref=main")
echo "   HTTP $CODE $([ "$CODE" = 200 ] && echo OK || echo FAILED)"

rm -f "/tmp/gh_body.$$"
echo
echo "If both say OK with 'Write access: True', the token is good for Vercel."
