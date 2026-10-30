from pathlib import Path
import json,hashlib,os,shutil,re,subprocess
root=Path(os.environ['QA_ROOT_DIR']);src=root/'src';data=json.loads((Path(__file__).parent/'operations.json').read_text())
def manifest():
 return {str(p.relative_to(src)):hashlib.sha256(p.read_bytes()).hexdigest() for p in src.rglob('*') if p.is_file() and not any(x in ['.git','.github'] for x in p.relative_to(src).parts)}
def digest(m):return hashlib.sha256(''.join(k+'\0'+m[k]+'\n' for k in sorted(m)).encode()).hexdigest()
before=manifest();assert digest(before)==data['before'],'base source mismatch'
(root/'evidence').mkdir(parents=True,exist_ok=True);(root/'baseline').mkdir(exist_ok=True)
shutil.copy(src/'billing-print.html',root/'baseline/billing-print.html')
for n in ['assets','enterprise']:(root/'baseline'/n).symlink_to(src/n,target_is_directory=True)
original=(src/'billing-print.html').read_text()
for row in data['files']:
 p=src/row['path'];assert hashlib.sha256(p.read_bytes()).hexdigest()==row['before']
 text=p.read_text()
 for start,end,value in reversed(row['edits']):text=text[:start]+value+text[end:]
 p.write_text(text);assert hashlib.sha256(p.read_bytes()).hexdigest()==row['after'],row['path']+' transfer mismatch'
after=manifest();assert digest(after)==data['after'],'result source mismatch'
changed=sorted(k for k in after if after[k]!=before.get(k));assert changed==sorted(x['path'] for x in data['files'])
assert re.search(r'<style>(.*?)</style>',original,re.S).group(1)==re.search(r'<style>(.*?)</style>',(src/'billing-print.html').read_text(),re.S).group(1)
subprocess.run(['git','diff','--check'],cwd=src,check=True)
(root/'evidence/source-check.json').write_text(json.dumps({'base':data['before'],'candidate':data['after'],'changed':changed,'before':before,'after':after,'original_template_css_unchanged':True},indent=2))
print('Exact five-file source verified; 68 other application files unchanged')
