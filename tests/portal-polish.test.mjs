import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [clientHtml, restaurantHtml, driverHtml, adminHtml, polishCss, navigationJs, clientJs, clientV20Js, clientAddressesJs, restaurantJs, restaurantV20Js, driverJs] = await Promise.all([
  read('cliente.html'),
  read('restaurante.html'),
  read('painel-de-entrega.html'),
  read('index.html'),
  read('css/experience-polish.css'),
  read('js/common/navigation-memory.js'),
  read('js/client/client.js'),
  read('js/client/client-v20.js'),
  read('js/client/client-addresses.js'),
  read('js/restaurant/restaurant.js'),
  read('js/restaurant/restaurant-v20.js'),
  read('js/driver/driver.js')
]);

const tests = [];
const test = (name, run) => tests.push({ name, run });

function assertIncludes(source, values, label) {
  for (const value of values) assert.ok(source.includes(value), `${label} não contém ${value}`);
}

test('polimento final está isolado dos três portais e não entra no Admin', () => {
  for (const [name, html] of [['Cliente', clientHtml], ['Restaurante', restaurantHtml], ['Motorista', driverHtml]]) {
    assertIncludes(html, ['css/experience-polish.css', 'js/common/navigation-memory.js'], name);
  }
  assert.doesNotMatch(adminHtml, /experience-polish|navigation-memory/);
});

test('navegação guarda painel, histórico e scroll com restauro seguro', () => {
  assertIncludes(navigationJs, [
    'sessionStorage', 'localStorage', 'pushState', 'replaceState', 'popstate',
    'pagehide', 'saveScroll', 'restorePosition', 'transientPages', 'data-smart-back'
  ], 'navigation-memory.js');
  assertIncludes(clientJs, ["role: 'client'", "transientPages: ['dish-detail', 'map']", 'restorablePages:', 'validateContext:', 'panelNavigation.restore()'], 'client.js');
  assertIncludes(restaurantJs, ["role: 'restaurant'", 'panelNavigation.restore()'], 'restaurant.js');
  assertIncludes(driverJs, ["role: 'driver'", "transientPages: ['detalhe-entrega']", 'driverNavigation.restore()'], 'driver.js');
});

test('navegação inteligente funciona com avanço, retorno e posição anterior', () => {
  const makeStorage = () => {
    const values = new Map();
    return {
      getItem: (key) => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key)
    };
  };
  const windowListeners = {};
  const documentListeners = {};
  const fakeWindow = {
    localStorage: makeStorage(),
    sessionStorage: makeStorage(),
    location: { href: 'file:///trago/cliente.html', hash: '' },
    history: {
      state: null,
      pushes: 0,
      replacements: 0,
      pushState(state, _title, href) { this.pushes += 1; this.state = state; fakeWindow.location.href = href; fakeWindow.location.hash = new URL(href).hash; },
      replaceState(state, _title, href) { this.replacements += 1; this.state = state; fakeWindow.location.href = href; fakeWindow.location.hash = new URL(href).hash; }
    },
    scrollY: 0,
    lastScroll: 0,
    scrollTo({ top }) { this.scrollY = top; this.lastScroll = top; },
    requestAnimationFrame(callback) { callback(); },
    addEventListener(type, listener) { windowListeners[type] = listener; }
  };
  const fakeDocument = {
    addEventListener(type, listener) { documentListeners[type] = listener; }
  };
  vm.runInNewContext(navigationJs, { window: fakeWindow, document: fakeDocument, URL, URLSearchParams, Map, Set, JSON, Math, Number, String, Array, Object, Error });

  const renders = [];
  const navigation = fakeWindow.TragoNavigation.create({
    role: 'client',
    pages: ['home', 'food', 'menu', 'dish-detail'],
    defaultPage: 'home',
    transientPages: ['dish-detail'],
    getCurrent: () => 'home',
    render: (page) => renders.push(page)
  });

  navigation.restore();
  fakeWindow.scrollY = 240;
  navigation.navigate('food');
  fakeWindow.scrollY = 480;
  navigation.navigate('menu');
  navigation.back();

  assert.deepEqual(renders, ['home', 'food', 'menu', 'food']);
  assert.equal(navigation.current, 'food');
  assert.equal(fakeWindow.lastScroll, 480);
  navigation.navigate('dish-detail');
  const saved = JSON.parse(fakeWindow.localStorage.getItem('trago:navigation:client:last'));
  assert.equal(saved.page, 'food', 'painel transitório não deve substituir a última página segura');
  const pushesBeforeTransientExit = fakeWindow.history.pushes;
  const replacementsBeforeTransientExit = fakeWindow.history.replacements;
  navigation.navigate('menu');
  assert.equal(fakeWindow.history.pushes, pushesBeforeTransientExit, 'sair de painel transitório deve substituir a entrada e não criar loop');
  assert.equal(fakeWindow.history.replacements, replacementsBeforeTransientExit + 1, 'saída do detalhe deve substituir a entrada transitória');
  navigation.back('home');
  assert.equal(navigation.current, 'food', 'Voltar depois de sair do detalhe deve regressar ao painel real anterior');
  const pushesBeforeRoot = fakeWindow.history.pushes;
  navigation.navigate('menu', { root: true, source: 'root' });
  assert.equal(fakeWindow.history.pushes, pushesBeforeRoot, 'navegação principal não deve poluir o histórico do botão Voltar');
  navigation.back('home');
  assert.equal(navigation.current, 'home', 'uma navegação principal deve limpar o percurso anterior');
  const session = JSON.parse(fakeWindow.sessionStorage.getItem('trago:navigation:client:session'));
  assert.equal(Array.isArray(session.stack), true, 'a memória de retorno deve ter um formato persistente e seguro');
  assert.deepEqual(session.stack, [], 'uma navegação principal deve também limpar a memória persistida');
  assert.equal(typeof windowListeners.popstate, 'function');
  assert.equal(typeof windowListeners.pagehide, 'function');
  assert.equal(typeof documentListeners.click, 'function');
});

test('localização actual e endereços guardados alimentam rotas e pedidos', () => {
  assertIncludes(clientHtml, [
    'id="client-address-sheet"', 'id="client-address-form"', 'data-address-type="home"',
    'data-address-type="work"', 'data-address-type="other"', 'id="client-address-list"',
    'Locais prontos para usar.', 'data-client-location-refresh', 'js/client/client-addresses.js'
  ], 'cliente.html');
  assertIncludes(clientAddressesJs, [
    'tragoClientSavedAddresses', 'tragoClientCurrentLocationV1', 'refreshCurrentLocation', 'renderAddresses', 'saveFromForm',
    'data-address-use', 'data-address-use-action', 'data-address-menu', 'data-address-default',
    'data-address-edit', 'data-address-delete', 'data-address-use-location', 'addressStorageKey'
  ], 'client-addresses.js');
  assertIncludes(clientJs, ['TragoClientUseSavedAddress', 'resolveSavedAddressPoint'], 'client.js');
  assertIncludes(clientHtml, ['data-smart-back', 'data-fallback-panel="food"'], 'cliente.html');
  assert.doesNotMatch(clientV20Js, /\[data-address-add\][\s\S]{0,180}jump-panel="map"/);
  assertIncludes(clientHtml, ['data-local-back', 'id="btn-cargo-back"'], 'cliente.html');
  assert.match(clientJs, /\.v20-back:not\(\[data-local-back\]\)/);
});

test('mapa de comida e rota de carga têm contextos e retornos independentes', () => {
  assertIncludes(clientHtml, [
    'data-map-context="food-delivery"', 'data-map-context="delivery-route"',
    'id="btn-map-back"', 'id="btn-confirm-map"', 'id="map-context-title"'
  ], 'cliente.html');
  assertIncludes(clientJs, [
    "mapContext: 'delivery-route'", "state.mapContext === 'food-delivery'",
    "kind === 'food-delivery'", 'foodDeliveryCoords', 'openMapContext', 'closeMapContext'
  ], 'client.js');
  assert.doesNotMatch(clientHtml, /id="food-delivery-address"[\s\S]{0,500}data-jump-panel="map"/);
});

test('componentes assinalados nas capturas têm composição dedicada', () => {
  assertIncludes(clientHtml, [
    'v20-vehicle-section', 'v20-map-workspace', 'v20-auth-sheet', 'v20-order-contact',
    'id="client-profile-sheet"', 'id="client-driver-chat-form"'
  ], 'cliente.html');
  assertIncludes(polishCss, [
    '.v20-client-app .v20-vehicle-section', '.v20-client-app .v20-map-workspace',
    '.v20-client-app .v20-auth-sheet > header:not(.simple)', '.v20-client-app .v20-order-contact',
    '.v20-client-app .v20-address-list'
  ], 'experience-polish.css');
});

test('fluxos de navegação duplicados e dependência antiga foram retirados', async () => {
  assert.doesNotMatch(clientJs, /\$\$\('\[data-jump-panel\]'\)\.forEach/);
  assert.doesNotMatch(restaurantV20Js, /v20-restaurant-tabs \[data-panel=.*\.click\(\)/);
  assert.doesNotMatch(driverHtml, /templatemo-glass-admin-script\.js/);
  assert.doesNotMatch(clientHtml, /data-open-view=/);
  await assert.rejects(access(new URL('../js/client/client-visual.js', import.meta.url)));
  await assert.rejects(access(new URL('../js/restaurant/restaurant-visual.js', import.meta.url)));
});

test('CSS final protege alinhamento, leitura, toque, modais e breakpoints', () => {
  assertIncludes(polishCss, [
    'min-width: 0', 'overflow-wrap: break-word', ':focus-visible', 'overscroll-behavior: contain',
    '@media (max-width: 1050px)', '@media (max-width: 960px)', '@media (max-width: 700px)',
    '@media (max-width: 520px)', 'env(safe-area-inset-left)', 'env(safe-area-inset-bottom)',
    '@media (prefers-reduced-motion: reduce)'
  ], 'experience-polish.css');
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
