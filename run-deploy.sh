#!/usr/bin/env bash
set -euo pipefail

# Simple deploy helper for local/server using Docker Compose
# Usage: copy .env.example -> .env, then ./run-deploy.sh

if [ ! -f .env ]; then
  echo "WARNING: .env not found. Copy .env.example to .env or export env vars manually."
  echo "Creating .env from .env.example"
  cp .env.example .env
fi

echo "Building and starting containers..."
docker compose build --pull --no-cache

docker compose up -d

echo "Waiting for blog-service health..."
for i in {1..30}; do
  STATUS=$(docker inspect --format='{{json .State.Health}}' blog-service 2>/dev/null || true)
  if echo "$STATUS" | grep -q "\"Status\": \"healthy\""; then
    echo "Service is healthy"
    break
  fi
  echo -n "."
  sleep 1
done

echo

echo "Deployment finished. Access the app at http://localhost:8005/blog/"

echo "To follow logs: docker compose logs -f"
