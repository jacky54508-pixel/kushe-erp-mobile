"""Exact, test-only startup correction; original failing test source is retained."""
from pathlib import Path
import hashlib
p = Path(__file__).with_name('auth-service.py')
s = p.read_text()
assert hashlib.sha256(s.encode()).hexdigest() == '2ec7ad86e01cb24b5fec78cbef10747c88384fbe314c50e9f97d3200356522dc'
changes = {
    "AUTH_IMAGE = 'supabase/gotrue:v2.197.0'": "AUTH_IMAGE = 'supabase/gotrue:v2.197.0@sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b'",
    "PG_IMAGE = 'postgres:17.6-alpine'": "PG_IMAGE = 'postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94'",
    "PG,'pg_isready','-U','lab','-d','lab'": "PG,'pg_isready','-h','127.0.0.1','-U','lab','-d','lab'",
    "if okay and p.returncode: raise RuntimeError('Subprocess failed: ' + ' '.join(args[:3]))": "if okay and p.returncode:\n        safe = p.stderr[-1000:]\n        for secret in (SECRET, PASSWORD, DB_PASSWORD): safe = safe.replace(secret, '[REDACTED]')\n        raise RuntimeError('Subprocess failed: ' + ' '.join(args[:3]) + '; ' + safe)",
    "sh(['docker','network','rm',NET],okay=False)": "sh(['docker','network','rm',NET],okay=False)\n    check('Ephemeral test containers and internal network were removed', not sh(['docker','inspect',AUTH,PG],okay=False).strip('[]\\n ') and not sh(['docker','network','inspect',NET],okay=False).strip('[]\\n '))"
}
for before, after in changes.items():
    assert s.count(before) == 1, before
    s = s.replace(before, after)
compile(s, str(p), 'exec')
# Emit source digest, never generated passwords or session credentials.
e = p.parents[1] / 'evidence'; e.mkdir(exist_ok=True)
(e / 'executed-source.sha256').write_text(hashlib.sha256(s.encode()).hexdigest() + '\n')
exec(compile(s, str(p), 'exec'), {'__file__': str(p), '__name__': '__main__'})
