import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCart, supportsAddOns } from '../assets/pos-core.js';

const food = { id: 'food', category: '(01) อาหารจานเดียว' };
const drink = { id: 'drink', category: '(09) เครื่องดื่ม' };

test('add-ons use category defaults and allow a per-product override', () => {
  assert.equal(supportsAddOns(food), true);
  assert.equal(supportsAddOns(drink), false);
  assert.equal(supportsAddOns({ ...food, addOnsEnabled: false }), false);
  assert.equal(supportsAddOns({ ...drink, addOnsEnabled: true }), true);
});

test('product editor exposes and persists the add-on toggle', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../assets/pos-app.js', import.meta.url), 'utf8');

  assert.match(html, /id="product-addons-enabled"[^>]*type="checkbox"/);
  assert.match(app, /supportsAddOns\(product\)/);
  assert.match(app, /const addOnsEnabled = \$\('#product-addons-enabled'\)\.checked/);
  assert.match(app, /Object\.assign\(product, \{[^}]*addOnsEnabled/);
});

test('disabled add-ons cannot remain chargeable in the cart', () => {
  const product = { id: 'food', name: 'ข้าว', category: '(01) อาหารจานเดียว', price: 65, addOnsEnabled: false };
  const result = calculateCart([{
    productId: 'food',
    quantity: 1,
    addOns: [{ id: 'egg', name: 'เพิ่มไข่ดาว', price: 20 }],
  }], [product]);

  assert.deepEqual(result.items[0].addOns, []);
  assert.equal(result.total, 65);
});
