"""P39-3 guarded Store note writer tests, with a fake in-browser ERP seed only."""
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8796/.p39-3i-tests/fixture.html"

def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,channel='chrome') if __import__('os').environ.get('P39_INV_USE_SYSTEM_CHROME')=='1' else p.chromium.launch(headless=True)
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
          if(after.billings[0].note!=='原始合成備註'||after.billings[0].publicNote!=='新的虛構對外備註')
            throw Error('note or PDF publicNote not updated');
          if(after.billings[0].noteRevisionHistory[0].before!=='原始合成備註'||
             after.billings[0].noteRevisionHistory[0].originalPublicNote!=='')
            throw Error('previous note missing');
          const protectedKeys=Object.keys(before).filter(k=>
            !['billings','meta','audit'].includes(k));
          const changed=protectedKeys.filter(k=>
            JSON.stringify(before[k])!==JSON.stringify(after[k]));
          if(changed.length)throw Error('protected ERP data changed: '+changed.join(','));
          const billBefore={...before.billings[0]},billAfter={...after.billings[0]};
          for(const row of [billBefore,billAfter]){
            delete row.publicNote;delete row.updatedAt;delete row.noteRevisionHistory;
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
          if(store.getState().billings[0].note!=='原始合成備註'||store.getState().billings[0].publicNote!=='新的虛構對外備註')
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
        # Confirm the original billing PDF renderer consumes the saved public note.
        page.add_script_tag(url="/assets/js/billing-print.js")
        pdf_model=page.evaluate("""()=>{
          const store=window.KuSheERPStore;
          return window.KusheBillingPrint.buildExternalView(store.getState().billings[0]);
        }""")
        assert pdf_model["publicNote"]=="新的虛構對外備註",pdf_model
        assert pdf_model["totalAmount"]==105000,pdf_model
        assert pdf_model["receivableAmount"]==100000,pdf_model
        blank=page.evaluate("""async()=>{
            const store=window.KuSheERPStore,
                fresh=store.p39BillingNoteRevisionContext('syn-b');
            await store.saveP39BillingNoteRevision('syn-b',{
                expectedSnapshot:fresh.snapshot,note:'',reason:'清除對外備註'});
            const bill=store.getState().billings[0],
                rendered=window.KusheBillingPrint.buildExternalView(bill),
                old={...bill,note:'ERP 內部資料'};
            delete old.publicNote;
            return {internal:bill.note,public:bill.publicNote,
              rendered:rendered.publicNote,
              hiddenLegacy:window.KusheBillingPrint.buildExternalView(old).publicNote,
              count:bill.noteRevisionHistory.length};
        }""")
        assert blank=={"internal":"原始合成備註","public":"","rendered":"",
                       "hiddenLegacy":"","count":2},blank
        assert not errors,errors
        print("PASS: Store CAS note revision, protected accounting, stale/role/duplicate guards")
        # End-to-end candidate button and modal, still only synthetic fixture data.
        ui_ctx=browser.new_context()
        ui_page=ui_ctx.new_page()
        ui_page.goto(URL)
        ui_page.wait_for_function("() => !!window.KuSheERPStore")
        ui_page.evaluate("async()=>{await window.KuSheERPStore.load()}")
        ui_page.add_script_tag(url="/assets/js/p39-note-revision.js")
        mounted=ui_page.evaluate("""()=>{
          const overlay=document.createElement('div');
          overlay.className='erp-detail-overlay';
          overlay.innerHTML='<section class="erp-detail-card"><div class="erp-detail-body"></div></section>';
          document.body.append(overlay);
          const store=window.KuSheERPStore;
          const billing=store.getState().billings[0],info=store.billingDocumentState(billing.id);
          return window.KusheP39BillingNote.mount(overlay,billing,info,()=>{});
        }""")
        assert mounted is True,"note UI did not mount"
        ui_page.locator('[data-p393-open]').click()
        ui_page.locator('.p393-note-form [name="note"]').fill('由候選操作頁儲存的虛構備註')
        ui_page.locator('.p393-note-form [name="reason"]').fill('候選 UI 實機回歸')
        ui_page.locator('.p393-note-form button[type="submit"]').click()
        ui_page.wait_for_function(
          "() => window.KuSheERPStore.getState().billings[0].publicNote === '由候選操作頁儲存的虛構備註'"
        )
        committed=ui_page.evaluate("""()=>{
          const state=window.KuSheERPStore.getState();
          return {internalNote:state.billings[0].note,count:state.billings[0].noteRevisionHistory.length,
                  receivable:state.receivables[0].amount,
                  bankCount:state.bankTransactions.length};
        }""")
        assert committed == {"internalNote":"原始合成備註","count":1,"receivable":100000,"bankCount":0},committed
        ui_ctx.close()
        ctx.close()
        browser.close()

if __name__ == "__main__":
    main()
