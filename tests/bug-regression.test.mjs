import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const clientHtml = read('cliente.html');
const clientLogin = read('login-cliente.html');
const clientJs = read('js/client/client.js');
const clientV20 = read('js/client/client-v20.js');
const clientAddresses = read('js/client/client-addresses.js');
const restaurantJs = read('js/restaurant/restaurant.js');
const restaurantV20 = read('js/restaurant/restaurant-v20.js');
const driverJs = read('js/driver/driver.js');
const driverMap = read('js/driver/driverMap.js');
const mapUi = read('js/common/map-ui.js');
const supabaseRealtime = read('js/common/supabaseRealtime.js');
const experience360 = read('css/experience-360.css');
const accessV20 = read('css/access-v20.css');
const feedback = read('js/common/feedback.js');
const navigation = read('js/common/navigation-memory.js');
const support = read('js/common/support.js');
const serviceWorker = read('sw.js');
const edge = read('supabase/functions/api/index.ts');
const expressOrders = read('backend/controllers/orderController.js');
const idGeneratorMigration = read('backend/supabase/migrations/2026-07-23-fix-trago-id-generator.sql');
const partnerMigration = read('backend/supabase/migrations/2026-07-24-trago-partners-and-purchase-source.sql');

const tests = [];
const test = (name, run) => tests.push({ name, run });

test('Service Worker clona a resposta antes da escrita assíncrona na cache', () => {
  const cloneAt = serviceWorker.indexOf('const cacheCopy = response.clone()');
  const cacheAt = serviceWorker.indexOf('caches.open(CACHE_NAME)', cloneAt);
  assert.ok(cloneAt >= 0);
  assert.ok(cacheAt > cloneAt);
  assert.ok(serviceWorker.includes("url.pathname.includes('/functions/v1/')"));
  assert.ok(serviceWorker.includes("if (request.method !== 'GET') return"));
});

test('os quatro portais usam leitura JSON segura e o Service Worker corrigido', () => {
  for (const file of ['cliente.html', 'restaurante.html', 'painel-de-entrega.html', 'index.html']) {
    const html = read(file);
    assert.ok(html.includes('js/common/http.js'), `${file} sem parser HTTP`);
    assert.ok(html.includes('js/common/sw-register.js'), `${file} sem actualização do Service Worker`);
  }
  for (const folder of ['js/client', 'js/restaurant', 'js/driver', 'js/admin', 'js/common']) {
    const files = fs.readdirSync(path.join(root, folder)).filter((file) => file.endsWith('.js'));
    for (const file of files) {
      const source = read(path.join(folder, file));
      assert.equal(/\.json\(\)/.test(source), false, `${folder}/${file} ainda usa response.json() directamente`);
    }
  }
});

test('cliente entra com email e palavra-passe sem pedir telefone ou PIN', () => {
  assert.ok(clientLogin.includes('id="client-password"'));
  assert.ok(clientLogin.includes("document.getElementById('client-phone-field').hidden = mode === 'login'"));
  assert.equal(clientLogin.includes('id="client-pin"'), false);
  assert.equal(clientHtml.includes('name="pin"'), false);
  assert.ok(clientV20.includes(': { email, password }'));
  assert.ok(edge.includes("const email = lowerEmail(body.email || body.identifier)"));
  assert.ok(edge.includes("Email ou palavra-passe incorrectos."));
  assert.ok(edge.includes("path === '/api/client/password'"));
  assert.ok(accessV20.includes('.v20-access-app [hidden]{display:none!important}'));
});

test('rota Admin de clientes não é interceptada pelo portal singular do Cliente', () => {
  assert.ok(edge.includes("path !== '/api/client' && !path.startsWith('/api/client/')"));
  assert.equal(edge.includes("if (!path.startsWith('/api/client')) return null"), false);
  assert.ok(edge.includes("path === '/api/clients' && method === 'GET'"));
});

test('Bottle Store tem interface própria, categorias e carrinho partilhado', () => {
  assert.ok(clientHtml.includes('data-panel="bottle-store"'));
  assert.ok(clientHtml.includes('id="bottle-store-results"'));
  assert.ok(clientHtml.includes('id="bottle-store-categories"'));
  assert.ok(clientJs.includes('function renderBottleStore()'));
  assert.ok(clientJs.includes("panel === 'bottle-store'"));
  assert.ok(clientJs.includes('renderFoodCard(item, restaurant)'));
});

test('home liga Parceiros TraGo e remove Carga apenas da secção de serviços', () => {
  const services = clientHtml.match(/<div class="v20-services">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.ok(services.includes('data-jump-panel="partners"'));
  assert.ok(services.includes('Parceiros TraGo'));
  assert.equal(services.includes('<strong>Carga</strong>'), false);
  assert.ok(clientHtml.includes('data-jump-panel="delivery"'));
});

test('Parceiros TraGo têm directório, mapa, candidatura segura e API real', () => {
  assert.ok(clientHtml.includes('data-panel="partners"'));
  assert.ok(clientHtml.includes('id="partners-map"'));
  assert.ok(clientHtml.includes('id="partner-application-form"'));
  assert.ok(clientJs.includes('function loadPartners('));
  assert.ok(clientJs.includes('function renderPartnersMap('));
  assert.ok(clientJs.includes('/api/public/partners/applications'));
  assert.ok(edge.includes("path === '/api/public/partners'"));
  assert.ok(edge.includes("path === '/api/public/partners/applications'"));
  assert.ok(edge.includes("status: 'pending'"));
  assert.ok(partnerMigration.includes('create table if not exists public.trago_partners'));
  assert.ok(partnerMigration.includes('alter table public.trago_partners enable row level security'));
});

test('Bottle Store tem perfil completo e Favoritos separa Bebidas de Pratos', () => {
  assert.ok(clientHtml.includes('data-panel="bottle-profile"'));
  assert.ok(clientHtml.includes('data-wishlist-tab="drinks"'));
  assert.ok(clientJs.includes('function renderBottleProfile('));
  assert.ok(clientJs.includes('function openBottleProfile('));
  assert.ok(clientJs.includes("activeTab === 'drinks'"));
  assert.ok(clientJs.includes('bottleCategoryFor(item, item.restaurant)'));
});

test('carga exige produto e origem real e cada ponto pode ser colocado no mapa', () => {
  assert.ok(clientHtml.includes('id="cargo-item-description"'));
  assert.ok(clientHtml.includes('id="cargo-partner-select"'));
  assert.ok(clientHtml.includes('data-map-target="pickup"'));
  assert.ok(clientHtml.includes('data-map-target="delivery"'));
  assert.ok(clientHtml.includes('data-map-target="stop"'));
  assert.ok(clientHtml.includes('id="map-place-search"'));
  assert.ok(clientJs.includes("kind: 'map-search'"));
  assert.ok(clientJs.includes("!['partner', 'map_location'].includes(state.cargoSourceType)"));
  assert.ok(clientJs.includes('requested_product: requestedProduct'));
  assert.ok(clientJs.includes('function openPointMap('));
  assert.ok(clientV20.includes('window.TragoClientAddCargoStop'));
  assert.ok(edge.includes("throw new HttpError(400, 'Escolha a categoria e descreva exactamente o produto ou carga.')"));
  assert.ok(edge.includes("purchase_source_type: purchaseSourceType"));
  assert.ok(partnerMigration.includes('add column if not exists requested_product'));
});

test('acompanhamento usa localização real do motorista e geometria rodoviária', () => {
  assert.ok(clientV20.includes('/api/public/geo/route'));
  assert.ok(clientV20.includes('context?.driver?.location?.lat'));
  assert.ok(clientV20.includes('drawTrackingRoute'));
  assert.ok(edge.includes("path === '/api/public/geo/route'"));
  assert.ok(experience360.includes('.trago-map-live-badge'));
});

test('mapas mostram rota, motorista e parceiros sem esperar pela API de geometria', () => {
  const routeRefresh = clientV20.slice(
    clientV20.indexOf('function refreshTrackingRoutes'),
    clientV20.indexOf('async function paintTrackingMap')
  );
  assert.ok(routeRefresh.includes('drawTrackingRoute(layers, [mainOrigin, delivery]'));
  assert.ok(routeRefresh.includes('drawTrackingRoute(layers, [driver, target]'));
  assert.equal(routeRefresh.includes('await trackingRoute'), false);
  assert.ok(clientV20.includes("upsertTrackingMarker(map, 'driver', driver"));
  assert.ok(clientV20.includes('}).setView([-25.9692, 32.5732], 12)'));
  assert.ok(clientV20.includes('signal: controller.signal'));
  assert.ok(mapUi.includes('function syncPartnerLayer'));
  assert.ok(clientJs.includes('syncClientPartnerLayers'));
  assert.ok(clientV20.includes("window.addEventListener('trago:partners-updated'"));
  assert.ok(driverMap.includes("fetch(`${API_URL}/api/public/partners`)"));
  assert.ok(driverMap.includes('syncPartnerLayer?.(map, mapPartners)'));
});

test('Cliente recebe a localização do motorista em canal Realtime privado do pedido', () => {
  assert.ok(clientHtml.includes('@supabase/supabase-js@2'));
  assert.ok(clientHtml.includes('js/common/supabaseRealtime.js'));
  assert.ok(supabaseRealtime.includes('async function connectOrderRealtime'));
  assert.ok(supabaseRealtime.includes('sha256Hex(safeAccessToken)'));
  assert.ok(supabaseRealtime.includes('`order:${safeOrderId}:${tokenHash}`'));
  assert.ok(clientV20.includes("event === 'order_driver_location'"));
  assert.ok(clientV20.includes('applyRealtimeDriverLocation(payload)'));
  assert.ok(edge.includes('const broadcastOrder = async'));
  assert.ok(edge.includes("broadcastOrder(activeOrderId, 'order_driver_location'"));
  assert.ok(edge.includes('public_access_token_hash'));
});

test('filtros rápidos são exclusivos e o botão limpar restaura Todos', () => {
  assert.ok(clientV20.includes("selected === 'all' ? [] : [selected]"));
  assert.ok(clientV20.includes('TragoClientSetDirectoryQuick'));
  assert.ok(clientJs.includes("key === 'all' ? state.directoryQuickFilters.length === 0"));
  assert.ok(clientJs.includes("state.directorySort = 'recommended'"));
});

test('notificações usam caixa remota estável, fila offline e gestos persistentes', () => {
  assert.ok(clientHtml.includes('class="v20-menu-badge" hidden>0</b>'));
  assert.equal(clientHtml.includes('class="v20-menu-badge">3</b>'), false);
  assert.ok(clientJs.includes('CLIENT_NOTIFICATIONS_CACHE_KEY'));
  assert.ok(clientJs.includes('CLIENT_NOTIFICATIONS_PENDING_KEY'));
  assert.ok(clientJs.includes('applyNotificationPendingState'));
  assert.ok(clientJs.includes('processNotificationQueue'));
  assert.ok(clientJs.includes('showNotificationUndo'));
  assert.equal(clientJs.includes('CLIENT_NOTIFICATIONS_DELETED_OVERRIDES_KEY'), false);
  assert.equal(clientJs.includes('CLIENT_NOTIFICATIONS_READ_OVERRIDES_KEY'), false);
  assert.ok(clientJs.includes('beginNotificationSwipe'));
  assert.ok(clientJs.includes("/api/client/notifications/${encodeURIComponent(operation.id)}/read"));
  assert.ok(clientJs.includes("method: operation.type === 'delete' ? 'DELETE' : 'POST'"));
  assert.ok(clientJs.includes("operation.type === 'read_all'"));
  assert.ok(edge.includes('clientNotificationReadMatch'));
  assert.ok(edge.includes('clientNotificationDeleteMatch'));
  assert.ok(edge.includes('summaryOnly'));
  assert.ok(edge.includes('nextCursor'));
  assert.ok(edge.includes(".is('deleted_at', null)"));
});

test('Voltar guarda a origem e não fica preso ao Menu', () => {
  assert.ok(clientHtml.includes('data-panel="notifications"'));
  assert.ok(clientHtml.includes('data-fallback-panel="home"'));
  assert.ok(clientJs.includes("button.removeAttribute('data-jump-panel')"));
  assert.ok(navigation.includes('scroll, stack, current'));
  assert.ok(navigation.includes("sessionState.current !== target"));
});

test('favoritos usam o tipo aceite pela base de dados e mantêm compatibilidade antiga', () => {
  assert.ok(clientV20.includes("button.dataset.favoriteType = 'product'"));
  assert.ok(clientJs.includes('data-favorite-type="restaurant"'));
  assert.ok(clientV20.includes('entity_type: entityType'));
  assert.ok(edge.includes("requestedEntityType === 'menu_item'"));
  assert.ok(edge.includes("? 'product'"));
  assert.ok(edge.includes("['restaurant', 'product']"));
  assert.ok(clientJs.includes('function renderWishlist()'));
  assert.ok(clientJs.includes('window.TragoClientRenderWishlist = renderWishlist'));
  assert.ok(clientV20.includes("new CustomEvent('trago:favorites-changed')"));
});

test('home distingue pratos de restaurantes e carrega imagens sob demanda', () => {
  assert.ok(clientJs.includes('function renderPopularRestaurantCard'));
  assert.ok(clientJs.includes('popularRestaurants.map(renderPopularRestaurantCard)'));
  assert.equal(clientJs.includes('favorites.map(({ restaurant, ...item }) => renderFoodCard'), false);
  assert.ok(clientJs.includes('loading="lazy" decoding="async"'));
  assert.ok(clientHtml.includes('id="client-header-avatar-image"'));
  assert.ok(clientHtml.includes('id="client-menu-avatar-image"'));
});

test('restaurante não apresenta acções inválidas em pedidos antigos já recolhidos', () => {
  assert.ok(restaurantJs.includes('function normalizeRestaurantStatus'));
  assert.ok(restaurantJs.includes("'recolha_em_progresso', 'recolha_concluida'"));
  assert.ok(edge.includes('pickup_completed_at || order.delivery_start_at'));
  assert.ok(edge.includes('pickup_authorized_at'));
  assert.equal(restaurantV20.includes("const labels = { accept: 'Pedido aceite."), false);
});

test('feedback, skeletons e navegação móvel final são partilhados pelos portais', () => {
  assert.ok(feedback.includes('window.TragoFeedback = Object.freeze'));
  for (const file of ['cliente.html', 'restaurante.html', 'painel-de-entrega.html', 'index.html']) {
    const html = read(file);
    assert.ok(html.includes('css/feedback.css'), file);
    assert.ok(html.includes('js/common/feedback.js'), file);
    assert.ok(html.includes('css/experience-360.css'), file);
  }
  assert.ok(experience360.includes('.trago-skeleton-card'));
  assert.ok(experience360.includes('[data-panel="communication"]'));
  assert.ok(experience360.includes('[data-panel="reviews"]'));
});

test('cesto de comida sobrevive a actualizações e reconcilia produtos reais', () => {
  assert.ok(clientJs.includes("const CART_KEY = 'tragoClientFoodCart'"));
  assert.ok(clientJs.includes('function restoreCart()'));
  assert.ok(clientJs.includes('function persistCart()'));
  assert.ok(clientJs.includes('function reconcileCartWithRestaurants()'));
  assert.ok(clientJs.includes('reconcileCartWithRestaurants();'));
});

test('pesquisa de moradas usada no checkout existe na Edge Function', () => {
  assert.ok(clientJs.includes('/api/public/geo/search'));
  assert.ok(edge.includes("path === '/api/public/geo/search'"));
  assert.ok(edge.includes('nominatim.openstreetmap.org/search'));
  assert.ok(edge.includes('AbortSignal.timeout(9000)'));
});

test('suporte gera IDs pelo schema correcto e actualiza a lista após criar a conversa', () => {
  assert.ok(idGeneratorMigration.includes('extensions.gen_random_bytes(12)'));
  assert.ok(idGeneratorMigration.includes('grant execute on function public.trago_generate_id() to service_role'));
  assert.ok(support.includes('async function load(selectFirst = false, force = false)'));
  assert.ok(support.includes('await load(false, true)'));
});

test('restaurante preserva nomes longos no cabeçalho móvel', () => {
  assert.ok(experience360.includes('.v20-restaurant-app .v20-restaurant-identity h1'));
  assert.ok(experience360.includes('-webkit-line-clamp: 2'));
  assert.ok(experience360.includes('white-space: normal'));
});

test('formulários assíncronos preservam a referência antes de aguardar a API', () => {
  assert.equal(restaurantJs.includes('event.currentTarget.reset()'), false);
  assert.equal(restaurantV20.includes('event.currentTarget.reset()'), false);
  assert.ok(restaurantJs.includes('const form = event.currentTarget'));
  assert.ok(restaurantV20.includes('const form = event.currentTarget'));
});

test('fluxos críticos não voltam aos diálogos nativos do navegador', () => {
  const sources = [
    clientJs,
    clientV20,
    clientAddresses,
    restaurantJs,
    restaurantV20,
    read('js/common/ui.js'),
    read('js/common/auth.js'),
    read('js/admin/adminApi.js'),
    read('js/admin/admin.js')
  ];
  const nativeDialog = /(^|[^\w.])(alert|confirm|prompt)\s*\(/m;
  for (const source of sources) assert.equal(nativeDialog.test(source), false);
});

test('produção não escreve tokens, credenciais ou corpos privados na consola', () => {
  const production = [
    read('js/common/auth.js'),
    read('js/admin/adminApi.js'),
    read('js/admin/admin.js'),
    read('js/admin/adminCharts.js'),
    read('js/driver/driver.js')
  ].join('\n');
  assert.equal(production.includes("console.log('Token encontrado:'"), false);
  assert.equal(production.includes("console.log('LOGIN RESPONSE:'"), false);
  assert.equal(/DEBUG .*BODY|SIMULAÇÃO|SIMULACAO/i.test(production), false);
});

test('restaurante agrupa pedidos aceites na fila de preparação', () => {
  assert.ok(restaurantJs.includes("else if (restaurantStatus === 'accepted') orderCounts.preparing += 1"));
  assert.ok(restaurantJs.includes("return ['accepted', 'preparing'].includes(restaurantStatus)"));
});

test('dados do motorista atribuído ficam isolados por conta do cliente', () => {
  assert.ok(clientV20.includes("localStorage.getItem(storageKey(ASSIGNED_DRIVER_KEY))"));
  assert.ok(clientV20.includes("localStorage.setItem(storageKey(ASSIGNED_DRIVER_KEY)"));
  assert.ok(clientV20.includes("localStorage.removeItem(storageKey(ASSIGNED_DRIVER_KEY))"));
  assert.equal(clientV20.includes("localStorage.getItem('tragoDriverPublicProfile')"), false);
});

test('detalhe do motorista actualiza apenas o texto do método de pagamento', () => {
  assert.ok(driverJs.includes("?.querySelector(':scope > span')"));
});

test('reatribuição liberta o motorista anterior e ocupa o novo nos dois backends', () => {
  for (const source of [edge, expressOrders]) {
    assert.ok(source.includes('ONLINE_FREE'));
    assert.ok(source.includes('ONLINE_BUSY'));
    assert.ok(source.includes('order.assigned_to_driver'));
  }
  assert.ok(edge.includes("await updateRow('driver_profiles', oldProfile.id, { status: DRIVER_STATUS.ONLINE_FREE })"));
  assert.ok(edge.includes("await updateRow('driver_profiles', newProfile.id, { status: DRIVER_STATUS.ONLINE_BUSY })"));
  assert.ok(expressOrders.includes('oldProfile.status = DRIVER_STATUS.ONLINE_FREE'));
  assert.ok(expressOrders.includes('newDriverProfile.status = DRIVER_STATUS.ONLINE_BUSY'));
});

let passed = 0;
for (const entry of tests) {
  try {
    await entry.run();
    passed += 1;
    console.log(`PASS ${entry.name}`);
  } catch (error) {
    console.error(`FAIL ${entry.name}`);
    console.error(error);
  }
}

console.log(`\n${passed}/${tests.length} testes passaram.`);
if (passed !== tests.length) process.exitCode = 1;
