#!/bin/sh

# DB migration: download from URL if INIT_DB_URL is set
# After successful migration, remove INIT_DB_URL env var in Coolify
if [ -n "$INIT_DB_URL" ]; then
  echo "Downloading DB from $INIT_DB_URL ..."
  apk add --no-cache curl >/dev/null 2>&1
  curl -fL --connect-timeout 10 --max-time 120 -o /app/data/app.db "$INIT_DB_URL"
  echo "DB download done: $(stat -c%s /app/data/app.db 2>/dev/null || echo '?') bytes"
fi

exec node src/index.js
