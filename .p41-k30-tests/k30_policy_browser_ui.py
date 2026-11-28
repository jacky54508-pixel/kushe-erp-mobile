#!/usr/bin/env python3
"""Actual daily opt-in, full allocation, manual and legacy-term UI acceptance."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import traceback

from playwright.sync_api import sync_playwright

from k30_policy_browser_store import (ROOT, Report, Server, boot, raw, public, scopes,
    coherent_commit, preserve_history, invoke, save_daily, bill_sources, discount, select_browser)
from k30_policy_fixture import (HTML, PREFIX, DATE, OLD_DATE, PROJECT, EMPLOYEES,
    RATES, LEGACY_UNPAID, LEGACY_BILLS, terms, daily_values, legacy_payment_terms)

STYLES = ['assets/css/app.css', 'assets/css/commissions-scoped.css',
          'assets/css/daily-pay-compact.css', 'assets/css/daily-draft-review.css',
          'assets/css/project-billing-defaults.css', 'assets/css/receivables-scoped.css',
          'assets/css/receivable-cheques.css', 'assets/css/billing-groups.css']
SCRIPTS = ['assets/js/display-sort.js', 'assets/js/project-billing-defaults.js',
           'assets/js/daily-draft-review.js', 'assets/js/commission-agreement-ui.js',
           'assets/js/commissions.js', 'assets/js/billing-print.js',
           'assets/js/billing-bundle-print.js', 'assets/js/external-billing-invoice.js',
           'assets/js/external-billing-invoice-ui.js', 'assets/js/billing-allowance-ui.js',
           'assets/js/billing-groups.js', 'assets/js/billing.js']
VIEWPORTS = {'desktop': {'width': 1440, 'height': 1000},
             'mobile': {'width': 390, 'height': 844}}


def mount(page, server, report, name):
    before = raw(page)
    for path in STYLES:
        page.add_style_tag(url=server.origin + '/' + path)
    page.add_style_tag(content='.page-frame{margin-left:0!important}.page-frame>.view{padding:16px;min-width:0;max-width:100%}*{scroll-behavior:auto!important;animation:none!important;transition:none!important}')
    for path in SCRIPTS:
        page.add_script_tag(url=server.origin + '/' + path)
    page.evaluate("""()=>{document.querySelectorAll('.page-frame>.view').forEach(n=>n.style.setProperty('display','none','important'));
      document.getElementById('commissionsView').style.setProperty('display','block','important');
      document.body.dataset.route='commissions';KusheCommissions.activate()}""")
    page.locator('#commissionMonthFilter').fill(DATE[:7])
    page.locator('#commissionMonthFilter').dispatch_event('change')
    report.check(name + ': actual policy UI mounting does not change stored data', raw(page) == before)


def daily_form(page, agreed=True, amount=100000, date=DATE):
    page.locator('#addCommission').click()
    form = page.locator('#dailyWorkForm')
    form.wait_for(state='visible')
    form.locator('[name=date]').fill(date)
    for employee in EMPLOYEES:
        form.locator('[name=dailyEmployees][value="' + employee + '"]').check()
    for employee, rate in RATES.items():
        form.locator('[name=dailyCommissionRate][data-employee-id="' + employee + '"]').fill(str(rate))
    form.locator('.daily-house-project').select_option(PROJECT)
    form.locator('.daily-house-name').fill(PREFIX + 'UI-HOUSE')
    form.locator('.daily-house-name').dispatch_event('change')
    form.locator('.daily-line-choice').select_option('manual')
    form.locator('.daily-line-item').fill(PREFIX + 'UI-NEW-WORK')
    form.locator('.daily-line-price').fill(str(amount))
    form.locator('.daily-line-qty').fill('1')
    form.locator('[name=note]').fill(PREFIX + 'ACTUAL-UI-SAVE')
    panel = form.locator('[data-daily-commission-agreement][data-project-id="' + PROJECT + '"]')
    panel.wait_for(state='visible')
    if agreed:
        panel.locator('[data-agreement-enabled]').check()
        for key, value in terms().items():
            if key in ('policy', 'futureNewAgreementConfirmed'):
                continue
            panel.locator('[data-agreement-field="' + key + '"]').fill(value)
        panel.locator('[data-agreement-confirmed]').check()
    return form, panel


def submit_daily(page, report, name, form):
    before = raw(page)
    form.locator('button[type="submit"]').first.click()
    page.wait_for_function("()=>Boolean(document.querySelector('#dailyWorkForm')?.dataset.lastSavedBatch)")
    page.wait_for_function("()=>document.querySelector('#dailyWorkForm .daily-save-feedback')?.dataset.tone==='success'")
    after = coherent_commit(page, report, name, before, 'saveDailyBatch')
    batch = form.get_attribute('data-last-saved-batch')
    logs = [row for row in public(page)['dailyLogs'] if row.get('batchId') == batch]
    form.locator('[data-cancel]').click()
    form.wait_for(state='detached')
    return logs, after


def geometry(page, report, name):
    modal = page.locator('.ca-modal')
    dimensions = modal.evaluate('node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}}')
    report.check(name + ': actual policy dialog fits the viewport',
                 dimensions['left'] >= -1 and dimensions['right'] <= dimensions['width'] + 1
                 and dimensions['top'] >= -1 and dimensions['bottom'] <= dimensions['height'] + 1,
                 dimensions)
    report.check(name + ': policy dialog has an accessible name',
                 modal.get_attribute('role') == 'dialog' and modal.get_attribute('aria-modal') == 'true'
                 and bool(page.locator('#commissionAgreementTitle').inner_text().strip()))


def open_finalization(page, agreement_id):
    page.locator('#openCommissionAgreements').click()
    page.locator('[data-ca-finalize="' + agreement_id + '"]').click()
    page.locator('#commissionFinalizationForm').wait_for(state='visible')


def fill_finalization(page, allocations, key):
    form = page.locator('#commissionFinalizationForm')
    form.locator('[name=date]').fill(DATE)
    form.locator('[name=reference]').fill(PREFIX + key + '-APPROVAL')
    form.locator('[name=reason]').fill(PREFIX + key + '-FINAL-NET')
    for row in allocations:
        allocation = form.locator('[data-ca-allocation][data-billing-id="' + row['billingId']
                                  + '"][data-scope-key="' + row['scopeKey'] + '"]')
        allocation.locator('[data-ca-allocation-amount]').fill(str(row['untaxedAmount']))
        if row.get('approvalReference'):
            allocation.locator('[data-ca-allocation-reference]').fill(row['approvalReference'])
    return form


def review_finalization(page, report, name, allowed=True):
    before = raw(page)
    page.locator('[data-ca-preview]').click()
    page.locator('[data-ca-review]').wait_for(state='visible')
    page.wait_for_function("()=>!document.querySelector('[data-ca-preview]').disabled")
    report.check(name + ': actual preview is read-only and enables only an allowed confirmation',
                 raw(page) == before
                 and page.locator('#commissionFinalizationForm [name=confirmed]').is_enabled() is allowed)
    report.check(name + ': explicit final confirmation is required',
                 page.locator('[data-ca-final-post]').is_disabled())


def post_finalization(page, report, name, expected):
    form = page.locator('#commissionFinalizationForm')
    form.locator('[name=confirmed]').check()
    before = raw(page)
    form.locator('[data-ca-final-post]').click()
    page.wait_for_function("()=>KuSheERPStore.getState().meta.commissionFinalizations?.some(r=>r.eventType==='finalize')")
    form.wait_for(state='detached')
    report.check(name + ': successful finalization closes every policy editor and leaves no retry form',
                 page.locator('.ca-overlay').count() == 0 and page.locator('[data-ca-final-post]').count() == 0)
    after = coherent_commit(page, report, name, before, 'finalizeCommissionAgreements')
    rows = [row for row in public(page)['commissions'] if row.get('commissionFinalizationId')]
    report.check(name + ': actual clicks create the independently expected individual amounts',
                 {row['employee']: row['commission'] for row in rows} == expected, rows)
    report.check(name + ': finalization UI does not issue a payment or alter original daily records',
                 all(after['idb']['main'][key] == before['idb']['main'][key] for key in
                     ('dailyLogs', 'salaryPayments', 'commissionSettlements', 'banks', 'bankTransactions')))
    return after


def run_daily_ui(browser, server, report, device):
    name = 'policy-ui-daily-new-agreement-' + device
    context = browser.new_context(viewport=VIEWPORTS[device], is_mobile=device == 'mobile',
                                  has_touch=device == 'mobile', service_workers='block')
    try:
        page, initial = boot(context, server, report, name)
        mount(page, server, report, name)
        form, panel = daily_form(page)
        panel.locator('[data-agreement-field=workScope]').fill(PREFIX + 'UI-REVISED-WORK-SCOPE')
        report.check(name + ': editing agreed content invalidates previous opt-in confirmation',
                     not panel.locator('[data-agreement-confirmed]').is_checked())
        panel.locator('[data-agreement-confirmed]').check()
        draft = page.evaluate("()=>document.querySelector('#dailyWorkForm')._dailySubmitContext.readDraft()")
        report.check(name + ': actual daily form sends the explicit per-project agreement and frozen rates',
                     list(draft['commissionAgreementsByProject']) == [PROJECT]
                     and draft['commissionAgreementsByProject'][PROJECT]['futureNewAgreementConfirmed'] is True
                     and {key: float(value) for key, value in draft['commissionRates'].items()} == RATES)
        logs, _ = submit_daily(page, report, name, form)
        agreement = scopes(page, report, name)[0]
        report.check(name + ': actual daily UI creates estimates without formal commissions',
                     all(log['commission'] == 0 and log['estimatedCommission'] == (30000 if log['employee'] == EMPLOYEES[0] else 20000)
                         for log in logs)
                     and public(page)['commissions'] == initial['idb']['main']['commissions'])
        open_finalization(page, agreement['id'])
        fill_finalization(page, [{'billingId': '', 'scopeKey': agreement['scopeKey'],
                                 'untaxedAmount': 90000, 'approvalReference': PREFIX + 'UI-UNBILLED-APPROVAL'}], name)
        review_finalization(page, report, name)
        text = page.locator('[data-ca-review]').inner_text()
        report.check(name + ': review visibly shows approved net and each employee amount',
                     '$90,000' in text and '$27,000' in text and '$18,000' in text, text)
        geometry(page, report, name)
        page.screenshot(path=str(report.qa / (name + '-review.png')), full_page=False)
        post_finalization(page, report, name, dict(zip(EMPLOYEES, (27000, 18000))))
        page.locator('#openCommissionAgreements').click()
        report.check(name + ': explicit reopening shows finalized history rather than another submit',
                     '已核定' in page.locator('[data-ca-agreement="' + agreement['id'] + '"]').inner_text()
                     and page.locator('[data-ca-finalize="' + agreement['id'] + '"]').count() == 0)
        page.locator('[data-ca-close]').first.click()
        preserve_history(report, name, initial['idb']['main'], public(page))
        report.case(name)
    finally:
        context.close()


def run_backfill_ui(browser, server, report):
    name = 'policy-ui-mobile-historical-backfill-defaults-to-original-agreement'
    context = browser.new_context(viewport=VIEWPORTS['mobile'], is_mobile=True, has_touch=True, service_workers='block')
    try:
        page, initial = boot(context, server, report, name)
        mount(page, server, report, name)
        form, panel = daily_form(page, agreed=False, amount=20000, date=OLD_DATE)
        report.check(name + ': policy opt-in is initially unchecked',
                     not panel.locator('[data-agreement-enabled]').is_checked())
        logs, _ = submit_daily(page, report, name, form)
        report.check(name + ': late input saves original formula and creates no policy record',
                     all(not row.get('commissionAgreementId')
                         and row['commission'] == (6000 if row['employee'] == EMPLOYEES[0] else 4000) for row in logs)
                     and not public(page)['meta'].get('commissionAgreements'))
        preserve_history(report, name, initial['idb']['main'], public(page))
        report.case(name)
    finally:
        context.close()


def run_manual_ui(browser, server, report):
    name = 'policy-ui-manual-agreement-explicit-create-then-finalize'
    context = browser.new_context(viewport=VIEWPORTS['desktop'], service_workers='block')
    try:
        page, initial = boot(context, server, report, name)
        mount(page, server, report, name)
        page.locator('#manualCommission').click()
        page.locator('[data-manual-new-agreement]').click()
        form = page.locator('#commissionAgreementManualForm')
        form.wait_for(state='visible')
        form.locator('[name=projectId]').select_option(PROJECT)
        values = {'workDate': DATE, 'workScope': PREFIX + 'UI-MANUAL-INDEPENDENT-WORK',
                  'originalUntaxedAmount': '100000', 'reference': PREFIX + 'UI-MANUAL-AGREEMENT',
                  'agreedDate': DATE, 'startDate': DATE, 'agreedDueDate': DATE,
                  'paymentTerms': PREFIX + 'UI-AGREED-PAYMENT-DATE'}
        for key, value in values.items():
            form.locator('[name="' + key + '"]').fill(value)
        for employee, rate in RATES.items():
            person = form.locator('[data-ca-manual-person="' + employee + '"]')
            person.locator('[data-ca-person-selected]').check()
            person.locator('[data-ca-person-rate]').fill(str(rate))
        form.locator('[name=futureNewAgreementConfirmed]').check()
        before_review = raw(page)
        form.locator('[data-ca-manual-review]').click()
        report.check(name + ': manual agreement review is read-only', raw(page) == before_review)
        geometry(page, report, name)
        form.locator('[data-ca-manual-create]').click()
        form.wait_for(state='detached')
        report.check(name + ': agreement save closes the editor for cloud synchronization',
                     page.locator('.ca-overlay').count() == 0)
        coherent_commit(page, report, name, before_review, 'createCommissionAgreement')
        agreement = scopes(page, report, name)[0]
        report.check(name + ': manual save creates only an agreement, never wages or bank payments',
                     public(page)['commissions'] == initial['idb']['main']['commissions']
                     and public(page)['bankTransactions'] == initial['idb']['main']['bankTransactions'])
        open_finalization(page, agreement['id'])
        fill_finalization(page, [{'billingId': '', 'scopeKey': agreement['scopeKey'],
                                 'untaxedAmount': 90000, 'approvalReference': PREFIX + 'UI-MANUAL-FINAL'}], name)
        review_finalization(page, report, name)
        post_finalization(page, report, name, dict(zip(EMPLOYEES, (27000, 18000))))
        preserve_history(report, name, initial['idb']['main'], public(page))
        report.case(name)
    finally:
        context.close()


def run_matrix_ui(browser, server, report):
    name = 'policy-ui-mobile-entire-mixed-source-allocation'
    context = browser.new_context(viewport=VIEWPORTS['mobile'], is_mobile=True, has_touch=True, service_workers='block')
    try:
        page, initial = boot(context, server, report, name)
        _, logs, agreements = save_daily(page, report, name, daily_values(amount=60000))
        _, old_logs, _ = save_daily(page, report, name + '-legacy', daily_values(False, amount=40000))
        old_commissions = [row for row in public(page)['commissions'] if row.get('sourceId') in {log['id'] for log in old_logs}]
        bill = bill_sources(page, report, name + '-BILL', [(logs[0], 0), (old_logs[0], 0)])
        discount(page, report, name, bill['id'],
                 {'untaxed': 10000, 'tax': 500, 'grossTotal': 10500, 'retention': 0, 'receivable': 10500},
                 [legacy_payment_terms(row['id']) for row in old_commissions])
        mount(page, server, report, name)
        agreement = agreements[0]
        open_finalization(page, agreement['id'])
        rows = page.locator('[data-ca-allocation]')
        report.check(name + ': whole mixed bill exposes both new and legacy manual allocation rows',
                     rows.count() == 2 and all(rows.nth(i).locator('[data-ca-allocation-amount]').input_value() == '' for i in range(2)))
        allocation = [{'billingId': bill['id'], 'scopeKey': agreement['scopeKey'], 'untaxedAmount': 54000},
                      {'billingId': bill['id'], 'scopeKey': 'daily:' + old_logs[0]['groupId'], 'untaxedAmount': 35000}]
        fill_finalization(page, allocation, name)
        review_finalization(page, report, name + '-incorrect-total', allowed=False)
        allocation[1]['untaxedAmount'] = 36000
        fill_finalization(page, allocation, name)
        review_finalization(page, report, name)
        geometry(page, report, name)
        page.screenshot(path=str(report.qa / (name + '-review.png')), full_page=False)
        before = public(page)
        post_finalization(page, report, name, dict(zip(EMPLOYEES, (16200, 10800))))
        report.check(name + ': legacy source commissions remain identical after full matrix UI submission',
                     all(next(r for r in public(page)['commissions'] if r['id'] == row['id']) == row
                         for row in before['commissions']))
        preserve_history(report, name, initial['idb']['main'], public(page))
        report.case(name)
    finally:
        context.close()


def run_legacy_terms_ui(browser, server, report):
    name = 'policy-ui-explicit-legacy-terms-post-and-reverse-close-editors'
    context = browser.new_context(viewport=VIEWPORTS['desktop'], service_workers='block')
    try:
        page, initial = boot(context, server, report, name)
        mount(page, server, report, name)
        page.evaluate("""()=>{KusheCommissions.deactivate();document.getElementById('commissionsView').style.setProperty('display','none','important');
          document.getElementById('billingsView').style.setProperty('display','block','important');
          document.body.dataset.route='billings';KusheBilling.activate()}""")
        page.locator('#billingMonthFilter').fill('2026-04')
        page.locator('#billingMonthFilter').dispatch_event('change')
        entry = page.locator('[data-billing-discount-readonly="' + LEGACY_BILLS[1] + '"]:visible')
        entry.click()
        form = page.locator('#billingAllowanceForm')
        form.locator('[name=date]').fill(DATE)
        form.locator('[name=reference]').fill(PREFIX + 'UI-LEGACY-DISCOUNT')
        form.locator('[name=reason]').fill(PREFIX + 'UI-LEGACY-CUSTOMER-AGREEMENT')
        form.locator('[name=approvedGrossReduction]').fill('2100')
        reductions = {'untaxed': 2000, 'tax': 100, 'grossTotal': 2100, 'retention': 105, 'receivable': 1995}
        for key, value in reductions.items():
            form.locator('[data-reduction="' + key + '"]').fill(str(value))
        form.locator('[data-allowance-preview]').click()
        page.wait_for_function("()=>!document.querySelector('[data-allowance-preview]').disabled")
        legacy = form.locator('[data-legacy-payment-terms="' + LEGACY_UNPAID + '"]')
        legacy.wait_for(state='visible')
        report.check(name + ': old wages require an explicit unselected payment agreement',
                     legacy.locator('[data-legacy-terms-mode]').input_value() == ''
                     and form.locator('[name=confirmed]').is_disabled())
        legacy.locator('[data-legacy-terms-mode]').select_option('agreed-date')
        legacy.locator('[data-legacy-terms-date]').fill(DATE)
        legacy.locator('[data-legacy-terms-reference]').fill(PREFIX + 'UI-VERIFIED-OLD-TERMS')
        legacy.locator('[data-legacy-terms-confirmed]').check()
        form.locator('[data-allowance-preview]').click()
        page.wait_for_function("()=>!document.querySelector('[data-allowance-preview]').disabled")
        form.locator('[name=confirmed]').check()
        before = raw(page)
        form.locator('[data-allowance-post]').click()
        page.wait_for_function("()=>KuSheERPStore.getState().meta.billingAllowances?.length===1")
        form.wait_for(state='detached')
        coherent_commit(page, report, name, before, 'postBillingAllowance')
        report.check(name + ': successful post leaves no open allowance editor',
                     page.locator('.billing-allowance-overlay').count() == 0)
        terms_saved = public(page)['meta']['commissionPaymentTerms']
        event = public(page)['meta']['billingAllowances'][0]
        entry.click()
        page.locator('[data-allowance-reverse="' + event['id'] + '"]').click()
        form = page.locator('#billingAllowanceForm')
        form.locator('[name=date]').fill(DATE)
        form.locator('[name=reference]').fill(PREFIX + 'UI-LEGACY-REVERSAL')
        form.locator('[name=reason]').fill(PREFIX + 'UI-REVERSE-CUSTOMER-DISCOUNT')
        report.check(name + ': reversal reuses saved terms without asking for a replacement agreement',
                     form.locator('[data-legacy-payment-terms]').count() == 0)
        form.locator('[data-allowance-preview]').click()
        page.wait_for_function("()=>!document.querySelector('[data-allowance-preview]').disabled")
        form.locator('[name=confirmed]').check()
        before = raw(page)
        form.locator('[data-allowance-post]').click()
        page.wait_for_function("()=>KuSheERPStore.getState().meta.billingAllowances?.length===2")
        form.wait_for(state='detached')
        coherent_commit(page, report, name, before, 'reverseBillingAllowance')
        report.check(name + ': reversal closes editor and preserves original terms amount and payment',
                     page.locator('.billing-allowance-overlay').count() == 0
                     and public(page)['meta']['commissionPaymentTerms'] == terms_saved
                     and all(public(page)[key] == initial['idb']['main'][key] for key in
                         ('commissions', 'payroll', 'salaryPayments', 'commissionSettlements', 'banks', 'bankTransactions')))
        preserve_history(report, name, initial['idb']['main'], public(page))
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
    source = (root / 'assets/js/erp-store.js').read_bytes()
    report = Report(args.output.resolve())
    report.data.update(schema='k30-policy-real-ui-browser-v1',
                       headCommit=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
                       sources={path: hashlib.sha256((root / path).read_bytes()).hexdigest()
                                for path in ['assets/js/erp-store.js', *STYLES, *SCRIPTS]})
    try:
        server = Server(source, root, extra=[*STYLES, *SCRIPTS])
        server.resources['/fixture.html'] = (HTML.encode('utf-8'), 'text/html; charset=utf-8')
        with server, sync_playwright() as playwright:
            executable = select_browser(args.browser)
            report.data['browserExecutable'] = executable or 'Playwright managed Chromium'
            browser = playwright.chromium.launch(headless=True, **({'executable_path': executable} if executable else {}))
            try:
                tasks = [(run_daily_ui, (device,)) for device in VIEWPORTS]
                tasks += [(run_backfill_ui, ()), (run_manual_ui, ()), (run_matrix_ui, ()), (run_legacy_terms_ui, ())]
                for function, arguments in tasks:
                    try:
                        function(browser, server, report, *arguments)
                    except Exception as error:
                        report.data['failures'].append({'case': function.__name__, 'arguments': list(arguments),
                                                        'message': str(error), 'traceback': traceback.format_exc()})
                        report.flush()
                        traceback.print_exc()
            finally:
                browser.close()
        report.check('policy UI made no request outside the exact owned loopback resources',
                     not report.data['externalRequests'], report.data['externalRequests'])
        report.check('policy UI raised no unhandled page error', not report.data['pageErrors'], report.data['pageErrors'])
        report.data['status'] = 'BLOCKED' if report.data['failures'] or any(not row['passed'] for row in report.data['checks']) else 'K30_POLICY_UI_PASS'
        return 0 if report.data['status'] == 'K30_POLICY_UI_PASS' else 1
    except Exception as error:
        report.data['status'] = 'BLOCKED'
        report.data['failures'].append({'message': str(error), 'traceback': traceback.format_exc()})
        return 1
    finally:
        report.flush()
        print(json.dumps({key: report.data[key] for key in ('status', 'passCount', 'failCount', 'failures')},
                         ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    raise SystemExit(main())
