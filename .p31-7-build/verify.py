from pathlib import Path
import base64,zlib,hashlib,subprocess,json
src=Path('source').resolve()
harness=Path(__file__).resolve().parent
base='76cd91bccd13d4013f369facf4dc1701ab8f74a3'
expected='dff6e0dd5b7b388e65c7c13a084cb5217a07c78e'
allowed=['assets/css/billing-groups.css','assets/js/billing-groups.js','index.html']
def git(*args):
 return subprocess.check_output(['git','-C',str(src),*args],text=True).strip()
assert git('rev-parse','HEAD')==base
assert git('rev-parse','HEAD^{tree}')=='ad908bfd44aa59509fe46b21a76caddd6cacbe42'
compressed=base64.b64decode(''.join((harness/f'part{i}.b64').read_text().strip() for i in range(4)),validate=True)
assert hashlib.sha256(compressed).hexdigest()=='667738ea02c42f3380f495a5e9f3575db9c0c77ccf38fc1c2c8e25152a2fd93d'
patch=zlib.decompress(compressed)
assert hashlib.sha256(patch).hexdigest()=='e9e441cd4664d27d5e6c101f784b6979cef0e8cdd2d409786fb2cdb3783cd72f'
patchfile=Path('p31-7-verified.patch').resolve();patchfile.write_bytes(patch)
git('apply','--check',str(patchfile));git('apply',str(patchfile))
assert sorted(git('diff','--name-only').splitlines())==allowed
git('diff','--check')
for name in git('ls-files','*.js').splitlines():subprocess.run(['node','--check',str(src/name)],check=True)
git('add','--',*allowed)
actual=git('write-tree');assert actual==expected,(actual,expected)
Path('evidence').mkdir(exist_ok=True)
Path('evidence/verified-source.json').write_text(json.dumps({'base':base,'tree':actual,'files':allowed,'syntax':'PASS','scope':'exact locally tested source; no ERP business-data access'},indent=2))
print('EXACT TESTED SOURCE VERIFIED:',actual)
