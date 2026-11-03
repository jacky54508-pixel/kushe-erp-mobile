from playwright.sync_api import sync_playwright

URL="http://127.0.0.1:8796/.p36-tests/navigation.html"

def main():
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        page=browser.new_page()
        errors=[]
        page.on("pageerror",lambda e:errors.append(str(e)))
        page.goto(URL)
        page.wait_for_function("() => document.querySelector('#appShell')?.hidden === false && document.body.dataset.route === 'dashboard'")
        assert not errors, errors
        state=page.evaluate("() => ({ctx:window.__p36.ctx?.role,view:window.KusheAuthGate.canView('billings'),load:window.__p36.loadCount})")
        assert state["ctx"]=="owner" and state["view"] is True and state["load"]==1, state
        # Legitimate owner navigation, no revalidation needed.
        page.locator("#quickBilling").click()
        page.wait_for_function("() => document.body.dataset.route === 'billings'")
        assert not errors, errors

        # Simulate missing in-memory membership, while the original signed-in principal is still valid.
        page.evaluate("() => {window.__p36.ctx=null;window.__p36.permissionRefreshes=0;}")
        page.locator("#quickEmployee").click()
        page.wait_for_function("() => document.body.dataset.route === 'employees' && window.__p36.ctx?.role==='owner'")
        recovered=page.evaluate("() => ({refresh:window.__p36.permissionRefreshes,visible:!document.querySelector('#appShell').hidden,load:window.__p36.loadCount,toasts:[...document.querySelectorAll('#toastHost .toast')].map(x=>x.textContent)})")
        assert recovered["refresh"]==1 and recovered["visible"] and recovered["load"]==1,recovered
        assert not any("沒有此功能的查看權限" in t for t in recovered["toasts"]),recovered

        # Several click events while context has dropped: only a single revalidation may be issued.
        page.evaluate("() => {window.__p36.ctx=null;window.__p36.permissionRefreshes=0;document.querySelector('#quickBilling').click();document.querySelector('#quickEmployee').click();}")
        page.wait_for_function("() => document.body.dataset.route === 'employees' && window.__p36.ctx?.role==='owner'")
        assert page.evaluate("() => window.__p36.permissionRefreshes")==1

        # After server-verified accounting role, a forbidden module must remain denied.
        page.evaluate("() => {window.__p36.requestedRole='accounting';window.__p36.ctx=null;}")
        page.locator("#quickBilling").click()
        page.wait_for_function("() => window.__p36.ctx?.role === 'accounting'")
        assert page.locator('a[data-module="employees"]').is_hidden()
        page.evaluate("() => window.KushePhase1.navigate('employees')")
        restricted=page.evaluate("() => ({route:document.body.dataset.route,allowed:window.KusheAuthGate.canView('employees'),toasts:[...document.querySelectorAll('#toastHost .toast')].map(x=>x.textContent)})")
        assert restricted["route"]!="employees" and not restricted["allowed"],restricted
        assert any("沒有此功能的查看權限" in t for t in restricted["toasts"]),restricted

        # If the server says this is an ordinary employee (not the original ERP account),
        # never revive the full ERP shell despite the earlier owner-looking dashboard.
        page.evaluate("() => {window.__p36.requestedRole='employee';window.__p36.ctx=null;}")
        page.evaluate("() => document.querySelector('#quickBilling').click()")
        page.wait_for_function("() => document.querySelector('#appShell').hidden && document.querySelector('#loginError').textContent.includes('不是完整 ERP')")
        employee=page.evaluate("() => ({appHidden:document.querySelector('#appShell').hidden,role:window.__p36.ctx?.role})")
        assert employee["appHidden"] and employee["role"]=="employee",employee

        # Reset to owner only in test harness. Missing session must fail closed to login.
        page.evaluate("() => {window.__p36.requestedRole='owner';window.__p36.ctx={userId:'test-owner',role:'owner',legacySourceUserId:'test-owner',status:'active',shadowVerified:true};window.KushePhase1.navigate('dashboard');window.__p36.ctx=null;window.__p36.alive=false;}")
        page.evaluate("() => document.querySelector('#quickBilling').click()")
        page.wait_for_function("() => document.querySelector('#appShell').hidden && document.querySelector('#loginError').textContent.includes('登入')")
        last=page.evaluate("() => ({appHidden:document.querySelector('#appShell').hidden,loginVisible:!document.querySelector('#loginView').hidden,loadCount:window.__p36.loadCount,commits:window.__p36.commits})")
        assert last["appHidden"] and last["loginVisible"] and last["loadCount"]==1 and last["commits"]==0,last
        assert not errors,errors
        browser.close()
    print("P36 PERMISSION REVALIDATION PASS: owner context recovery, permission preservation, employee denial, expired login, singleflight and no Store writes")

if __name__=="__main__":
    main()
