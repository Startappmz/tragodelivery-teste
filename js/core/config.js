/**
 * Configuração pública da aplicação TraGo.
 *
 * O browser nunca recebe segredos. A API canónica é Node/Express; este módulo
 * não consulta nem cria fallback para Supabase Edge Functions.
 */

const runtimeConfig = globalThis.TRAGO_CONFIG && typeof globalThis.TRAGO_CONFIG === 'object'
  ? globalThis.TRAGO_CONFIG
  : {};

const trimTrailingSlash = (value) => String(value || '').trim().replace(/\/+$/, '');

const detectEnvironment = () => {
  if (runtimeConfig.APP_ENV) return String(runtimeConfig.APP_ENV);
  if (typeof window === 'undefined') return 'test';
  return ['localhost', '127.0.0.1'].includes(window.location.hostname) ? 'development' : 'production';
};

const toPositiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const apiUrl = trimTrailingSlash(runtimeConfig.API_URL);
const socketUrl = trimTrailingSlash(runtimeConfig.SOCKET_URL || apiUrl);

export const TRAGO_CONFIG = Object.freeze({
  API_URL: apiUrl,
  SOCKET_URL: socketUrl,
  APP_ENV: detectEnvironment(),
  MAP_PROVIDER: String(runtimeConfig.MAP_PROVIDER || 'openstreetmap'),
  REQUEST_TIMEOUT_MS: toPositiveInteger(runtimeConfig.REQUEST_TIMEOUT_MS, 15000),
  GET_RETRY_COUNT: Math.min(toPositiveInteger(runtimeConfig.GET_RETRY_COUNT, 1), 3),
  SOCKET_PATH: String(runtimeConfig.SOCKET_PATH || '/socket.io'),
  SESSION_VERSION: 1
});

export function buildApiUrl(path = '') {
  const value = String(path || '').trim();
  if (/^https?:\/\//i.test(value)) return value;

  const normalizedPath = value ? `/${value.replace(/^\/+/, '')}` : '';
  return TRAGO_CONFIG.API_URL ? `${TRAGO_CONFIG.API_URL}${normalizedPath}` : normalizedPath || '/';
}

export function getSocketOrigin() {
  if (TRAGO_CONFIG.SOCKET_URL) return TRAGO_CONFIG.SOCKET_URL;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

export function isProduction() {
  return TRAGO_CONFIG.APP_ENV === 'production';
}

