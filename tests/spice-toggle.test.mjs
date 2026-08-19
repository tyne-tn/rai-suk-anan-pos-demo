import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateCart, supportsSpiceLevel } from '../assets/pos-core.js';

const food = { id: 'food', name: 'ข้าว', category: '(01) อาหารจานเดียว', price: 65 };
const drink = { id: 'drink', name: 'ชา', category: '(09) เครื่องดื่ม', price: 35 };

test('spice uses category defaults and allows a per-product override', () => {
  assert.equal(supportsSpiceLevel(food), true);
  assert.equal(supportsSpiceLevel(drink), false);
  assert.equal(supportsSpiceLevel({ ...food, spiceLevelEnabled: false }), false);
  assert.equal(supportsSpiceLevel({ ...drink, spiceLevelEnabled: true }), true);
});

test('product editor exposes and persists the spice toggle', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../assets/pos-app.js', import.meta.url), 'utf8');

  assert.match(html, /id="product-spice-enabled"[^>]*type="checkbox"/);
  assert.match(app, /const spiceLevelEnabled = \$\('#product-spice-enabled'\)\.checked/);
  assert.match(app, /Object\.assign\(product, \{[^}]*spiceLevelEnabled/);
  assert.match(app, /supportsSpiceLevel\(\{ category: event\.target\.value\.trim\(\) \}\)/);
});

test('disabled spice cannot remain in cart calculations or completed orders', () => {
  const result = calculateCart([{
    productId: 'food',
    quantity: 1,
    spiceLevel: 'เผ็ดมาก',
  }], [{ ...food, spiceLevelEnabled: false }]);

  assert.equal(result.items[0].spiceLevel, undefined);
  assert.equal(Object.hasOwn(result.items[0], 'spiceLevel'), false);
});
