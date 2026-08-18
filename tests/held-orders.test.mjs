import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHeldOrder, isSameServiceLocation } from '../assets/pos-core.js';

const products = [{ id: 'food', name: 'ต้มแซ่บ', category: '(06) ครัวอีสาน', price: 85 }];
const cart = [{ lineId: 'line-1', productId: 'food', quantity: 2, note: 'ไม่ใส่ผัก' }];
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../assets/pos-app.js', import.meta.url), 'utf8');

test('held order preserves editable cart, table and calculated total', () => {
  const held = createHeldOrder({
    cart,
    products,
    serviceLocation: { type: 'table', zone: 'D', table: 4 },
    now: new Date('2026-08-18T14:00:00.000Z'),
    id: 'held-1',
  });

  assert.equal(held.id, 'held-1');
  assert.equal(held.status, 'held');
  assert.equal(held.total, 170);
  assert.equal(held.itemCount, 2);
  assert.deepEqual(held.serviceLocation, { type: 'table', zone: 'D', table: 4, label: 'โซน D · โต๊ะ 4' });
  assert.deepEqual(held.cart, cart);
  assert.notEqual(held.cart, cart);
});

test('table matching prevents two open bills for the same table but not takeaway bills', () => {
  assert.equal(
    isSameServiceLocation(
      { type: 'table', zone: 'D', table: 4 },
      { type: 'table', zone: 'D', table: 4 },
    ),
    true,
  );
  assert.equal(isSameServiceLocation({ type: 'table', zone: 'D', table: 4 }, { type: 'table', zone: 'D', table: 5 }), false);
  assert.equal(isSameServiceLocation({ type: 'takeaway' }, { type: 'takeaway' }), false);
});

test('sale and orders screens expose hold, resume and cancel controls', () => {
  assert.match(html, /id="hold-order"/);
  assert.match(html, /id="held-orders"/);
  assert.match(app, /function holdCurrentOrder/);
  assert.match(app, /data-resume-held/);
  assert.match(app, /data-cancel-held/);
  assert.match(app, /STORAGE_KEYS\.heldOrders/);
});
