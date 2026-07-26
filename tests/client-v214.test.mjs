import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [html, clientJs, addressesJs, navigationJs, a11yJs, css, apiTs, migration] = await Promise.all([
  read('cliente.html'),
  read('js/client/client.js'),
  read('js/client/client-addresses.js'),
  read('js/common/navigation-memory.js'),
  read('js/client/client-a11y-v21.js'),
  read('css/client-ui-v21.css'),
  read('supabase/functions/api/index.ts'),
  read('backend/supabase/migrations/2026-07-26-client-v214-notification-refinement.sql')
]);

const tests = [];
const test = (name, run) => tests.push({ name, run });
const includes = (source, values, label) => values.forEach((value) => assert.ok(source.includes(value), `${label} não contém ${value}`));

function makeStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

test('centro de notificações tem filtros, estados, paginação e região de anúncio isolada', () => {
  includes(html, [
    'id="client-notification-summary"', 'data-notification-filter="all"', 'data-notification-filter="unread"',
    'id="client-notification-sync-status"', 'data-notification-load-more', 'id="client-notification-announcer"'
  ], 'cliente.html');
  assert.doesNotMatch(html, /id="client-notification-list"[^>]*aria-live=/);
});

test('notificações usam fila offline, desfazer e cache versionado por cliente', () => {
  includes(clientJs, [
    'CLIENT_NOTIFICATIONS_CACHE_KEY', 'CLIENT_NOTIFICATIONS_PENDING_KEY', 'processNotificationQueue',
    'CLIENT_NOTIFICATION_UNDO_MS', 'showNotificationUndo', 'restoreDeletedNotification',
    'fetchClientNotificationSummary', 'startNotificationPolling', 'clientStorageKey',
    'ensureNotificationOwner', 'notificationRequestController', 'notificationQueuedFetch', "operation.type === 'read_all'"
  ], 'client.js');
  assert.doesNotMatch(clientJs, /CLIENT_NOTIFICATIONS_READ_OVERRIDES_KEY|CLIENT_NOTIFICATIONS_DELETED_OVERRIDES_KEY/);
});


test('marcar todas funciona offline e troca de conta limpa memória e pedidos antigos', () => {
  includes(clientJs, [
    "upsertNotificationOperation({ type: 'read_all', id: 'all'",
    "operation.type === 'read_all'",
    'notificationOwnerVersion += 1',
    'notificationRequestController?.abort?.()',
    "owner !== currentNotificationOwnerScope()"
  ], 'client.js');
  assert.doesNotMatch(clientJs, /unread\.forEach\([\s\S]{0,500}type: 'read'/);
});

test('mudança de filtro durante pedido activo agenda nova sincronização', () => {
  includes(clientJs, [
    'notificationRequestFilter', 'notificationQueuedFetch = { force: true, filter',
    'const queued = notificationQueuedFetch', 'queueMicrotask(() => fetchClientNotifications(queued))'
  ], 'client.js');
});

test('gesto para a direita não elimina visualmente notificação já lida', () => {
  includes(clientJs, [
    'const positiveLimit = item?.read_at ? 34 : 118',
    "(current.dx > 0 && item?.read_at)",
    "if (current.dx > 0) await markClientNotificationRead"
  ], 'client.js');
});

test('markup de notificação não contém controlo interactivo dentro de outro controlo', () => {
  assert.match(clientJs, /<div class=\"v20-notification-card\">/);
  assert.match(clientJs, /<button class=\"v20-notification-content\"/);
  assert.doesNotMatch(clientJs, /<article class=\"v20-notification-card\"[^>]*role=\"button\"/);
});

test('CSS cria camadas de composição apenas durante gesto', () => {
  assert.match(css, /\.v20-notification-row\.is-swiping \.v20-notification-card[\s\S]*will-change: transform/);
  const permanent = css.match(/\.v20-notification-card\s*\{[\s\S]*?\}/)?.[0] || '';
  assert.doesNotMatch(permanent, /will-change/);
  includes(css, ['.v20-notification-menu-toggle', '.v20-notification-mobile-actions', '.v20-notification-undo'], 'client-ui-v21.css');
});

test('API evita upsert incompatível e deduplica eventos por identidade real', () => {
  const clientNotificationFunction = apiTs.slice(apiTs.indexOf('const createClientNotification'), apiTs.indexOf('let operationalNotificationSyncPromise'));
  assert.match(clientNotificationFunction, /\.insert\(record\)/);
  assert.match(clientNotificationFunction, /23505/);
  assert.doesNotMatch(clientNotificationFunction, /\.upsert\(/);
  includes(clientNotificationFunction, ['driver_offer_id', 'driver_id', 'restaurant_id', 'event_id'], 'createClientNotification');
});

test('API suporta resumo, filtro, cursor e operações idempotentes', () => {
  includes(apiTs, [
    "summary_only", "query.filter === 'unread'", 'limit + 1', 'nextCursor', 'totalAll', 'totalUnread',
    'alreadyRead: true', 'alreadyDeleted: true', "order('id', { ascending: false })"
  ], 'api/index.ts');
});

test('migração cobre paginação visível e não lida', () => {
  includes(migration, ['idx_client_notifications_visible_cursor', 'idx_client_notifications_unread_cursor', 'deleted_at is null and read_at is null'], 'migração V21.4');
});

test('endereços locais são isolados por cliente e têm menu operacional compacto', () => {
  includes(addressesJs, ['addressStorageKey', 'TragoClientStorageKey', 'data-address-use', 'data-address-menu', 'data-address-use-action'], 'client-addresses.js');
  assert.doesNotMatch(addressesJs, /localStorage\.setItem\(STORAGE_KEY/);
  includes(html, ['id="client-address-use-sheet"', 'data-address-use-action="pickup"', 'data-address-use-action="food"', 'data-address-use-action="express"'], 'cliente.html');
});

test('localização automática poupa bateria e localização explícita mantém alta precisão', () => {
  assert.match(addressesJs, /enableHighAccuracy: manual === true/);
  assert.match(addressesJs, /function useCurrentLocation[\s\S]*enableHighAccuracy: true/);
});

test('navegação preserva contexto de perfil e não restaura subpáginas transitórias', () => {
  includes(navigationJs, ['normaliseContext', 'restorablePages', 'deepLinkPages', 'validateContext', 'applyContext', 'fallbackFor'], 'navigation-memory.js');
  includes(clientJs, ["context: { id: String(restaurantId) }", "context: { id: String(itemId)", 'restorablePages:', 'deepLinkPages:', 'fallbackFor:'], 'client.js');

  const listeners = {};
  const fakeWindow = {
    localStorage: makeStorage(), sessionStorage: makeStorage(),
    location: { href: 'file:///trago/cliente.html', hash: '' },
    history: {
      state: null,
      pushState(state, _title, href) { this.state = state; fakeWindow.location.href = href; fakeWindow.location.hash = new URL(href).hash; },
      replaceState(state, _title, href) { this.state = state; fakeWindow.location.href = href; fakeWindow.location.hash = new URL(href).hash; }
    },
    scrollY: 0, scrollTo() {}, requestAnimationFrame(callback) { callback(); },
    addEventListener(type, callback) { listeners[type] = callback; }
  };
  const fakeDocument = { addEventListener() {} };
  vm.runInNewContext(navigationJs, { window: fakeWindow, document: fakeDocument, URL, URLSearchParams, Map, Set, JSON, Math, Number, String, Array, Object, Error });
  let selected = '';
  const renders = [];
  const nav = fakeWindow.TragoNavigation.create({
    role: 'client', pages: ['home', 'food', 'restaurant-profile', 'dish-detail'], defaultPage: 'home',
    transientPages: ['dish-detail'], restorablePages: ['home', 'food'], getCurrent: () => 'home',
    validateContext: (page, context) => page !== 'restaurant-profile' || Boolean(context.id),
    applyContext: (_page, context) => { selected = context.id || ''; },
    fallbackFor: () => 'food', render: (page) => renders.push(page)
  });
  nav.restore();
  nav.navigate('restaurant-profile', { context: { id: 'abc123' } });
  assert.equal(selected, 'abc123');
  assert.match(fakeWindow.location.hash, /view=restaurant-profile&id=abc123/);
  nav.navigate('dish-detail', { context: { id: 'dish1' } });
  nav.back('food');
  assert.equal(nav.current, 'restaurant-profile');
  assert.equal(selected, 'abc123');
  assert.deepEqual(renders, ['home', 'restaurant-profile', 'dish-detail', 'restaurant-profile']);
});


test('nova sessão não reabre páginas internas não autorizadas para deep link', () => {
  const fakeWindow = {
    localStorage: makeStorage(), sessionStorage: makeStorage(),
    location: { href: 'file:///trago/cliente.html#view=notifications', hash: '#view=notifications' },
    history: {
      state: null,
      pushState(state, _title, href) { this.state = state; fakeWindow.location.href = href; fakeWindow.location.hash = new URL(href).hash; },
      replaceState(state, _title, href) { this.state = state; fakeWindow.location.href = href; fakeWindow.location.hash = new URL(href).hash; }
    },
    scrollY: 0, scrollTo() {}, requestAnimationFrame(callback) { callback(); }, addEventListener() {}
  };
  vm.runInNewContext(navigationJs, { window: fakeWindow, document: { addEventListener() {} }, URL, URLSearchParams, Map, Set, JSON, Math, Number, String, Array, Object, Error });
  const nav = fakeWindow.TragoNavigation.create({
    role: 'client', pages: ['home', 'food', 'notifications', 'restaurant-profile'], defaultPage: 'home',
    restorablePages: ['home', 'food'], deepLinkPages: ['home', 'food', 'restaurant-profile'], getCurrent: () => 'home',
    validateContext: (page, context) => page !== 'restaurant-profile' || Boolean(context.id), render() {}
  });
  nav.restore();
  assert.equal(nav.current, 'home');
});

test('foco de diálogo ignora backdrop invisível', () => {
  includes(a11yJs, ['.v20-sheet-backdrop', '.dish-detail-backdrop', '[data-autofocus]'], 'client-a11y-v21.js');
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
