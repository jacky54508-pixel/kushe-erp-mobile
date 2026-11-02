"""Retain strict HTTP-contract failures, but complete independent safety cases.
No production code and no weakening of failed closed authentication requirements.
"""
from pathlib import Path
import hashlib, ast
p=Path('.p32-3-isolation/lab/backend_probe.py')
s=p.read_text()
assert hashlib.sha256(s.encode()).hexdigest()=='c87c1d12e3e8bb6ae8bb83811bc76f5a81090d979b5df26605e8a95bda51bbab'
changes={
 "def check(name: str, okay: bool):":"def check(name: str, okay: bool, *, fatal: bool = True):",
 "    if not okay:\n        raise AssertionError(name)":"    if not okay and fatal:\n        raise AssertionError(name)",
 "        lower=login()['access_token']\n        check('fresh_login_still_requires_second_factor'":"        pending=login()\n        lower=pending['access_token']\n        check('fresh_login_still_requires_second_factor'",
 "        def signed(t):":"        server_expiry={}\n        def signed(t):",
 "            w=c['webauthn']; flow=w['type']; opts=w['credential_options']":"            server_expiry[c['id']]=int(c.get('expires_at') or 0)\n            w=c['webauthn']; flow=w['type']; opts=w['credential_options']",
 "        time.sleep(16)":'''        delay=server_expiry[expired['challenge_id']]-time.time()+2
        check('server_expiry_deadline_bounded',0<delay<=310)
        RESULTS.append({'diagnostic':'expiry_uses_server_deadline','wait_seconds':round(delay,1)})
        time.sleep(delay)''',
 "        bad=signed(lower)":'''        def reject_without_elevation(name, payload):
            nonlocal pending, lower
            code, response = verify(lower, payload)
            machine = str(response.get('error_code') or response.get('code') or '')
            RESULTS.append({'diagnostic':name,'http_status':code,'error_code':machine if len(machine)<100 and all(c.isalnum() or c in '_-' for c in machine) else 'redacted'})
            check(name+'_no_session_issued',400<=code<600 and not response.get('access_token') and not response.get('refresh_token') and not response.get('session'))
            # Keep the original expected 4xx contract as a failure if the service returns 500.
            # Do NOT silently relabel a server error as a normal authentication rejection.
            check(name,code in (400,401,403,404,422),fatal=False)
            renewed=require_ok(name+'_check_server_session',api('/token?grant_type=refresh_token',{'refresh_token':pending['refresh_token']}))
            c=jwt_claims(renewed['access_token'])
            check(name+'_still_aal1',c['sub']==subject and c['aal']=='aal1')
            pending=renewed;lower=renewed['access_token']
        bad=signed(lower)''',
 "        check('invalid_signature_rejected',verify(lower,bad)[0] in (400,401,403,404,422))":"        reject_without_elevation('invalid_signature_rejected',bad)",
 "        check('tampered_origin_rejected',verify(lower,wrong)[0] in (400,401,403,404,422))":"        reject_without_elevation('tampered_origin_rejected',wrong)",
 "        check('expired_challenge_rejected',verify(lower,expired)[0] in (400,401,403,404,422))":"        reject_without_elevation('expired_challenge_rejected',expired)",
 "        run();outcome='PASS'":"        run();outcome='FAILED_HTTP_CONTRACT' if any(v.get('passed') is False for v in RESULTS) else 'PASS'",
}
for old,new in changes.items():
    assert s.count(old)==1,old
    s=s.replace(old,new)
ast.parse(s)
p.write_text(s)
print('Prepared isolated probe with unchanged strict HTTP expectations; source SHA256='+hashlib.sha256(s.encode()).hexdigest())
