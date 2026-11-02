"""Isolated protocol laboratory, NOT a production WebAuthn server or Supabase test.
New ephemeral Chromium profile; virtual authenticator; synthetic identity only.
Routing fulfills one .test origin in memory, aborts everything else. No ERP scripts.
ECDSA verification here is a test oracle, not a proposed replacement for Supabase.
"""
from pathlib import Path
import base64, json, hashlib, secrets, time, copy, os
from playwright.sync_api import sync_playwright
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import ec
R = Path(__file__).resolve().parents[1]; E = R/'evidence'; E.mkdir(exist_ok=True)
ORIGIN = 'https://kushe-auth-lab.test'; RP = 'kushe-auth-lab.test'
results=[]
def check(name, condition):
    results.append({'name':name,'pass':bool(condition)})
    if not condition: raise AssertionError(name)
def b64(b): return base64.urlsafe_b64encode(b).decode().rstrip('=')
def unb64(s): return base64.urlsafe_b64decode(s+'='*((4-len(s)%4)%4))
def expect_reject(name, fn):
    try: fn()
    except Exception: check(name,True)
    else: check(name,False)
class LabVerifier:
    """Test-only fixed ES256 verifier for a trusted virtual enrollment; no service API."""
    def __init__(self, key, credential_id): self.key=key;self.credential_id=credential_id;self.pending={}
    def challenge(self):
        value=b64(secrets.token_bytes(32));ident='challenge-'+secrets.token_hex(8)
        self.pending[ident]={'challenge':value,'expires':time.monotonic()+20,'user':'synthetic-user','factor':'synthetic-factor'}
        return ident,value
    def verify(self, ident, assertion, user='synthetic-user', factor='synthetic-factor'):
        state=self.pending.get(ident);assert state and state['expires']>time.monotonic()
        assert user==state['user'] and factor==state['factor']
        assert assertion['id']==self.credential_id and assertion['type']=='public-key'
        client=unb64(assertion['response']['clientDataJSON']); data=json.loads(client)
        assert data['type']=='webauthn.get' and data['challenge']==state['challenge']
        assert data['origin']==ORIGIN and not data.get('crossOrigin',False)
        auth=unb64(assertion['response']['authenticatorData']);assert len(auth)>=37
        assert auth[:32]==hashlib.sha256(RP.encode()).digest()
        assert auth[32]&1 and auth[32]&4 # user presence AND user verification
        self.key.verify(unb64(assertion['response']['signature']),auth+hashlib.sha256(client).digest(),ec.ECDSA(hashes.SHA256()))
        del self.pending[ident] # consume successful challenge
        return True
with sync_playwright() as p:
    exe=os.environ.get('CHROMIUM_PATH')
    browser=p.chromium.launch(**({'executable_path':exe} if exe else {}),headless=True,args=['--no-sandbox'])
    context=browser.new_context(service_workers='block');requests=[];unexpected=[]
    def route(r):
        requests.append(r.request.url)
        if r.request.url==ORIGIN+'/': return r.fulfill(status=200,content_type='text/html',body='<title>Isolated MFA Protocol Lab</title><p>Synthetic identities only. Not the ERP.</p>')
        unexpected.append(r.request.url);r.abort()
    context.route('**/*',route);page=context.new_page()
    try:
        page.goto(ORIGIN+'/',timeout=15000)
        page.evaluate("""() => {
          const denied=()=>{throw new Error('Application storage forbidden')};
          Object.defineProperty(window,'indexedDB',{value:{open:denied,deleteDatabase:denied}});
          for(const name of ['localStorage','sessionStorage'])Object.defineProperty(window,name,{value:{getItem:denied,setItem:denied,removeItem:denied,clear:denied}});
          window.fetch=denied;window.XMLHttpRequest=function(){denied()};window.WebSocket=function(){denied()};
          window.b64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/=/g,'').replace(/\\+/g,'-').replace(/\\//g,'_');
          window.bytes=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
        }""")
        check('Synthetic HTTPS origin is a native secure context',page.evaluate('isSecureContext'))
        cdp=context.new_cdp_session(page);cdp.send('WebAuthn.enable')
        dev=cdp.send('WebAuthn.addVirtualAuthenticator',{'options':{'protocol':'ctap2','transport':'internal','hasResidentKey':True,'hasUserVerification':True,'isUserVerified':True,'automaticPresenceSimulation':True}})['authenticatorId']
        ch=b64(secrets.token_bytes(32))
        enrolled=page.evaluate("""async challenge=>{
          const c=await navigator.credentials.create({publicKey:{rp:{id:location.hostname,name:'Isolated Lab'},user:{id:new Uint8Array(16).fill(7),name:'synthetic@example.invalid',displayName:'Synthetic user'},challenge:bytes(challenge),pubKeyCredParams:[{type:'public-key',alg:-7}],attestation:'none',authenticatorSelection:{authenticatorAttachment:'platform',residentKey:'required',userVerification:'required'},timeout:10000}});
          window.credentialId=c.id;
          return {id:c.id,type:c.type,client:b64(c.response.clientDataJSON),spki:b64(c.response.getPublicKey()),auth:b64(c.response.getAuthenticatorData())};
        }""",ch)
        client=json.loads(unb64(enrolled['client']));auth=unb64(enrolled['auth'])
        check('Native registration proves correct challenge and lab origin',client['type']=='webauthn.create' and client['challenge']==ch and client['origin']==ORIGIN)
        check('Virtual platform registration has user-verification flag',bool(auth[32]&4))
        key=serialization.load_der_public_key(unb64(enrolled['spki']));server=LabVerifier(key,enrolled['id'])
        get="""async challenge=>{const c=await navigator.credentials.get({publicKey:{rpId:location.hostname,challenge:bytes(challenge),allowCredentials:[{id:bytes(credentialId),type:'public-key',transports:['internal']}],userVerification:'required',timeout:10000}});return {id:c.id,type:c.type,response:{clientDataJSON:b64(c.response.clientDataJSON),authenticatorData:b64(c.response.authenticatorData),signature:b64(c.response.signature)}};}"""
        ident,ch=server.challenge();a=page.evaluate(get,ch)
        check('Native assertion has valid ES256 signature with required UV',server.verify(ident,a))
        expect_reject('Successful challenge cannot be replayed',lambda:server.verify(ident,a))
        ident,ch=server.challenge();a=page.evaluate(get,ch)
        for field,value in [('challenge','not-the-challenge'),('origin','https://phishing.invalid'),('type','webauthn.create'),('crossOrigin',True)]:
            changed=copy.deepcopy(a);c=json.loads(unb64(changed['response']['clientDataJSON']));c[field]=value;changed['response']['clientDataJSON']=b64(json.dumps(c).encode())
            expect_reject('Reject modified client '+field,lambda:server.verify(ident,changed))
        changed=copy.deepcopy(a);raw=bytearray(unb64(changed['response']['signature']));raw[-1]^=1;changed['response']['signature']=b64(raw)
        expect_reject('Cryptographic signature forgery rejected',lambda:server.verify(ident,changed))
        for bit,label in [(1,'user-presence'),(4,'user-verification')]:
            changed=copy.deepcopy(a);raw=bytearray(unb64(changed['response']['authenticatorData']));raw[32]&=~bit;changed['response']['authenticatorData']=b64(raw)
            expect_reject('Missing '+label+' rejected',lambda:server.verify(ident,changed))
        changed=copy.deepcopy(a);raw=bytearray(unb64(changed['response']['authenticatorData']));raw[0]^=1;changed['response']['authenticatorData']=b64(raw)
        expect_reject('Wrong relying-party hash rejected',lambda:server.verify(ident,changed))
        expect_reject('Another synthetic account cannot consume assertion',lambda:server.verify(ident,a,user='other-user'))
        expect_reject('Another factor cannot consume assertion',lambda:server.verify(ident,a,factor='other-factor'))
        server.pending[ident]['expires']=time.monotonic()-1
        expect_reject('Expired challenge is rejected',lambda:server.verify(ident,a))
        cdp.send('WebAuthn.setAutomaticPresenceSimulation',{'authenticatorId':dev,'enabled':False})
        outcome=page.evaluate("""async()=>{const ac=new AbortController();setTimeout(()=>ac.abort(),50);try{await navigator.credentials.get({publicKey:{rpId:location.hostname,challenge:crypto.getRandomValues(new Uint8Array(32)),allowCredentials:[{type:'public-key',id:bytes(credentialId)}],userVerification:'required'},signal:ac.signal});return 'unexpected-success'}catch(e){return e.name}}""")
        check('Native credential request can be cancelled',outcome=='AbortError')
        outcome=page.evaluate("""async()=>{try{await navigator.credentials.get({publicKey:{rpId:'wrong-origin.invalid',challenge:crypto.getRandomValues(new Uint8Array(32)),timeout:2000}});return 'unexpected-success'}catch(e){return e.name}}""")
        check('Browser rejects unrelated RP domain',outcome=='SecurityError')
        check('No request leaves the synthetic origin',not unexpected and requests==[ORIGIN+'/'])
    finally:
        (E/'native-webauthn.json').write_text(json.dumps({'scope':'Native Chromium virtual authenticator plus test-only ES256 verifier. NOT actual Face ID, Windows Hello, Supabase, or company credentials. No ERP loaded.', 'results':results,'requests':requests,'unexpected':unexpected},ensure_ascii=False,indent=2))
        browser.close()
print('Native protocol:',len(results),'passed')
