from pathlib import Path
import os,base64,gzip,hashlib,json,subprocess
HERE=Path(__file__).resolve().parent
ROOT=Path(os.environ['QA_ROOT_DIR']);SRC=ROOT/'src'
EXPECTED=['assets/css/billing-groups.css','assets/js/billing-groups.js','assets/js/erp-store.js','assets/js/external-billing-print.js','external-billing-print.html','index.html']
BLOBS={'part0.b64':'86beba5b029613ecb20aa45e4b1ca3210de7dff2','part1-prefix.b64':'58fe96e0e9d2d1cfd42d2c45b3ed0c7bf94a949c','part1-tail.b64':'ebbad739d8c2e89fc3cfc1ee44ffc408b8e3a1f7','part2a.b64':'8438bc719d8dae1db8d1d2c268698f577efc3ced','part2b.b64':'9337b0622469ac0dd860a4427b902bd72523f309'}
def sha(b):return hashlib.sha256(b).hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=SRC,text=True).strip()
def replace_once(s,a,b):
 assert s.count(a)==1,('transport marker',a)
 return s.replace(a,b)
parts={}
for name,want in BLOBS.items():
 b=(HERE/name).read_bytes();assert hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()==want,name
 parts[name]=b.decode('ascii')
# Correct identified transport-only transcription errors BEFORE decoding. Both
# complete compressed and decoded payload hashes below are independent gates.
a=replace_once(parts['part0.b64'],'NLtXr2x197V','NLtXr2x897V')
b=parts['part1-prefix.b64'];assert b.endswith('TvSu?INVALID')
b=b[:-len('TvSu?INVALID')];assert b.endswith('nVxhUK70i4UJ')
b=replace_once(b,'NZWIT3TLbD','NZWIT3LbD')+parts['part1-tail.b64']
c=parts['part2a.b64']+replace_once(parts['part2b.b64'],'9vleq1ftPOETF','9vleq1ltPOETF')
encoded=a+b+c;assert len(encoded)==18008
packed=base64.b64decode(encoded,validate=True)
assert sha(packed)=='a4195ba70a8f491e4bb8040b4cb78edcca7b5bba8f48556712374faab3d2052c'
raw=gzip.decompress(packed);assert sha(raw)=='1c7268bebe7711f58cc2a4e06942dfa5d38d152518c6051da9ff452295027afd'
p=json.loads(raw);assert sorted(p['files'])==EXPECTED
assert git('rev-parse','HEAD')=='074d815e19fc00c3d1372d2b6f95b401f257fafd'
assert git('rev-parse','HEAD^{tree}')==p['expectedBaseTree']=='f66a8242e258523e104ae24ad119b459d760b8e7'
assert git('status','--porcelain')==''
for name,f in p['files'].items():
 path=SRC/name;before=path.read_bytes();assert sha(before)==f['before'],name
 lines=before.decode().splitlines(keepends=True)
 last=-1
 for i,j,t in f['edits']:
  assert isinstance(i,int) and isinstance(j,int) and last<=i<=j<=len(lines) and isinstance(t,str)
  last=j
 for i,j,t in reversed(f['edits']):lines[i:j]=[t]
 after=''.join(lines).encode();assert sha(after)==f['after'],name
 path.write_bytes(after)
assert sorted(git('diff','--name-only').splitlines())==EXPECTED
subprocess.run(['git','add','--',*EXPECTED],cwd=SRC,check=True)
assert git('write-tree')==p['expectedTree']=='c3783c3d16595a20ff498bcf0ee75127211a5610'
(ROOT/'tests').mkdir(parents=True,exist_ok=True);(ROOT/'evidence').mkdir(parents=True,exist_ok=True)
(ROOT/'tests/fixture.json').write_text(p['fixture'])
(ROOT/'tests/native-unified.py').write_text(p['native'])
manifest={str(f.relative_to(SRC)):sha(f.read_bytes()) for f in SRC.rglob('*') if f.is_file() and not any(x in ['.git','.github'] for x in f.relative_to(SRC).parts)}
assert len(manifest)==73
(ROOT/'evidence/source-verification.json').write_text(json.dumps({'baseTree':p['expectedBaseTree'],'candidateTree':p['expectedTree'],'rawSha256':sha(raw),'gzipSha256':sha(packed),'changedFiles':EXPECTED,'publicFiles':manifest},indent=2))
print('PASS: exact payload, six source files, all 73 public files and candidate tree verified')
