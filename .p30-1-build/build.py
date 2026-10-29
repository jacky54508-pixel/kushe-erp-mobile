from pathlib import Path
import base64,gzip,hashlib,json,os,subprocess
root=Path(os.environ['QA_ROOT_DIR']);source=root/'src';here=Path(__file__).parent
encoded=''.join((here/f'part{i}.b64').read_text().strip() for i in range(6))
raw=gzip.decompress(base64.b64decode(encoded,validate=True))
assert hashlib.sha256(raw).hexdigest()=='d4f08e822869923a5187bb65691bf6af63fa830445b7175f6b37296e8e842133','Transfer payload differs from tested source'
data=json.loads(raw)
allowed={'assets/css/historical-billing.css','assets/js/erp-store.js','assets/js/historical-billing.js','assets/js/historical-quotation.js','index.html'}
assert set(data['manifest'])==allowed
assert data['expectedTree']=='c41bb6b816d3545f811a9a6dcd058608f0ad7dfb'
for name,hashes in data['manifest'].items():
 p=source/name
 assert (hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None)==hashes['before'],name+' base hash mismatch'
evidence=root/'evidence';evidence.mkdir(parents=True,exist_ok=True)
patch=evidence/'exact.patch';patch.write_text(data['patch'])
subprocess.run(['git','apply','--check',str(patch)],cwd=source,check=True)
subprocess.run(['git','apply',str(patch)],cwd=source,check=True)
for name,hashes in data['manifest'].items():
 assert hashlib.sha256((source/name).read_bytes()).hexdigest()==hashes['after'],name+' candidate hash mismatch'
tests=root/'tests';tests.mkdir(exist_ok=True)
(tests/'native-tests.py').write_text(data['nativeTest'])
(tests/'fixture.json').write_text(json.dumps(data['fixture'],ensure_ascii=False))
(evidence/'source-manifest.json').write_text(json.dumps(data['manifest'],indent=2))
(evidence/'expected-tree.txt').write_text(data['expectedTree'])
print('Verified exact payload and all five tested application hashes',flush=True)
