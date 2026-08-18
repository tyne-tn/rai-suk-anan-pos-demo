import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCart, createOrder, supportsSpiceLevel } from '../assets/pos-core.js';

const food = { id: 'food', name: 'ตําไทย', category: '(02) ส้มตํา', price: 65 };
const drink = { id: 'drink', name: 'น้ําเปล่า', category: '(09) เครื่องดื่ม', price: 20 };

test('spice selector applies to food but not drinks or equipment', () => {
  assert.equal(supportsSpiceLevel({ category: '(01) อาหารจานเดียว' }), true);
  assert.equal(supportsSpiceLevel(food), true);
  assert.equal(supportsSpiceLevel(drink), false);
  assert.equal(supportsSpiceLevel({ category: '(05) กางเต้น & อุปกรณ์เล่นน้ํา' }), false);
});

test('cart defaults food to medium spice and ignores spice for drinks', () => {
  const totals = calculateCart([
    { productId: 'food', quantity: 1 },
    { productId: 'drink', quantity: 1, spiceLevel: 'เผ็ดมาก' },
  ], [food, drink]);

  assert.equal(totals.items[0].spiceLevel, 'เผ็ดกลาง');
  assert.equal(totals.items[1].spiceLevel, undefined);
});

test('cart rejects unsupported spice levels', () => {
  assert.throws(
    () => calculateCart([{ productId: 'food', quantity: 1, spiceLevel: 'หวานมาก' }], [food]),
    /ระดับความเผ็ดไม่ถูกต้อง/,
  );
});
