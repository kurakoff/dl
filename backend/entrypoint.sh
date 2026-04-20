#!/bin/sh

# One-time DB migration from legacy server via HTTP
# Runs only once — creates a flag file after success
if [ ! -f /app/data/.migrated ] && [ -n "$INIT_DB_URL" ]; then
  echo "Downloading DB from legacy server..."
  wget -q -O /app/data/app.db "$INIT_DB_URL"
  NEW_SIZE=$(stat -c%s /app/data/app.db 2>/dev/null || echo 0)
  echo "DB downloaded: $NEW_SIZE bytes"
  touch /app/data/.migrated
fi

exec node src/index.js
