"""P39-3 isolated browser regression. Synthetic DOM only, no ERP credentials or cloud."""
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8796/p39-candidate/sandbox.html"

def snapshot(page):
    return page.evaluate("window.__p393SyntheticTest.snapshot()")

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1250, "height": 920})
        page = ctx.new_page()
        page_errors = []
        external = []
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.on("request", lambda r: external.append(r.url)
                if not r.url.startswith("http://127.0.0.1:8796/") else None)
        page.goto(URL)
        page.wait_for_function("!!window.__p393SyntheticTest")
        before = snapshot(page)
        assert before["meta"]["revision"] == 1
        assert len(before["billingAllowances"]) == 0
        assert before["billings"][0]["grossTotal"] == 105000

        # Standalone note editor must not touch accounting arrays.
        page.locator('#noteForm [name="note"]').fill("虛構核定備註")
        page.locator('#noteForm button[type="submit"]').click()
        note = snapshot(page)
        assert note["billings"][0]["note"] == "虛構核定備註"
        assert note["billingNoteRevisions"][0]["before"] == "原虛構備註"
        for key in ("receivables", "invoices", "bankTransactions", "commissions",
                    "payroll", "receipts", "retentionReceipts"):
            assert note[key] == before[key], key

        # Preview may not change the state.
        page.locator("#preview").click()
        assert snapshot(page) == note
        assert "未進行任何入帳" in page.locator("#message").inner_text()

        # Candidate write is isolated to a synthetic ledger.
        page.locator('#allowanceForm button[type="submit"]').click()
        after = snapshot(page)
        assert len(after["billingAllowances"]) == 1
        assert after["billingAllowances"][0]["discount"]["gross"] == 10500
        assert after["billingAllowances"][0]["productionAuthorized"] is False
        assert after["billings"][0]["grossTotal"] == 105000
        assert after["receivables"] == before["receivables"]
        assert after["invoices"] == before["invoices"]
        assert after["bankTransactions"] == before["bankTransactions"]
        assert "正式 ERP 沒有新增資料" in page.locator("#message").inner_text()
        page.locator('#allowanceForm button[type="submit"]').click()
        assert len(snapshot(page)["billingAllowances"]) == 1
        assert "ALLOWANCE_ALREADY_EXISTS" in page.locator("#message").inner_text()

        # Issued invoice requires a synthetic voucher; originals remain unchanged.
        page.locator("#invoiceStatus").select_option("invoiced")
        issued_before = snapshot(page)
        page.locator('#allowanceForm button[type="submit"]').click()
        issued_after = snapshot(page)
        assert issued_after["invoices"] == issued_before["invoices"]
        assert issued_after["billingAllowances"][0]["voucher"]["synthetic"] is True
        assert issued_after["billingAllowances"][0]["invoiceNo"] == "SYN-INV-0001"
        # No invoice mode never fabricates a tax amount.
        page.locator("#invoiceStatus").select_option("no_invoice")
        page.locator('#allowanceForm button[type="submit"]').click()
        no_invoice = snapshot(page)
        assert no_invoice["billingAllowances"][0]["discount"]["tax"] == 0
        assert no_invoice["invoices"] == []

        # No browser persistence: refreshing loses all revisions and allowances.
        page.reload()
        page.wait_for_function("!!window.__p393SyntheticTest")
        clean = snapshot(page)
        assert clean["meta"]["revision"] == 1
        assert clean["billingAllowances"] == []
        assert clean["billingNoteRevisions"] == []
        assert not external, external
        assert not page_errors, page_errors
        ctx.close()
        browser.close()
    print("PASS: synthetic note, allowance, issued/no-invoice, duplicate, reset, no external requests")

if __name__ == "__main__":
    main()
