#!/bin/sh

# One-time DB init from legacy server (remove after first deploy)
DB_SIZE=$(stat -c%s /app/data/app.db 2>/dev/null || echo 0)
if [ "$DB_SIZE" -lt 100000 ] && [ -n "$INIT_DB_HOST" ]; then
  echo "DB not found, copying from legacy server..."
  apk add --no-cache openssh-client sshpass
  sshpass -p "$INIT_DB_PASS" scp -o StrictHostKeyChecking=no "$INIT_DB_USER@$INIT_DB_HOST:$INIT_DB_PATH" /app/data/app.db
  echo "DB copied successfully"
fi

exec node src/index.js
