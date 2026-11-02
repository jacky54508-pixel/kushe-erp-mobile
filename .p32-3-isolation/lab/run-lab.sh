#!/usr/bin/env bash
# Disposable CI test only; no production configuration, credentials or ERP scripts.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p evidence
printf '%s\n' '{"status":"NOT_RUN","reason":"Preflight or service startup not complete","real_business_data_used":false}' > evidence/backend-result.json
command -v docker >/dev/null
command -v python >/dev/null
python -c 'import playwright' >/dev/null
id="p323-$(python -c 'import secrets; print(secrets.token_hex(5))')"
network="$id-network"; db="$id-db"; auth="$id-auth"
tmp="$(mktemp -d)"
cleanup() {
  rc=$?
  # Only sanitized errors from the disposable service; never dump tokens or config.
  python - "$auth" "$rc" <<'PYDIAG' || true
import json, os, re, subprocess, sys
from pathlib import Path
raw=subprocess.run(['docker','logs',sys.argv[1]],capture_output=True,text=True)
rows=[]
for line in (raw.stdout+'\n'+raw.stderr).splitlines():
    try: item=json.loads(line)
    except Exception: continue
    if item.get('level') not in ('error','fatal','panic','warning','warn'): continue
    selected={k:item[k] for k in ('level','error','msg','component','status','path') if k in item}
    text=json.dumps(selected)
    for key in ('LAB_JWT_SECRET','LAB_DB_PASSWORD'):
        if os.environ.get(key): text=text.replace(os.environ[key], '[REDACTED]')
    text=re.sub(r'postgres(?:ql)?://[^\s\"\']+', '[REDACTED_DB_URL]', text)
    text=re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[REDACTED_JWT]', text)
    text=re.sub(r'[A-Za-z0-9_.+%-]+@[A-Za-z0-9.-]+', '[SYNTHETIC_EMAIL]', text)
    rows.append(text)
Path('evidence/service-errors.txt').write_text('\n'.join(rows[-25:]))
Path('evidence/cleanup.json').write_text(json.dumps({'probe_exit':int(sys.argv[2]),'only_disposable_services':True}))
PYDIAG
  docker rm -f "$auth" "$db" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf -- "$tmp"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
umask 077
export LAB_JWT_SECRET="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
export KUSHE_EMPTY_AUTH_LAB='p32-3-disposable-only'
dbpass="$(python -c 'import secrets; print(secrets.token_hex(24))')"
# Version-pinned laboratory images; record resolved digests for reproducibility.
# No host account settings, cloud keys, production URLs or ERP files are used.
docker pull postgres:17.6-alpine >/dev/null
docker pull supabase/gotrue:v2.197.0 >/dev/null
mkdir -p evidence
docker image inspect postgres:17.6-alpine supabase/gotrue:v2.197.0 --format '{{json .RepoDigests}}' > evidence/image-digests.txt
docker network create --internal "$network" >/dev/null
printf 'POSTGRES_PASSWORD=%s\nPOSTGRES_DB=authlab\n' "$dbpass" > "$tmp/db.env"
docker run -d --name "$db" --network "$network" --network-alias db \
  --tmpfs /var/lib/postgresql/data:rw --env-file "$tmp/db.env" postgres:17.6-alpine >/dev/null
ready=0
for i in {1..45}; do
  if docker exec "$db" pg_isready -U postgres -d authlab >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
test "$ready" = 1
docker exec "$db" psql -U postgres -d authlab -v ON_ERROR_STOP=1 -c \
  'CREATE SCHEMA IF NOT EXISTS auth; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN; CREATE EXTENSION IF NOT EXISTS pgcrypto; ALTER ROLE postgres IN DATABASE authlab SET search_path TO auth, public;' >/dev/null
cat > "$tmp/auth.env" <<EOF
GOTRUE_API_HOST=0.0.0.0
PORT=18430
API_EXTERNAL_URL=http://127.0.0.1:18430
GOTRUE_SITE_URL=https://kushe-auth-isolated.test
GOTRUE_DB_DRIVER=postgres
DATABASE_URL=postgres://postgres:${dbpass}@db:5432/authlab?sslmode=disable
DB_NAMESPACE=auth
GOTRUE_JWT_SECRET=${LAB_JWT_SECRET}
GOTRUE_JWT_EXP=600
GOTRUE_JWT_AUD=authenticated
GOTRUE_JWT_ISSUER=http://127.0.0.1:18430
GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
GOTRUE_JWT_ADMIN_ROLES=service_role
GOTRUE_MAILER_AUTOCONFIRM=true
GOTRUE_EXTERNAL_EMAIL_ENABLED=true
GOTRUE_DISABLE_SIGNUP=false
GOTRUE_MFA_TOTP_ENROLL_ENABLED=true
GOTRUE_MFA_TOTP_VERIFY_ENABLED=true
GOTRUE_MFA_WEB_AUTHN_ENROLL_ENABLED=true
GOTRUE_MFA_WEB_AUTHN_VERIFY_ENABLED=true
GOTRUE_MFA_RATE_LIMIT_CHALLENGE_AND_VERIFY=100
GOTRUE_MFA_CHALLENGE_EXPIRY_DURATION=15
GOTRUE_WEBAUTHN_RP_ID=kushe-auth-isolated.test
GOTRUE_WEBAUTHN_RP_DISPLAY_NAME=Disposable Auth Laboratory
GOTRUE_WEBAUTHN_RP_ORIGINS=https://kushe-auth-isolated.test
GOTRUE_PASSKEY_ENABLED=false
EOF
docker run -d --name "$auth" --network "$network" --env-file "$tmp/auth.env" \
  supabase/gotrue:v2.197.0 >/dev/null
auth_pid="$(docker inspect --format '{{.State.Pid}}' "$auth")"
test "$auth_pid" -gt 0
export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
probe=(sudo --preserve-env=LAB_JWT_SECRET,KUSHE_EMPTY_AUTH_LAB,LAB_AUTH_CONTAINER,LAB_DB_PASSWORD,PLAYWRIGHT_BROWSERS_PATH nsenter --target "$auth_pid" --net env "LD_LIBRARY_PATH=${LD_LIBRARY_PATH:-}" "$(command -v python)")
export LAB_AUTH_CONTAINER="$auth"
export LAB_DB_PASSWORD="$dbpass"
"${probe[@]}" - <<'PY'
import time, urllib.request, subprocess, os, re
from pathlib import Path
for i in range(60):
    try:
        with urllib.request.urlopen('http://127.0.0.1:18430/health',timeout=1) as r:
            if r.status == 200: break
    except Exception: time.sleep(1)
else:
    raw=subprocess.run(['docker','logs',os.environ['LAB_AUTH_CONTAINER']],capture_output=True,text=True).stderr
    for secret in [os.environ['LAB_JWT_SECRET'], os.environ['LAB_DB_PASSWORD']]: raw=raw.replace(secret,'[REDACTED]')
    raw=re.sub(r'postgres(?:ql)?://[^\s\"\']+', '[REDACTED_DB_URL]', raw)
    Path('evidence/startup-diagnostic.txt').write_text(raw[-12000:])
    raise SystemExit('Disposable Auth health check did not succeed; backend test NOT run.')
PY
"${probe[@]}" lab/backend_probe.py
