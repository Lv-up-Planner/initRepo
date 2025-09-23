#!/bin/sh
set -eu

# Mixed load (list/detail/create) using curl only.
# Usage:
#   sh ./mixed_load.sh --url http://127.0.0.1:30700 --duration 60s \
#      --rate-list 64 --rate-detail 12 --rate-create 4

URL=""
DURATION="60s"       # 60s / 2m / plain seconds
RATE_LIST=64         # rps for GET /api/posts
RATE_DETAIL=12       # rps for GET /api/posts/{id}
RATE_CREATE=4        # rps for POST /api/posts
SEED_COUNT=5         # number of seed posts

usage() {
  echo "Usage: sh ./mixed_load.sh --url <BASE_URL> [--duration 60s] [--rate-list 64] [--rate-detail 12] [--rate-create 4]";
}

while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --duration) DURATION="$2"; shift 2 ;;
    --rate-list) RATE_LIST="$2"; shift 2 ;;
    --rate-detail) RATE_DETAIL="$2"; shift 2 ;;
    --rate-create) RATE_CREATE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if [ -z "$URL" ]; then echo "ERROR: --url is required" >&2; usage; exit 1; fi

to_seconds() {
  d="$1"
  case "$d" in
    *s) echo "${d%?}" ;;
    *m) m="${d%?}"; echo $(( m * 60 )) ;;
    *) echo "$d" ;;
  esac
}

DUR_S=$(to_seconds "$DURATION")
TARGET_LIST="${URL%/}/api/posts"

echo "==== Mixed Load Config ===="
echo "URL        : ${URL}"
echo "List       : ${TARGET_LIST} (${RATE_LIST} rps)"
echo "Detail     : /api/posts/{id} (${RATE_DETAIL} rps)"
echo "Create     : /api/posts (${RATE_CREATE} rps)"
echo "Duration   : ${DURATION}"
echo "==========================="

SEED_FILE="$(mktemp)"
TOKEN_FILE="$(mktemp)"
cleanup() { rm -f "$SEED_FILE" "$TOKEN_FILE" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

rand_str() { LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c "$1"; }

extract_token() {
  # naive JSON token extractor
  sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
}

extract_id() {
  sed -n 's/.*"id"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p'
}

pick_random_id() {
  cnt=$(wc -l < "$SEED_FILE" | tr -d ' ')
  if [ "$cnt" -le 0 ]; then echo 1; return; fi
  rnd=$(od -An -N2 -tu2 /dev/urandom | tr -d ' ')
  idx=$(( (rnd % cnt) + 1 ))
  sed -n "${idx}p" "$SEED_FILE"
}

echo "[BEFORE] LB /stats:"
curl -s "${URL%/}/stats" | jq . 2>/dev/null || curl -s "${URL%/}/stats" || true

# Setup: register, login, seed posts
USERNAME="ml_$(rand_str 6)"
PASSWORD="secret_$(rand_str 6)"
EMAIL="$USERNAME@example.com"

# Register (201 or 400 accepted)
curl -s -o /dev/null -w "" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USERNAME\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  "${URL%/}/api/register" || true

# Login -> token
LOGIN_RESP=$(curl -s -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" \
  "${URL%/}/api/login")
TOKEN=$(echo "$LOGIN_RESP" | extract_token)
if [ -z "$TOKEN" ]; then echo "ERROR: failed to obtain token" >&2; exit 1; fi
echo "$TOKEN" > "$TOKEN_FILE"

# Seed posts
i=1
while [ "$i" -le "$SEED_COUNT" ]; do
  TITLE="seed-$i-$(rand_str 4)"
  CONTENT="Seed content $i $(rand_str 20)\nMore lines $(rand_str 10)"
  RESP=$(curl -s -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
    -d "{\"title\":\"$TITLE\",\"content\":\"$CONTENT\"}" \
    "${URL%/}/api/posts")
  ID=$(echo "$RESP" | extract_id || true)
  if [ -n "$ID" ]; then echo "$ID" >> "$SEED_FILE"; fi
  i=$(( i + 1 ))
done

# Per-second burst runners
run_list() {
  sec=1
  while [ "$sec" -le "$DUR_S" ]; do
    j=1
    while [ "$j" -le "$RATE_LIST" ]; do
      curl -s -o /dev/null "${URL%/}/api/posts" &
      j=$(( j + 1 ))
    done
    wait
    sec=$(( sec + 1 ))
  done
}

run_detail() {
  sec=1
  while [ "$sec" -le "$DUR_S" ]; do
    j=1
    while [ "$j" -le "$RATE_DETAIL" ]; do
      ID=$(pick_random_id)
      curl -s -o /dev/null "${URL%/}/api/posts/$ID" &
      j=$(( j + 1 ))
    done
    wait
    sec=$(( sec + 1 ))
  done
}

run_create() {
  TOKEN=$(cat "$TOKEN_FILE")
  sec=1
  while [ "$sec" -le "$DUR_S" ]; do
    j=1
    while [ "$j" -le "$RATE_CREATE" ]; do
      T="ml-$(rand_str 6)"
      C="Load generated content $(rand_str 40)"
      curl -s -o /dev/null \
        -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
        -d "{\"title\":\"$T\",\"content\":\"$C\"}" \
        "${URL%/}/api/posts" &
      j=$(( j + 1 ))
    done
    wait
    sec=$(( sec + 1 ))
  done
}

# Run scenarios concurrently
run_list &
run_detail &
run_create &
wait

echo "[AFTER] LB /stats:"
curl -s "${URL%/}/stats" | jq . 2>/dev/null || curl -s "${URL%/}/stats" || true

echo "Done."

