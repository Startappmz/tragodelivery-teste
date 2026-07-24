import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [clientHtml, restaurantHtml, clientCss, restaurantCss, clientJs, clientV20Js, restaurantJs, restaurantV20Js, driverHtml, driverCss, driverJs, driverV20Js, supportJs, adminHtml, supportController, edgeApi] = await Promise.all([
  read('cliente.html'),
  read('restaurante.html'),
  read('css/portal-v20.css'),
  read('css/restaurant-v20.css'),
  read('js/client/client.js'),
  read('js/client/client-v20.js'),
  read('js/restaurant/restaurant.js'),
  read('js/restaurant/restaurant-v20.js'),
  read('painel-de-entrega.html'),
  read('css/driver-v20.css'),
  read('js/driver/driver.js'),
  read('js/driver/driver-v20.js'),
  read('js/common/support.js'),
  read('index.html'),
  read('backend/controllers/supportController.js'),
  read('supabase/functions/api/index.ts')
]);

const tests = [];
const test = (name, run) => tests.push({ name, run });

function idsIn(html) {
  return [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
}

function assertUniqueIds(html, label) {
  const ids = idsIn(html);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], [], `${label} tem IDs repetidos`);
}

function assertContainsAll(source, values, label) {
  for (const value of values) assert.ok(source.includes(value), `${label} não contém ${value}`);
}

function buttonsWithoutTypeInsideForms(html) {
  const missing = [];
  for (const form of html.matchAll(/<form\b[\s\S]*?<\/form>/gi)) {
    for (const button of form[0].matchAll(/<button\b([^>]*)>/gi)) {
      if (!/\btype\s*=/.test(button[1])) missing.push(button[0]);
    }
  }
  return missing;
}

test('portais são HTML, CSS e JavaScript puro', () => {
  const combined = `${clientHtml}\n${restaurantHtml}\n${driverHtml}\n${adminHtml}\n${clientCss}\n${restaurantCss}\n${driverCss}\n${clientV20Js}\n${restaurantV20Js}\n${driverV20Js}\n${supportJs}`;
  assert.doesNotMatch(combined, /\breact(?:dom)?\b|\.jsx\b|\.tsx\b|tailwind(?:css)?|createRoot/i);
  assertContainsAll(clientHtml, ['js/client/client.js', 'js/client/client-v20.js'], 'cliente.html');
  assertContainsAll(restaurantHtml, ['js/restaurant/restaurant.js', 'js/restaurant/restaurant-v20.js'], 'restaurante.html');
});

test('Cliente começa pelo onboarding V20 completo', () => {
  assertContainsAll(clientHtml, [
    'id="client-onboarding"',
    'id="onboarding-image"',
    'id="btn-next-onboarding"',
    'id="btn-location-later"',
    'assets/v20/images/onboard_1.svg'
  ], 'cliente.html');
  assertContainsAll(clientV20Js, [
    'Selecione a sua localização',
    'Escolha alimentos saborosos',
    'Receba tudo a tempo',
    'Encontre restaurantes e entregas perto de si',
    'assets/v20/images/delivery_location.svg'
  ], 'client-v20.js');
});

test('Cliente cobre navegação, descoberta e checkout do V20', () => {
  assertContainsAll(clientHtml, [
    'data-panel="home"', 'data-panel="food"', 'data-panel="dish-detail"',
    'data-panel="wishlist"', 'data-panel="history"', 'data-panel="menu"',
    'id="directory-filter-sheet"', 'id="cart-modal"', 'id="order-detail-sheet"',
    'id="food-checkout-form"', 'id="restaurants-container"', 'id="dish-detail-content"'
  ], 'cliente.html');
  assert.match(clientJs, /\/api\/public\/restaurants/);
});

test('Cliente inclui Bottle Store como fluxo independente', () => {
  assertContainsAll(clientHtml, [
    'data-panel="bottle-store"',
    'id="bottle-store-search"',
    'id="bottle-store-categories"',
    'id="bottle-store-results"'
  ], 'cliente.html');
  assertContainsAll(clientJs, [
    'function renderBottleStore()',
    'BOTTLE_CATEGORY_GROUPS',
    'data-bottle-category'
  ], 'client.js');
});

test('Cliente inclui Carga completa e mapa real', () => {
  assertContainsAll(clientHtml, [
    'id="cargo-step-selector"', 'id="cargo-step-details"', 'id="cargo-type-grid"',
    'data-cargo-type="carga"', 'data-cargo-type="flores"', 'data-vehicle="Camião"',
    'id="client-map"', 'id="client-delivery-form"', 'id="order-payment-method"'
  ], 'cliente.html');
});

test('Cliente não deixa de fora as áreas da conta', () => {
  assertContainsAll(clientHtml, [
    'data-panel="addresses"', 'data-panel="notifications"', 'data-panel="coupons"',
    'data-panel="preferences"', 'data-panel="language"', 'data-panel="support"',
    'data-panel="referral"', 'data-panel="policies"', 'data-panel="about"',
    'id="client-auth-sheet"'
  ], 'cliente.html');
});

test('Restaurante cobre as seis áreas do V20', () => {
  assertContainsAll(restaurantHtml, [
    'data-panel="overview"', 'data-panel="orders"', 'data-panel="menu"',
    'data-panel="profile"', 'data-panel="communication"', 'data-panel="reviews"',
    'id="restaurant-coupon-form"', 'id="restaurant-note-form"',
    'css/feedback.css', 'js/common/feedback.js'
  ], 'restaurante.html');
  assert.match(restaurantJs, /TragoFeedback\.confirm/, 'eliminação usa confirmação visual comum');
});

test('Restaurante mantém integrações reais do perfil, menu e pedidos', () => {
  assertContainsAll(restaurantHtml, [
    'id="menu-form"', 'id="restaurant-menu-list"', 'id="restaurant-orders-list"',
    'id="restaurant-profile-form"', 'id="profile-name"', 'id="profile-address"'
  ], 'restaurante.html');
  assertContainsAll(restaurantJs, ['/api/restaurant/menu', '/api/restaurant/orders', '/api/restaurant/profile'], 'restaurant.js');
});

test('Editor do Restaurante inclui stock, ingredientes, opções e disponibilidade', () => {
  assertContainsAll(restaurantHtml, [
    'id="menu-daily-stock"', 'id="menu-ingredients"', 'id="menu-details"',
    'id="menu-tags"', 'id="menu-option-groups"', 'id="menu-auto-disable"',
    'id="menu-unavailable-reason"', 'id="menu-available"'
  ], 'restaurante.html');
});

test('HTML não contém IDs duplicados', () => {
  assertUniqueIds(clientHtml, 'Cliente');
  assertUniqueIds(restaurantHtml, 'Restaurante');
});

test('sistema V20 contém Roboto, desktop, mobile e safe areas', () => {
  const css = `${clientCss}\n${restaurantCss}`;
  assertContainsAll(css, [
    '@font-face', 'Roboto', '#79b933', '.v20-onboarding', '.v20-bottom-nav',
    '.v20-restaurant-tabs', '.v20-products-layout', '@media(max-width:800px)',
    '@media(max-width:700px)', 'env(safe-area-inset-bottom)'
  ], 'CSS V20');
});

test('Motorista V20 preserva todos os contratos operacionais', () => {
  assertContainsAll(driverHtml, [
    'id="entregas-container"', 'id="driver-route-map"', 'id="btn-iniciar-entrega"',
    'id="form-finalizacao"', 'id="codigo-finalizacao"', 'id="entrega-status"', 'id="payment-confirmation-modal"',
    'id="driver-total-ganhos"', 'id="form-change-password-driver"',
    'id="btn-seguir-motorista"', 'id="btn-limpar-trilho"', 'id="btn-mapa-compacto"'
  ], 'painel-de-entrega.html');
  assertContainsAll(driverJs, [
    '/api/orders/my-deliveries', '/pickup-start', '/pickup-complete', '/delivery-start',
    '/payment-preview', '/complete', '/api/drivers/my-earnings', '/api/auth/change-password'
  ], 'driver.js');
});

test('Motorista V20 tem design responsivo e suporte interno sem atalhos de outros papéis', () => {
  assertContainsAll(driverHtml, [
    'id="suporte-motorista"', 'data-support-role="driver"', 'data-driver-nav="suporte-motorista"',
    'css/driver-v20.css', 'js/driver/driver-v20.js'
  ], 'painel-de-entrega.html');
  assert.doesNotMatch(driverHtml, /href="(?:cliente|restaurante|index)\.html"/);
  assertContainsAll(driverCss, ['Roboto', '#79b933', '.driver-bottom-nav', '@media(max-width:700px)', 'env(safe-area-inset-bottom)'], 'driver-v20.css');
  assert.match(`${driverHtml}\n${driverCss}\n${driverV20Js}`, /TragoSupport|data-support-hub/);
});

test('os quatro painéis partilham suporte interno persistente', () => {
  assertContainsAll(clientHtml, ['data-support-role="client"', 'js/common/support.js'], 'cliente.html');
  assertContainsAll(restaurantHtml, ['data-support-role="restaurant"', 'js/common/support.js'], 'restaurante.html');
  assertContainsAll(driverHtml, ['data-support-role="driver"', 'js/common/support.js'], 'painel-de-entrega.html');
  assertContainsAll(adminHtml, ['id="nav-support"', 'id="support-center"', 'data-support-role="admin"', 'js/common/support.js'], 'index.html');
  assertContainsAll(supportJs, ['listThreads', 'createThread', 'getMessages', 'sendMessage', 'updateThread'], 'support.js');
  assertContainsAll(supportController, ['SupportThread', 'SupportMessage', 'createAdminNotification'], 'supportController.js');
  assertContainsAll(edgeApi, ['routeSupport', "support_threads", "support_messages"], 'Supabase Edge API');
});

test('HTML dos quatro painéis não contém IDs duplicados', () => {
  assertUniqueIds(driverHtml, 'Motorista');
  assertUniqueIds(adminHtml, 'Admin');
});

test('portais operacionais não têm recursos locais quebrados nem submits acidentais', async () => {
  for (const [file, html] of [['cliente.html', clientHtml], ['restaurante.html', restaurantHtml], ['painel-de-entrega.html', driverHtml]]) {
    assert.deepEqual(buttonsWithoutTypeInsideForms(html), [], `${file} tem botões sem tipo explícito dentro de formulários`);
    const refs = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map((match) => match[1]);
    for (const ref of refs) {
      const clean = ref.split(/[?#]/)[0];
      if (!clean || /^(?:https?:|mailto:|tel:|data:)/.test(clean)) continue;
      await access(new URL(`../${clean}`, import.meta.url));
    }
  }
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
