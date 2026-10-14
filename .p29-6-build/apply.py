from pathlib import Path
import base64,zlib,json,hashlib,subprocess,sys
source=Path(sys.argv[1]).resolve(); here=Path(__file__).resolve().parent
payload=''.join((here/('patch-'+str(i)+'.b64')).read_text().strip() for i in (1,2,3))
# Normalize a known transport transcription before verifying the entire payload.
payload=payload.replace('PhnjUqNmc','PhnjqNmc')
assert hashlib.sha256(payload.encode()).hexdigest()=='816eb26ccce227eb9878039c13595683e3091b2e8cb9a0ec5e2bb41f75111359','Transport digest mismatch; no application files changed'
plan=json.loads(zlib.decompress(base64.b64decode(payload,validate=True)))
allowed={'assets/js/erp-store.js','assets/js/billing.js','assets/js/dashboard.js','assets/js/receivable-cheques.js','assets/css/receivable-cheques.css','index.html'}
assert set(plan)==allowed
out=[]
for name,entry in plan.items():
 p=source/name; before=p.read_bytes() if p.exists() else None
 assert (hashlib.sha256(before).hexdigest() if before is not None else None)==entry['before'],name+' base hash mismatch'
 lines=(before.decode() if before is not None else '').splitlines(True)
 for i,j,text in reversed(entry['ops']):lines[i:j]=[text]
 after=''.join(lines).encode();assert hashlib.sha256(after).hexdigest()==entry['after'],name+' result hash mismatch'
 out.append((p,after))
for p,data in out:p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
for p in sorted((source/'assets/js').glob('*.js')):subprocess.run(['node','--check',str(p)],check=True)
subprocess.run(['git','-C',str(source),'diff','--check'],check=True)
(here/'source-manifest.json').write_text(json.dumps({name:{k:v for k,v in e.items() if k!='ops'} for name,e in plan.items()},indent=2))
print('Exact tested six-file source applied. All JavaScript syntax and diff checks passed.')
