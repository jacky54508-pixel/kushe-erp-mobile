from pathlib import Path
import base64, hashlib, json, lzma, os, subprocess, sys
control=Path(__file__).resolve().parent
encoded=(control/'payload.txt').read_bytes()
assert hashlib.sha256(encoded).hexdigest()=='d5808447e8eb7acd09c06beef7014491547b3cf58c3d2f3ae7fa21c1a9cce994'
data=json.loads(lzma.decompress(base64.b64decode(encoded,validate=True)))
manifest=data['manifest'];root=Path(sys.argv[1]).resolve()
assert manifest['base']=='3e32f1084c5bf9359398929715d17b7d272bd24a'
assert manifest['main']=='6b9e17a1ef41ea9b7896cd0e3848536d2c255fb4'
expected={'assets/js/erp-store.js','index.html'}
assert {row['path'] for row in manifest['files']}==expected
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()==manifest['base']
assert not subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True).strip()
for row in manifest['files']:
    assert hashlib.sha256((root/row['path']).read_bytes()).hexdigest()==row['baseline_sha256']
    assert subprocess.check_output(['git','hash-object',row['path']],cwd=root,text=True).strip()==row['baseline_blob']
patch=data['patch'].encode()
assert hashlib.sha256(patch).hexdigest()=='2bd1480ef60f6e601c49e372ec7492742c260ee7a431938160f3ee9f04a0a0c0'
patchfile=Path(os.environ['RUNNER_TEMP'])/'integrity.patch';patchfile.write_bytes(patch)
subprocess.run(['git','apply','--check',str(patchfile)],cwd=root,check=True)
subprocess.run(['git','apply',str(patchfile)],cwd=root,check=True)
for row in manifest['files']:
    assert hashlib.sha256((root/row['path']).read_bytes()).hexdigest()==row['candidate_sha256']
    assert subprocess.check_output(['git','hash-object',row['path']],cwd=root,text=True).strip()==row['candidate_blob']
assert set(subprocess.check_output(['git','diff','--name-only'],cwd=root,text=True).splitlines())==expected
assert not subprocess.check_output(['git','ls-files','--others','--exclude-standard'],cwd=root,text=True).strip()
subprocess.run(['git','diff','--check'],cwd=root,check=True)
for path in (root/'assets/js').glob('*.js'):
    subprocess.run(['node','--check',str(path)],check=True)
assert set(data['tests'])=={'native_storage_ci.py','native_fixture.js'}
qa=Path(os.environ['RUNNER_TEMP'])/'integrity-qa';qa.mkdir(exist_ok=True)
for name,content in data['tests'].items():(qa/name).write_text(content)
print('Two-file patch, baseline/candidate hashes and all JavaScript syntax verified. Synthetic QA only.')
