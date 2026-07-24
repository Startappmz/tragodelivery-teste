import { apiRequest, setApiTokenProvider } from './api.js';
import { TRAGO_CONFIG } from './config.js';

const SESSION_PREFIX = 'trago.auth';
const ACTORS = new Set(['client', 'restaurant', 'admin', 'driver']);
const memoryStorage = new Map();
let activeActor = null;

function storage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch (_error) {
    // Ambientes com storage bloqueado usam apenas memória durante a sessão.
  }
  return {
    getItem: (key) => memoryStorage.get(key) || null,
    setItem: (key, value) => memoryStorage.set(key, String(value)),
    removeItem: (key) => memoryStorage.delete(key)
  };
}

function assertActor(actor) {
  if (!ACTORS.has(actor)) throw new TypeError(`Actor de autenticação inválido: ${actor}`);
  return actor;
}

const sessionKey = (actor) => `${SESSION_PREFIX}.${assertActor(actor)}`;

function decodeJwtPayload(token) {
  try {
    const encoded = String(token || '').split('.')[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = typeof atob === 'function'
      ? atob(padded)
      : Buffer.from(padded, 'base64').toString('binary');
    return JSON.parse(decodeURIComponent([...decoded].map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')));
  } catch (_error) {
    return null;
  }
}

function inferExpiry(token, explicitExpiry) {
  if (explicitExpiry) {
    const parsed = new Date(explicitExpiry).getTime();
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  const payload = decodeJwtPayload(token);
  return payload?.exp ? new Date(Number(payload.exp) * 1000).toISOString() : null;
}

export function setActiveActor(actor) {
  activeActor = assertActor(actor);
  return activeActor;
}

export function getSession(actor = activeActor) {
  if (!actor) return null;
  try {
    const value = storage().getItem(sessionKey(actor));
    const session = value ? JSON.parse(value) : null;
    if (!session || session.version !== TRAGO_CONFIG.SESSION_VERSION || session.actor !== actor) return null;
    return session;
  } catch (_error) {
    return null;
  }
}

export function isSessionExpired(session, now = Date.now()) {
  if (!session?.expiresAt) return false;
  const expiresAt = new Date(session.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

export function getAccessToken(actor = activeActor) {
  const session = getSession(actor);
  if (session && isSessionExpired(session)) {
    clearSession(actor);
    return null;
  }
  return session?.token || null;
}

export function setSession(actor, input = {}) {
  assertActor(actor);
  if (!input.token) throw new TypeError('A sessão requer um token.');
  const session = {
    version: TRAGO_CONFIG.SESSION_VERSION,
    actor,
    token: String(input.token),
    expiresAt: inferExpiry(input.token, input.expiresAt),
    profile: input.profile || null,
    createdAt: new Date().toISOString()
  };
  storage().setItem(sessionKey(actor), JSON.stringify(session));
  return session;
}

export function updateCachedProfile(actor, profile) {
  const session = getSession(actor);
  if (!session) return null;
  const updated = { ...session, profile: profile || null, refreshedAt: new Date().toISOString() };
  storage().setItem(sessionKey(actor), JSON.stringify(updated));
  return updated;
}

export function clearSession(actor = activeActor) {
  if (!actor) return;
  storage().removeItem(sessionKey(actor));
}

export function clearAllSessions() {
  ACTORS.forEach((actor) => storage().removeItem(sessionKey(actor)));
}

export function installAuth(actor, options = {}) {
  setActiveActor(actor);
  setApiTokenProvider((requestedActor) => getAccessToken(requestedActor || actor));

  if (typeof window === 'undefined') return () => {};
  const handler = (event) => {
    const detail = event.detail || {};
    if (detail.actor && detail.actor !== actor) return;
    if (![401, 403].includes(Number(detail.status))) return;
    clearSession(actor);
    options.onUnauthorized?.(detail);
  };
  window.addEventListener('trago:auth-error', handler);
  return () => window.removeEventListener('trago:auth-error', handler);
}

export function createAuthClient({ actor, endpoints }) {
  assertActor(actor);
  if (!endpoints?.login || !endpoints?.me) throw new TypeError('Login e /me são obrigatórios no cliente de autenticação.');

  return Object.freeze({
    async login(credentials) {
      const data = await apiRequest(endpoints.login, { method: 'POST', body: credentials, auth: 'none', actor });
      const token = data?.token || data?.accessToken;
      const profile = data?.profile || data?.client || data?.restaurant || data?.user || null;
      return setSession(actor, { token, profile, expiresAt: data?.expiresAt });
    },
    async register(payload) {
      if (!endpoints.register) throw new TypeError('Endpoint de registo não configurado.');
      return apiRequest(endpoints.register, { method: 'POST', body: payload, auth: 'none', actor });
    },
    async me() {
      const data = await apiRequest(endpoints.me, { auth: 'required', actor });
      const profile = data?.profile || data?.client || data?.restaurant || data?.user || data;
      updateCachedProfile(actor, profile);
      return profile;
    },
    async logout() {
      try {
        if (endpoints.logout && getAccessToken(actor)) {
          await apiRequest(endpoints.logout, { method: 'POST', auth: 'required', actor, retries: 0 });
        }
      } finally {
        clearSession(actor);
      }
    }
  });
}
