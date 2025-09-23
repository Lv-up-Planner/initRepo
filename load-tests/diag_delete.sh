#!/bin/sh
set -eu

# Diagnostic script for DELETE /api/posts/{id}
# Creates a post, checks it exists, deletes it, then verifies it's gone.
# Optionally registers/logins a user if credentials are not provided.
#
# Usage:
#   sh ./diag_delete.sh --url http://127.0.0.1:30700 [--username u --password p]
#

URL=""
USERNAME=""
PASSWORD=""

usage() {
  echo "Usage: sh ./diag_delete.sh --url <BASE_URL> [--username USER --password PASS]";
}

while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --username) USERNAME="$2"; shift 2 ;;
    --password) PASSWORD="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if [ -z "$URL" ]; then echo "ERROR: --url is required" >&2; usage; exit 1; fi

rand_str() { LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c "$1"; }
extract_token() { sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'; }
extract_id() { sed -n 's/.*"id"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p'; }

JQ=0; command -v jq >/dev/null 2>&1 && JQ=1 || true

say() { echo "[diag] $*"; }

# 1) credentials
GEN=0
if [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
  USERNAME="diag_$(rand_str 6)"
  PASSWORD="secret_$(rand_str 6)"
  GEN=1
  say "generated credentials username=$USERNAME password=$PASSWORD"
fi
EMAIL="$USERNAME@example.com"

# 2) register (201 or 400 acceptable)
say "registering user (ok if 400 already exists)"
curl -s -o /dev/null -w "status=%{http_code}\n" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USERNAME\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  "${URL%/}/api/register" || true

# 3) login -> token
say "logging in"
LOGIN_RESP=$(curl -s -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" \
  "${URL%/}/api/login")
TOKEN=$(echo "$LOGIN_RESP" | extract_token)
if [ -z "$TOKEN" ]; then
  say "ERROR: failed to obtain token"; echo "$LOGIN_RESP"; exit 1
fi
say "obtained token (truncated): $(echo "$TOKEN" | cut -c1-10)***"

# 4) create post
TITLE="diag-$(date +%s)-$(rand_str 4)"
CONTENT="Diagnostic content $(rand_str 24)"
say "creating post title=$TITLE"
CREATE_RESP=$(curl -s -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d "{\"title\":\"$TITLE\",\"content\":\"$CONTENT\"}" \
  "${URL%/}/api/posts")
POST_ID=$(echo "$CREATE_RESP" | extract_id)
if [ -z "$POST_ID" ]; then
  say "ERROR: failed to create post"; echo "$CREATE_RESP"; exit 1
fi
say "created post id=$POST_ID"

# 5) GET before delete
say "verifying before delete (should be 200)"
curl -s -o /dev/null -w "status=%{http_code}\n" "${URL%/}/api/posts/$POST_ID"
if [ "$JQ" -eq 1 ]; then curl -s "${URL%/}/api/posts/$POST_ID" | jq .; else curl -s "${URL%/}/api/posts/$POST_ID"; fi

# 6) DELETE
say "deleting id=$POST_ID (expect 204)"
curl -s -o /dev/null -w "status=%{http_code}\n" -X DELETE -H "Authorization: Bearer $TOKEN" "${URL%/}/api/posts/$POST_ID"

# 7) GET after delete
say "verifying after delete (should be 404)"
curl -s -o /dev/null -w "status=%{http_code}\n" "${URL%/}/api/posts/$POST_ID"
RESP_AFTER=$(curl -s "${URL%/}/api/posts/$POST_ID")
if [ "$JQ" -eq 1 ]; then echo "$RESP_AFTER" | jq .; else echo "$RESP_AFTER"; fi

# 8) List top entries (id/title) for sanity
say "listing top entries for sanity (id/title)"
LIST=$(curl -s "${URL%/}/api/posts")
if [ "$JQ" -eq 1 ]; then
  echo "$LIST" | jq '.[0:5] | map({id, title})'
else
  echo "$LIST" | sed 's/{/\n{/g' | sed -n '1,10p' | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*"title"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/id=\1 title=\2/p'
fi

say "done. Please share the outputs above (especially statuses for before/after and the list snippet)."

