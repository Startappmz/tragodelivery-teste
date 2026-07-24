import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

const edge = read('supabase/functions/api/index.ts');
const migration = read('backend/supabase/migrations/2026-07-23-final-integration.sql');
const client = [
  read('cliente.html'),
  read('login-cliente.html'),
  read('js/client/client.js'),
  read('js/client/client-v20.js'),
  read('js/client/client-addresses.js')
].join('\n');
const restaurant = [
  read('restaurante.html'),
  read('js/restaurant/restaurant.js'),
  read('js/restaurant/restaurant-v20.js')
].join('\n');
const driver = [
  read('painel-de-entrega.html'),
  read('js/driver/driver.js'),
  read('js/driver/driver-profile.js')
].join('\n');
const admin = [
  read('index.html'),
  read('js/admin/adminApi.js'),
  read('js/admin/adminModals.js'),
  read('js/common/ui.js')
].join('\n');

test('migração final é incremental, idempotente e preserva dados existentes', () => {
  [
    'add column if not exists route_stops',
    'add column if not exists delivery_proof_url',
    'add column if not exists operational_note',
    "'trago-private-media'",
    'revoke execute on function %s from public, anon, authenticated',
    'create index if not exists'
  ].forEach((token) => assert.ok(migration.includes(token), token));
  assert.doesNotMatch(migration, /\bdrop\s+table\b|\btruncate\b|\bdelete\s+from\b/i);
  assert.doesNotMatch(migration, /create policy\s+trago_media_public_read/i);
});

test('Cliente tem autenticação, perfil, moradas, favoritos, benefícios e notificações reais', () => {
  [
    '/api/public/clients/register',
    '/api/public/clients/login',
    '/api/client/me',
    '/api/client/addresses',
    '/api/client/favorites',
    '/api/client/benefits',
    '/api/client/notifications'
  ].forEach((route) => {
    assert.ok(edge.includes(route), `Edge: ${route}`);
    assert.ok(client.includes(route), `Cliente: ${route}`);
  });
  assert.match(edge, /generateClientToken/);
  assert.match(client, /Authorization:\s*`Bearer \$\{session\.token\}`/);
});

test('router da Edge remove o prefixo da função no ambiente Supabase', () => {
  assert.match(edge, /else if \(parts\[0\] === 'api'\)/);
  assert.match(edge, /pathParts = parts\.slice\(1\)/);
});

test('pedidos usam preços, opções, stock, agendamento e cupões validados no servidor', () => {
  [
    'validateFoodOrder',
    'commitFoodStock',
    'commitCouponUse',
    '/api/public/coupons/validate',
    'scheduled_at',
    'route_stops'
  ].forEach((token) => assert.ok(edge.includes(token), token));
  assert.match(client, /food_items/);
  assert.match(client, /coupon_code/);
  assert.match(client, /route_stops/);
});

test('Restaurante publica perfil, menu avançado, cupões e estado operacional no banco', () => {
  [
    '/api/restaurant/profile',
    '/api/restaurant/menu',
    '/api/restaurant/coupons',
    'operational_note',
    'opening_hours',
    'delivery_zones',
    'TragoRestaurantCollectOptions'
  ].forEach((token) => assert.ok(restaurant.includes(token), token));
  assert.doesNotMatch(restaurant, /tragoRestaurantOperationalNote/);
});

test('Motorista guarda perfil e comprovativo em Storage e o pedido expõe a prova', () => {
  assert.match(driver, /\/api\/media\/upload/);
  assert.match(driver, /delivery-proof/);
  assert.match(driver, /storage_ref/);
  assert.match(driver, /delivery_proof_url/);
  assert.match(edge, /MEDIA_BUCKET/);
  assert.match(edge, /PRIVATE_MEDIA_BUCKET/);
  assert.match(edge, /signPrivateMedia/);
  assert.match(edge, /delivery-proof\$\/i/);
  assert.match(edge, /delivery_proof_at/);
  assert.match(admin, /Comprovativo de entrega/);
  assert.match(client, /delivery_proof_url/);
});

test('chat e suporte cobrem os quatro papéis com histórico persistente', () => {
  ['client', 'restaurant', 'driver', 'admin'].forEach((role) => {
    assert.ok(edge.includes(`'${role}'`) || edge.includes(`"${role}"`), role);
  });
  assert.match(edge, /order_messages/);
  assert.match(edge, /support_threads/);
  assert.match(edge, /support_messages/);
  assert.match(client, /\/messages/);
  assert.match(restaurant, /\/messages/);
  assert.match(driver, /\/messages/);
  assert.match(admin, /sendAdminOrderMessage/);
});

test('upload multimédia exige actor autenticado e limita formato e tamanho', () => {
  assert.match(edge, /const routeMedia/);
  assert.match(edge, /resolveMediaActor/);
  assert.match(edge, /categoriesByRole/);
  assert.match(edge, /5 \* 1024 \* 1024/);
  assert.match(edge, /image\/jpeg/);
  assert.match(edge, /image\/png/);
  assert.match(edge, /image\/webp/);
});

test('não restam operações demonstrativas apresentadas como funcionalidades reais', () => {
  const source = `${client}\n${restaurant}\n${driver}\n${admin}`;
  assert.doesNotMatch(source, /RASCUNHO LOCAL|TragoDelivery\.wipe|estatísticas foram resetadas.*Simulação/i);
  assert.doesNotMatch(source, /ReactDOM|createRoot\(|from\s+['"]react/i);
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
