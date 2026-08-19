import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../assets/pos-app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/pos.css', import.meta.url), 'utf8');

test('sale cart and held bills can print a kitchen order', () => {
  assert.match(html, /id="print-kitchen-order"/);
  assert.match(html, /id="kitchen-print-root"/);
  assert.match(app, /function printKitchenOrder/);
  assert.match(app, /data-print-held/);
  assert.match(app, /window\.print\(\)/);
  assert.match(app, /showToast\(`พักบิล \$\{held\.serviceLocation\.label\} แล้ว`\);[\s\S]*printKitchenOrder\(\{ cart: held\.cart/);
  assert.match(app, /showToast\('เลือกออเดอร์กลับบ้านแล้ว'\);[\s\S]*if \(cartTotals\(\)\.itemCount\) printKitchenOrder\(\)/);
});

test('57 mm kitchen ticket omits prices and payment data', () => {
  assert.match(css, /@page\{size:57mm auto;margin:0\}/);
  assert.match(css, /\.kitchen-print-root\{[^}]*width:57mm/);
  assert.match(app, /ใบออเดอร์ครัว/);
  assert.match(app, /item\.spiceLevel/);
  assert.match(app, /item\.addOns/);
  assert.match(app, /item\.note/);
  assert.doesNotMatch(app, /kitchen-ticket[\s\S]{0,1800}(?:paymentMethod|amountReceived|money\.format)/);
});
