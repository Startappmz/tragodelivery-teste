import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [
  driverHtml, driverCss, driverJs, profileJs, clientHtml, clientJs, clientV20Js,
  driverController, publicController, driverRoutes, driverModel, schema, migration, edgeApi
] = await Promise.all([
  read('painel-de-entrega.html'),
  read('css/driver-premium.css'),
  read('js/driver/driver.js'),
  read('js/driver/driver-profile.js'),
  read('cliente.html'),
  read('js/client/client.js'),
  read('js/client/client-v20.js'),
  read('backend/controllers/driverController.js'),
  read('backend/controllers/publicPortalController.js'),
  read('backend/routes/driverRoutes.js'),
  read('backend/models/DriverProfile.js'),
  read('backend/supabase/schema.sql'),
  read('backend/supabase/migrations/2026-07-22-driver-premium-profile.sql'),
  read('supabase/functions/api/index.ts')
]);
const driverTrackingJs = await read('js/driver/driverTracking.js');

const tests = [];
const test = (name, run) => tests.push({ name, run });
const includes = (source, values, label) => values.forEach((value) => assert.ok(source.includes(value), `${label} não contém ${value}`));

test('perfil premium é HTML, CSS e JavaScript puro', () => {
  const combined = `${driverHtml}\n${driverCss}\n${driverJs}\n${profileJs}`;
  assert.doesNotMatch(combined, /\breact(?:dom)?\b|\.jsx\b|\.tsx\b|createRoot/i);
  includes(driverHtml, ['css/driver-premium.css', 'js/driver/driver-profile.js', 'id="driver-profile-form"'], 'painel do motorista');
});

test('motorista pode gerir identidade, viatura e documentos com privacidade', () => {
  includes(driverHtml, [
    'id="driver-avatar-file"', 'id="driver-vehicle-file"', 'id="driver-license-file"',
    'name="vehicle_plate"', 'name="vehicle_brand"', 'name="vehicle_model"',
    'name="license_number"', 'name="emergency_phone"',
    'O cliente vê apenas o perfil público e a viatura.'
  ], 'perfil do motorista');
  includes(profileJs, ['compressImage', 'tragoDriverPublicProfile', '/api/drivers/me/profile', 'calculateCompletion'], 'driver-profile.js');
  includes(driverCss, ['.driver-profile-layout', 'Reparação estrutural do painel do Motorista', '@media (max-width: 760px)'], 'driver-premium.css');
  assert.doesNotMatch(driverHtml, /Como o cliente o vê|Portais interligados|driver-public-preview-card|driver-portal-links-premium/);
});

test('layout do Motorista elimina compactação, navegação duplicada e grelhas partidas', () => {
  assert.doesNotMatch(driverHtml, /driver-compact-ui|driver-mobile-nav|mobile-driver-menu-toggle/);
  assert.equal((driverHtml.match(/class="driver-map-footer"/g) || []).length, 1);
  includes(driverHtml, ['class="driver-bottom-nav"', 'id="bottom-nav-entregas"', 'id="bottom-nav-sair"'], 'navegação do motorista');
  includes(driverCss, [
    'grid-template-columns: repeat(5, minmax(0, 1fr)) !important',
    'grid-template-columns: minmax(0, 1fr) !important',
    '.v20-driver-app .support-sidebar-head',
    'font-size: 13px !important'
  ], 'reparação responsiva');
  includes(driverJs, ['`Pedido #${orderId.slice(-6)}`'], 'detalhe do pedido');
});

test('ganhos têm um único controlo visual, métricas, gráfico e extrato', () => {
  includes(driverHtml, [
    'id="driver-period-label"', 'id="driver-average-earning"', 'id="driver-performance-chart"',
    'id="driver-refresh-earnings"', 'id="driver-export-earnings"', 'driver-earnings-period-select" hidden'
  ], 'ganhos do motorista');
  includes(driverJs, ['renderDriverEarningsChart', 'exportDriverEarnings', 'TragoDriverEarningsData'], 'driver.js');
  assert.match(driverCss, /@media \(max-width: 700px\)[\s\S]*driver-earnings-stats[\s\S]*grid-template-columns: 1fr 1fr/);
});

test('modais do Motorista nunca deixam apenas o fundo escuro visível', () => {
  includes(driverCss, [
    'body.v20-driver-app .driver-modal > .modal-content',
    'opacity: 1 !important',
    'transform: none !important',
    'body.v20-driver-app .driver-modal.hidden'
  ], 'driver-premium.css');
  includes(driverJs, ['initDriverModalGuard', "attributeFilter: ['class']", 'driver-modal-open'], 'driver.js');
  includes(driverTrackingJs, [
    'locationPromptDismissed',
    'hideLocationModal({ dismissed: true })',
    "modal.setAttribute('aria-hidden', 'true')",
    'showLocationPermissionModal({ force: true })'
  ], 'driverTracking.js');
  assert.doesNotMatch(driverTrackingJs, /closeBtn\.style\.display\s*=\s*['"]none['"]/);
});

test('cliente abre identificação pública ao tocar na viatura do mapa', () => {
  includes(clientHtml, [
    'data-open-assigned-driver', 'id="client-driver-profile-sheet"',
    'data-assigned-driver-avatar', 'data-assigned-driver-plate', 'data-assigned-driver-vehicle-photo'
  ], 'cliente.html');
  includes(clientV20Js, ['TragoClientSetAssignedDriver', 'renderAssignedDriver', 'tragoClientAssignedDriver'], 'client-v20.js');
  includes(clientJs, ['TragoClientSetAssignedDriver?.(data.driver)'], 'client.js');
});

test('backend expõe só identificação pública e mantém documentos privados', () => {
  includes(driverRoutes, ["'/me/profile'", 'getMyProfile', 'updateMyProfile'], 'driverRoutes.js');
  includes(driverController, ['driverProfilePayload', 'license_photo_url', 'publicDriverPayload'], 'driverController.js');
  includes(publicController, ['publicAssignedDriver', 'avatar_url', 'vehicle_photo_url'], 'publicPortalController.js');
  const publicBlock = publicController.match(/const publicAssignedDriver[\s\S]*?const findNearestFreeDriver/)?.[0] || '';
  assert.doesNotMatch(publicBlock, /license|emergency/i);
  includes(driverModel, ['avatar_url', 'vehicle_photo_url', 'license_photo_url', 'vehicle_color'], 'DriverProfile.js');
});

test('Supabase e Express partilham o contrato do perfil premium e radar', () => {
  includes(schema, ['avatar_url text', 'vehicle_photo_url text', 'license_photo_url text', 'vehicle_color text'], 'schema.sql');
  includes(migration, ['add column if not exists avatar_url', 'add column if not exists verified'], 'migração');
  includes(edgeApi, [
    "path === '/api/drivers/me/profile'", 'radar-assign', 'publicAssignedDriver',
    'vehicle_photo_url: row.vehicle_photo_url'
  ], 'Supabase Edge API');
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
