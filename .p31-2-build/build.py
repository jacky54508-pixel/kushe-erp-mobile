from pathlib import Path
import base64, hashlib, json, subprocess, zlib
BASE='79cdf59225d13527b10835394d8720279fd34c0e'
TREE='e205a34da714d66735391b7705ed8e0f8c95f678'
ALLOWED={'assets/js/billing.js','assets/js/billing-groups.js','assets/css/billing-groups.css','index.html'}
root=Path('qa/src').resolve()
evidence=Path('qa/evidence');evidence.mkdir(parents=True,exist_ok=True)
def sha(data):return hashlib.sha256(data).hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=root,text=True).strip()
assert git('rev-parse','HEAD')==BASE
assert git('status','--porcelain')==''
tracked=git('ls-files').splitlines()
before={name:sha((root/name).read_bytes()) for name in tracked}
compressed=base64.b64decode((Path(__file__).parent/'payload.b64').read_text(),validate=True)
assert sha(compressed)=='c8219aabf6160fc57c682d104cff14d4cf2da25fd7c30f9d526c6fc6e32d4ffa'
raw=zlib.decompress(compressed)
assert sha(raw)=='3ea67d882f0c3aa5362a0fece7fc1dc449cff93929437f511fa576f3228180bb'
operations=json.loads(raw)
assert len(operations)==4 and {o['path'] for o in operations}==ALLOWED
for op in operations:
    p=root/op['path'];data=p.read_bytes();assert sha(data)==op['base']
    old=data.decode('utf-8');out=[];last=0
    for start,end,text in op['splices']:
        assert isinstance(start,int) and isinstance(end,int) and last<=start<=end<=len(old)
        assert isinstance(text,str)
        out.extend([old[last:start],text]);last=end
    out.append(old[last:]);new=''.join(out).encode('utf-8')
    assert sha(new)==op['result'],op['path']
    p.write_bytes(new)
after={name:sha((root/name).read_bytes()) for name in tracked}
changed={name for name in tracked if before[name]!=after[name]}
assert changed==ALLOWED
assert set(git('diff','--name-only').splitlines())==ALLOWED
subprocess.run(['git','diff','--check'],cwd=root,check=True)
subprocess.run(['git','add','--',*sorted(ALLOWED)],cwd=root,check=True)
assert git('write-tree')==TREE
manifest={'base':BASE,'candidate_tree':TREE,'changed':sorted(changed),'protected_tracked_files':len(tracked)-4,'before':before,'after':after,'source_hashes_verified':True,'scope':'UI-only; no real ERP account or business database access'}
(evidence/'source-verification.json').write_text(json.dumps(manifest,indent=2))
print('PASS: exact four-file patch, protected files, and full Git tree verified')
