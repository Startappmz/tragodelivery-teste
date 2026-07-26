import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [html, clientJs, clientV20, apiTs, css, addressesJs, sw, swRegister, migration] = await Promise.all([
  read('cliente.html'), read('js/client/client.js'), read('js/client/client-v20.js'),
  read('supabase/functions/api/index.ts'), read('css/client-ui-v21.css'),
  read('js/client/client-addresses.js'), read('sw.js'), read('js/common/sw-register.js'),
  read('backend/supabase/migrations/2026-07-26-client-v216-public-catalog-coupons.sql')
]);

const tests = [];
const test = (name, run) => tests.push({ name, run });
const includes = (source, values, label) => values.forEach((value) => assert.ok(source.includes(value), `${label} não contém ${value}`));

test('API agrega cupões TraGo e cupões dos restaurantes', () => {
  includes(apiTs, [
    'publicRestaurantCoupons', 'publicFinanceCoupon', "source: 'restaurant'", "source: 'platform'",
    "select('id,name,coupons,status')", 'restaurantCoupons', 'platformCoupons', 'clientRedemptions'
  ], 'api/index.ts');
  assert.match(apiTs, /coupons:\s*publicRestaurantCoupons\(restaurant\)/);
});

test('API não publica cupões inactivos, expirados ou esgotados', () => {
  includes(apiTs, ['couponDateIsActive', 'coupon.active === false', 'used >= limit', 'expiresAt'], 'api/index.ts');
});

test('fallback público usa cache RLS e função SECURITY INVOKER', () => {
  includes(clientJs, ['trago_public_catalog_coupons', 'TRAGO_SUPABASE_ANON_KEY'], 'client.js');
  includes(migration, [
    'trago_public_catalog_coupon_cache', 'enable row level security',
    'trago_public_catalog_coupon_cache_read', 'security invoker',
    'trg_restaurants_public_catalog_coupon_cache'
  ], 'migração V21.6');
  assert.doesNotMatch(migration, /trago_public_catalog_coupons\(\)[\s\S]{0,500}security definer/i);
});

test('benefícios apresentam código, desconto, restaurante e condições', () => {
  includes(clientV20, ['discount_label', 'restaurant_name', 'conditions', 'data-use-client-coupon'], 'client-v20.js');
  assert.match(clientV20, /Cupão \$\{code\} copiado/);
});

test('catálogo usa localização actual já capturada sem endpoint por card', () => {
  includes(clientJs, [
    "CURRENT_LOCATION_KEY = 'tragoClientCurrentLocationV1'", 'readCatalogLocation',
    'restaurantDistanceKm', 'haversineKm', "trago:current-location-updated"
  ], 'client.js');
  assert.doesNotMatch(clientJs, /fetch\([^\n]+distance[^\n]+restaurant/);
  includes(addressesJs, ['tragoClientCurrentLocationV1', "trago:current-location-updated"], 'client-addresses.js');
});

test('distância aparece em cards de restaurantes, pratos e perfis', () => {
  includes(clientJs, [
    'v20-food-card-context', 'v20-popular-distance', 'v20-restaurant-head-context',
    'Distância aproximada', 'Distância do restaurante', 'restaurantDistanceMarkup'
  ], 'client.js');
});

test('distância é declarada aproximada e tem fallback de privacidade', () => {
  includes(clientJs, ['≈ ${distance.toFixed', "'Activar localização'", "'Localização desligada'"], 'client.js');
  assert.doesNotMatch(clientJs, /latitude.*innerHTML|longitude.*innerHTML/i);
});

test('cupão activo aparece nos cards e perfil do restaurante', () => {
  includes(clientJs, ['v20-cover-coupon', 'restaurantCouponMarkup', 'restaurantCouponBanner', 'CUPÃO DISPONÍVEL'], 'client.js');
  includes(css, ['.v20-catalog-coupon', '.v20-cover-coupon', '.v20-restaurant-coupon-banner'], 'client-ui-v21.css');
});

test('assets V21.6 invalidam cache antigo', () => {
  includes(html, ['client-v217-1'], 'cliente.html');
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
