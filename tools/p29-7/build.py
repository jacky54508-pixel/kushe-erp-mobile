"""Apply only the exact locally tested P29-7 files to a detached base checkout."""
import base64, hashlib, json, subprocess, sys, zlib
from pathlib import Path
root=Path(sys.argv[1]).resolve(); evidence=Path(sys.argv[2]).resolve(); tests=Path(sys.argv[3]).resolve()
evidence.mkdir(parents=True,exist_ok=True); tests.mkdir(parents=True,exist_ok=True)
here=Path(__file__).resolve().parent
encoded=''.join(p.read_text().strip() for p in sorted(here.glob('payload.*')))
# Correct a single transport transcription character; require the original complete payload hash.
encoded=encoded.replace('LkJu+2yrw','LkJu+yrw')
assert hashlib.sha256(encoded.encode()).hexdigest()=='7c84e861abd602abfc2397da713d54cef5b55ac5ac90e5af962ecef4f7d7bf1b','Transport payload mismatch'
payload=json.loads(zlib.decompress(base64.b64decode(encoded,validate=True)))
allowed={'assets/css/daily-draft-review.css','assets/js/daily-draft-review.js','assets/js/commissions.js','assets/js/erp-store.js','index.html'}
assert set(payload['manifest'])==allowed
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()=='4ea7ac6df139dd2b2856833a468d44fb6242e5e2'
for name,hashes in payload['manifest'].items():
 p=root/name; actual=hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
 assert actual==hashes['before'],('Base mismatch',name,actual)
patch=evidence/'p29-7.patch'; patch.write_text(payload['patch'])
subprocess.run(['git','apply','--check',str(patch)],cwd=root,check=True)
subprocess.run(['git','apply',str(patch)],cwd=root,check=True)
subprocess.run(['git','diff','--check'],cwd=root,check=True)
for name,hashes in payload['manifest'].items():
 assert hashlib.sha256((root/name).read_bytes()).hexdigest()==hashes['after'],('Candidate mismatch',name)
for name,content in payload['tests'].items():
 assert name in {'native-ci.py','fixture.json'}
 (tests/name).write_text(content)
(evidence/'source-manifest.json').write_text(json.dumps(payload['manifest'],indent=2))
count=0
for p in sorted((root/'assets/js').glob('*.js')):
 subprocess.run(['node','--check',str(p)],check=True);count+=1
(evidence/'syntax-check.json').write_text(json.dumps({'javascriptFiles':count,'status':'PASS'}))
print('Exact five-file candidate verified;',count,'JavaScript syntax checks PASS',flush=True)
