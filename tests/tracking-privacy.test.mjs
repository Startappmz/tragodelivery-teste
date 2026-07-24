import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

const channels = read('backend/utils/messageChannels.js');
const communication = read('backend/controllers/orderCommunicationController.js');
const presence = read('backend/utils/driverPresence.js');
const publicPortal = read('backend/controllers/publicPortalController.js');
const socket = read('backend/socketHandler.js');
const migration = read('backend/supabase/migrations/2026-07-24-tracking-communication-security.sql');
const edge = read('supabase/functions/api/index.ts');
const client = read('js/client/client-v20.js') + read('cliente.html');
const driver = read('js/driver/driver.js') + read('painel-de-entrega.html');
const restaurant = read('js/restaurant/restaurant.js') + read('restaurante.html');
const admin = read('js/admin/adminModals.js');

test('matriz de visibilidade impede o Cliente de ler o canal Motorista ↔ Loja', () => {
  assert.match(channels, /role === 'client'\)[^\n]+MESSAGE_CHANNEL\.CLIENT_DRIVER[^\n]+MESSAGE_CHANNEL\.SYSTEM/);
  assert.match(channels, /role === 'restaurant'\)[^\n]+MESSAGE_CHANNEL\.DRIVER_PARTNER[^\n]+MESSAGE_CHANNEL\.SYSTEM/);
  assert.match(channels, /role === 'driver'[\s\S]+MESSAGE_CHANNEL\.CLIENT_DRIVER,\s*MESSAGE_CHANNEL\.DRIVER_PARTNER/);
  assert.match(communication, /channelsForViewer/);
  assert.match(communication, /MESSAGE_CHANNEL\.CLIENT_DRIVER/);
  assert.match(communication, /MESSAGE_CHANNEL\.DRIVER_PARTNER/);
});

test('persistência inclui canal, papéis visíveis, presença e ofertas atómicas', () => {
  ['channel_type', 'visible_to_roles', 'driver_presence', 'driver_offers', 'trago_create_driver_offer', 'trago_respond_driver_offer'].forEach((token) => {
    assert.ok(migration.includes(token), token);
  });
  assert.match(migration, /create unique index[\s\S]+conversations\(order_id,\s*channel_type\)/i);
});

test('radar só usa presença disponível e recente', () => {
  assert.match(presence, /last_seen_at=gte/);
  assert.match(presence, /is_online=eq\.true&is_available=eq\.true/);
  assert.match(presence, /locationMaxAgeMs = 600000/);
  assert.match(publicPortal, /getFreshAvailablePresences/);
  assert.match(publicPortal, /distance_km <= radiusKm/);
  assert.match(publicPortal, /RADAR_EXPANDED_RADIUS_KM = 25/);
  assert.match(publicPortal, /radius_expanded/);
  assert.match(socket, /isFreshLocation[\s\S]+60000/);
  assert.match(socket, /PRESENCE_GRACE_MS = 45000/);
  assert.match(edge, /RADAR_LOCATION_TTL_MS = 10 \* 60 \* 1000/);
  assert.match(edge, /no_free_driver_in_25km/);
  assert.match(migration, /last_seen_at < now\(\) - interval '60 seconds'/);
  assert.match(migration, /location_updated_at < now\(\) - interval '10 minutes'/);
});

test('as quatro interfaces declaram canais e estados sem conversa partilhada', () => {
  assert.match(client, /Canal privado Cliente ↔ Motorista/);
  assert.match(driver, /client_driver/);
  assert.match(driver, /driver_partner/);
  assert.match(restaurant, /O Cliente não vê estas mensagens/);
  assert.match(admin, /name="channel"/);
  assert.doesNotMatch(client, /Motorista, restaurante e operação TraGo/);
  assert.doesNotMatch(restaurant, /Cliente, motorista, restaurante e Admin no mesmo pedido/);
});

test('Express e Edge aplicam autorização de recolha e estados públicos equivalentes', () => {
  const orderController = read('backend/controllers/orderController.js');
  assert.match(orderController, /pickupAuthorizedAt/);
  assert.match(edge, /pickup_authorized_at/);
  assert.match(edge, /publicStatusLabels/);
  ['Pedido confirmado', 'Em preparação', 'A caminho', 'Entregue', 'Cancelado'].forEach((label) => {
    assert.ok(client.includes(label), label);
    assert.ok(edge.includes(label), label);
  });
});

test('ficheiros críticos mantêm sintaxe JavaScript válida', () => {
  [
    'backend/utils/messageChannels.js',
    'backend/utils/driverPresence.js',
    'backend/utils/audit.js',
    'backend/controllers/orderCommunicationController.js',
    'backend/controllers/orderController.js',
    'backend/controllers/publicPortalController.js',
    'backend/controllers/driverController.js',
    'backend/socketHandler.js',
    'js/client/client-v20.js',
    'js/driver/driver.js',
    'js/restaurant/restaurant.js',
    'js/admin/adminModals.js'
  ].forEach((file) => {
    const result = spawnSync(process.execPath, ['--check', resolve(root, file)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
  });
});

let passed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}\n${error.stack || error}`);
    process.exitCode = 1;
  }
}
console.log(`\n${passed}/${cases.length} testes passaram.`);
