import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [html, clientJs, clientV20, navJs, apiTs, migration, css, sw, swRegister] = await Promise.all([
  read('cliente.html'), read('js/client/client.js'), read('js/client/client-v20.js'),
  read('js/common/navigation-memory.js'), read('supabase/functions/api/index.ts'),
  read('backend/supabase/migrations/2026-07-26-client-v215-order-history.sql'),
  read('css/client-ui-v21.css'), read('sw.js'), read('js/common/sw-register.js')
]);

const tests = [];
const test = (name, run) => tests.push({ name, run });
const includes = (source, values, label) => values.forEach((value) => assert.ok(source.includes(value), `${label} não contém ${value}`));

function makeStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear()
  };
}

test('funções inexistentes foram removidas e criação usa store canónica', () => {
  assert.doesNotMatch(clientJs, /\bwriteHistory\s*\(/);
  assert.match(clientJs, /function upsertOrderHistory\s*\(/);
  assert.ok((clientJs.match(/upsertOrderHistory\(order\)/g) || []).length >= 2);
  includes(clientJs, ['window.TragoClientFilterOrders = setOrderHistoryFilter', 'window.TragoClientOrders = Object.freeze'], 'client.js');
});

test('somente store canónica grava cache de pedidos', () => {
  assert.equal((clientV20.match(/ORDER_HISTORY_KEY/g) || []).length, 0, 'client-v20 não deve manter cache própria de pedidos');
  assert.doesNotMatch(clientV20, /localStorage\.(?:getItem|setItem)\(storageKey\(ORDER_HISTORY_KEY\)/);
  assert.match(clientV20, /TragoClientOrders\?\.upsert/);
  assert.match(clientV20, /TragoClientOrders\?\.patch/);
});

test('store normaliza estados e isola cache por conta em runtime', () => {
  const localStorage = makeStorage();
  const sessionStorage = makeStorage();
  const document = { querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
  const window = {
    localStorage, sessionStorage, document,
    addEventListener() {}, removeEventListener() {},
    setInterval, clearInterval, setTimeout, clearTimeout,
    requestAnimationFrame: (callback) => callback(),
    location: { href: 'https://example.test/cliente.html', hash: '' }
  };
  window.window = window;
  const context = {
    window, document, localStorage, sessionStorage, navigator: { onLine: true },
    console, Intl, Date, Map, Set, WeakMap, Promise, URL, URLSearchParams,
    AbortController, FormData, CustomEvent: class {}, Event: class {},
    setInterval, clearInterval, setTimeout, clearTimeout, requestAnimationFrame: window.requestAnimationFrame,
    queueMicrotask, encodeURIComponent, decodeURIComponent, fetch: async () => ({ ok: false }),
    API_URL: 'https://api.test', readJsonResponse: async () => ({})
  };
  vm.runInNewContext(clientJs, context);
  window.TragoClientOrders.upsert({ id: 'aaaaaaaaaaaaaaaaaaaaaaaa', status: 'completed', price: 10 }, { render: false });
  assert.equal(window.TragoClientOrders.active().length, 0);
  assert.equal(window.TragoClientOrders.all()[0].status, 'concluido');

  localStorage.setItem('tragoClientSession', JSON.stringify({ id: 'user-one', token: 'token' }));
  window.TragoClientOrders.resetSession();
  assert.equal(window.TragoClientOrders.all().length, 0);
  window.TragoClientOrders.upsert({ id: 'bbbbbbbbbbbbbbbbbbbbbbbb', status: 'pendente' }, { render: false });
  assert.equal(window.TragoClientOrders.active().length, 1);

  localStorage.removeItem('tragoClientSession');
  window.TragoClientOrders.resetSession();
  assert.equal(window.TragoClientOrders.all().length, 1);
  assert.equal(window.TragoClientOrders.all()[0].id, 'aaaaaaaaaaaaaaaaaaaaaaaa');
});


test('resposta remota vazia remove pedido activo obsoleto e pedidos iguais partilham single-flight', async () => {
  const localStorage = makeStorage();
  const sessionStorage = makeStorage();
  localStorage.setItem('tragoClientSession', JSON.stringify({ id: 'user-one', token: 'token' }));
  localStorage.setItem('tragoClientOrderHistory:user-one', JSON.stringify([{ id: 'cccccccccccccccccccccccc', status: 'pendente' }]));
  let requestCount = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const document = { querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
  const window = {
    localStorage, sessionStorage, document,
    addEventListener() {}, removeEventListener() {},
    setInterval, clearInterval, setTimeout, clearTimeout,
    requestAnimationFrame: (callback) => callback(),
    location: { href: 'https://example.test/cliente.html', hash: '' }
  };
  window.window = window;
  const fetch = async () => {
    requestCount += 1;
    await gate;
    return { ok: true, status: 200, _data: { orders: [], totals: { active: 0, completed: 0, cancelled: 0 }, hasMore: false, nextCursor: '' } };
  };
  vm.runInNewContext(clientJs, {
    window, document, localStorage, sessionStorage, navigator: { onLine: true },
    console, Intl, Date, Map, Set, WeakMap, Promise, URL, URLSearchParams,
    AbortController, FormData, CustomEvent: class {}, Event: class {},
    setInterval, clearInterval, setTimeout, clearTimeout, requestAnimationFrame: window.requestAnimationFrame,
    queueMicrotask, encodeURIComponent, decodeURIComponent, fetch,
    API_URL: 'https://api.test', readJsonResponse: async (response) => response._data || {}
  });
  window.TragoClientRefreshSession();
  assert.equal(window.TragoClientOrders.active().length, 1);
  const first = window.TragoClientOrders.refresh(true);
  const second = window.TragoClientOrders.refresh(true);
  assert.equal(requestCount, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(window.TragoClientOrders.active().length, 0);
});

test('pedidos de convidado podem ser associados com token seguro', () => {
  includes(clientJs, ['claimGuestOrdersForSession', '/api/client/orders/claim', 'access_token'], 'client.js');
  includes(apiTs, ["path === '/api/client/orders/claim'", 'hashOrderAccessToken(accessToken)', 'Este pedido já pertence a outra conta'], 'api/index.ts');
});

test('sincronização evita tempestade e rejeita respostas de outra conta', () => {
  includes(clientJs, [
    'orderRequestController', 'orderRequestPromise', 'orderQueuedRefresh',
    'orderOwnerVersion', 'owner !== currentOrderOwnerScope()',
    'version !== orderOwnerVersion', 'return orderRequestPromise'
  ], 'client.js');
});

test('separadores actualizam estado visual, acessível e dados reais', () => {
  includes(clientJs, ['setOrderHistoryFilter', "button.setAttribute('aria-pressed'", 'fetchOrderPage({ filter: target'], 'client.js');
  assert.match(clientV20, /TragoClientFilterOrders\?\.\(button\.dataset\.orderTab/);
  includes(html, ['data-order-tab="active"', 'data-order-tab="previous"', 'data-order-tab="cancelled"'], 'cliente.html');
});

test('histórico tem paginação, estado de sincronização e datas seguras', () => {
  includes(html, ['id="client-history-sync-status"', 'data-order-load-more', 'id="client-history-list"'], 'cliente.html');
  assert.doesNotMatch(html, /id="client-history-list"[^>]*aria-live=/);
  includes(clientJs, ['formatOrderDate', 'Data indisponível', 'loadMoreOrderHistory', 'ORDER_PAGE_SIZE'], 'client.js');
  includes(css, ['.v20-history-sync-status', '.v20-history-load-more', '.status-pill.status-cancelado'], 'client-ui-v21.css');
});

test('login, logout e 401 reinicializam estado por identidade', () => {
  includes(clientJs, ['identityChanged', 'resetOrderSessionState()', 'panelNavigation?.destroy?.()', 'TragoClientRefreshFavorites'], 'client.js');
  includes(clientV20, ["response.status === 401", 'TragoClientRefreshSession?.({ refreshData: true })', 'TragoClientResetOrderTracking'], 'client-v20.js');
});

test('tracking de pedidos encerrados pára polling', () => {
  includes(clientV20, ['isTerminalOrderStatus', 'orderChatTimer = null', 'clearInterval(orderChatTimer)'], 'client-v20.js');
  assert.match(clientV20, /if \(!isTerminalOrderStatus\(activeOrderEntry\?\.status\)\)/);
});

test('API pagina por estado com cursor e totais exactos', () => {
  includes(apiTs, [
    "path === '/api/client/orders'", "filter === 'active'", "filter === 'completed'",
    'activeCountResult', 'completedCountResult', 'cancelledCountResult',
    'limit + 1', 'nextCursor', "order(sortColumn", 'sort_at'
  ], 'api/index.ts');
  assert.doesNotMatch(apiTs.slice(apiTs.indexOf("path === '/api/client/orders'"), apiTs.indexOf("path === '/api/client/addresses'")), /limit\(100\)/);
});

test('migração preserva dados e cria índices por estado', () => {
  includes(migration, [
    'update public.orders', 'closed_at = coalesce',
    'idx_orders_client_active_cursor', 'idx_orders_client_completed_cursor', 'idx_orders_client_cancelled_cursor',
    "where status = 'concluido'", "where status = 'cancelado'"
  ], 'migração V21.5');
  assert.doesNotMatch(migration, /delete\s+from|truncate|drop\s+table/i);
});

test('navegação substitui controlador sem acumular listeners', () => {
  includes(navJs, ['controllers.get(role)?.destroy?.()', 'function destroy()', "removeEventListener('popstate'", "removeEventListener('pagehide'"], 'navigation-memory.js');
});

test('input fantasma foi removido e comprovativo continua disponível', () => {
  assert.doesNotMatch(html, /id="client-proof-file"/);
  assert.match(html, /data-upload-proof/);
  assert.match(clientV20, /delivery-proof/);
});

test('Service Worker usa versão V21.5 para invalidar cache antigo', () => {
  assert.match(sw, /trago-client-v21-7/);
  assert.match(swRegister, /client-v21-7/);
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
