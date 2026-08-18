import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCart, createOrder } from '../assets/pos-core.js';

const food = { id: 'food', name: 'ข้าวกะเพรา', category: '(01) อาหารจานเดียว', price: 65 };

test('item customization adds extras per quantity and keeps note', () => {
  const cart = [{
    lineId: 'line-1',
    productId: 'food',
    quantity: 2,
    spiceLevel: 'เผ็ดกลาง',
    addOns: [
      { id: 'extra-rice', name: 'เพิ่มข้าว', price: 10 },
      { id: 'fried-egg', name: 'เพิ่มไข่ดาว', price: 20 },
    ],
    note: 'ไม่ใส่ถั่วฝักยาว',
  }];
  const totals = calculateCart(cart, [food]);
  assert.equal(totals.total, 190);
  assert.equal(totals.items[0].unitPrice, 95);
  assert.equal(totals.items[0].note, 'ไม่ใส่ถั่วฝักยาว');
  assert.equal(totals.items[0].addOns.length, 2);

  const order = createOrder({ cart, products: [food], paymentMethod: 'qr' });
  assert.equal(order.items[0].note, 'ไม่ใส่ถั่วฝักยาว');
  assert.equal(order.items[0].addOns[1].name, 'เพิ่มไข่ดาว');
});

test('item customization rejects invalid add-on prices', () => {
  assert.throws(
    () => calculateCart([{ productId: 'food', quantity: 1, addOns: [{ id: 'bad', name: 'ผิดพลาด', price: -1 }] }], [food]),
    /ราคาของเพิ่มไม่ถูกต้อง/,
  );
});
