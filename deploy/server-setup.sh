#!/usr/bin/env bash
# One-time setup of a FRESH Ubuntu 24.04 server for Mastishq (run it on the server, as root).
#
#   sudo APP_DOMAIN=app.mastishq.ai API_DOMAIN=api-new.mastishq.ai EMAIL=you@example.com bash server-setup.sh
#
# It is safe to run again: every step checks before it changes anything.
set -euo pipefail

: "${APP_DOMAIN:?Set APP_DOMAIN, e.g. app.mastishq.ai}"
: "${API_DOMAIN:?Set API_DOMAIN, e.g. api-new.mastishq.ai}"
: "${EMAIL:?Set EMAIL (the certificate authority sends expiry notices there)}"
NODE_MAJOR="${NODE_MAJOR:-24}"
DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ "$(id -u)" = 0 ] || { echo "Please run with sudo."; exit 1; }
id -u "$DEPLOY_USER" >/dev/null 2>&1 || { echo "User '$DEPLOY_USER' does not exist (set DEPLOY_USER=...)."; exit 1; }

echo "== 1/8  System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx gettext-base ufw unattended-upgrades curl ca-certificates gnupg rsync dnsutils

echo "== 2/8  Node.js ${NODE_MAJOR}"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
node --version

echo "== 3/8  Service user and folders"
id -u mastishq >/dev/null 2>&1 || useradd --system --home /var/lib/mastishq --shell /usr/sbin/nologin mastishq
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 755 /opt/mastishq /opt/mastishq/backend /opt/mastishq/frontend
install -d -o mastishq -g mastishq -m 750 /var/lib/mastishq /var/lib/mastishq/uploads
install -d -m 700 /etc/mastishq
if [ ! -f /etc/mastishq/api.env ]; then
  install -m 600 "$HERE/env.production.example" /etc/mastishq/api.env
  echo "   Created /etc/mastishq/api.env from the template. EDIT IT before starting the API."
fi

echo "== 4/8  API service (systemd)"
install -m 644 "$HERE/systemd/mastishq-api.service" /etc/systemd/system/mastishq-api.service
systemctl daemon-reload
systemctl enable mastishq-api

echo "== 5/8  nginx"
export APP_DOMAIN API_DOMAIN
envsubst '${APP_DOMAIN} ${API_DOMAIN}' < "$HERE/nginx/mastishq.conf.template" > /etc/nginx/sites-available/mastishq
ln -sf /etc/nginx/sites-available/mastishq /etc/nginx/sites-enabled/mastishq
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl reload nginx || systemctl restart nginx

echo "== 6/8  Firewall (only SSH, HTTP and HTTPS are open)"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "== 7/8  Automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "== 8/8  HTTPS certificate (Let's Encrypt)"
MY_IP="$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')"
ok=1
for d in "$APP_DOMAIN" "$API_DOMAIN"; do
  got="$(dig +short "$d" | tail -n1)"
  if [ "$got" != "$MY_IP" ]; then ok=0; echo "   DNS for $d is '${got:-not set}', this server is $MY_IP"; fi
done
if [ "$ok" = 1 ]; then
  certbot --nginx -d "$APP_DOMAIN" -d "$API_DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
  echo "   HTTPS is on, certificates renew automatically."
else
  echo "   Skipped: point both names at $MY_IP in DNS, wait a few minutes, then run:"
  echo "   sudo certbot --nginx -d $APP_DOMAIN -d $API_DOMAIN --agree-tos -m $EMAIL --redirect"
fi

echo
echo "Server is ready. Next: edit /etc/mastishq/api.env, then run deploy.sh from your computer."
