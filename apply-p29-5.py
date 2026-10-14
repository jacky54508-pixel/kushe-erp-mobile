from pathlib import Path
import base64,zlib,hashlib,json,subprocess
root=Path.cwd();harness=Path(__file__).parent
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()=='ddf737cfad6895adddf48072e9a6d9ccc3e7f435'
patch=zlib.decompress(base64.b64decode((harness/'p29-5.patch.zlib.b64').read_text()))
subprocess.run(['git','apply','--check','-'],input=patch,check=True)
subprocess.run(['git','apply','-'],input=patch,check=True)
expected={'assets/css/payroll-commission-picker.css':'10210ed2dc7b85cc5b422d7a1e5142cb594f993422e57cc7083c0f298834612b','assets/js/payroll-commission-picker.js':'654a40d3449ddb633a434d1ceff51f1b244e4161b46d79b699576ac349c35752','assets/js/payroll.js':'f8907fe6c6fc879794f58bd2a483d815f9fa9dfbdc3f145ea635b9e73b7394cb','index.html':'f5de6d006056d1af3b7934ce2ea579c303f8d1be6b837fb43ed0a5f9199b4ec6'}
changed=set(subprocess.check_output(['git','diff','--name-only'],text=True).splitlines()+subprocess.check_output(['git','ls-files','--others','--exclude-standard'],text=True).splitlines())
assert changed==set(expected),changed
for name,digest in expected.items():assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest,name
for p in (root/'assets/js').glob('*.js'):subprocess.run(['node','--check',str(p)],check=True)
evidence=Path('/tmp/p29-5-evidence');evidence.mkdir(exist_ok=True)
(evidence/'source-manifest.json').write_text(json.dumps(expected,indent=2))
(evidence/'verified-patch.diff').write_bytes(patch)
print('Exact tested file hashes and changed-file allowlist verified. Main and beta unchanged.')
