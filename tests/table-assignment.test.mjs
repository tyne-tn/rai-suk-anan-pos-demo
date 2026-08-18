import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_SERVICE_ZONES, createOrder } from '../assets/pos-core.js';

const products = [{ id: 'coffee', name: 'กาแฟ', category: '(09) เครื่องดื่ม', price: 50 }];
const cart = [{ productId: 'coffee', quantity: 1 }];
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../assets/pos-app.js', import.meta.url), 'utf8');

test('default service layout has A-D and extra zones with ten tables each', () => {
  assert.deepEqual(DEFAULT_SERVICE_ZONES.map((zone) => zone.name), ['A', 'B', 'C', 'D', 'โต๊ะเสริม']);
  DEFAULT_SERVICE_ZONES.forEach((zone) => assert.deepEqual(zone.tables, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
});

test('completed order stores a validated table assignment', () => {
  const order = createOrder({
    cart,
    products,
    paymentMethod: 'cash',
    amountReceived: 100,
    serviceLocation: { type: 'table', zone: 'B', table: 7 },
  });
  assert.deepEqual(order.serviceLocation, { type: 'table', zone: 'B', table: 7, label: 'โซน B · โต๊ะ 7' });
});

test('takeaway orders are supported and missing locations are rejected', () => {
  const takeaway = createOrder({ cart, products, paymentMethod: 'qr', serviceLocation: { type: 'takeaway' } });
  assert.equal(takeaway.serviceLocation.label, 'กลับบ้าน');
  assert.throws(() => createOrder({ cart, products, paymentMethod: 'qr' }), /กรุณาเลือกโซนและโต๊ะ/);
  assert.throws(() => createOrder({ cart, products, paymentMethod: 'qr', serviceLocation: { type: 'table', zone: 'Z', table: 99 } }), /โซนหรือโต๊ะไม่ถูกต้อง/);
});

test('sale screen exposes zone and table selection controls', () => {
  assert.match(html, /id="choose-location"/);
  assert.match(html, /id="location-dialog"/);
  assert.match(html, /id="zone-options"/);
  assert.match(html, /id="table-options"/);
  assert.match(app, /order\.serviceLocation\?\.label/);
});
