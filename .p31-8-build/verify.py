from pathlib import Path
import sys,json,hashlib,gzip,base64,subprocess
root=Path(sys.argv[1]).resolve();bundle=Path(__file__).resolve().parent;out=Path('evidence');out.mkdir(exist_ok=True)
sha=lambda b:hashlib.sha256(b).hexdigest()
def manifest():
 return {str(p.relative_to(root)):sha(p.read_bytes()) for p in sorted(root.rglob('*')) if p.is_file() and p.relative_to(root).parts[0] not in ('.git','.github')}
def digest(m):return sha(json.dumps(m,sort_keys=True,separators=(',',':')).encode())
before=manifest();assert len(before)==73;assert digest(before)=='89e999627dd3e9763405e4b73e7c125521093dc21b0ae23e6407c3a579ceac20','base source mismatch'
encoded=''.join((bundle/('part'+str(i)+'.txt')).read_text() for i in range(3));packed=base64.b64decode(encoded,validate=True)
assert sha(packed)=='fc383d208c697ac65d6bea1aeb4c892d086ff0ced03fefc852d7d48d77d6aafc','transfer mismatch'
patch=gzip.decompress(packed);assert sha(patch)=='0642dc26eee23a8c0ecb059bc8a935a675e1dcf70cf1a82d4416c0d1cc6d6e5c','patch mismatch'
subprocess.run(['git','apply','--check','-'],input=patch,cwd=root,check=True);subprocess.run(['git','apply','-'],input=patch,cwd=root,check=True)
after=manifest();assert digest(after)=='91b70009d1d113a496159ae93a98533647c554294ae92c59ee5ec4ff02a2f7c1','tested source mismatch'
allowed=['assets/css/billing-groups.css','assets/js/billing-groups.js','index.html']
changed=subprocess.check_output(['git','diff','--name-only'],cwd=root,text=True).splitlines();assert sorted(changed)==allowed,changed
subprocess.run(['git','diff','--check'],cwd=root,check=True)
syntax=[]
for p in sorted(root.rglob('*.js')):
 if '.git' in p.parts:continue
 subprocess.run(['node','--check',str(p)],check=True);syntax.append(str(p.relative_to(root)))
assert len(syntax)==39
(out/'verified-source.json').write_text(json.dumps({'base':'29c37345dc3677eeaf8b29dc79e6fa3c8d8d3182','changed':changed,'sourceFiles':len(after),'beforeDigest':digest(before),'afterDigest':digest(after),'after':after,'syntax':syntax,'localChecksReportedSeparately':593,'noLiveDataAccess':True},indent=2))
print('Exact three-file patch and all 73 application files verified; all 39 JS syntax checks passed.')
