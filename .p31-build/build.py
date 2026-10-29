from pathlib import Path
import base64,zlib,json,hashlib,subprocess,os
here=Path(__file__).resolve().parent
root=Path(os.environ['QA_ROOT_DIR']);src=root/'src';(root/'evidence').mkdir(parents=True,exist_ok=True);(root/'tests').mkdir(exist_ok=True)
h=lambda data:hashlib.sha256(data).hexdigest()
parts=sorted(here.glob('part*.b64'),key=lambda p:int(p.stem[4:]))
assert len(parts)==8,'Unexpected transfer parts'
packed=base64.b64decode(''.join(p.read_text() for p in parts),validate=True)
assert h(packed)=='26f302f4709328001a131f043293b86a1c34c7a114cb8bd61b213421f3811319','Transfer mismatch'
raw=zlib.decompress(packed)
assert h(raw)=='89fa2ba84a320a65cc9e75866697a11f325becdcaa9d49e5248c80c691259e5d','Payload mismatch'
data=json.loads(raw)
allowed={'assets/css/billing-groups.css','assets/js/billing-groups.js','assets/js/billing.js','assets/js/erp-store.js','assets/js/external-billing-print.js','external-billing-print.html','index.html'}
assert set(data['files'])==allowed
for name,digest in data['all_base'].items():assert h((src/name).read_bytes())==digest,'Base mismatch: '+name
patch=root/'p31.patch';patch.write_text(data['patch'])
subprocess.run(['git','apply','--check',str(patch)],cwd=src,check=True)
subprocess.run(['git','apply',str(patch)],cwd=src,check=True)
for name,digest in data['all_result'].items():assert h((src/name).read_bytes())==digest,'Result mismatch: '+name
actual={p.relative_to(src).as_posix() for p in src.rglob('*') if p.is_file() and not p.relative_to(src).parts[0].startswith('.')}
assert actual==set(data['all_result']),'Unexpected public files'
(root/'tests/native-groups.py').write_text(data['native'])
(root/'tests/fixture.json').write_text(json.dumps(data['fixture'],ensure_ascii=False))
(root/'evidence/source-manifest.json').write_text(json.dumps(data['files'],indent=2))
(root/'evidence/all-source-hashes.json').write_text(json.dumps(data['all_result'],indent=2))
print('Exact application source verified: seven changes; 73 public files; no business data access')
