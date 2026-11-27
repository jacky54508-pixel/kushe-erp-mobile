"""K29 real Store + receivable/group render. No production session or network."""
import argparse
import json
import traceback
from pathlib import Path

from playwright.sync_api import sync_playwright
from pdf_support import Report, Server, browser_options, restrict, sha, source
from receivables_fixture import CUSTOMER, GROUP_SETUP, HTML, IDS, fixture

STYLES = ['assets/css/app.css', 'assets/css/commissions-scoped.css', 'assets/css/receivables-scoped.css',
          'assets/css/receivable-cheques.css', 'assets/css/billing-groups.css']
SCRIPTS = ['assets/js/display-sort.js', 'assets/js/billing-print.js', 'assets/js/billing-bundle-print.js',
           'assets/js/external-billing-invoice.js', 'assets/js/external-billing-invoice-ui.js', 'assets/js/billing-groups.js', 'assets/js/billing.js']
VIEWPORTS = {'desktop': {'width': 1440, 'height': 1000}, 'mobile': {'width': 390, 'height': 844}}
ACTION_CAPTURE = r'''()=>{
 const api=window.KusheBillingGroups;
 window.KusheBillingGroups={...api,mountList(...args){
  const result=api.mountList(...args);
  window.__k29Actions=[...args[0].querySelectorAll('button')].map(node=>({node,handler:node.onclick,text:node.textContent,data:JSON.stringify(node.dataset)}));
  window.__k29SourceRows=[...args[0].querySelectorAll('.bg-source-row,.bg-source-record')].map(node=>({id:node.dataset.expandReceivable||node.dataset.mobileReceivable,text:node.textContent}));
  return result;
 }};
}'''


def run_case(browser, server, report, version, device):
    name = 'receivables-' + device + '-' + version
    context = browser.new_context(viewport=VIEWPORTS[device], is_mobile=device == 'mobile', has_touch=device == 'mobile', service_workers='block')
    restrict(context, server, report, name)
    try:
        page = context.new_page()
        page.set_default_timeout(20000)
        page.goto(server.origin + '/' + version + '/fixture.html')
        report.check(name + ': seed is installed only in owned empty profile', page.evaluate('x=>__k29Seed(x)', fixture()))
        page.add_script_tag(url=server.origin + '/' + version + '/assets/js/erp-store.js')
        page.evaluate('async()=>{await KuSheERPStore.load();await KuSheERPStore.saveCustomer({name:"合成建設有限公司｜長名稱對齊測試"},"SYN-K29-CUSTOMER")}')
        group = page.evaluate(GROUP_SETUP)
        report.check(name + ': real source model has exact expected original balances', group['totals']['outstanding'] == 140000 and group['totals']['retentionOutstanding'] == 9000 and group['totals']['grossTotal'] == 189000, group['totals'])
        before = {'raw': page.evaluate('()=>__k29Raw()'), 'state': page.evaluate('()=>KuSheERPStore.getState()')}
        for path in STYLES:
            page.add_style_tag(url=server.origin + '/' + version + '/' + path)
        page.add_style_tag(content='.page-frame{margin-left:0!important}.page-frame>.view{padding:18px;min-width:0;max-width:100%}@media(max-width:620px){.page-frame>.view{padding:12px}}')
        for path in SCRIPTS:
            page.add_script_tag(url=server.origin + '/' + version + '/' + path)
            if path.endswith('billing-groups.js'):
                page.evaluate(ACTION_CAPTURE)
        page.evaluate('()=>KusheReceivables.activate()')
        selector = '.bg-group-mobile[data-bg-group]' if device == 'mobile' else '.bg-inline-row[data-bg-group]'
        summary = page.locator('#receivablesApp ' + selector)
        report.check(name + ': one real group is rendered on selected surface', summary.count() == 1)
        report.check(name + ': presentation preserves every bound action node, handler, label and data action', page.evaluate('()=>__k29Actions.every(x=>x.node.isConnected&&x.handler===x.node.onclick&&x.text===x.node.textContent&&x.data===JSON.stringify(x.node.dataset))'))
        report.check(name + ': source row content remains intact', page.evaluate('()=>__k29SourceRows.every(x=>[...document.querySelectorAll(".bg-source-row,.bg-source-record")].some(n=>(n.dataset.expandReceivable||n.dataset.mobileReceivable)===x.id&&n.textContent===x.text))'))
        summary.scroll_into_view_if_needed()
        geometry = summary.evaluate('''e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight,frameScroll:document.querySelector('.page-frame').scrollTop}}''')
        report.check(name + ': screenshot actually contains the group summary', geometry['bottom'] > 0 and geometry['top'] < geometry['viewportHeight'], geometry)
        if device == 'mobile':
            report.check(name + ': mobile group has no horizontal clipping', geometry['left'] >= -1 and geometry['right'] <= geometry['viewportWidth'] + 1, geometry)
        page.screenshot(path=str(report.qa / (name + '-collapsed.png')), full_page=False)
        report.save(name + '-geometry.json', geometry)
        if version == 'after':
            report.check(name + ': collapsed summary contains original invoice states', summary.locator('.ar-group-invoices').count() == 1 and '已開發票' in summary.locator('.ar-group-invoices').inner_text() and '待開發票' in summary.locator('.ar-group-invoices').inner_text())
            report.check(name + ': version audit moved out of collapsed summary', summary.locator('.bg-document-date .bg-document-stamp').count() == 0 and summary.locator('.bg-document-date [data-bg-history]').count() == 0)
        summary.locator('[data-bg-expand]').click()
        report.check(name + ': existing expand action opens originals', summary.locator('[data-bg-expand]').get_attribute('aria-expanded') == 'true')
        details = summary if device == 'mobile' else page.locator('[data-bg-details="' + group['document']['id'] + '"]')
        original_selector = '[data-mobile-receivable]' if device == 'mobile' else '.bg-source-row'
        originals = details.locator(original_selector)
        report.check(name + ': both exact original receivables remain attached', originals.count() == 2 and sorted(originals.evaluate_all('(nodes)=>nodes.map(n=>n.dataset.mobileReceivable||n.dataset.expandReceivable)')) == sorted(bid + '-AR' for bid in IDS[:2]))
        report.check(name + ': original invoice number and retention are still present', 'SYN-K29-INV-A' in details.inner_text() and '$5,000' in details.inner_text() and '$4,000' in details.inner_text())
        if version == 'after':
            audit = details.locator('.ar-group-version')
            audit.scroll_into_view_if_needed()
            report.check(name + ': expanded version and original timestamp remain available', audit.locator('[data-bg-history]').count() == 1 and '第 2 版' in audit.inner_text() and '最後修改' in audit.inner_text())
            page.screenshot(path=str(report.qa / (name + '-expanded-version.png')), full_page=False)
            audit.locator('[data-bg-history]').click()
            page.locator('.bg-history-list').wait_for()
            report.check(name + ': original version-history action still opens both saved versions', page.locator('.bg-history-entry').count() == 2 and '2026/11/25' in page.locator('.bg-history-list').inner_text() and '2026/11/26' in page.locator('.bg-history-list').inner_text())
            page.screenshot(path=str(report.qa / (name + '-history.png')), full_page=False)
            page.locator('[data-bg-history-close]').click()
        original = originals.first
        original.scroll_into_view_if_needed()
        page.screenshot(path=str(report.qa / (name + '-original.png')), full_page=False)
        if device == 'mobile':
            menu = original.locator('.bg-source-account-menu')
            menu.locator('summary').click()
            collect = menu.locator('.receivable-action-collect:not(:disabled)')
        else:
            menu = original.locator('.bg-source-account-menu')
            menu.locator('summary').click()
            collect = menu.locator('[data-receive]')
        collect.click()
        page.locator('#receiptEditorForm').wait_for()
        report.check(name + ': preserved receipt action opens its actual original source', 'SYN-K29-NO-A' in page.locator('.receipt-card').inner_text() and '$60,000' in page.locator('.receipt-card').inner_text())
        page.locator('.receipt-card [data-close-detail]').first.click()
        after = {'raw': page.evaluate('()=>__k29Raw()'), 'state': page.evaluate('()=>KuSheERPStore.getState()')}
        report.check(name + ': render, expand, history and receipt-open change no stored business data', before == after)
        facts = {'groupTotals': group['totals'], 'sourceIds': group['document']['sourceIds'],
                 'invoiceSources': [s['document']['invoiceNo'] for s in group['sources']],
                 'sourceSettlements': [s['settlement'] for s in group['sources']], 'geometry': geometry}
        report.save(name + '.json', facts)
        report.data['cases'].append(name)
        return facts
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--browser', type=Path)
    args = parser.parse_args()
    report = Report(args.output.resolve(), 'k29-real-receivables-ui-v1')
    resources = {'/favicon.ico': (b'', 'image/x-icon')}
    try:
        for version in ('before', 'after'):
            resources['/' + version + '/fixture.html'] = (HTML.encode(), 'text/html; charset=utf-8')
            for path in ['assets/js/erp-store.js'] + SCRIPTS + STYLES:
                raw = source(args.root, path, version)
                resources['/' + version + '/' + path] = (raw, 'text/css; charset=utf-8' if path.endswith('.css') else 'text/javascript; charset=utf-8')
                report.data.setdefault('sources', {})[version + '/' + path] = sha(raw)
        with Server(resources) as server, sync_playwright() as playwright:
            browser = playwright.chromium.launch(**browser_options(args.browser))
            try:
                for device in VIEWPORTS:
                    before = run_case(browser, server, report, 'before', device)
                    after = run_case(browser, server, report, 'after', device)
                    report.check(device + ': before/after original amounts, membership, invoices and settlement identical', {k: v for k, v in before.items() if k != 'geometry'} == {k: v for k, v in after.items() if k != 'geometry'})
                    if device == 'desktop':
                        report.check(device + ': collapsed merged row is shorter than published baseline', after['geometry']['height'] < before['geometry']['height'], {'before': before['geometry']['height'], 'after': after['geometry']['height']})
                report.check('all browser requests stay on owned synthetic allowlist', not report.data['externalRequests'], report.data['externalRequests'])
                report.check('no uncaught browser errors', not report.data['pageErrors'], report.data['pageErrors'])
                report.data['status'] = 'PASS'
            finally:
                browser.close()
    except Exception as error:
        report.data['status'] = 'BLOCKED' if 'Executable doesn' in str(error) or 'browserType.launch' in str(error) else 'FAIL'
        report.data['failure'] = {'message': str(error), 'traceback': traceback.format_exc()}
    finally:
        report.flush()
    print(json.dumps({'status': report.data['status'], 'checks': report.data['passCount'], 'output': str(report.output)}, ensure_ascii=False))
    return 0 if report.data['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
