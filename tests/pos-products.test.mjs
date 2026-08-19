import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PRODUCTS, getProductCategories, groupCatalogProducts } from '../assets/pos-core.js';

test('Loyverse catalog contains only fixed-price sellable items', () => {
  assert.equal(DEFAULT_PRODUCTS.length, 103);
  assert.equal(new Set(DEFAULT_PRODUCTS.map((product) => product.id)).size, DEFAULT_PRODUCTS.length);
  assert.equal(new Set(DEFAULT_PRODUCTS.map((product) => product.name)).size, DEFAULT_PRODUCTS.length);
  assert.ok(DEFAULT_PRODUCTS.every((product) => Number.isFinite(product.price) && product.price > 0));
  assert.ok(DEFAULT_PRODUCTS.every((product) => product.active));
});

test('product editor categories are unique and keep catalog order', () => {
  assert.deepEqual(getProductCategories([
    { category: 'อาหาร' },
    { category: 'เครื่องดื่ม' },
    { category: 'อาหาร' },
    { category: '' },
  ]), ['อาหาร', 'เครื่องดื่ม']);
});

test('Loyverse variants are represented as distinct POS products', () => {
  assert.ok(DEFAULT_PRODUCTS.some((product) => product.name === 'A01 ข้าวกระเพราหมูสับ (ธรรมดา)' && product.price === 65));
  assert.ok(DEFAULT_PRODUCTS.some((product) => product.name === 'A01 ข้าวกระเพราหมูสับ (ไข่ดาว)' && product.price === 80));
  assert.ok(DEFAULT_PRODUCTS.some((product) => product.name === 'H02 น้ําเปล่า (เล็ก)' && product.price === 20));
  assert.ok(DEFAULT_PRODUCTS.some((product) => product.name === 'H02 น้ําเปล่า (ใหญ่)' && product.price === 35));
});

test('variable-price Loyverse items are not published as zero-price products', () => {
  const names = new Set(DEFAULT_PRODUCTS.map((product) => product.name));
  assert.ok(!names.has('อุปกรณ์'));
  assert.ok(!names.has('เปิดเครื่องดื่ม อื่นๆ'));
  assert.ok(!names.has('เมนูพิเศษชุดละ'));
});

test('catalog groups Loyverse variants into one menu card', () => {
  const groups = groupCatalogProducts(DEFAULT_PRODUCTS);
  const rice = groups.find((group) => group.displayName === 'A01 ข้าวกระเพราหมูสับ');
  assert.ok(rice);
  assert.deepEqual(rice.products.map((product) => product.optionName).sort(), ['ธรรมดา', 'ไข่ดาว']);
  assert.equal(rice.minPrice, 65);
  assert.equal(rice.maxPrice, 80);
});
