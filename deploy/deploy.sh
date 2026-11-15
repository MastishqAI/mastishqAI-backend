#!/usr/bin/env bash
# Deploy Mastishq from your computer to the server (tests -> build -> upload -> restart -> health check).
#
#   SERVER=ubuntu@<elastic-ip> SSH_KEY=~/.ssh/mastishq.pem ./deploy/deploy.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

: "${SERVER:?Set SERVER, e.g. SERVER=ubuntu@13.x.x.x}"
: "${SSH_KEY:?Set SSH_KEY to the path of your .pem key}"
API_DOMAIN="${API_DOMAIN:-api-new.mastishq.ai}"

# Safety: never deploy onto the OLD live servers.
case "$SERVER" in
  *13.201.1.26*|*13.235.242.252*) echo "STOP: that is the OLD live SmartLearn server. Use the new server's address."; exit 1;;
esac

SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=accept-new)
RSYNC_SSH="ssh ${SSH_OPTS[*]}"

echo "== 1/5  Running tests"
(cd backend && npm test)

echo "== 2/5  Building the website"
(cd frontend && npm ci && npm run build)

echo "== 3/5  Uploading"
rsync -az --delete -e "$RSYNC_SSH" \
  --exclude node_modules --exclude .env --exclude '.env.*' --exclude uploads --exclude test --exclude '*.log' \
  backend/ "$SERVER:/opt/mastishq/backend/"
rsync -az --delete -e "$RSYNC_SSH" frontend/dist/ "$SERVER:/opt/mastishq/frontend/"

echo "== 4/5  Installing and restarting the API"
ssh "${SSH_OPTS[@]}" "$SERVER" 'cd /opt/mastishq/backend && npm ci --omit=dev && sudo systemctl restart mastishq-api'

echo "== 5/5  Health check"
for i in 1 2 3 4 5 6; do
  if curl -fsS "https://$API_DOMAIN/health"; then echo; echo "Deployed OK."; exit 0; fi
  echo "  not up yet, retrying..."; sleep 4
done
echo "The API did not answer. Check the logs:  ssh -i $SSH_KEY $SERVER 'sudo journalctl -u mastishq-api -n 80 --no-pager'"
exit 1
