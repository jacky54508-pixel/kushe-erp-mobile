#!/usr/bin/env python3
"""Freeze already-reviewed K25 sources. Run once after all candidate edits finish."""
import argparse
import hashlib
import json
from pathlib import Path
BASE='75938e04b8f2db6b382dc3399a3a46d845684773'
PRODUCTION=('assets/js/erp-store.js','assets/js/commissions.js','index.html','assets/js/p41-commission-correction-ui.js','assets/css/p41-commission-correction.css')
TESTS=('k25_fixture.py','k25_browser_review.py','source_guard.py')
parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True);parser.add_argument('--tests',type=Path,required=True);args=parser.parse_args()
files={}
for name in PRODUCTION:
 b=(args.root/name).read_bytes();files[name]={'sha256':hashlib.sha256(b).hexdigest(),'gitBlob':hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest(),'bytes':len(b)}
for name in TESTS:
 b=(args.tests/name).read_bytes();files['.p41-k25-tests/'+name]={'sha256':hashlib.sha256(b).hexdigest(),'gitBlob':hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest(),'bytes':len(b)}
(args.tests/'SOURCE_MANIFEST.json').write_text(json.dumps({'schema':'k25-reviewed-source-manifest-v1','baseCommit':BASE,'files':files},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(files,ensure_ascii=False,indent=2))
