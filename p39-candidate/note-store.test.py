"""P39-3 guarded Store note writer tests, with a fake in-browser ERP seed only."""
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8796/p39-candidate/note-store-fixture.html"

def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        ctx=browser.new_context()
        page=ctx.new_page()
        errors=[]
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL)
        page.wait_for_function("() => !!window.KuSheERPStore")
        result=page.evaluate("""async () => {
          const store=window.KuSheERPStore;
          await store.load();
          const before=structuredClone(store.getState());
          const info=store.p39BillingNoteRevisionContext('syn-b');
          if(!info.snapshot || info.note!=='原始合成備註')
            throw Error('original note snapshot missing');
          const saved=await store.saveP39BillingNoteRevision('syn-b',{
            expectedSnapshot:info.snapshot,note:'新的虛構對外備註',reason:'合成資料測試'
          });
          const after=structuredClone(store.getState());
          if(saved.revision!==1 || saved.financialUnchanged!==true)
            throw Error('unexpected writer result');
          if(after.billings[0].note!=='新的虛構對外備註')
            throw Error('note not updated');
          if(after.billings[0].noteRevisionHistory[0].before!=='原始合成備註')
            throw Error('previous note missing');
          const protectedKeys=Object.keys(before).filter(k=>
            !['billings','meta','audit'].includes(k));
          const changed=protectedKeys.filter(k=>
            JSON.stringify(before[k])!==JSON.stringify(after[k]));
          if(changed.length)throw Error('protected ERP data changed: '+changed.join(','));
          const billBefore={...before.billings[0]},billAfter={...after.billings[0]};
          for(const row of [billBefore,billAfter]){
            delete row.note;delete row.updatedAt;delete row.noteRevisionHistory;
          }
          if(JSON.stringify(billBefore)!==JSON.stringify(billAfter))
            throw Error('billing financial fields were changed');
          let stale=false;try {
            await store.saveP39BillingNoteRevision('syn-b',{
              expectedSnapshot:info.snapshot,note:'不應覆蓋',reason:'過期快照'
            });
          }catch(e){stale=e.code==='P39_NOTE_STALE_SOURCE'}
          if(!stale)throw Error('stale document was not blocked');
          const fresh=store.p39BillingNoteRevisionContext('syn-b');
          window.KusheAuthGate.canWrite=()=>false;
          let denied=false;try{
            await store.saveP39BillingNoteRevision('syn-b',{
              expectedSnapshot:fresh.snapshot,note:'權限不足',reason:'測試'
            });
          }catch(e){denied=e.code==='P39_NOTE_PERMISSION_DENIED'}
          if(!denied)throw Error('role guard not enforced');
          window.KusheAuthGate.canWrite=()=>true;
          if(store.getState().billings[0].note!=='新的虛構對外備註')
            throw Error('denied operation changed the note');
          const same=await store.saveP39BillingNoteRevision('syn-b',{
            expectedSnapshot:fresh.snapshot,note:'新的虛構對外備註',reason:'重複'
          });
          if(!same.unchanged || store.getState().billings[0].noteRevisionHistory.length!==1)
            throw Error('no-op created a duplicate note history entry');
          return {
            saved:saved.documentOnly,historyLength:after.billings[0].noteRevisionHistory.length,
            changedProtectedCollections:changed,staleBlocked:stale,
            permissionBlocked:denied,noChangeDeduplicated:same.unchanged,
            auditLast:after.audit[0]?.action||''
          };
        }""")
        assert result["saved"] is True,result
        assert result["historyLength"] == 1,result
        assert result["changedProtectedCollections"] == [],result
        assert result["staleBlocked"] and result["permissionBlocked"],result
        assert result["noChangeDeduplicated"],result
        assert not errors,errors
        print("PASS: Store CAS note revision, protected accounting, stale/role/duplicate guards")
        ctx.close()
        browser.close()

if __name__ == "__main__":
    main()
