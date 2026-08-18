import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../assets/pos-app.js', import.meta.url), 'utf8');

test('payment can only complete from the explicit confirm button', () => {
  assert.match(html, /type="button" class="close-button" data-close-dialog="payment-dialog"/);
  assert.match(html, /type="button" class="cancel-button" id="cancel-payment">ย้อนกลับ<\/button>/);
  assert.match(html, /id="confirm-payment"[^>]*type="submit"/);
  assert.match(app, /#cancel-payment[^\n]+payment-dialog[^\n]+close\('cancel'\)/);
});

test('all form header close buttons are non-submit controls', () => {
  const closeButtons = [...html.matchAll(/<button[^>]*class="close-button"[^>]*>/g)].map((match) => match[0]);
  assert.equal(closeButtons.length, 4);
  closeButtons.forEach((button) => assert.match(button, /type="button"/));
});
