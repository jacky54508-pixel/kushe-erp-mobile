#!/usr/bin/env python3
"""Real K30 entry buttons, source forms, postings and reversals on two viewports."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import traceback

from playwright.sync_api import sync_playwright

from k30_browser_store import (ROOT, Report, Server, boot, raw, public, invoke, ledger,
    check_commit, financial, receipt, select_browser, GROUP_SETUP, post)
from k30_fixture import (HTML, PREFIX, DATE, IDS, ORIGINALS, REDUCTIONS,
    LEGACY_AR, LEGACY_BILL, LEGACY_BILL_AR, allowance_input)

STYLES = ['assets/css/app.css', 'assets/css/commissions-scoped.css',
          'assets/css/receivables-scoped.css', 'assets/css/receivable-cheques.css', 'assets/css/billing-groups.css']
SCRIPTS = ['assets/js/display-sort.js', 'assets/js/billing-print.js', 'assets/js/billing-bundle-print.js',
           'assets/js/external-billing-invoice.js', 'assets/js/external-billing-invoice-ui.js',
           'assets/js/billing-allowance-ui.js', 'assets/js/billing-groups.js', 'assets/js/billing.js']
VIEWPORTS = {'desktop': {'width': 1440, 'height': 1000}, 'mobile': {'width': 390, 'height': 844}}


def install_ui(page, server):
    for path in STYLES:
        page.add_style_tag(url=server.origin + '/' + path)
    page.add_style_tag(content='.page-frame{margin-left:0!important}.page-frame>.view{display:block!important;padding:18px;min-width:0;max-width:100%}*{scroll-behavior:auto!important;animation:none!important;transition:none!important}@media(max-width:620px){.page-frame>.view{padding:12px}}')
    for path in SCRIPTS:
        page.add_script_tag(url=server.origin + '/' + path)
    page.evaluate("async()=>{document.body.dataset.route='billings';await KusheBilling.activate()}")
    page.locator('#billingMonthFilter').fill('2026-10')
    page.locator('#billingMonthFilter').dispatch_event('change')


def open_from_entry(page, group=False):
    selector = '#billingsApp [data-bg-discount]:visible' if group else '#billingsApp [data-billing-discount-readonly="' + IDS[0] + '"]:visible'
    page.locator(selector).first.click()
    page.locator('#billingAllowanceForm').wait_for(state='visible')


def fill_form(page, group=False, issued=False, reversal=False):
    form = page.locator('#billingAllowanceForm')
    form.locator('[name="date"]').fill(DATE)
    form.locator('[name="reference"]').fill(PREFIX + ('UI-REVERSE-REFERENCE' if reversal else 'UI-AGREEMENT'))
    form.locator('[name="reason"]').fill(PREFIX + ('UI-REVERSE-REASON' if reversal else 'UI-NEGOTIATED-REASON'))
    if not reversal:
        indices = (0, 1) if group else (0,)
        form.locator('[name="approvedGrossReduction"]').fill(str(sum(REDUCTIONS[index]['grossTotal'] for index in indices)))
        for index in indices:
            source = form.locator('[data-allowance-source="' + IDS[index] + '"]')
            for key, value in REDUCTIONS[index].items():
                source.locator('[data-reduction="' + key + '"]').fill(str(value))
    if issued:
        evidence = form.locator('[data-allowance-evidence="' + IDS[0] + '-INVOICE"]')
        evidence.locator('[data-voucher-reference]').fill(PREFIX + ('UI-REVERSE-VOUCHER' if reversal else 'UI-VOUCHER'))
        evidence.locator('[data-voucher-date]').fill(DATE)
        evidence.locator('[data-voucher-verified]').check()


def review_ui(page, report, name, allowed=True):
    before = raw(page)
    page.locator('[data-allowance-preview]').click()
    page.locator('[data-allowance-review]').wait_for(state='visible')
    page.wait_for_function("()=>!document.querySelector('[data-allowance-preview]').disabled")
    confirm = page.locator('#billingAllowanceForm [name="confirmed"]')
    report.check(name + ': actual preview enables confirmation only for an admitted request', confirm.is_enabled() is allowed)
    report.check(name + ': UI preview is read-only', raw(page) == before)
    report.check(name + ': posting requires explicit confirmation after preview', page.locator('[data-allowance-post]').is_disabled())


def print_sources(page):
    return page.evaluate("""()=>{const rows=KuSheERPStore.getState().billings.filter(b=>['SYN-K30-BILL-A','SYN-K30-BILL-B'].includes(b.id));return {single:rows.map(r=>KusheBillingPrint.buildExternalView(r)),combined:KusheBillingBundlePrint.buildCombinedView(rows)}}""")


def check_geometry(page, report, name):
    modal = page.locator('.billing-allowance-modal')
    geometry = modal.evaluate('''node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,viewportWidth:innerWidth,viewportHeight:innerHeight}}''')
    report.check(name + ': modal fits actual viewport without horizontal clipping', geometry['left'] >= -1 and geometry['right'] <= geometry['viewportWidth'] + 1 and geometry['top'] >= -1 and geometry['bottom'] <= geometry['viewportHeight'] + 1, geometry)
    report.check(name + ': modal is an accessible named dialog', modal.get_attribute('role') == 'dialog' and modal.get_attribute('aria-modal') == 'true' and bool(page.locator('#billingAllowanceTitle').inner_text().strip()))
    report.save(name + '-geometry.json', geometry)


def run_flow(browser, server, report, device, group=False, issued=False):
    name = 'ui-' + device + ('-group' if group else '-single') + ('-issued-voucher' if issued else '')
    context = browser.new_context(viewport=VIEWPORTS[device], is_mobile=device == 'mobile', has_touch=device == 'mobile', service_workers='block')
    try:
        page, _ = boot(context, server, report, name, 'issued' if issued else 'standard')
        if group:
            page.evaluate(GROUP_SETUP)
        install_ui(page, server)
        before_open = raw(page)
        original_print = print_sources(page)
        open_from_entry(page, group)
        report.check(name + ': real entry opens the correct complete source scope without mutation', page.locator('[data-allowance-source]').count() == (2 if group else 1) and raw(page) == before_open)
        fill_form(page, group, issued)
        review_ui(page, report, name)
        review_text = page.locator('[data-allowance-review]').inner_text()
        report.check(name + ': review visibly shows exact reduced source amount', '$94,500' in review_text and '$4,500' in review_text, review_text)
        check_geometry(page, report, name)
        page.locator('[data-allowance-review]').scroll_into_view_if_needed()
        page.screenshot(path=str(report.qa / (name + '-review.png')), full_page=False)
        # Changing a single field must invalidate both the checked source and the
        # confirmation. This is a real DOM edit, not a direct writer call.
        page.locator('#billingAllowanceForm [name="reason"]').fill(PREFIX + 'UI-REVISED-REASON')
        report.check(name + ': input edit invalidates the previous preview', page.locator('[data-allowance-review]').is_hidden() and page.locator('[data-allowance-post]').is_disabled() and page.locator('[name="confirmed"]').is_disabled())
        review_ui(page, report, name + '-rechecked')
        page.locator('#billingAllowanceForm [name="confirmed"]').check()
        report.check(name + ': explicit confirmation enables actual posting button', page.locator('[data-allowance-post]').is_enabled())
        before_post = raw(page)
        page.locator('[data-allowance-post]').click()
        page.wait_for_function('()=>KuSheERPStore.getState().meta.billingAllowances?.length===1')
        page.locator('.allowance-success').wait_for(state='visible')
        event, after = check_commit(report, name + '-clicked-post', page, before_post, None)
        report.check(name + ': UI posts exactly the explicit allocation total', event['approvedGrossReduction'] == (18900 if group else 10500) and len(event['allocations']) == (2 if group else 1))
        report.check(name + ': original single and combined print payloads remain byte-equivalent', print_sources(page) == original_print)
        report.check(name + ': posted history is visible', page.locator('[data-allowance-history] .allowance-history-row').count() == 1 and event['id'] in page.locator('[data-allowance-history]').inner_text())
        page.locator('[data-allowance-history]').scroll_into_view_if_needed()
        page.screenshot(path=str(report.qa / (name + '-posted.png')), full_page=False)
        page.locator('[data-allowance-reverse="' + event['id'] + '"]').click()
        fill_form(page, group, issued, reversal=True)
        review_ui(page, report, name + '-reverse')
        page.locator('#billingAllowanceForm [name="confirmed"]').check()
        before_reverse = raw(page)
        page.locator('[data-allowance-post]').click()
        page.wait_for_function('()=>KuSheERPStore.getState().meta.billingAllowances?.length===2')
        page.locator('.allowance-success').wait_for(state='visible')
        reversed_event, _ = check_commit(report, name + '-clicked-reverse', page, before_reverse, None, 'reverse')
        report.check(name + ': real reversal button appends opposite event and retains original posting', reversed_event['reverseOf'] == event['id'] and ledger(public(page))[0] == event)
        report.check(name + ': original sources and original print views are restored exactly', financial(page, report, name)['effective'] == ORIGINALS[0] and print_sources(page) == original_print)
        page.locator('[data-allowance-history]').scroll_into_view_if_needed()
        page.screenshot(path=str(report.qa / (name + '-reversed.png')), full_page=False)
        report.case(name)
    finally:
        context.close()


def run_refusal(browser, server, report, device, failure):
    name = 'ui-' + device + '-refusal-' + failure
    context = browser.new_context(viewport=VIEWPORTS[device], is_mobile=device == 'mobile', has_touch=device == 'mobile', service_workers='block')
    try:
        page, _ = boot(context, server, report, name)
        install_ui(page, server)
        open_from_entry(page)
        fill_form(page)
        if failure == 'cloud-prepare':
            page.evaluate("()=>{KusheCloudSync.prepareBillingAllowanceWrite=async()=>{throw Error('SYN-K30 Cloud capability is unavailable')}}")
            review_ui(page, report, name, allowed=False)
            report.check(name + ': actual preparation error is visible', 'SYN-K30 Cloud capability is unavailable' in page.locator('[data-allowance-review]').inner_text())
        else:
            review_ui(page, report, name)
            page.locator('#billingAllowanceForm [name="confirmed"]').check()
            if failure == 'receipt-arrived':
                invoke(page, report, name, 'addReceipt', receipt(1000, key='UI-EXTERNAL-RECEIPT'))
                report.check(name + ': actual external Store event invalidates stale confirmation', page.locator('[data-allowance-post]').is_disabled() and page.locator('[name="confirmed"]').is_disabled())
                report.check(name + ': stale source message is visible', '更新' in page.locator('[data-allowance-message]').inner_text())
            else:
                before = raw(page)
                page.evaluate("()=>{__k28Auth.role='staff'}")
                page.locator('[data-allowance-post]').click()
                page.wait_for_function("()=>!document.querySelector('#billingAllowanceForm').inert&&!document.querySelector('[data-allowance-preview]').disabled")
                report.check(name + ': actual post-time owner loss leaves all stored data unchanged', raw(page) == before)
                report.check(name + ': owner refusal is visible and posting remains disabled', bool(page.locator('[data-allowance-review]').inner_text().strip()) and page.locator('[data-allowance-post]').is_disabled())
        report.check(name + ': failed operation preserves typed source amounts and reason', page.locator('[name="reason"]').input_value() == PREFIX + 'UI-NEGOTIATED-REASON' and page.locator('[data-allowance-source="' + IDS[0] + '"] [data-reduction="grossTotal"]').input_value() == '10500')
        report.check(name + ': no failed UI action creates any allowance event', ledger(public(page)) == [])
        check_geometry(page, report, name)
        page.locator('[data-allowance-message]').scroll_into_view_if_needed()
        page.screenshot(path=str(report.qa / (name + '.png')), full_page=False)
        report.case(name)
    finally:
        context.close()


def run_legacy_consumers(browser, server, report, device, unrelated_allowance=False):
    name = 'ui-legacy-consumers-' + device + ('-with-unrelated-allowance' if unrelated_allowance else '-without-ledger')
    context = browser.new_context(viewport=VIEWPORTS[device], is_mobile=device == 'mobile', has_touch=device == 'mobile', service_workers='block')
    try:
        page, _ = boot(context, server, report, name, 'legacy-consumers')
        if unrelated_allowance:
            post(page, report, name + '-unrelated-real-post', allowance_input())
        before_render = raw(page)
        original_state = public(page)
        report.check(name + ': fixtures retain a standalone AR and an issued legacy bill with no invoice row',
                     not any(row.get('receivableId') == LEGACY_AR for row in original_state['billings'])
                     and not any(row.get('billingId') == LEGACY_BILL or row.get('sourceId') == LEGACY_BILL for row in original_state['invoices']))
        install_ui(page, server)
        compatibility = page.evaluate('''ids=>{
          const s=KuSheERPStore.getState(),bill=s.billings.find(row=>row.id===ids.bill);
          return {standalone:KusheBillingAllowance.forReceivable(ids.ar),
            oldBilling:KusheBillingAllowance.forBilling(ids.bill),oldReceivable:KusheBillingAllowance.forReceivable(ids.billAr),
            ordinary:KusheBillingAllowance.receiptState(bill,s),strict:KusheBillingAllowance.billing(ids.bill,s)};
        }''', {'ar': LEGACY_AR, 'bill': LEGACY_BILL, 'billAr': LEGACY_BILL_AR})
        report.check(name + ': unrelated allowance history never forces legacy consumers into new strict admission',
                     compatibility['standalone'] is None and compatibility['oldBilling'] is None and compatibility['oldReceivable'] is None, compatibility)
        report.check(name + ': original legacy receipt status and 60000 balance remain exact',
                     compatibility['ordinary']['received'] == 40000 and compatibility['ordinary']['unreceived'] == 60000
                     and compatibility['ordinary']['status'] == '部分收款')
        report.check(name + ': the same legacy missing-invoice source remains ineligible for formal allowance',
                     compatibility['strict']['valid'] is False and compatibility['strict']['settlement'] is None)
        page.evaluate("""async()=>{KusheBilling.deactivate();document.getElementById('billingsView').style.setProperty('display','none','important');document.body.dataset.route='receivables';await KusheReceivables.activate()}""")
        month_selector = '#receivablesApp .mobile-filter-common input[type="month"]' if device == 'mobile' else '#receivableMonth'
        page.locator(month_selector).fill('2026-10')
        page.locator(month_selector).dispatch_event('change')
        for receivable_id, expected in ((LEGACY_AR, 7500), (LEGACY_BILL_AR, 60000)):
            attribute = 'data-mobile-receivable' if device == 'mobile' else 'data-expand-receivable'
            row = page.locator('#receivablesApp [' + attribute + '="' + receivable_id + '"]')
            report.check(name + ': actual legacy row shows its saved open balance ' + receivable_id,
                         row.count() == 1 and '$' + format(expected, ',') in row.inner_text(), row.inner_text())
            collect = row.locator('button.receivable-action-collect' if device == 'mobile' else '[data-receive="' + receivable_id + '"]').first
            report.check(name + ': original ordinary receive action stays enabled ' + receivable_id, collect.is_enabled())
            collect.click()
            form = page.locator('#receiptEditorForm')
            form.wait_for(state='visible')
            amount = form.locator('[name="cashAmount"]')
            report.check(name + ': actual receive form retains original available amount and ceiling ' + receivable_id,
                         amount.input_value() == str(expected) and amount.get_attribute('max') == str(expected))
            page.locator('.receipt-card [data-close-detail]').first.click()
        report.check(name + ': list rendering and opening both ordinary receipt forms perform zero storage writes',
                     raw(page) == before_render and public(page) == original_state)
        # Formal allowance uses the strict projection even when ordinary screens
        # preserve a valid saved legacy balance.
        page.evaluate('id=>{KusheBillingAllowance.open({billingId:id});return true}', LEGACY_BILL)
        page.locator('#billingAllowanceForm').wait_for(state='visible')
        report.check(name + ': formal legacy-source modal displays its invoice blocker and stays disabled',
                     '發票' in page.locator('[data-allowance-source="' + LEGACY_BILL + '"]').inner_text()
                     and page.locator('[data-allowance-post]').is_disabled()
                     and page.locator('#billingAllowanceForm [name="confirmed"]').is_disabled())
        page.locator('[data-allowance-close]').first.click()
        # A malformed snapshot cannot enter the real Store at all. Exercise the
        # public presentation API with its explicit snapshot argument in the real
        # browser; do not fake getState(), rewrite published state, or bypass load.
        blocked = page.evaluate('''x=>{
          const bad=structuredClone(KuSheERPStore.getState());
          if(x.related)bad.meta.billingAllowances[0].allocations[0].receivableId='SYN-K30-MISSING-AR';
          else bad.meta.billingAllowances={unexpected:'SYN-K30-MALFORMED'};
          const ar=KusheBillingAllowance.forReceivable(x.ar,bad),bill=KusheBillingAllowance.forBilling(x.bill,bad);
          const host=document.createElement('div');host.dataset.k30InvalidProof='true';host.innerHTML=KusheBillingAllowance.summary(ar);document.body.append(host);
          return {ar,bill,strict:KuSheERPStore.receivableFinancialState(x.ar,bad)};
        }''', {'ar': LEGACY_AR, 'bill': LEGACY_BILL, 'related': unrelated_allowance})
        report.check(name + ': malformed or unidentifiable ledger never falls back to raw legacy balances',
                     all(blocked[key] is not None and blocked[key]['valid'] is False and blocked[key]['effective'] is None
                         and blocked[key]['settlement'] is None for key in ('ar', 'bill', 'strict')), blocked)
        report.check(name + ': malformed projection renders a visible blocker rather than a numeric zero',
                     page.locator('[data-k30-invalid-proof] [role="alert"]').count() == 1
                     and '$0' not in page.locator('[data-k30-invalid-proof]').inner_text())
        report.check(name + ': malformed-snapshot presentation leaves real ledger and every durable layer untouched',
                     raw(page) == before_render and public(page) == original_state)
        report.save(name + '.json', {'compatibility': compatibility, 'malformedProjection': blocked})
        report.case(name)
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--browser', type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    store = (root / 'assets/js/erp-store.js').read_bytes()
    report = Report(args.output.resolve())
    report.data['schema'] = 'k30-real-ui-browser-v1'
    report.data['headCommit'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    report.data['sources'] = {path: hashlib.sha256((root / path).read_bytes()).hexdigest() for path in ['assets/js/erp-store.js', *STYLES, *SCRIPTS]}
    try:
        server = Server(store, root, extra=[*STYLES, *SCRIPTS])
        server.resources['/fixture.html'] = (HTML.encode('utf-8'), 'text/html; charset=utf-8')
        with server, sync_playwright() as playwright:
            executable = select_browser(args.browser)
            report.data['browserExecutable'] = executable or 'Playwright managed Chromium'
            browser = playwright.chromium.launch(headless=True, **({'executable_path': executable} if executable else {}))
            try:
                tasks = [(run_flow, (device, group, False)) for device in VIEWPORTS for group in (False, True)]
                tasks += [(run_flow, ('desktop', False, True))]
                tasks += [(run_refusal, (device, failure)) for device in VIEWPORTS for failure in ('cloud-prepare', 'receipt-arrived', 'owner-changed')]
                tasks += [(run_legacy_consumers, ('desktop', False)), (run_legacy_consumers, ('mobile', True))]
                for function, arguments in tasks:
                    try:
                        function(browser, server, report, *arguments)
                    except Exception as error:
                        report.data['failures'].append({'case': function.__name__, 'arguments': list(arguments), 'message': str(error), 'traceback': traceback.format_exc()})
                        report.flush()
                        traceback.print_exc()
            finally:
                browser.close()
        report.check('all UI browser requests stayed within exact owned loopback allowlist', not report.data['externalRequests'], report.data['externalRequests'])
        report.check('no unhandled UI page errors', not report.data['pageErrors'], report.data['pageErrors'])
        report.data['status'] = 'BLOCKED' if report.data['failures'] or any(not row['passed'] for row in report.data['checks']) else 'K30_ISOLATED_UI_PASS'
        return 0 if report.data['status'] == 'K30_ISOLATED_UI_PASS' else 1
    except Exception as error:
        report.data['status'] = 'BLOCKED'
        report.data['failures'].append({'message': str(error), 'traceback': traceback.format_exc()})
        traceback.print_exc()
        return 1
    finally:
        report.flush()
        print(json.dumps({key: report.data[key] for key in ('status', 'passCount', 'failCount', 'failures')}, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    raise SystemExit(main())
