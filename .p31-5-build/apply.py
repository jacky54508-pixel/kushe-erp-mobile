from pathlib import Path
import base64,gzip,hashlib,subprocess,sys,json
root=Path(sys.argv[1]).resolve();here=Path(__file__).resolve().parent
expected=['assets/css/billing-groups.css','assets/js/billing-groups.js','index.html']
def git(*args):return subprocess.check_output(['git',*args],cwd=root,text=True).strip()
assert git('rev-parse','HEAD')=='f11e9c2a1df78d4eafa43e2acd4995f48ae71fde'
assert git('rev-parse','HEAD^{tree}')=='50e7afa5e4bd7544c58a256e9d25e0cbd0f5b266'
assert git('status','--porcelain')==''
encoded=''.join((here/f'part{i}.b64').read_text() for i in range(4))
raw=gzip.decompress(base64.b64decode(encoded,validate=True))
assert hashlib.sha256(raw).hexdigest()=='dc63ecd2ea2e0e3a755ef16befa8b45cc5531c7731c7de63724539ba2a72148e'
patch=here/'verified.patch';patch.write_bytes(raw)
subprocess.run(['git','apply','--check',str(patch)],cwd=root,check=True)
subprocess.run(['git','apply',str(patch)],cwd=root,check=True)
assert sorted(git('diff','--name-only').splitlines())==expected
subprocess.run(['git','diff','--check'],cwd=root,check=True)
js=sorted(root.rglob('*.js'))
for p in js:subprocess.run(['node','--check',str(p)],check=True)
assert len(js)==39
subprocess.run(['git','add','--',*expected],cwd=root,check=True)
assert git('write-tree')=='5d914a62c153301b28afab7dbd312113dd521788'
result={'base':'f11e9c2a1df78d4eafa43e2acd4995f48ae71fde','tree':git('write-tree'),'changed':expected,'syntax_count':len(js),'local_synthetic_checks':459,'note':'CI verifies exact source and syntax; local browser/store checks are not double counted. No live ERP data access.'}
(here/'verification.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
