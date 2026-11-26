#!/usr/bin/env python3
"""Exact candidate scope and unchanged production kernel verification for K25."""
import argparse
import hashlib
import json
import os
import subprocess
import traceback
from pathlib import Path

BASE='75938e04b8f2db6b382dc3399a3a46d845684773'
BRANCH='p41-k25-commission-review-20261126'
BASE_STORE_SHA256='6d0753fb4c24febbc368d5fcca360e77972331b2c16d4a811841ccb81fe5b94e'
PRODUCTION=('assets/js/erp-store.js','assets/js/commissions.js','index.html','assets/js/p41-commission-correction-ui.js','assets/css/p41-commission-correction.css')
WORKFLOW='.github/workflows/p41-k25-commission-review.yml'
LEGACY=('.p33-4-tests/regression.py','.p33-4-tests/fixture.html','.p34-tests/test.py','.p34-tests/store.html','.p35-tests/test_ui.py','.p39-inv1-tests/chrome_legacy.py','.p39-inv1-tests/test_store.py','.p39-inv1-tests/real-store.html')


def sha(b):return hashlib.sha256(b).hexdigest()
def blob(b):return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()


def strip_additive_store(candidate):
    begin=b'  // K25_COMMISSION_REVIEW_BEGIN';end=b'  // K25_COMMISSION_REVIEW_END'
    assert candidate.count(begin)==candidate.count(end)==1,'K25 block markers must be unique'
    start=candidate.index(begin);stop=candidate.index(end,start)+len(end)
    # Match the complete inserted block including exactly its trailing line ending.
    if candidate[stop:stop+2]==b'\r\n':stop+=2
    elif candidate[stop:stop+1]==b'\n':stop+=1
    else:raise AssertionError('K25 end marker lacks line ending')
    clean=candidate[:start]+candidate[stop:]
    for value in (b"    'createCommissionCorrectionReview',\n",b"    'createCommissionCorrectionReview',\r\n"):
        if value in clean:
            assert clean.count(value)==1;clean=clean.replace(value,b'',1);break
    else:raise AssertionError('Exact K25 writer registration not found')
    api=b'commissionCorrectionPreview, commissionCorrectionReviews, createCommissionCorrectionReview, '
    assert clean.count(api)==1,'Exact K25 read/write exports not found'
    return clean.replace(api,b'',1)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,default=Path('.'));parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    root=args.root.resolve();out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
    result={'schema':'k25-source-guard-v1','status':'RUNNING','baseCommit':BASE,'expectedBranch':BRANCH,'productionDataTouched':False}
    def git(*v):return subprocess.check_output(['git','-C',str(root),*v])
    try:
        assert os.environ.get('GITHUB_REF_NAME')==BRANCH,'Unexpected branch'
        subprocess.check_call(['git','-C',str(root),'merge-base','--is-ancestor',BASE,'HEAD'])
        result['headCommit']=git('rev-parse','HEAD').decode().strip()
        changes=[p.decode() for p in git('diff','--name-only','-z',BASE,'HEAD').split(b'\0') if p]
        assert all(p in PRODUCTION or p==WORKFLOW or p.startswith('.p41-k25-tests/') for p in changes),changes
        assert all(p in changes for p in PRODUCTION) and WORKFLOW in changes,changes
        result['changedFiles']=changes
        manifest=json.loads((root/'.p41-k25-tests/SOURCE_MANIFEST.json').read_text(encoding='utf-8'))
        assert manifest['baseCommit']==BASE
        result['verifiedSources']={}
        for name,expected in manifest['files'].items():
            assert name in PRODUCTION or name.startswith('.p41-k25-tests/'),name
            value=(root/name).read_bytes();actual={'sha256':sha(value),'gitBlob':blob(value),'bytes':len(value)}
            assert actual==expected,(name,actual,expected)
            assert git('rev-parse','HEAD:'+name).decode().strip()==actual['gitBlob'],name
            result['verifiedSources'][name]=actual
        assert set(PRODUCTION)<=set(result['verifiedSources'])
        base_store=git('show',BASE+':assets/js/erp-store.js');candidate=(root/'assets/js/erp-store.js').read_bytes()
        assert sha(base_store)==BASE_STORE_SHA256
        stripped=strip_additive_store(candidate)
        assert stripped==base_store,'Existing Store code changed outside the added K25 block/API registrations'
        result['unchangedCompleteStoreOutsideK25Block']=True
        result['unchangedLegacyFiles']={}
        for name in LEGACY:
            value=(root/name).read_bytes();assert value==git('show',BASE+':'+name),name;result['unchangedLegacyFiles'][name]=sha(value)
        result['status']='K25_SOURCE_GUARD_PASS'
    except Exception as error:
        result['status']='BLOCKED';result['error']={'type':type(error).__name__,'message':str(error),'traceback':traceback.format_exc()};raise
    finally:
        (out/'SOURCE_GUARD_RESULT.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(result,ensure_ascii=False,indent=2),flush=True)


if __name__=='__main__':main()
