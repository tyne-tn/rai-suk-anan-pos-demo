import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../assets/pos-app.js', import.meta.url), 'utf8');

test('product editor exposes a mobile-friendly image upload', () => {
  assert.match(html, /id="product-image"/);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(html, /capture="environment"/);
  assert.match(html, /id="product-image-preview"/);
  assert.match(html, /id="remove-product-image"/);
});

test('uploaded images are validated, compressed and used in product views', () => {
  assert.match(app, /file\.size > 8 \* 1024 \* 1024/);
  assert.match(app, /toDataURL\('image\/webp', 0\.76\)/);
  assert.match(app, /productVisual\(representative, 'product-photo'/);
  assert.match(app, /productVisual\(product, 'line-photo'/);
  assert.match(app, /productVisual\(product, 'admin-photo'/);
});
