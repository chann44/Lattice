#!/usr/bin/env sh
set -eu

DATE=$(date +%Y-%m-%d)
BACKUP_DIR=${BACKUP_DIR:-./data/backups}
DB_PATH=${DB_PATH:-./data/agent-scm.db}

mkdir -p "$BACKUP_DIR"
sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/agent-scm-$DATE.db'"
gzip -f "$BACKUP_DIR/agent-scm-$DATE.db"

echo "backup created: $BACKUP_DIR/agent-scm-$DATE.db.gz"
