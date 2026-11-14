"""P39-3K-10 synthetic-only reload and stale-tab safety acceptance.
No live ERP account, Supabase credentials, or production backup is loaded.
"""
from playwright.sync_api import sync_playwright

URL="http://127.0.0.1:8796/.p39-3i-tests/fixture.html"

def main():
    with sync_playwright() as p:
        import os
        browser=p.chromium.launch(headless=True,channel="chrome") if os.getenv("P39_INV_USE_SYSTEM_CHROME")=="1" else p.chromium.launch(headless=True)
        ctx=browser.new_context()
        # Existing fixture reseeds Emergency backup on every navigation, which is
        # unsuitable for a persistence test. Make its SYNTHETIC seed idempotent.
        def serve_fixture(route):
            import urllib.request
            html=urllib.request.urlopen(URL,timeout=10).read().decode("utf-8")
            original="localStorage.setItem('KuSheERP25_EMERGENCY',JSON.stringify(seed));"
            assert html.count(original)==1
            html=html.replace(original,"if(!localStorage.getItem('KuSheERP25_EMERGENCY')) localStorage.setItem('KuSheERP25_EMERGENCY',JSON.stringify(seed));")
            route.fulfill(status=200,body=html,content_type="text/html; charset=utf-8")
        ctx.route("**/.p39-3i-tests/fixture.html",serve_fixture)
        first=ctx.new_page()
        first.goto(URL)
        first.wait_for_function("() => !!window.KuSheERPStore")
        first.evaluate("async()=>await window.KuSheERPStore.load()")
        second=ctx.new_page()
        second.goto(URL)
        second.wait_for_function("() => !!window.KuSheERPStore")
        second.evaluate("async()=>await window.KuSheERPStore.load()")
        stale=second.evaluate("""()=>{
          const store=window.KuSheERPStore;
          return store.p39BillingNoteRevisionContext('syn-b').snapshot;
        }""")
        written=first.evaluate("""async()=>{
          const store=window.KuSheERPStore;
          const before=store.p39BillingNoteRevisionContext('syn-b');
          await store.saveP39BillingNoteRevision('syn-b',{
            expectedSnapshot:before.snapshot,note:'跨頁籤安全測試備註',
            reason:'虛構資料 reload safety test'
          });
          const s=store.getState();
          return {note:s.billings[0].publicNote,original:s.billings[0].note,
            total:s.billings[0].grossTotal,ar:s.receivables[0].amount,
            bank:s.bankTransactions.length};
        }""")
        assert written=={"note":"跨頁籤安全測試備註","original":"原始合成備註","total":105000,"ar":100000,"bank":0},written
        rejected=second.evaluate("""async(oldSnapshot)=>{
          try {
            await window.KuSheERPStore.saveP39BillingNoteRevision('syn-b',{
              expectedSnapshot:oldSnapshot,note:'過期頁籤不應覆寫',
              reason:'虛構版本衝突測試'
            });
            return {rejected:false};
          } catch(error) {
            return {rejected:true,code:error.code||'',message:error.message||''};
          }
        }""",stale)
        assert rejected["rejected"],rejected
        first.reload()
        first.wait_for_function("() => !!window.KuSheERPStore")
        fresh=first.evaluate("""async()=>{
          await window.KuSheERPStore.load();
          const s=window.KuSheERPStore.getState();
          return {note:s.billings[0].publicNote,original:s.billings[0].note,
            total:s.billings[0].grossTotal,ar:s.receivables[0].amount,
            bank:s.bankTransactions.length};
        }""")
        assert fresh==written,(fresh,written)
        second.reload()
        second.wait_for_function("() => !!window.KuSheERPStore")
        again=second.evaluate("""async()=>{
          await window.KuSheERPStore.load();
          const s=window.KuSheERPStore.getState();
          return {note:s.billings[0].publicNote,ar:s.receivables[0].amount,
            bank:s.bankTransactions.length};
        }""")
        assert again=={"note":"跨頁籤安全測試備註","ar":100000,"bank":0},again
        print("PASS P39-3K-10: reload persisted synthetic change; stale tab rejected; protected finance unchanged")
        ctx.close()
        browser.close()

if __name__=="__main__":
    main()
