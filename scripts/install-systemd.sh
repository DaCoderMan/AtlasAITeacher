#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ATLAS_ENV_FILE:-$ROOT/.env}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
ROOT_ESCAPED="$(printf '%q' "$ROOT")"
ENV_ESCAPED="$(printf '%q' "$ENV_FILE")"
mkdir -p "$UNIT_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Atlas environment file not found: $ENV_FILE" >&2
  echo "Create it from .env.example and set DATABASE_URL plus required secrets." >&2
  exit 1
fi

cat > "$UNIT_DIR/atlas-ingest.service" <<EOF
[Unit]
Description=Atlas automatic ingestion worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$ROOT
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/env bash -lc 'set -a; source $ENV_ESCAPED; set +a; cd $ROOT_ESCAPED && exec node scripts/atlas-daemon.js'
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

cat > "$UNIT_DIR/atlas-dropbox.service" <<EOF
[Unit]
Description=Atlas automatic file inbox watcher
After=network-online.target atlas-ingest.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$ROOT
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/env bash -lc 'set -a; source $ENV_ESCAPED; set +a; cd $ROOT_ESCAPED && exec node scripts/watch-dropbox.js'
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now atlas-ingest.service atlas-dropbox.service

echo "Atlas automation services installed and started."
systemctl --user --no-pager --full status atlas-ingest.service atlas-dropbox.service || true
