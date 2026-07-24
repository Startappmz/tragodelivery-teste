import { TRAGO_CONFIG, buildApiUrl } from './config.js';

const SAFE_RETRY_METHODS = new Set(['GET', 'HEAD']);
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
let tokenProvider = () => null;

export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message || 'Não foi possível concluir o pedido.');
    this.name = 'ApiError';
    this.status = Number(options.status || 0);
    this.code = options.code || (this.status ? `HTTP_${this.status}` : 'NETWORK_ERROR');
    this.fields = options.fields || {};
    this.retryable = Boolean(options.retryable);
    this.payload = options.payload;
    this.cause = options.cause;
  }
}

export function setApiTokenProvider(provider) {
  tokenProvider = typeof provider === 'function' ? provider : () => null;
}

export function getErrorDetails(payload, status = 0) {
  const nested = payload && typeof payload.error === 'object' ? payload.error : {};
  const message = nested.message || payload?.message || payload?.error_description || '';
  return {
    message: String(message || `O servidor devolveu o estado ${status || 'desconhecido'}.`),
    code: nested.code || payload?.code || (status ? `HTTP_${status}` : 'UNKNOWN_ERROR'),
    fields: nested.fields || payload?.fields || {}
  };
}

function dispatchAuthError(detail) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent('trago:auth-error', { detail }));
}

function createAbortContext(externalSignal, timeoutMs) {
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) abortFromExternal();
    else externalSignal.addEventListener('abort', abortFromExternal, { once: true });
  }

  const timeoutError = typeof DOMException === 'function'
    ? new DOMException('Tempo limite excedido.', 'TimeoutError')
    : new Error('Tempo limite excedido.');
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      externalSignal?.removeEventListener?.('abort', abortFromExternal);
    }
  };
}

async function parseResponse(response) {
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json().catch(() => null);
  const text = await response.text();
  return text || null;
}

function unwrapPayload(payload) {
  if (payload && payload.success === true && Object.prototype.hasOwnProperty.call(payload, 'data')) {
    return payload.data;
  }
  return payload;
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function apiRequestDetailed(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const authMode = options.auth || 'optional';
  const token = options.token || tokenProvider(options.actor);
  const headers = new Headers(options.headers || {});
  const bodyIsFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const bodyIsBlob = typeof Blob !== 'undefined' && options.body instanceof Blob;
  let body = options.body;

  if (authMode === 'required' && !token) {
    throw new ApiError('Inicie sessão para continuar.', { status: 401, code: 'AUTH_REQUIRED' });
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');

  if (body != null && !bodyIsFormData && !bodyIsBlob && typeof body !== 'string') {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }
  if (options.idempotencyKey) headers.set('Idempotency-Key', String(options.idempotencyKey));

  const requestedRetries = options.retries ?? TRAGO_CONFIG.GET_RETRY_COUNT;
  const retries = SAFE_RETRY_METHODS.has(method) ? Math.max(0, Math.min(Number(requestedRetries) || 0, 3)) : 0;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : TRAGO_CONFIG.REQUEST_TIMEOUT_MS;
  const url = buildApiUrl(path);
  let attempt = 0;

  while (attempt <= retries) {
    const abortContext = createAbortContext(options.signal, timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: ['GET', 'HEAD'].includes(method) ? undefined : body,
        credentials: options.credentials || 'include',
        signal: abortContext.signal,
        cache: options.cache
      });
      const payload = await parseResponse(response);

      if (!response.ok) {
        const details = getErrorDetails(payload, response.status);
        const error = new ApiError(details.message, {
          status: response.status,
          code: details.code,
          fields: details.fields,
          retryable: RETRYABLE_STATUS.has(response.status),
          payload
        });

        if ([401, 403].includes(response.status)) {
          dispatchAuthError({ status: response.status, path, actor: options.actor, code: error.code });
        }
        if (attempt < retries && error.retryable) {
          attempt += 1;
          await wait(250 * (2 ** (attempt - 1)));
          continue;
        }
        throw error;
      }

      return {
        data: unwrapPayload(payload),
        meta: payload?.success === true ? payload.meta || {} : {},
        raw: payload,
        status: response.status,
        headers: response.headers
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (options.signal?.aborted) {
        throw new ApiError('O pedido foi cancelado.', { code: 'REQUEST_ABORTED', retryable: false, cause: error });
      }
      const timedOut = abortContext.signal.aborted && !options.signal?.aborted;
      const normalized = new ApiError(
        timedOut ? 'O servidor demorou demasiado a responder.' : 'Não foi possível ligar ao servidor.',
        {
          code: timedOut ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
          retryable: true,
          cause: error
        }
      );
      if (attempt < retries) {
        attempt += 1;
        await wait(250 * (2 ** (attempt - 1)));
        continue;
      }
      throw normalized;
    } finally {
      abortContext.cleanup();
    }
  }

  throw new ApiError('Não foi possível concluir o pedido.', { code: 'REQUEST_FAILED' });
}

export async function apiRequest(path, options = {}) {
  const result = await apiRequestDetailed(path, options);
  return result.data;
}

export const api = Object.freeze({
  get: (path, options = {}) => apiRequest(path, { ...options, method: 'GET' }),
  post: (path, body, options = {}) => apiRequest(path, { ...options, method: 'POST', body }),
  put: (path, body, options = {}) => apiRequest(path, { ...options, method: 'PUT', body }),
  patch: (path, body, options = {}) => apiRequest(path, { ...options, method: 'PATCH', body }),
  delete: (path, options = {}) => apiRequest(path, { ...options, method: 'DELETE' })
});
