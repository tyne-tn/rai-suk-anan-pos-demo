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

test('product editor has an explicit cancel action beside save', () => {
  assert.match(html, /class="product-form-actions"/);
  assert.match(html, /type="button"[^>]*id="cancel-product"[^>]*>ยกเลิก<\/button>/);
});

test('uploaded images are validated, compressed and used in product views', () => {
  assert.match(app, /file\.size > 8 \* 1024 \* 1024/);
  assert.match(app, /toDataURL\('image\/webp', 0\.76\)/);
  assert.match(app, /productVisual\(representative, 'product-photo'/);
  assert.match(app, /productVisual\(product, 'line-photo'/);
  assert.match(app, /productVisual\(product, 'admin-photo'/);
});

test('product management exposes a confirmed delete action', () => {
  assert.match(app, /data-delete-product/);
  assert.match(app, /function deleteProduct/);
  assert.match(app, /รายการขายย้อนหลังจะไม่ถูกลบ/);
});

test('product management can create, edit, and delete whole option groups', () => {
  assert.match(html, /id="option-group-grid"/);
  assert.match(html, /id="option-group-name"/);
  assert.match(html, /id="option-group-selection"/);
  assert.match(app, /state\.options\.groups/);
  assert.match(app, /function saveOptions/);
  assert.match(app, /function deleteOptionGroup/);
  assert.match(app, /data-edit-option-group/);
  assert.match(app, /data-delete-option-group/);
  assert.match(app, /function addOptionRow/);
  assert.match(app, /function deleteOptionRow/);
  assert.match(html, /id="add-option-row"/);
  assert.match(app, /price < 0/);
});

test('product management is split into Loyverse-style catalog sections', () => {
  for (const section of ['items', 'categories', 'options', 'discounts']) {
    assert.match(html, new RegExp(`data-product-section="${section}"`));
    assert.match(html, new RegExp(`data-product-panel="${section}"`));
  }
  assert.match(app, /function switchProductSection/);
  assert.match(app, /function renderCategoryAdmin/);
  assert.match(app, /function renameCategory/);
});
