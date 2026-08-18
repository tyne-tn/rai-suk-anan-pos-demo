import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PRODUCTS } from '../assets/pos-core.js';

test('Loyverse catalog contains only fixed-price sellable items', () => {
  assert.equal(DEFAULT_PRODUCTS.length, 103);
  assert.equal(new Set(DEFAULT_PRODUCTS.map((product) => product.id)).size, DEFAULT_PRODUCTS.length);
  assert.equal(new Set(DEFAULT_PRODUCTS.map((product) => product.name)).size, DEFAULT_PRODUCTS.length);
  assert.ok(DEFAULT_PRODUCTS.every((product) => Number.isFinite(product.price) && product.price > 0));
  assert.ok(DEFAULT_PRODUCTS.every((product) => product.active));
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
