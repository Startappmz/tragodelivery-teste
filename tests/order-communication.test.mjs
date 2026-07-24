import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

const expressRoutes = read('backend/routes/publicPortalRoutes.js') + read('backend/routes/orderRoutes.js');
const edge = read('supabase/functions/api/index.ts');
const migration = read('backend/supabase/migrations/2026-07-22-order-participant-communication.sql')
  + read('backend/supabase/migrations/2026-07-24-tracking-communication-security.sql');
const client = read('js/client/client.js') + read('js/client/client-v20.js') + read('cliente.html');
const restaurant = read('js/restaurant/restaurant.js') + read('restaurante.html');
const driver = read('js/driver/driver.js') + read('painel-de-entrega.html');
const admin = read('js/admin/adminApi.js') + read('js/admin/adminModals.js');

test('base de dados guarda participantes, estado e mensagens do pedido', () => {
  ['restaurant_id', 'restaurant_status', 'public_access_token_hash', 'create table if not exists public.order_messages'].forEach((token) => assert.ok(migration.includes(token), token));
});

test('Cliente tem contexto, chat e cancelamento autenticados por pedido', () => {
  ['/public/orders/:id/context', '/public/orders/:id/messages', '/public/orders/:id/cancel'].forEach((route) => assert.ok(expressRoutes.includes(route), route));
  assert.match(client, /X-Order-Access-Token/);
  assert.match(client, /public_access_token/);
});

test('token público é guardado apenas como hash no servidor', () => {
  assert.match(read('backend/utils/orderAccess.js'), /sha256/);
  assert.match(edge, /hashOrderAccessToken/);
  const fromOrder = edge.slice(edge.indexOf('const fromOrder ='), edge.indexOf('const fromOrderMessage ='));
  assert.doesNotMatch(fromOrder, /public_access_token_hash/);
});

test('Restaurante controla preparação e conversa real do pedido', () => {
  ['/restaurant/orders/:id/messages', '/restaurant/orders/:id/status', '/restaurant/orders/:id/confirm', '/restaurant/orders/:id/pickup-confirmation'].forEach((route) => assert.ok(expressRoutes.includes(route), route));
  ['preparing', 'rejected', '/confirm', '/pickup-confirmation'].forEach((status) => assert.ok(restaurant.includes(status), status));
  assert.match(restaurant, /restaurant-order-chat-stream/);
  assert.match(restaurant, /O Cliente não vê estas mensagens/);
});

test('Motorista recebe dois canais privados e autorização de recolha', () => {
  assert.match(driver, /driver-order-chat-stream/);
  assert.match(driver, /driver-restaurant-ready/);
  assert.match(driver, /client_driver/);
  assert.match(driver, /driver_partner/);
  assert.match(driver, /\/api\/orders\/\$\{encodeURIComponent\(driverActiveOrderId\)\}\/messages/);
});

test('levantamento de comida exige confirmação do restaurante nos dois backends', () => {
  assert.match(read('backend/controllers/orderController.js'), /pickupAuthorizedAt/);
  assert.match(edge, /pickup_authorized_at/);
});

test('Admin abre conversa em pedidos activos e históricos', () => {
  assert.match(admin, /Detalhes e conversa/);
  assert.match(admin, /loadAdminOrderMessages/);
  assert.match(admin, /sendAdminOrderMessage/);
});

test('Express e Supabase Edge expõem os mesmos contratos de comunicação', () => {
  ['context', 'messages', 'cancel', 'restaurantStatusMatch', 'restaurantConfirmMatch', 'restaurantPickupMatch', 'orderMessagesMatch'].forEach((token) => assert.ok(edge.includes(token), token));
});

test('Cliente recebe somente estados públicos e canal Cliente ↔ Motorista', () => {
  ['Pedido confirmado', 'Em preparação', 'A caminho', 'Entregue', 'Cancelado'].forEach((label) => assert.ok(client.includes(label), label));
  assert.match(client, /Canal privado Cliente ↔ Motorista/);
  assert.match(edge, /MESSAGE_CHANNEL\.CLIENT_DRIVER/);
  assert.match(edge, /publicStatusLabels/);
});

test('interfaces não apresentam operações demonstrativas como dados reais', () => {
  const clientHtml = read('cliente.html');
  const restaurantHtml = read('restaurante.html');
  assert.match(clientHtml, /v20-active-order hidden/);
  assert.match(client, /Motorista por atribuir/);
  assert.doesNotMatch(restaurantHtml, /#TG2048|TRAGO15|124 avaliações/);
  assert.doesNotMatch(restaurantHtml, /RASCUNHO LOCAL|RASCUNHOS|neste dispositivo/);
  assert.match(restaurantHtml, /PUBLICADOS/);
  assert.match(restaurantHtml, /restaurant-rating-average/);
  assert.match(read('backend/controllers/publicPortalController.js'), /if \(available !== undefined\) item\.available/);
});

test('ficheiros JavaScript alterados mantêm sintaxe válida', () => {
  const files = [
    'js/client/client.js', 'js/client/client-v20.js', 'js/restaurant/restaurant.js',
    'js/restaurant/restaurant-v20.js', 'js/driver/driver.js', 'js/driver/driverTracking.js',
    'js/admin/adminApi.js', 'js/admin/adminModals.js',
    'backend/controllers/orderCommunicationController.js', 'backend/controllers/publicPortalController.js',
    'backend/controllers/orderController.js', 'backend/routes/publicPortalRoutes.js', 'backend/routes/orderRoutes.js'
    , 'backend/utils/messageChannels.js', 'backend/utils/driverPresence.js', 'backend/utils/audit.js'
  ];
  files.forEach((file) => {
    const result = spawnSync(process.execPath, ['--check', resolve(root, file)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
  });
});

test('implementação continua em HTML, CSS e JavaScript puro', () => {
  const source = `${client}\n${restaurant}\n${driver}`;
  assert.doesNotMatch(source, /from\s+['"]react|ReactDOM|createRoot\(/);
});

let passed = 0;
for (const [name, fn] of cases) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}\n${error.stack || error}`); process.exitCode = 1; }
}
console.log(`\n${passed}/${cases.length} testes passaram.`);
