from pathlib import Path
import os,json,hashlib,base64,zlib
here=Path(__file__).resolve().parent
root=Path(os.environ['QA_ROOT_DIR']).resolve()
(root/'evidence').mkdir(parents=True,exist_ok=True)
repairs=json.loads((here/'repairs.json').read_text()) if (here/'repairs.json').exists() else {}
parts=[]
for p in sorted(here.glob('part-*.b64')):
 s=''.join(p.read_text().split())
 for start,end,replacement in reversed(repairs.get(p.name,[])):
  s=s[:start]+replacement+s[end:]
 parts.append(s)
raw=zlib.decompress(base64.b64decode(''.join(parts),validate=True))
assert hashlib.sha256(raw).hexdigest()=='4ba611cef8d70c2ffc883e2ec8710b1041e89a56b9667eed30083752254fe5ea','Payload digest mismatch; no candidate permitted'
payload=json.loads(raw)
allowed={'assets/js/erp-store.js','assets/js/billing.js','assets/js/historical-billing.js','assets/css/historical-billing.css','assets/js/billing-print.js','billing-print.html','assets/js/billing-bundle-print.js','billing-bundle-print.html','index.html'}
assert set(payload['changes'])==allowed
manifest={}
for name,c in payload['changes'].items():
 p=root/'src'/name
 before=p.read_bytes() if p.exists() else None
 assert (hashlib.sha256(before).hexdigest() if before is not None else None)==c['before'],name+' wrong base'
 lines=(before.decode() if before is not None else '').splitlines(keepends=True)
 for start,end,replacement in reversed(c['ops']):
  lines[start:end]=replacement.splitlines(keepends=True)
 result=''.join(lines).encode()
 assert hashlib.sha256(result).hexdigest()==c['after'],name+' wrong target'
 p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(result)
 manifest[name]={'before':c['before'],'after':c['after']}
(root/'tests').mkdir(parents=True,exist_ok=True)
assert set(payload['tests'])=={'native-tests.py','fixture.json'}
for name,content in payload['tests'].items():(root/'tests'/name).write_text(content)
(root/'evidence/source-manifest.json').write_text(json.dumps(manifest,indent=2))
(root/'evidence/changed-files.txt').write_text('\n'.join(sorted(allowed))+'\n')
print('Verified exact payload and all nine source hashes')
