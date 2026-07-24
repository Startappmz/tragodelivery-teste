import assert from 'node:assert/strict';

import { apiRequest, ApiError } from '../js/core/api.js';
import { clearAllSessions, getAccessToken, getSession, setSession } from '../js/core/auth.js';
import { buildApiUrl, TRAGO_CONFIG } from '../js/core/config.js';
import { formatCurrency, formatDistance, formatOrderCode, formatPhone, getInitials } from '../js/core/formatters.js';
import { matchRoute, normalizePath } from '../js/core/router.js';
import { createSocketClient } from '../js/core/socket.js';
import { createStore } from '../js/core/store.js';
import { UploadValidationError, validateUpload } from '../js/core/uploader.js';
import { validateData } from '../js/core/validator.js';

const tests = [];
const test = (name, run) => tests.push({ name, run });

test('configuração usa API relativa sem fallback Edge', () => {
  assert.equal(TRAGO_CONFIG.API_URL, '');
  assert.equal(buildApiUrl('/api/health'), '/api/health');
  assert.equal(Object.hasOwn(TRAGO_CONFIG, 'SUPABASE_URL'), false);
});

test('router normaliza e extrai parâmetros', () => {
  assert.equal(normalizePath('https://trago.test/orders/123/?x=1'), '/orders/123');
  assert.deepEqual(matchRoute('/orders/:id', '/orders/PED-20'), { id: 'PED-20' });
  assert.deepEqual(matchRoute('/restaurants/:slug?', '/restaurants'), { slug: undefined });
  assert.equal(matchRoute('/orders/:id', '/restaurants/20'), null);
});

test('validator devolve erros por campo e aceita dados válidos', () => {
  const schema = {
    name: { label: 'Nome', rules: { required: true, minLength: 3 } },
    phone: { label: 'Telefone', rules: { required: true, phone: true } },
    email: { label: 'Email', rules: { required: true, email: true } },
    terms: { label: 'Termos', rules: { accepted: true } }
  };
  const invalid = validateData({ name: 'A', phone: '123', email: 'x', terms: false }, schema);
  assert.equal(invalid.valid, false);
  assert.deepEqual(Object.keys(invalid.errors), ['name', 'phone', 'email', 'terms']);
  const valid = validateData({ name: 'Ana', phone: '+258 84 123 4567', email: 'ana@example.com', terms: true }, schema);
  assert.equal(valid.valid, true);
});

test('formatters usam contexto moçambicano', () => {
  assert.match(formatCurrency(125.5), /125/);
  assert.equal(formatPhone('258841234567'), '+258 84 123 4567');
  assert.equal(formatDistance(2500), '2,5 km');
  assert.equal(formatOrderCode('abc-10'), '#ABC-10');
  assert.equal(getInitials('Maria João'), 'MJ');
});

test('store notifica selecções, protege estado e faz reset', () => {
  const store = createStore({ count: 0, label: 'inicial' });
  const changes = [];
  const unsubscribe = store.select((state) => state.count, (next, previous) => changes.push([previous, next]));
  store.setState({ count: 1 }, { source: 'test' });
  store.setState({ label: 'sem mudança do selector' });
  assert.deepEqual(changes, [[0, 1]]);
  assert.equal(Object.isFrozen(store.getState()), true);
  store.reset();
  assert.equal(store.getState().count, 0);
  unsubscribe();
});

test('auth separa sessões por papel e remove sessão expirada', () => {
  clearAllSessions();
  const futurePayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const expiredPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 })).toString('base64url');
  setSession('client', { token: `x.${futurePayload}.x`, profile: { id: 'client-1' } });
  setSession('restaurant', { token: `x.${expiredPayload}.x` });
  assert.match(getAccessToken('client'), /^x\./);
  assert.equal(getAccessToken('restaurant'), null);
  assert.equal(getSession('restaurant'), null);
  clearAllSessions();
});

test('API normaliza sucesso, erros e não termina sessão em falha de rede', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ success: true, data: { ok: true }, meta: { page: 1 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
    assert.deepEqual(await apiRequest('/api/test', { retries: 0 }), { ok: true });

    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'INVALID', message: 'Dados inválidos.' } }), {
      status: 422,
      headers: { 'content-type': 'application/json' }
    });
    await assert.rejects(() => apiRequest('/api/test', { retries: 0 }), (error) => {
      assert.equal(error instanceof ApiError, true);
      assert.equal(error.status, 422);
      assert.equal(error.code, 'INVALID');
      return true;
    });

    globalThis.fetch = async () => { throw new TypeError('offline'); };
    await assert.rejects(() => apiRequest('/api/test', { retries: 0 }), { code: 'NETWORK_ERROR', status: 0 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('uploader bloqueia formato e tamanho inválidos', () => {
  const valid = new Blob(['imagem'], { type: 'image/png' });
  assert.equal(validateUpload(valid), valid);
  assert.throws(() => validateUpload(new Blob(['texto'], { type: 'text/plain' })), UploadValidationError);
  assert.throws(() => validateUpload(new Blob(['12345'], { type: 'image/png' }), { maxBytes: 2 }), /exceder/);
});

test('Socket.IO usa token no handshake e publica estado', async () => {
  const handlers = new Map();
  const managerHandlers = new Map();
  let handshake;
  const fakeSocket = {
    connected: false,
    id: 'socket-test',
    io: { on: (event, listener) => managerHandlers.set(event, listener) },
    on(event, listener) { handlers.set(event, listener); },
    off(event) { handlers.delete(event); },
    once(event, listener) { handlers.set(event, listener); },
    emit() {},
    connect() {
      this.connected = true;
      handlers.get('connect')?.();
    },
    disconnect() {
      this.connected = false;
      handlers.get('disconnect')?.('client disconnect');
    }
  };
  const ioFactory = (_origin, options) => {
    options.auth((payload) => { handshake = payload; });
    return fakeSocket;
  };
  const states = [];
  const client = createSocketClient({ actor: 'client', tokenProvider: () => 'jwt-test', ioFactory });
  client.subscribeStatus((state) => states.push(state));
  await client.connect();
  assert.deepEqual(handshake, { token: 'jwt-test', actor: 'client' });
  assert.equal(client.getState(), 'connected');
  assert.deepEqual(states, ['idle', 'connecting', 'connected']);
  client.disconnect();
  assert.equal(client.getState(), 'idle');
});

let failures = 0;
for (const { name, run } of tests) {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

console.log(`\n${tests.length - failures}/${tests.length} testes passaram.`);
if (failures) process.exitCode = 1;
