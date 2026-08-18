import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createOrder, summarizeOrders } from '../assets/pos-core.js';

const location = { type: 'takeaway' };

test('daily report calculates gross profit from the cost captured at sale time', () => {
  const order = createOrder({
    cart: [{ productId: 'food', quantity: 2 }],
    products: [{ id: 'food', name: 'ข้าว', category: '(01) อาหารจานเดียว', price: 50, cost: 30 }],
    paymentMethod: 'qr',
    serviceLocation: location,
  });

  assert.equal(order.items[0].unitCost, 30);
  assert.equal(order.items[0].lineCost, 60);
  const summary = summarizeOrders([order]);
  assert.equal(summary.revenue, 100);
  assert.equal(summary.costOfGoods, 60);
  assert.equal(summary.grossProfit, 40);
  assert.equal(summary.grossMargin, 40);
  assert.equal(summary.missingCostItemCount, 0);
});

test('daily report marks profit incomplete when a sold item has no cost', () => {
  const order = createOrder({
    cart: [{ productId: 'drink', quantity: 3 }],
    products: [{ id: 'drink', name: 'น้ำ', category: '(09) เครื่องดื่ม', price: 20 }],
    paymentMethod: 'cash',
    amountReceived: 100,
    serviceLocation: location,
  });

  const summary = summarizeOrders([order]);
  assert.equal(summary.costOfGoods, 0);
  assert.equal(summary.grossProfit, 60);
  assert.equal(summary.missingCostItemCount, 3);
});

test('product editor and report expose local cost and daily profit metrics', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../assets/pos-app.js', import.meta.url), 'utf8');
  const products = readFileSync(new URL('../assets/pos-products.js', import.meta.url), 'utf8');

  assert.match(html, /id="product-cost"/);
  assert.match(html, /id="metric-cost"/);
  assert.match(html, /id="metric-profit"/);
  assert.match(html, /id="metric-margin"/);
  assert.match(html, /id="profit-cost-warning"/);
  assert.match(app, /summary\.grossProfit/);
  assert.match(app, /summary\.missingCostItemCount/);
  assert.doesNotMatch(products, /\bcost\s*:/);
});
