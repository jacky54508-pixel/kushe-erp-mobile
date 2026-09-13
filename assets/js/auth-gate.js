(function () {
  'use strict';

  const config = window.KUSHE_PHASE1_CONFIG || {};
  const SESSION_KEY = config.authSessionStorageKey || 'kushe_erp_supabase_auth_v1';
  let authGeneration = 0;
  let activeValidation = null;

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
    try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
    try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
  }

  async function requestJson(path, options = {}) {
    const { url, key } = authConfig();
    const headers = { apikey: key };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetch(`${url}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal
      });
    } catch (error) {
      throw new AuthRequestError(0, '', error?.name === 'AbortError' ? 'aborted' : 'transport');
    }
    let payload = {};
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) throw new AuthRequestError(response.status);
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
    saveSession(next);
    return next.user;
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

  window.KusheAuthGate = Object.freeze({ requireAuth, login, changePassword, logout, session, user });
}());
