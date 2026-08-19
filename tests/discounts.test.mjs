import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateCart, createHeldOrder, createOrder, summarizeOrders } from '../assets/pos-core.js';

const product = { id: 'food', name: 'ข้าว', category: '(01) อาหารจานเดียว', price: 100, cost: 40 };
const location = { type: 'table', zone: 'A', table: 1 };

test('item discount is applied before the bill discount', () => {
  const totals = calculateCart([
    { productId: 'food', quantity: 2, discount: { type: 'percent', value: 10 } },
  ], [product], { type: 'amount', value: 30 });

  assert.equal(totals.grossSubtotal, 200);
  assert.equal(totals.items[0].grossLineTotal, 200);
  assert.equal(totals.items[0].discountAmount, 20);
  assert.equal(totals.items[0].lineTotal, 180);
  assert.equal(totals.subtotal, 180);
  assert.equal(totals.orderDiscountAmount, 30);
  assert.equal(totals.discountTotal, 50);
  assert.equal(totals.total, 150);
});

test('fixed discounts cannot reduce an item or bill below zero', () => {
  const totals = calculateCart([
    { productId: 'food', quantity: 1, discount: { type: 'amount', value: 999 } },
  ], [product], { type: 'amount', value: 999 });

  assert.equal(totals.items[0].lineTotal, 0);
  assert.equal(totals.total, 0);
  assert.equal(totals.discountTotal, 100);
});

test('invalid percentage discounts are rejected', () => {
  assert.throws(
    () => calculateCart([{ productId: 'food', quantity: 1, discount: { type: 'percent', value: 101 } }], [product]),
    /ส่วนลด/,
  );
});

test('completed and held orders preserve item and bill discounts', () => {
  const cart = [{ productId: 'food', quantity: 1, discount: { type: 'amount', value: 10 } }];
  const orderDiscount = { type: 'percent', value: 10 };
  const order = createOrder({ cart, products: [product], orderDiscount, paymentMethod: 'qr', serviceLocation: location });
  const held = createHeldOrder({ cart, products: [product], orderDiscount, serviceLocation: location });

  assert.deepEqual(order.items[0].discount, { type: 'amount', value: 10 });
  assert.deepEqual(order.orderDiscount, orderDiscount);
  assert.equal(order.total, 81);
  const report = summarizeOrders([order]);
  assert.equal(report.revenue, 81);
  assert.equal(report.costOfGoods, 40);
  assert.equal(report.grossProfit, 41);
  assert.deepEqual(held.orderDiscount, orderDiscount);
  assert.equal(held.total, 81);
});

test('discount controls are available for items, cart, held bills, and receipts', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../assets/pos-app.js', import.meta.url), 'utf8');

  assert.match(html, /id="item-discount-type"/);
  assert.match(html, /id="item-discount-value"/);
  assert.match(html, /id="order-discount-type"/);
  assert.match(html, /id="order-discount-value"/);
  assert.match(app, /orderDiscount:\s*loadObject\(STORAGE_KEYS\.orderDiscount\)/);
  assert.match(app, /orderDiscount:\s*state\.orderDiscount/);
  assert.match(app, /held\.orderDiscount/);
  assert.match(app, /ส่วนลด/);
});
