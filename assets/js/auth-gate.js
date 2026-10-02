(function () {
  'use strict';

  const config = window.KUSHE_PHASE1_CONFIG || {};
  const SESSION_KEY = config.authSessionStorageKey || 'kushe_erp_supabase_auth_v1';
  let authGeneration = 0;
  let activeValidation = null;
  let activeCompanyContext = null;

  const PERMISSION_ALIASES = Object.freeze({
    attendance:'commissions',
    'billing-draft':'billings',
    customers:'projects'
  });
  const ROLE_PERMISSIONS = Object.freeze({
    owner:Object.freeze({
      view:Object.freeze(['dashboard','projects','quotations','billings','unbilled-work','receivables','payables','banks','invoices','materials','employees','commissions','payroll','reports','settings']),
      write:Object.freeze(['dashboard','projects','quotations','billings','unbilled-work','receivables','payables','banks','invoices','materials','employees','commissions','payroll','reports','settings'])
    }),
    admin:Object.freeze({
      view:Object.freeze(['dashboard','projects','quotations','billings','unbilled-work','receivables','payables','banks','invoices','materials','employees','commissions','payroll','reports']),
      write:Object.freeze(['projects','quotations','billings','unbilled-work','receivables','payables','banks','invoices','materials','employees','commissions','payroll'])
    }),
    accounting:Object.freeze({
      view:Object.freeze(['dashboard','projects','quotations','billings','unbilled-work','receivables','payables','banks','invoices','payroll','reports']),
      write:Object.freeze(['quotations','billings','unbilled-work','receivables','payables','banks','invoices','payroll'])
    }),
    employee:Object.freeze({
      view:Object.freeze(['projects','materials','commissions']),
      write:Object.freeze(['materials','commissions'])
    })
  });

  // Persistent Auth sessions from earlier releases are intentionally discarded.
  try { localStorage.removeItem(SESSION_KEY); } catch (_) {}

  class AuthRequestError extends Error {
    constructor(status = 0, code = '', kind = '') {
      super('Authentication request failed');
      this.name = 'AuthRequestError';
      this.status = Number(status) || 0;
      this.code = String(code || '');
      this.kind = kind || (this.status >= 500 ? 'server' : this.status ? 'http' : 'invalid');
    }
  }

  function authConfig() {
    const url = String(config.supabaseUrl || '').trim().replace(/\/+$/, '');
    const key = String(config.supabasePublishableKey || '').trim();
    if (!/^https:\/\//i.test(url) || !key || /(?:service[_-]?role|sb_secret_)/i.test(key)) throw new AuthRequestError(0, 'invalid_config');
    return { url, key };
  }

  function storedUser(value) {
    if (!value || typeof value !== 'object' || !String(value.id || '').trim()) return null;
    return { id: String(value.id), email: String(value.email || '') };
  }

  function decodeJwtPayload(token) {
    const parts=String(token||'').split('.');
    if(parts.length<2)throw new AuthRequestError(0,'invalid_access_token');
    try{
      const base=parts[1].replace(/-/g,'+').replace(/_/g,'/'),padded=base+'='.repeat((4-base.length%4)%4);
      return JSON.parse(decodeURIComponent(Array.from(atob(padded),char=>'%'+char.charCodeAt(0).toString(16).padStart(2,'0')).join('')));
    }catch(_){throw new AuthRequestError(0,'invalid_access_token')}
  }

  function sessionAal(value=readSession()) {
    if(!value?.access_token)return null;
    const aal=String(decodeJwtPayload(value.access_token)?.aal||'aal1');
    return aal==='aal2'?'aal2':'aal1';
  }

  function normalizeMfaFactors(payload) {
    const rows=Array.isArray(payload)?payload:Array.isArray(payload?.all)?payload.all:[
      ...(Array.isArray(payload?.totp)?payload.totp:[]),
      ...(Array.isArray(payload?.phone)?payload.phone:[])
    ];
    return rows.filter((row)=>row&&typeof row==='object').map((row)=>({
      id:String(row.id||''),
      factorType:String(row.factor_type||row.factorType||row.type||''),
      status:String(row.status||''),
      friendlyName:String(row.friendly_name||row.friendlyName||''),
      createdAt:String(row.created_at||row.createdAt||'')
    })).filter((row)=>row.id);
  }

  function normalizeSession(value, fallbackRefreshToken = '') {
    const accessToken = String(value?.access_token || '').trim();
    const refreshToken = String(value?.refresh_token || fallbackRefreshToken || '').trim();
    const expiresAt = Number(value?.expires_at) || Math.floor(Date.now() / 1000) + Math.max(0, Number(value?.expires_in) || 0);
    if (!accessToken) throw new AuthRequestError(0, 'invalid_session_payload');
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      user: storedUser(value?.user)
    };
  }

  function readSession() {
    try {
      const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      return value && typeof value === 'object' && String(value.access_token || '').trim() ? value : null;
    } catch (_) {
      return null;
    }
  }

  function saveSession(value) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    authGeneration += 1;
  }

  function clearSession() {
    authGeneration += 1;
    activeCompanyContext = null;
    try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
    try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
  }

  async function requestJson(path, options = {}) {
    const { url, key } = authConfig();
    const headers = { apikey: key };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    const timeoutMs=Math.max(0,Number(options.timeoutMs)||0);
    const controller=!options.signal&&timeoutMs&&typeof AbortController==='function'?new AbortController():null;
    const timeout=controller?setTimeout(()=>controller.abort(),timeoutMs):0;
    try {
      response = await fetch(`${url}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal||controller?.signal
      });
    } catch (error) {
      throw new AuthRequestError(0, '', error?.name === 'AbortError' ? 'aborted' : 'transport');
    } finally {
      if(timeout)clearTimeout(timeout);
    }
    let payload = {};
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) throw new AuthRequestError(response.status,String(payload?.code||''),'http');
    return payload;
  }

  async function verifiedUser(accessToken) {
    const value = await requestJson('/auth/v1/user', { token: accessToken });
    const user = storedUser(value);
    if (!user) throw new AuthRequestError(0, 'invalid_user_payload');
    return user;
  }

  function sameSession(current, generation) {
    const stored = readSession();
    return authGeneration === generation && Boolean(stored)
      && stored.access_token === current.access_token
      && stored.refresh_token === current.refresh_token
      && stored.user?.id === current.user?.id;
  }

  function transientAuthError(error) {
    return ['transport', 'aborted', 'server'].includes(error?.kind);
  }

  async function refreshSession(current, generation, onRotation) {
    if (!String(current?.refresh_token || '').trim()) throw new AuthRequestError(401);
    const payload = await requestJson('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: { refresh_token: current.refresh_token }
    });
    if (!String(payload?.refresh_token || '').trim()) throw new AuthRequestError(0, 'invalid_refresh_payload');
    const next = normalizeSession(payload);
    if (!current.user?.id || !next.user?.id || next.user.id !== current.user.id) {
      throw new AuthRequestError(0, 'principal_mismatch');
    }
    if (!sameSession(current, generation)) return false;
    // Preserve rotated credentials only after the response proves the same principal.
    saveSession(next);
    const rotationGeneration = authGeneration;
    onRotation(next, rotationGeneration);
    const verified = await verifiedUser(next.access_token);
    if (verified.id !== current.user.id) throw new AuthRequestError(0, 'principal_mismatch');
    if (!sameSession(next, rotationGeneration)) return false;
    next.user = verified;
    saveSession(next);
    return true;
  }

  async function validateAuth() {
    const current = readSession();
    if (!current) return false;
    let protectedSession = current, protectedGeneration = authGeneration;
    try {
      const next = normalizeSession(current);
      next.user = await verifiedUser(next.access_token);
      if (!current.user?.id || next.user.id !== current.user.id) throw new AuthRequestError(0, 'principal_mismatch');
      if (!sameSession(current, protectedGeneration)) return false;
      saveSession(next);
      return true;
    } catch (error) {
      if ((error?.status === 401 || error?.status === 403) && current.refresh_token) {
        try {
          return await refreshSession(current, protectedGeneration, (next, generation) => {
            protectedSession = next;
            protectedGeneration = generation;
          });
        } catch (refreshError) {
          error = refreshError;
        }
      }
      if (!transientAuthError(error) && sameSession(protectedSession, protectedGeneration)) clearSession();
      return false;
    }
  }

  function requireAuth() {
    if (activeValidation) return activeValidation;
    const validation = validateAuth();
    activeValidation = validation;
    const clear = () => { if (activeValidation === validation) activeValidation = null; };
    validation.then(clear, clear);
    return validation;
  }

  async function login(email, password) {
    const address = String(email || '').trim();
    const secret = String(password || '');
    if (!address || !secret) throw new AuthRequestError(400);
    const payload = await requestJson('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: { email: address, password: secret }
    });
    const next = normalizeSession(payload);
    next.user = await verifiedUser(next.access_token);
    if (storedUser(payload?.user)?.id !== next.user.id) throw new AuthRequestError(0, 'principal_mismatch');
    activeCompanyContext = null;
    saveSession(next);
    return next.user;
  }

  async function mfaStatus() {
    const current=readSession();
    if(!current?.access_token||!current?.user?.id)throw new AuthRequestError(401,'invalid_session');
    const payload=await requestJson('/auth/v1/user',{token:current.access_token,timeoutMs:8000});
    const user=storedUser(payload);
    if(!user)throw new AuthRequestError(0,'invalid_user_payload');
    if(user.id!==current.user.id)throw new AuthRequestError(403,'principal_mismatch');
    const factors=normalizeMfaFactors(Array.isArray(payload?.factors)?payload.factors:[]);
    const verifiedTotp=factors.filter((row)=>row.factorType==='totp'&&row.status==='verified');
    return Object.freeze({
      aal:sessionAal(current),
      userId:user.id,
      verifiedTotp:Object.freeze(verifiedTotp.map((row)=>Object.freeze({...row}))),
      factors:Object.freeze(factors.map((row)=>Object.freeze({...row})))
    });
  }

  async function enrollTotp() {
    const current=readSession();
    if(!current?.access_token||!current?.user?.id)throw new AuthRequestError(401,'invalid_session');
    if(sessionAal(current)==='aal2')throw new AuthRequestError(409,'mfa_already_verified');
    const payload=await requestJson('/auth/v1/factors',{
      method:'POST',token:current.access_token,
      body:{factor_type:'totp',friendly_name:'酷舍 ERP'},timeoutMs:8000
    });
    const id=String(payload?.id||''),totp=payload?.totp||{},qrCode=String(totp.qr_code||totp.qrCode||''),secret=String(totp.secret||''),uri=String(totp.uri||'');
    if(!id||!qrCode||!secret)throw new AuthRequestError(0,'invalid_mfa_enrollment');
    return Object.freeze({factorId:id,qrCode,secret,uri});
  }

  async function createMfaChallenge(factorId) {
    const current=readSession(),id=String(factorId||'').trim();
    if(!current?.access_token||!current?.user?.id)throw new AuthRequestError(401,'invalid_session');
    if(!id)throw new AuthRequestError(400,'invalid_mfa_factor');
    const payload=await requestJson('/auth/v1/factors/'+encodeURIComponent(id)+'/challenge',{
      method:'POST',token:current.access_token,body:{},timeoutMs:8000
    });
    const challengeId=String(payload?.id||'');
    if(!challengeId)throw new AuthRequestError(0,'invalid_mfa_challenge');
    return Object.freeze({factorId:id,challengeId});
  }

  async function verifyMfa(factorId,challengeId,code) {
    const current=readSession(),id=String(factorId||'').trim(),challenge=String(challengeId||'').trim(),tokenCode=String(code||'').replace(/\s+/g,'');
    if(!current?.access_token||!current?.user?.id)throw new AuthRequestError(401,'invalid_session');
    if(!id||!challenge||!/^[0-9]{6,8}$/.test(tokenCode))throw new AuthRequestError(400,'invalid_mfa_code');
    const payload=await requestJson('/auth/v1/factors/'+encodeURIComponent(id)+'/verify',{
      method:'POST',token:current.access_token,
      body:{challenge_id:challenge,code:tokenCode},timeoutMs:8000
    });
    const next=normalizeSession(payload,current.refresh_token);
    next.user=await verifiedUser(next.access_token);
    if(next.user.id!==current.user.id)throw new AuthRequestError(403,'principal_mismatch');
    if(sessionAal(next)!=='aal2')throw new AuthRequestError(403,'mfa_not_elevated');
    activeCompanyContext=null;
    saveSession(next);
    return Object.freeze({aal:'aal2',user:{...next.user}});
  }

  async function requireMfa() {
    const current=readSession();
    if(!current)return false;
    if(!await requireAuth())return false;
    return sessionAal(readSession())==='aal2';
  }

  async function resolveCompanyContext() {
    const current = readSession();
    const userId = String(current?.user?.id || '').trim();
    const token = String(current?.access_token || '').trim();
    if (!userId || !token) throw new AuthRequestError(401, 'invalid_session');
    if (sessionAal(current)!=='aal2') throw new AuthRequestError(403,'mfa_required');

    const memberships = await requestJson(
      '/rest/v1/company_members?select=company_id,user_id,employee_id,role,status&user_id=eq.' + encodeURIComponent(userId) + '&order=created_at.asc',
      { token }
    );
    if (!Array.isArray(memberships)) throw new AuthRequestError(403, 'company_membership_invalid');
    const ownRows = memberships.filter((row) => String(row?.user_id || '') === userId);
    const activeRows = ownRows.filter((row) => String(row?.status || '') === 'active');
    if (!ownRows.length) throw new AuthRequestError(403, 'company_membership_missing');
    if (!activeRows.length) throw new AuthRequestError(403, 'company_membership_inactive');
    if (activeRows.length !== 1) throw new AuthRequestError(409, 'company_membership_ambiguous');

    const membership = activeRows[0];
    const companyId = String(membership.company_id || '').trim();
    const role = String(membership.role || '').trim();
    if (!companyId || !['owner','admin','accounting','employee'].includes(role)) {
      throw new AuthRequestError(403, 'company_membership_invalid');
    }

    const companies = await requestJson(
      '/rest/v1/companies?select=id,name,owner_user_id,legacy_source_user_id&id=eq.' + encodeURIComponent(companyId) + '&limit=2',
      { token }
    );
    if (!Array.isArray(companies) || companies.length !== 1 || String(companies[0]?.id || '') !== companyId) {
      throw new AuthRequestError(403, 'company_unavailable');
    }

    const states = await requestJson(
      '/rest/v1/erp_company_states?select=company_id,sync_version,updated_at,last_writer_mode,last_base_sync_version&company_id=eq.' + encodeURIComponent(companyId) + '&limit=2',
      { token }
    );
    if (!Array.isArray(states) || states.length !== 1 || String(states[0]?.company_id || '') !== companyId) {
      throw new AuthRequestError(403, 'company_state_unavailable');
    }

    if (String(readSession()?.user?.id || '') !== userId) throw new AuthRequestError(409, 'principal_mismatch');
    activeCompanyContext = Object.freeze({
      companyId,
      companyName: String(companies[0]?.name || ''),
      ownerUserId: String(companies[0]?.owner_user_id || ''),
      legacySourceUserId: String(companies[0]?.legacy_source_user_id || ''),
      userId,
      employeeId: String(membership.employee_id || ''),
      role,
      status: 'active',
      shadowVerified: true,
      companyState: Object.freeze({
        syncVersion: Number(states[0]?.sync_version) || 0,
        updatedAt: String(states[0]?.updated_at || ''),
        lastWriterMode: String(states[0]?.last_writer_mode || ''),
        lastBaseSyncVersion: Number(states[0]?.last_base_sync_version) || 0
      })
    });
    return activeCompanyContext;
  }

  function companyContext() {
    if (!activeCompanyContext) return null;
    return {
      ...activeCompanyContext,
      companyState: activeCompanyContext.companyState ? { ...activeCompanyContext.companyState } : null
    };
  }

  function permissionModule(module) {
    const value=String(module||'').replace(/^#/,'');
    return PERMISSION_ALIASES[value]||value;
  }

  function permissionList(kind) {
    const role=String(activeCompanyContext?.role||'');
    const permissions=ROLE_PERMISSIONS[role];
    return permissions&&Array.isArray(permissions[kind])?permissions[kind]:[];
  }

  function canView(module) {
    const target=permissionModule(module);
    return Boolean(target)&&permissionList('view').includes(target);
  }

  function canWrite(module) {
    const target=permissionModule(module);
    return Boolean(target)&&canView(target)&&permissionList('write').includes(target);
  }

  function firstAllowedRoute() {
    const preferred=['dashboard','projects','commissions','materials','quotations','billings','receivables','payables','banks','invoices','payroll','reports','settings'];
    return preferred.find((route)=>canView(route))||'';
  }

  function permissionSnapshot() {
    const role=String(activeCompanyContext?.role||'');
    return {
      role,
      view:[...permissionList('view')],
      write:[...permissionList('write')],
      firstRoute:firstAllowedRoute()
    };
  }

  async function changePassword(currentPassword, newPassword) {
    const currentSecret = String(currentPassword || '');
    const nextSecret = String(newPassword || '');
    if (!currentSecret || nextSecret.length < 12 || currentSecret === nextSecret) throw new AuthRequestError(400, 'invalid_password_input');
    if (!await requireAuth()) throw new AuthRequestError(401, 'invalid_session');

    const current = readSession();
    if (!current?.access_token) throw new AuthRequestError(401, 'invalid_session');
    const verified = await verifiedUser(current.access_token);
    if (!verified.email) throw new AuthRequestError(401, 'invalid_session');

    let reauthPayload;
    try {
      reauthPayload = await requestJson('/auth/v1/token?grant_type=password', {
        method: 'POST',
        body: { email: verified.email, password: currentSecret }
      });
    } catch (error) {
      if ([400, 401, 422].includes(Number(error?.status))) throw new AuthRequestError(401, 'invalid_current_password');
      throw error;
    }

    const responseUser = storedUser(reauthPayload?.user);
    if (!responseUser?.id || responseUser.id !== verified.id) throw new AuthRequestError(403, 'identity_mismatch');
    const fresh = normalizeSession(reauthPayload);
    const reauthUser = await verifiedUser(fresh.access_token);
    if (!reauthUser.id || reauthUser.id !== verified.id) throw new AuthRequestError(403, 'identity_mismatch');

    await requestJson('/auth/v1/user', {
      method: 'PUT',
      token: fresh.access_token,
      body: { password: nextSecret }
    });

    try {
      await requestJson('/auth/v1/logout', { method: 'POST', token: fresh.access_token });
    } catch (_) {
      // A successful password update must still end the local session.
    }
    clearSession();
    return true;
  }

  async function logout() {
    const current = readSession();
    // Invalidate local auth before the best-effort remote request can yield.
    clearSession();
    if (current?.access_token) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timeout = controller ? setTimeout(() => controller.abort(), 4000) : 0;
      try {
        await requestJson('/auth/v1/logout', { method: 'POST', token: current.access_token, signal: controller?.signal });
      } catch (_) {
        // Local logout must complete even when the remote best-effort request fails.
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    return true;
  }

  function session() {
    const value = readSession();
    return value ? { ...value, user: value.user ? { ...value.user } : null } : null;
  }

  function user() {
    return session()?.user || null;
  }

  window.KusheAuthGate = Object.freeze({ requireAuth, requireMfa, mfaStatus, enrollTotp, createMfaChallenge, verifyMfa, login, resolveCompanyContext, companyContext, canView, canWrite, firstAllowedRoute, permissionSnapshot, changePassword, logout, session, user });
}());
