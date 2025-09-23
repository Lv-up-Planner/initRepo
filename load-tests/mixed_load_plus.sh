#!/bin/sh
set -eu

# Mixed load (list/detail/create/update/delete) using curl.
# Adds --cleanup flag to remove created posts with title prefix.

URL=""
DURATION="60s"
RATE_LIST=40
RATE_DETAIL=15
RATE_CREATE=8
RATE_UPDATE=4
RATE_DELETE=3
SEED_COUNT=5
PREFIX="mlp-"   # title prefix for created posts
CLEANUP_ONLY=0

usage() {
  echo "Usage: sh ./mixed_load_plus.sh --url <BASE_URL> [--duration 60s] [--rate-list N] [--rate-detail N] [--rate-create N] [--rate-update N] [--rate-delete N] [--cleanup]";
}

while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --duration) DURATION="$2"; shift 2 ;;
    --rate-list) RATE_LIST="$2"; shift 2 ;;
    --rate-detail) RATE_DETAIL="$2"; shift 2 ;;
    --rate-create) RATE_CREATE="$2"; shift 2 ;;
    --rate-update) RATE_UPDATE="$2"; shift 2 ;;
    --rate-delete) RATE_DELETE="$2"; shift 2 ;;
    --cleanup) CLEANUP_ONLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if [ -z "$URL" ]; then echo "ERROR: --url is required" >&2; usage; exit 1; fi

to_seconds() { d="$1"; case "$d" in *s) echo "${d%?}";; *m) m="${d%?}"; echo $(( m * 60 ));; *) echo "$d";; esac; }
DUR_S=$(to_seconds "$DURATION")

SEED_FILE="$(mktemp)"
CREATED_FILE="$(mktemp)"   # IDs created during THIS run
TOKEN_FILE="$(mktemp)"
cleanup_tmp() { rm -f "$SEED_FILE" "$CREATED_FILE" "$TOKEN_FILE" 2>/dev/null || true; }
trap cleanup_tmp EXIT INT TERM

rand_str() { LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c "$1"; }
extract_token() { sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'; }
extract_id() { sed -n 's/.*"id"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p'; }

pick_random_id() {
  cnt=$(wc -l < "$SEED_FILE" | tr -d ' ')
  if [ "$cnt" -le 0 ]; then echo 1; return; fi
  rnd=$(od -An -N2 -tu2 /dev/urandom | tr -d ' ')
  idx=$(( (rnd % cnt) + 1 ))
  sed -n "${idx}p" "$SEED_FILE"
}

pick_random_created_id() {
  if [ ! -s "$CREATED_FILE" ]; then return 1; fi
  cnt=$(wc -l < "$CREATED_FILE" | tr -d ' ')
  if [ "$cnt" -le 0 ]; then return 1; fi
  rnd=$(od -An -N2 -tu2 /dev/urandom | tr -d ' ')
  idx=$(( (rnd % cnt) + 1 ))
  sed -n "${idx}p" "$CREATED_FILE"
}

list_json() { curl -s "${URL%/}/api/posts"; }

cleanup_posts() {
  TOKEN=$(cat "$TOKEN_FILE" 2>/dev/null || echo "")
  # 1) Prefer exact IDs created in THIS run
  if [ -s "$CREATED_FILE" ] && [ -n "$TOKEN" ]; then
    # unique IDs only
    sort -u "$CREATED_FILE" | while read -r ID; do
      [ -n "$ID" ] || continue
      echo "Attempting to delete ID: $ID"
      curl -v -s -o /dev/null -X DELETE -H "Authorization: Bearer $TOKEN" "${URL%/}/api/posts/$ID" || true
    done
  fi
  # 2) Best-effort fallback: remove any leftover prefix posts (may 403 for other authors)
  JSON=$(list_json)
  echo "$JSON" | tr '{' '\n' | grep '"title"' | while read -r line; do
    echo "$line" | grep "\"title\"[[:space:]]*:[[:space:]]*\"$PREFIX" >/dev/null 2>&1 || continue
    ID=$(echo "$line" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p')
    if [ -n "$ID" ] && [ -n "$TOKEN" ]; then
      curl -s -o /dev/null -X DELETE -H "Authorization: Bearer $TOKEN" "${URL%/}/api/posts/$ID" || true
    fi
  done
}

if [ "$CLEANUP_ONLY" = "1" ]; then
  cleanup_posts
  echo "Cleanup done."
  exit 0
fi

USERNAME="mlp_$(rand_str 6)"; PASSWORD="secret_$(rand_str 6)"; EMAIL="$USERNAME@example.com"
curl -s -o /dev/null -H 'Content-Type: application/json' -d "{\"username\":\"$USERNAME\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "${URL%/}/api/register" || true
LOGIN_RESP=$(curl -s -H 'Content-Type: application/json' -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" "${URL%/}/api/login")
TOKEN=$(echo "$LOGIN_RESP" | extract_token)
echo "$TOKEN" > "$TOKEN_FILE"

i=1; while [ "$i" -le "$SEED_COUNT" ]; do
  TITLE="seedp-$i-$(rand_str 4)"; CONTENT="Seed plus $i $(rand_str 20)"
  RESP=$(curl -s -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d "{\"title\":\"$TITLE\",\"content\":\"$CONTENT\"}" "${URL%/}/api/posts")
  ID=$(echo "$RESP" | extract_id || true); if [ -n "$ID" ]; then echo "$ID" >> "$SEED_FILE"; fi
  i=$(( i + 1 ))
done

run_list() { sec=1; while [ "$sec" -le "$DUR_S" ]; do j=1; while [ "$j" -le "$RATE_LIST" ]; do curl -s -o /dev/null "${URL%/}/api/posts" & j=$(( j + 1 )); done; wait; sec=$(( sec + 1 )); done; }
run_detail() { sec=1; while [ "$sec" -le "$DUR_S" ]; do j=1; while [ "$j" -le "$RATE_DETAIL" ]; do ID=$(pick_random_id); curl -s -o /dev/null "${URL%/}/api/posts/$ID" & j=$(( j + 1 )); done; wait; sec=$(( sec + 1 )); done; }
run_create() {
  TOKEN=$(cat "$TOKEN_FILE")
  sec=1
  while [ "$sec" -le "$DUR_S" ]; do
    j=1
    while [ "$j" -le "$RATE_CREATE" ]; do
      T="$PREFIX$(rand_str 6)"; C="Load gen $(rand_str 40)"
      RESP=$(curl -s -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d "{\"title\":\"$T\",\"content\":\"$C\"}" "${URL%/}/api/posts")
      ID=$(echo "$RESP" | extract_id || true)
      if [ -n "$ID" ]; then echo "$ID" >> "$CREATED_FILE"; fi &
      j=$(( j + 1 ))
    done
    wait
    sec=$(( sec + 1 ))
  done
}
run_update() { TOKEN=$(cat "$TOKEN_FILE"); sec=1; while [ "$sec" -le "$DUR_S" ]; do j=1; while [ "$j" -le "$RATE_UPDATE" ]; do ID=$(pick_random_id); NT="upd-$(rand_str 4)"; curl -s -o /dev/null -X PATCH -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d "{\"title\":\"$NT\"}" "${URL%/}/api/posts/$ID" & j=$(( j + 1 )); done; wait; sec=$(( sec + 1 )); done; }
run_delete() {
  TOKEN=$(cat "$TOKEN_FILE")
  sec=1
  while [ "$sec" -le "$DUR_S" ]; do
    j=1
    while [ "$j" -le "$RATE_DELETE" ]; do
      # Prefer deleting an ID created in THIS run
      CID=$(pick_random_created_id || true)
      if [ -n "${CID:-}" ]; then
        curl -s -o /dev/null -X DELETE -H "Authorization: Bearer $TOKEN" "${URL%/}/api/posts/$CID" &
      else
        # Fallback: choose by prefix (may 403)
        JSON=$(list_json)
        ID=$(echo "$JSON" | awk -v p="$PREFIX" 'BEGIN{RS="},{"} /"title" *: *"'"$PREFIX"'/ { if (match($0, /"id" *: *[0-9]+/)) { m=substr($0,RSTART,RLENGTH); sub(/[^0-9]*/,"",m); print m; exit } }')
        if [ -n "$ID" ]; then curl -s -o /dev/null -X DELETE -H "Authorization: Bearer $TOKEN" "${URL%/}/api/posts/$ID" & fi
      fi
      j=$(( j + 1 ))
    done
    wait
    sec=$(( sec + 1 ))
  done
}

run_list &
run_detail &
run_create &
run_update &
run_delete &
wait

echo "Cleanup created posts with prefix $PREFIX..."
cleanup_posts
echo "Done."
