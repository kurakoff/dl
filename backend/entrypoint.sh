#!/bin/sh

# One-time DB init from legacy server via HTTP (remove after first successful migration)
DB_SIZE=$(stat -c%s /app/data/app.db 2>/dev/null || echo 0)
if [ "$DB_SIZE" -lt 100000 ] && [ -n "$INIT_DB_URL" ]; then
  echo "DB is empty or small ($DB_SIZE bytes), downloading from legacy..."
  wget -q -O /app/data/app.db "$INIT_DB_URL"
  NEW_SIZE=$(stat -c%s /app/data/app.db 2>/dev/null || echo 0)
  echo "DB downloaded: $NEW_SIZE bytes"
fi

exec node src/index.js
