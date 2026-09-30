#!/usr/bin/env bash
# One-shot setup for an Ubuntu VM (e.g. Oracle Cloud Always Free). Run as root:
#   sudo DOMAIN=yourname.duckdns.org ADMIN_PASSWORD='strong-password' bash deploy/setup.sh
# Run it from inside the cloned repo. It installs Node 22 + Caddy (automatic HTTPS), runs the app as a service,
# and makes a nightly database backup.
set -euo pipefail
: "${DOMAIN:?set DOMAIN, e.g. yourname.duckdns.org}"
: "${ADMIN_PASSWORD:?set ADMIN_PASSWORD}"
APP=/opt/studyhub
SRC="$(cd "$(dirname "$0")/.." && pwd)"

apt-get update
apt-get install -y curl ca-certificates gnupg sqlite3 debian-keyring debian-archive-keyring apt-transport-https
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy

id studyhub &>/dev/null || useradd --system --home "$APP" --shell /usr/sbin/nologin studyhub
mkdir -p "$APP" /var/lib/studyhub/backups
rsync -a --delete --exclude node_modules --exclude data --exclude .git "$SRC"/ "$APP"/ 2>/dev/null || cp -r "$SRC"/. "$APP"/
(cd "$APP" && npm ci --omit=dev)
chown -R studyhub:studyhub "$APP" /var/lib/studyhub

cat > /etc/studyhub.env <<EOF
NODE_ENV=production
PORT=3000
DATA_DIR=/var/lib/studyhub
ADMIN_PASSWORD=$ADMIN_PASSWORD
EOF
chmod 600 /etc/studyhub.env

cat > /etc/systemd/system/studyhub.service <<EOF
[Unit]
Description=StudyHub
After=network.target
[Service]
User=studyhub
WorkingDirectory=$APP
EnvironmentFile=/etc/studyhub.env
ExecStart=/usr/bin/node --no-warnings server/index.js
Restart=always
[Install]
WantedBy=multi-user.target
EOF

cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    reverse_proxy 127.0.0.1:3000
}
EOF

cat > /etc/cron.daily/studyhub-backup <<'EOF'
#!/bin/sh
sqlite3 /var/lib/studyhub/studyhub.db ".backup /var/lib/studyhub/backups/studyhub-$(date +%F).db"
find /var/lib/studyhub/backups -name '*.db' -mtime +14 -delete
EOF
chmod +x /etc/cron.daily/studyhub-backup

# Ubuntu images on Oracle ship with a restrictive firewall
if command -v iptables >/dev/null; then
  iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport 80 -j ACCEPT
  iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport 443 -j ACCEPT
  command -v netfilter-persistent >/dev/null && netfilter-persistent save || true
fi

systemctl daemon-reload
systemctl enable --now studyhub
systemctl restart caddy
echo "Done. Open https://$DOMAIN  (login: admin / the ADMIN_PASSWORD you set)"
