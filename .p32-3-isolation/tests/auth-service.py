"""P32-3: real upstream Auth service, EMPTY ephemeral database, virtual device.
NOT a hosted-tenant or Face ID/Windows Hello test. Never load the ERP app/Store.
All HTTP requests are restricted to loopback Auth paths. No production config.
"""
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import base64, copy, hashlib, hmac, json, os, re, secrets, struct, subprocess, tempfile, time
import jwt
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
E = ROOT / 'evidence'; E.mkdir(exist_ok=True)
BASE = 'http://127.0.0.1:19999'
ORIGIN = 'https://kushe-auth-service-lab.test'
RP = 'kushe-auth-service-lab.test'
AUTH_IMAGE = 'supabase/gotrue:v2.197.0'
PG_IMAGE = 'postgres:17.6-alpine'
SUFFIX = secrets.token_hex(4)
NET, PG, AUTH = ['p32-3-' + x + '-' + SUFFIX for x in ('net', 'pg', 'auth')]
SECRET = secrets.token_urlsafe(48)
PASSWORD = secrets.token_urlsafe(32)
DB_PASSWORD = secrets.token_hex(24)
checks, journal, forbidden, image_ids = [], [], [], {}
browser_requests, browser_denied = [], []

def check(name, yes):
    if not any(x['name'] == name for x in checks) or not yes:
        checks.append({'name': name, 'pass': bool(yes)})
    if not yes: raise AssertionError(name)

def sh(args, okay=True):
    p = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
    if okay and p.returncode: raise RuntimeError('Subprocess failed: ' + ' '.join(args[:3]))
    return p.stdout.strip()

def sql(text):
    return sh(['docker','exec',PG,'psql','-U','lab','-d','lab','-Atc',text])

def call(method, path, body=None, token=None, want=None):
    allowed = re.fullmatch(r'/health|/signup|/user|/token\?grant_type=(password|refresh_token)|/logout|/factors(?:/[0-9a-f-]{36}(?:/(challenge|verify))?)?', path)
    if not allowed:
        forbidden.append(path); raise RuntimeError('Auth-path allowlist violation')
    headers={'Content-Type':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    req=Request(BASE+path, data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
    try:
        with urlopen(req,timeout=10) as r: status=r.status; raw=r.read()
    except HTTPError as e: status=e.code;raw=e.read()
    try: value=json.loads(raw)
    except Exception: value={}
    journal.append({'method':method,'path':re.sub('[0-9a-f]{8}-[0-9a-f-]{27}','{synthetic-factor}',path),'status':status,'error_code':value.get('error_code') if isinstance(value,dict) else None})
    if want is not None and status != want:
        raise AssertionError('Unexpected HTTP '+str(status)+' for '+method+' '+path.split('?')[0]+'; code='+str(value.get('error_code','')))
    return status,value

def claims(session):
    return jwt.decode(session['access_token'],SECRET,algorithms=['HS256'],audience='authenticated',issuer='http://localhost:19999')

def session_check(name, session, level, user_id=None):
    c=claims(session)
    status,user=call('GET','/user',token=session['access_token'],want=200)
    check(name,c.get('aal')==level and c.get('sub')==user['id'] and (user_id is None or user['id']==user_id))
    return user

def login(email):
    return call('POST','/token?grant_type=password',{'email':email,'password':PASSWORD},want=200)[1]

def code(secret):
    key=base64.b32decode(secret+'='*((8-len(secret)%8)%8))
    d=hmac.new(key,struct.pack('>Q',int(time.time())//30),hashlib.sha1).digest();o=d[-1]&15
    return str((struct.unpack('>I',d[o:o+4])[0]&0x7fffffff)%1000000).zfill(6)

def totp_verify(session, factor, secret):
    challenge=call('POST','/factors/'+factor+'/challenge',{},session['access_token'],200)[1]
    return call('POST','/factors/'+factor+'/verify',{'challenge_id':challenge['id'],'code':code(secret)},session['access_token'],200)[1]

def reject(name, response):
    status,data=response
    check(name,status>=400 and not data.get('access_token') and not data.get('refresh_token'))

def b64(raw): return base64.urlsafe_b64encode(raw).decode().rstrip('=')
def unb64(s): return base64.urlsafe_b64decode(s+'='*((4-len(s)%4)%4))

try:
    # Fetch only public software; no organization or project credentials supplied.
    for image in (AUTH_IMAGE, PG_IMAGE):
        sh(['docker','pull',image]); image_ids[image]=json.loads(sh(['docker','image','inspect',image,'--format','{{json .RepoDigests}}']))
    sh(['docker','network','create','--internal',NET])
    with tempfile.TemporaryDirectory(prefix='p32-3-auth-') as temp:
        pg_env=Path(temp)/'postgres.env';pg_env.write_text('POSTGRES_USER=lab\nPOSTGRES_DB=lab\nPOSTGRES_PASSWORD='+DB_PASSWORD+'\n');os.chmod(pg_env,0o600)
        sh(['docker','run','-d','--name',PG,'--network',NET,'--network-alias','lab-db','--env-file',str(pg_env),PG_IMAGE])
        for _ in range(45):
            if sh(['docker','exec',PG,'pg_isready','-U','lab','-d','lab'],okay=False).endswith('accepting connections'):break
            time.sleep(1)
        check('Fresh isolated database has no public business tables',sql("select count(*) from pg_tables where schemaname='public'")=='0')
        env={
          'GOTRUE_API_HOST':'0.0.0.0','GOTRUE_API_PORT':'9999','PORT':'9999',
          'API_EXTERNAL_URL':'http://localhost:19999','GOTRUE_SITE_URL':ORIGIN,
          'GOTRUE_DB_DRIVER':'postgres','DATABASE_URL':'postgres://lab:'+DB_PASSWORD+'@lab-db:5432/lab?sslmode=disable',
          'GOTRUE_DB_DATABASE_URL':'postgres://lab:'+DB_PASSWORD+'@lab-db:5432/lab?sslmode=disable',
          'DB_NAMESPACE':'auth','GOTRUE_DB_NAMESPACE':'auth',
          'GOTRUE_JWT_SECRET':SECRET,'GOTRUE_JWT_EXP':'3600','GOTRUE_JWT_AUD':'authenticated',
          'GOTRUE_JWT_DEFAULT_GROUP_NAME':'authenticated','GOTRUE_JWT_ADMIN_ROLES':'service_role',
          'GOTRUE_JWT_ISSUER':'http://localhost:19999',
          'GOTRUE_DISABLE_SIGNUP':'false','GOTRUE_EXTERNAL_EMAIL_ENABLED':'true','GOTRUE_MAILER_AUTOCONFIRM':'true',
          'GOTRUE_EXTERNAL_PHONE_ENABLED':'false','GOTRUE_RATE_LIMIT_EMAIL_SENT':'100',
          'GOTRUE_MFA_WEB_AUTHN_ENROLL_ENABLED':'true','GOTRUE_MFA_WEB_AUTHN_VERIFY_ENABLED':'true',
          'GOTRUE_MFA_TOTP_ENROLL_ENABLED':'true','GOTRUE_MFA_TOTP_VERIFY_ENABLED':'true',
          'GOTRUE_MFA_RATE_LIMIT_CHALLENGE_AND_VERIFY':'1000','GOTRUE_MFA_CHALLENGE_EXPIRY_DURATION':'10',
          'GOTRUE_WEBAUTHN_RP_ID':RP,'GOTRUE_WEBAUTHN_RP_DISPLAY_NAME':'Isolated Synthetic Auth Lab',
          'GOTRUE_WEBAUTHN_RP_ORIGINS':ORIGIN,
          'GOTRUE_MAILER_NOTIFICATIONS_MFA_FACTOR_ENROLLED_ENABLED':'false',
          'GOTRUE_MAILER_NOTIFICATIONS_MFA_FACTOR_UNENROLLED_ENABLED':'false',
          'GOTRUE_LOG_LEVEL':'error'
        }
        auth_env=Path(temp)/'auth.env';auth_env.write_text(''.join(k+'='+v+'\n' for k,v in env.items()));os.chmod(auth_env,0o600)
        sh(['docker','run','-d','--name',AUTH,'--network',NET,'-p','127.0.0.1:19999:9999','--env-file',str(auth_env),AUTH_IMAGE])
        healthy=None
        for _ in range(45):
            try:
                status,healthy=call('GET','/health')
                if status==200:break
            except (URLError,TimeoutError): pass
            time.sleep(1)
        check('Real official Auth service is ready',bool(healthy) and status==200)
        check('Pinned Auth version is v2.197.0','2.197.0' in str(healthy.get('version','')))
        image_ids['health_version']=healthy.get('version')
        email='p32-3-'+secrets.token_hex(6)+'@example.test'
        s=call('POST','/signup',{'email':email,'password':PASSWORD},want=200)[1]
        u=session_check('Password registration is server-verified AAL1',s,'aal1');uid=u['id']
        check('Exactly one synthetic account, zero public business tables',sql('select count(*) from auth.users')=='1' and sql("select count(*) from pg_tables where schemaname='public'")=='0')
        f=call('POST','/factors',{'factor_type':'totp','friendly_name':'Synthetic backup TOTP'},s['access_token'],200)[1]
        totp_id,totp_secret=f['id'],f['totp']['secret']
        s2=totp_verify(s,totp_id,totp_secret)
        session_check('Real TOTP verification establishes existing AAL2',s2,'aal2',uid)
        low=login(email)
        reject('AAL1 cannot add another factor after TOTP enrollment',call('POST','/factors',{'factor_type':'webauthn','friendly_name':'Blocked lower assurance'},low['access_token']))
        wf=call('POST','/factors',{'factor_type':'webauthn','friendly_name':'Synthetic virtual platform'},s2['access_token'],200)[1];wid=wf['id']
        challenge=call('POST','/factors/'+wid+'/challenge',{},s2['access_token'],200)[1]
        check('Server produces WebAuthn enrollment options',challenge['webauthn']['type']=='create' and challenge['webauthn']['credential_options']['publicKey']['rp']['id']==RP)
        with sync_playwright() as p:
            browser=p.chromium.launch(headless=True)
            ctx=browser.new_context(service_workers='block')
            def route(r):
                browser_requests.append(r.request.url)
                if r.request.url==ORIGIN+'/':return r.fulfill(status=200,content_type='text/html',body='<title>P32-3 synthetic authentication only</title>')
                browser_denied.append(r.request.url);r.abort()
            ctx.route('**/*',route);page=ctx.new_page();page.goto(ORIGIN+'/')
            page.evaluate("""() => {
                const deny=()=>{throw new Error('ERP/application access prohibited')};
                for(const name of ['localStorage','sessionStorage'])Object.defineProperty(window,name,{value:{getItem:deny,setItem:deny,removeItem:deny,clear:deny}});
                Object.defineProperty(window,'indexedDB',{value:{open:deny,deleteDatabase:deny}});
                window.fetch=deny;window.XMLHttpRequest=deny;window.WebSocket=deny;
                window.bytes=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
                window.b64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/=/g,'').replace(/\\+/g,'-').replace(/\\//g,'_');
                window.pack=c=>({id:c.id,rawId:b64(c.rawId),type:c.type,authenticatorAttachment:c.authenticatorAttachment,clientExtensionResults:c.getClientExtensionResults(),response:Object.fromEntries(['clientDataJSON','attestationObject','authenticatorData','signature','userHandle'].filter(k=>c.response[k]).map(k=>[k,b64(c.response[k])]))});
            }""")
            cd=ctx.new_cdp_session(page);cd.send('WebAuthn.enable')
            dev=cd.send('WebAuthn.addVirtualAuthenticator',{'options':{'protocol':'ctap2','transport':'internal','hasResidentKey':True,'hasUserVerification':True,'isUserVerified':True,'automaticPresenceSimulation':True}})['authenticatorId']
            create="""async o=>{const pk=o.publicKey;pk.challenge=bytes(pk.challenge);pk.user.id=bytes(pk.user.id);pk.excludeCredentials=(pk.excludeCredentials||[]).map(x=>({...x,id:bytes(x.id)}));pk.authenticatorSelection={authenticatorAttachment:'platform',residentKey:'preferred',userVerification:'required'};pk.attestation='none';pk.timeout=8000;if(!pk.user.name)pk.user.name='synthetic@example.test';if(!pk.user.displayName)pk.user.displayName='Synthetic user';return pack(await navigator.credentials.create({publicKey:pk}));}"""
            get="""async o=>{const pk=o.publicKey;pk.challenge=bytes(pk.challenge);pk.allowCredentials=(pk.allowCredentials||[]).map(x=>({...x,id:bytes(x.id),transports:['internal']}));pk.userVerification='required';pk.timeout=8000;return pack(await navigator.credentials.get({publicKey:pk}));}"""
            c=page.evaluate(create,challenge['webauthn']['credential_options'])
            s2=call('POST','/factors/'+wid+'/verify',{'challenge_id':challenge['id'],'webauthn':{'type':'create','credential_response':c}},s2['access_token'],200)[1]
            user=session_check('Official server accepts native WebAuthn registration and returns AAL2',s2,'aal2',uid)
            check('Existing TOTP and new WebAuthn both remain verified',all(any(x['id']==i and x['status']=='verified' for x in user['factors']) for i in (totp_id,wid)))
            s=login(email);session_check('A fresh password login still requires second factor',s,'aal1',uid)
            def assertion(session):
                ch=call('POST','/factors/'+wid+'/challenge',{},session['access_token'],200)[1]
                check('Service assertion RP remains bound to laboratory domain',ch['webauthn']['credential_options']['publicKey']['rpId']==RP)
                return ch,page.evaluate(get,ch['webauthn']['credential_options'])
            def verify(session,ch,cred):return call('POST','/factors/'+wid+'/verify',{'challenge_id':ch['id'],'webauthn':{'type':'request','credential_response':cred}},session['access_token'])
            ch,a=assertion(s)
            check('Native device assertion includes UP and UV',bool(unb64(a['response']['authenticatorData'])[32]&1) and bool(unb64(a['response']['authenticatorData'])[32]&4))
            status,verified=verify(s,ch,a);check('Real server verifies device assertion',status==200)
            session_check('Device second factor yields cryptographically verified AAL2',verified,'aal2',uid)
            amr=[x['method'] for x in claims(verified).get('amr',[])]
            check('Server session identifies WebAuthn second factor',any('webauthn' in x for x in amr));image_ids['device_amr']=amr
            reject('Reusing a consumed challenge is rejected',verify(verified,ch,a))
            token=verified['access_token'];parts=token.split('.');payload=json.loads(unb64(parts[1]));payload['sub']='00000000-0000-0000-0000-000000000000';parts[1]=b64(json.dumps(payload).encode())
            reject('A modified signed token is rejected by real Auth',call('GET','/user',token='.'.join(parts)))
            # Negative tests use fresh AAL1; no successful verification is fabricated.
            s=login(email);ch,a=assertion(s)
            bad=copy.deepcopy(a);raw=bytearray(unb64(bad['response']['signature']));raw[-1]^=1;bad['response']['signature']=b64(raw)
            reject('Tampered device signature is rejected by official server',verify(s,ch,bad))
            bad=copy.deepcopy(a);client=json.loads(unb64(bad['response']['clientDataJSON']));client['origin']='https://unrelated.invalid';bad['response']['clientDataJSON']=b64(json.dumps(client).encode())
            reject('Incorrect signed client origin cannot establish a session',verify(s,ch,bad))
            # Account boundary tested using another newly created blank test account.
            other=call('POST','/signup',{'email':'p32-other-'+secrets.token_hex(6)+'@example.test','password':PASSWORD},want=200)[1]
            reject('Another account cannot challenge this factor',call('POST','/factors/'+wid+'/challenge',{},other['access_token']))
            reject('Another account cannot verify this factor',verify(other,ch,a))
            session_check('Rejected requests leave original login at AAL1',s,'aal1',uid)
            cd.send('WebAuthn.setAutomaticPresenceSimulation',{'authenticatorId':dev,'enabled':False})
            outcome=page.evaluate("""async()=>{const ac=new AbortController();setTimeout(()=>ac.abort(),30);try{await navigator.credentials.get({publicKey:{rpId:location.hostname,challenge:crypto.getRandomValues(new Uint8Array(32)),userVerification:'required'},signal:ac.signal});return 'unexpected'}catch(e){return e.name}}""")
            check('Device prompt cancellation does not produce a credential',outcome=='AbortError')
            cd.send('WebAuthn.setAutomaticPresenceSimulation',{'authenticatorId':dev,'enabled':True})
            ch,a=assertion(s);time.sleep(11)
            expired=verify(s,ch,a);reject('Expired real service challenge cannot establish AAL2',expired)
            check('Expiry rejected for the expected reason',expired[1].get('error_code')=='mfa_challenge_expired')
            # Confirm fallback still genuinely works after device failure/cancellation.
            fallback=totp_verify(s,totp_id,totp_secret)
            user=session_check('Original TOTP fallback still creates real AAL2',fallback,'aal2',uid)
            check('Fallback did not delete either verified factor',all(any(x['id']==i and x['status']=='verified' for x in user['factors']) for i in (totp_id,wid)))
            refresh=call('POST','/token?grant_type=refresh_token',{'refresh_token':fallback['refresh_token']},want=200)[1]
            session_check('Normal token refresh preserves verified assurance',refresh,'aal2',uid)
            check('Browser never requested company app or any external endpoint',browser_requests==[ORIGIN+'/'] and not browser_denied)
            browser.close()
        check('Only two synthetic test accounts exist',sql('select count(*) from auth.users')=='2')
        check('Database still has zero public business tables',sql("select count(*) from pg_tables where schemaname='public'")=='0')
        check('No requests escaped the explicit Auth path allowlist',not forbidden)
        info=json.loads(sh(['docker','network','inspect',NET]))[0]
        check('Database and Auth run on an internal-only container network',info['Internal'] is True)
        check('Auth is published only on host loopback',json.loads(sh(['docker','inspect',AUTH]))[0]['HostConfig']['PortBindings']['9999/tcp'][0]['HostIp']=='127.0.0.1')
except Exception as e:
    # Do not serialize Auth bodies, tokens, secrets, environment or database rows.
    (E/'failure.json').write_text(json.dumps({'type':type(e).__name__,'message':str(e)[:400]},indent=2))
    raise
finally:
    for name in (AUTH,PG): sh(['docker','rm','-f','-v',name],okay=False)
    sh(['docker','network','rm',NET],okay=False)
    (E/'auth-service.json').write_text(json.dumps({'scope':'Official self-hosted Supabase Auth with fresh database and Chromium virtual authenticator. NOT the hosted company project or actual Face ID/Hello.','software':image_ids,'checks':checks,'passed':sum(x['pass'] for x in checks),'total':len(checks),'http':journal,'forbidden':forbidden,'browser_requests':browser_requests,'browser_denied':browser_denied,'cleanup':'teardown attempted for only generated laboratory containers and network'},ensure_ascii=False,indent=2))
print('P32-3 real-service checks:',len(checks),'passed')
