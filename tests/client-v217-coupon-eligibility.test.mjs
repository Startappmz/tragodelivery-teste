import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [html, clientJs, clientV20, apiTs, css, sw, swRegister] = await Promise.all([
  read('cliente.html'), read('js/client/client.js'), read('js/client/client-v20.js'), read('supabase/functions/api/index.ts'),
  read('css/client-ui-v21.css'), read('sw.js'), read('js/common/sw-register.js')
]);

const tests = [];
const test = (name, run) => tests.push({ name, run });
const includes = (source, values, label) => values.forEach((value) => assert.ok(source.includes(value), `${label} não contém ${value}`));

test('endpoint V21.7 devolve contrato de elegibilidade sem erro HTTP para cliente novo', () => {
  includes(apiTs, [
    'x-trago-coupon-contract', "contract !== 'eligibility-v1'", 'couponPublicResult',
    'recognized:', 'eligible:', "'minimum_not_reached'"
  ], 'api/index.ts');
  assert.match(apiTs, /return json\(publicResult\)/);
});

test('clientes antigos mantêm contrato legado durante rollout', () => {
  includes(apiTs, ['legacyStatus', "publicResult.status === 'not_found' ? 404", "publicResult.status === 'login_required' ? 401"], 'api/index.ts');
});

test('pedido mínimo de cupão é informação estruturada', () => {
  includes(apiTs, ['minimum_order:', 'current_subtotal:', 'missing_amount:', 'Adicione mais'], 'api/index.ts');
  assert.doesNotMatch(apiTs, /minimum_not_reached[\s\S]{0,300}throw new HttpError\(400/);
});

test('todas condições comerciais têm estados explícitos', () => {
  includes(apiTs, [
    "'inactive'", "'not_started'", "'expired'", "'usage_limit_reached'",
    "'restaurant_mismatch'", "'login_required'", "'client_limit_reached'",
    "'first_order_only'", "'delivery_fee_pending'", "'zero_discount'", "'not_found'"
  ], 'api/index.ts');
});

test('limite zero por cliente não vira limite um', () => {
  includes(apiTs, ['const perClientLimit = Math.max(0', 'perClientLimit > 0'], 'api/index.ts');
  assert.doesNotMatch(apiTs, /Number\(coupon\.per_client_limit \|\| 1\)/);
});

test('limite máximo ausente não zera desconto', () => {
  includes(apiTs, ['coupon.max_discount_cents != null'], 'api/index.ts');
  assert.doesNotMatch(apiTs, /coupon\.max_discount_cents !== null/);
});

test('criação do pedido revalida cupão com 422 em corrida de estado', () => {
  includes(apiTs, ['requireEligibleCoupon', 'new HttpError(422', 'couponEvaluation?.eligible'], 'api/index.ts');
});

test('frontend faz preflight local e evita POST 400 por pedido mínimo', () => {
  includes(clientJs, [
    'evaluateCatalogCouponLocally', "localEligibility?.eligible === false", 'couponMinimumOrderMzn',
    'Pedido mínimo de ${money(minimumOrder)}', "'X-Trago-Coupon-Contract': 'eligibility-v1'"
  ], 'client.js');
});

test('frontend trata resposta comercial sem toast de erro', () => {
  includes(clientJs, ['presentCouponEligibility', 'legacyCouponBusinessResult', 'setCartCouponFeedback'], 'client.js');
  assert.match(clientJs, /if \(data\.eligible !== true\) return presentCouponEligibility\(data\)/);
});

test('checkout avisa mínimo do restaurante antes do POST', () => {
  includes(clientJs, ['const minimumOrder = Math.max(0, Number(restaurant.min_order_amount || 0))', "$('#cart-list')?.scrollIntoView"], 'client.js');
  includes(html, ['cart-order-condition-feedback'], 'cliente.html');
});

test('feedback é acessível e distingue informação, sucesso, aviso e erro', () => {
  includes(html, ['cart-coupon-feedback', 'aria-live="polite"', 'role="status"'], 'cliente.html');
  includes(css, ['.v20-coupon-feedback.is-info', '.v20-coupon-feedback.is-success', '.v20-coupon-feedback.is-warning', '.v20-coupon-feedback.is-error'], 'client-ui-v21.css');
});


test('cupões da carteira alimentam o preflight do checkout', () => {
  includes(clientJs, ['registerCatalogCoupons', 'register: registerCatalogCoupons'], 'client.js');
  includes(clientV20, ['TragoClientCatalogCoupons?.register?.(data.coupons)'], 'client-v20.js');
});

test('cache V21.7 invalida assets antigos', () => {
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
