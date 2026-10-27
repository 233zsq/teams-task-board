#!/usr/bin/env bash
set -euo pipefail
umask 077
stage=$(realpath "${1:?staging directory required}")
domain=${2:?domain required}
port=${3:-4100}
test "$(id -u)" = 0 || { echo 'Run using sudo.' >&2; exit 1; }
case "$stage" in /home/ubuntu/team-task-board-stage-*) ;; *) echo 'Unexpected stage path' >&2; exit 1;; esac
[[ "$domain" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || exit 1
[[ "$port" =~ ^[0-9]+$ ]] && ((port > 1024 && port < 65536)) || exit 1
app="$stage/app"
test -f "$app/backend/dist/server.js"
test -f "$app/frontend/dist/index.html"
test -f "$app/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
revision=$(cat "$app/DEPLOY-REVISION")
[[ "$revision" =~ ^[a-f0-9]{40}$ ]] || exit 1
tls="$stage/tls"
test -f "$tls/fullchain.pem" && test -f "$tls/privkey.pem"
openssl x509 -in "$tls/fullchain.pem" -noout -checkhost "$domain"
openssl x509 -in "$tls/fullchain.pem" -noout -checkend 604800
cert_key=$(openssl x509 -in "$tls/fullchain.pem" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum | cut -d' ' -f1)
private_key=$(openssl pkey -in "$tls/privkey.pem" -pubout -outform DER | sha256sum | cut -d' ' -f1)
test "$cert_key" = "$private_key" || { echo 'Certificate/key mismatch' >&2; exit 1; }

root=/opt/team-task-board
release="$root/releases/$revision"
config=/etc/nginx/conf.d/team-task-board.conf
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="/var/backups/team-task-board/deployment-$stamp"
mkdir -p "$backup"
install -d -m 755 "$root" "$root/releases"
chmod 700 "$backup"
previous=$(readlink -f "$root/current" || true)
test ! -e "$config" || cp -a "$config" "$backup/nginx.conf"
test ! -d /etc/team-task-board || cp -a /etc/team-task-board "$backup/runtime-config"
test ! -f /etc/systemd/system/team-task-board.service || cp -a /etc/systemd/system/team-task-board.service "$backup/service"
systemctl is-active --quiet team-task-board && was_active=1 || was_active=0
printf '%s\n' "$previous" > "$backup/previous-release.txt"
success=0
rollback() {
    result=$?
    if ((success == 0)); then
        set +e
        if test -n "$previous" && test -d "$previous"; then ln -sfn "$previous" "$root/current"; fi
        if test -f "$backup/nginx.conf"; then cp -a "$backup/nginx.conf" "$config"; else rm -f "$config"; fi
        if test -d "$backup/runtime-config"; then cp -a "$backup/runtime-config/." /etc/team-task-board/; fi
        if test -f "$backup/service"; then cp -a "$backup/service" /etc/systemd/system/team-task-board.service; fi
        systemctl daemon-reload
        if ((was_active)); then systemctl restart team-task-board; else systemctl disable --now team-task-board; fi
        nginx -t && systemctl reload nginx
        printf 'DEPLOY_FAILED; rollback attempted; backup=%s\n' "$backup" >&2
    fi
    exit "$result"
}
trap rollback EXIT
if ! id teamboard >/dev/null 2>&1; then useradd --system --home-dir /var/lib/team-task-board --shell /usr/sbin/nologin teamboard; fi
install -d -m 700 -o teamboard -g teamboard /var/lib/team-task-board
install -d -m 750 -o root -g www-data /etc/team-task-board /etc/team-task-board/tls
install -m 644 "$tls/fullchain.pem" /etc/team-task-board/tls/fullchain.pem
install -m 600 "$tls/privkey.pem" /etc/team-task-board/tls/privkey.pem
if test -e "$release"; then echo 'Release already exists; use a new source commit.' >&2; exit 1; fi
mkdir "$release"
cp -a "$app/." "$release/"
chown -R root:root "$release"
chmod -R a+rX,go-w "$release"
cat > /etc/team-task-board/runtime.env <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=$port
ALLOWED_HOSTS=$domain,127.0.0.1,localhost
DATABASE_PATH=/var/lib/team-task-board/team-plan.sqlite
ENABLE_PRIORITY=0
ENABLE_FILTERS=0
ENABLE_ORDERING=0
ENABLE_SHARING=0
EOF
chown root:teamboard /etc/team-task-board/runtime.env
chmod 640 /etc/team-task-board/runtime.env
if ! test -f /etc/team-task-board/users.htpasswd; then
    python3 - <<'PY'
from pathlib import Path
import os, secrets, subprocess
password = secrets.token_urlsafe(24)
hashed = subprocess.run(['openssl', 'passwd', '-6', '-stdin'], input=password+'\n', text=True, capture_output=True, check=True).stdout.strip()
Path('/etc/team-task-board/users.htpasswd').write_text('team:'+hashed+'\n')
Path('/etc/team-task-board/access.txt').write_text('Username: team\nPassword: '+password+'\n')
os.chmod('/etc/team-task-board/access.txt', 0o600)
PY
fi
chown root:www-data /etc/team-task-board/users.htpasswd
chmod 640 /etc/team-task-board/users.htpasswd
ln -sfn "$release" "$root/current"
runuser -u teamboard -- env DATABASE_PATH=/var/lib/team-task-board/team-plan.sqlite /usr/local/bin/node "$root/current/backend/dist/db/init.js"
install -m 644 "$release/deploy/team-task-board.service" /etc/systemd/system/team-task-board.service
install -m 644 "$release/deploy/team-task-board-backup.service" /etc/systemd/system/team-task-board-backup.service
install -m 644 "$release/deploy/team-task-board-backup.timer" /etc/systemd/system/team-task-board-backup.timer
systemd-analyze verify /etc/systemd/system/team-task-board.service /etc/systemd/system/team-task-board-backup.service /etc/systemd/system/team-task-board-backup.timer
systemctl daemon-reload
systemctl enable --now team-task-board
systemctl restart team-task-board
healthy=0
for attempt in $(seq 1 40); do
    if curl --fail --silent --max-time 2 -H "Host: $domain" "http://127.0.0.1:$port/api/v1/health" >/dev/null; then healthy=1; break; fi
    sleep 0.25
done
test "$healthy" = 1 || { journalctl -u team-task-board --no-pager -n 15; exit 1; }
sed -e "s/__DOMAIN__/$domain/g" -e "s/__PORT__/$port/g" "$release/deploy/nginx.conf.template" > "$config"
nginx -t
systemctl reload nginx
status=$(curl --silent --show-error --resolve "$domain:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$domain/")
test "$status" = 401 || { echo 'Public authentication gate check failed' >&2; exit 1; }
systemctl enable --now team-task-board-backup.timer
systemctl start team-task-board-backup.service
success=1
printf 'DEPLOYED=https://%s/\nREVISION=%s\nSERVICE=team-task-board\nPORT=127.0.0.1:%s\nBACKUP=%s\nCREDENTIALS=/etc/team-task-board/access.txt\n' "$domain" "$revision" "$port" "$backup"
