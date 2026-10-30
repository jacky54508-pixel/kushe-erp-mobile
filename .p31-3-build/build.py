from pathlib import Path
import base64,zlib,hashlib,subprocess,json
src=Path('candidate');out=Path('evidence');out.mkdir(exist_ok=True)
base='10c77bddbd2845290e4317e093c543238dc1b34c'
expected='50e7afa5e4bd7544c58a256e9d25e0cbd0f5b266'
def git(*args):return subprocess.check_output(['git','-C',str(src),*args],text=True).strip()
assert git('rev-parse','HEAD')==base
assert git('rev-parse','HEAD^{tree}')=='c8fa7fcf72cdb28073e4c679a6b6e6cf3eecb8a4'
assert not git('status','--porcelain')
data=base64.b64decode(Path(__file__).with_name('patch.b64').read_text(),validate=True)
assert hashlib.sha256(data).hexdigest()=='b8725863d11ebe154cef2d01de3ede908a811457a4fe83bc04ca75ec1fe43532'
patch=zlib.decompress(data)
assert hashlib.sha256(patch).hexdigest()=='f8e248f776bb1eb4f5e67662f3bc7d4909621966de511476a2f390981ea65453'
subprocess.run(['git','-C',str(src),'apply','--check','-'],input=patch,check=True)
subprocess.run(['git','-C',str(src),'apply','--index','-'],input=patch,check=True)
files=git('diff','--cached','--name-only').splitlines()
assert files==['assets/css/billing-groups.css','assets/js/billing-groups.js','index.html'],files
assert not git('diff','--name-only')
subprocess.run(['git','-C',str(src),'diff','--cached','--check'],check=True)
actual=git('write-tree');assert actual==expected,(actual,expected)
(out/'exact-source.json').write_text(json.dumps({'base':base,'tree':actual,'changed_files':files,'whole_tree_matches_locally_tested_source':True,'store_and_pdf_unchanged':True},indent=2))
print('Verified all source bytes and exactly three UI/loading file changes; Store/PDF unchanged.')
