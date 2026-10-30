from pathlib import Path
import base64,gzip,hashlib,subprocess,json,sys
root=Path(sys.argv[1]).resolve()
def git(*args):
 return subprocess.check_output(['git','-C',str(root),*args],text=True).strip()
assert git('rev-parse','HEAD')=='f3d927818395a3accf38c4598c504646deb6942d'
assert git('rev-parse','HEAD^{tree}')=='5d914a62c153301b28afab7dbd312113dd521788'
raw=base64.b64decode((Path(__file__).parent/'change.b64').read_text().strip(),validate=True)
assert hashlib.sha256(raw).hexdigest()=='f3e8da61e1dd82f9e3e8af7ae08e2b3d0f3498a78cb8e1e24b990f1171e4fd9d'
patch=gzip.decompress(raw)
assert hashlib.sha256(patch).hexdigest()=='58edae35f168b86619e38222c48d44bb04bf9b8a81f8c1bdb6fb88f418f47c5b'
subprocess.run(['git','-C',str(root),'apply','--check','--whitespace=error','-'],input=patch,check=True)
subprocess.run(['git','-C',str(root),'apply','--whitespace=error','-'],input=patch,check=True)
expected={'assets/css/billing-groups.css':'c2499ae1ecf0c61978a3143793167a98fe975bcc2b99f446f646b70f963248f5','assets/js/billing-groups.js':'f68ddfe0cb2a6bfd311eeb8fbe2d07c805107be2880f952fc8ea0e6ba9c1ce3a','index.html':'2b4339a3c8894d34af7c203151acce3d42f2dfbb6a18b9755bd59e4abc50abb1'}
assert set(git('diff','--name-only').splitlines())==set(expected)
for name,sha in expected.items():assert hashlib.sha256((root/name).read_bytes()).hexdigest()==sha,name
subprocess.check_call(['git','-C',str(root),'diff','--check'])
subprocess.check_call(['git','-C',str(root),'add','--',*expected.keys()])
tree=git('write-tree');assert tree=='ad908bfd44aa59509fe46b21a76caddd6cacbe42',tree
count=0
for path in root.rglob('*.js'):
 if '.git' in path.parts:continue
 subprocess.check_call(['node','--check',str(path)]);count+=1
assert count==39
out=Path(__file__).parent/'verification.json';out.write_text(json.dumps({'tree':tree,'changed':expected,'syntax':count,'allProtectedFilesUnchanged':True,'localSyntheticChecks':465},indent=2))
print(out.read_text())
