from playwright.sync_api import sync_playwright
import json, sys
with sync_playwright() as p:
    browser=p.chromium.launch()
    page=browser.new_page()
    page.goto("http://127.0.0.1:8765/.p33-audit/store-test.html")
    page.wait_for_function("() => !!window.KuSheERPStore")
    result=page.evaluate("""async () => {
      const s=await window.KuSheERPStore.load();
      const counts={};
      for(const [k,v] of Object.entries(s)) if(Array.isArray(v)) counts[k]=v.length;
      return {keys:Object.keys(s),counts,settings:s.settings,meta:s.meta};
    }""")
    print(json.dumps(result,ensure_ascii=False,indent=2))
    browser.close()
