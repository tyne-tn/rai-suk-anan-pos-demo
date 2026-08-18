import { DEFAULT_PRODUCTS, calculateCart, createOrder, summarizeOrders } from './pos-core.js';

const STORAGE_KEYS = {
  products: 'rai-pos-products-v2',
  orders: 'rai-pos-orders-v2',
  cart: 'rai-pos-cart-v2',
};

const state = {
  products: load(STORAGE_KEYS.products, DEFAULT_PRODUCTS),
  orders: load(STORAGE_KEYS.orders, []),
  cart: load(STORAGE_KEYS.cart, []),
  category: 'ทั้งหมด',
  query: '',
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const money = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
const dayLabel = new Intl.DateTimeFormat('th-TH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });
const timeLabel = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });

function load(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return Array.isArray(parsed) ? parsed : structuredClone(fallback);
  } catch {
    return structuredClone(fallback);
  }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  const status = $('#saved-status');
  status.textContent = `บันทึกแล้ว ${timeLabel.format(new Date())}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function dateKey(value) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function todayKey() {
  return dateKey(new Date());
}

function cartTotals() {
  try {
    return calculateCart(state.cart, state.products);
  } catch {
    state.cart = state.cart.filter((item) => state.products.some((product) => product.id === item.productId));
    save(STORAGE_KEYS.cart, state.cart);
    return calculateCart(state.cart, state.products);
  }
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove('is-visible'), 2200);
}

function renderCategories() {
  const categories = ['ทั้งหมด', ...new Set(state.products.filter((product) => product.active).map((product) => product.category))];
  if (!categories.includes(state.category)) state.category = 'ทั้งหมด';
  $('#category-tabs').innerHTML = categories.map((category) => `
    <button class="${category === state.category ? 'is-active' : ''}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>
  `).join('');
  $('#category-list').innerHTML = categories.slice(1).map((category) => `<option value="${escapeHtml(category)}"></option>`).join('');
}

function renderProducts() {
  const query = state.query.trim().toLocaleLowerCase('th');
  const products = state.products.filter((product) => product.active)
    .filter((product) => state.category === 'ทั้งหมด' || product.category === state.category)
    .filter((product) => !query || `${product.name} ${product.category}`.toLocaleLowerCase('th').includes(query));

  $('#product-grid').innerHTML = products.map((product) => `
    <button class="product-card" data-add-product="${escapeHtml(product.id)}">
      <span class="product-emoji">${escapeHtml(product.emoji || '☕')}</span>
      <span class="product-category">${escapeHtml(product.category)}</span>
      <strong>${escapeHtml(product.name)}</strong>
      <span class="product-price">${money.format(product.price)}</span>
      <span class="add-badge">＋</span>
    </button>
  `).join('');
  $('#product-empty').hidden = products.length > 0;
}

function addToCart(productId) {
  const existing = state.cart.find((item) => item.productId === productId);
  if (existing) existing.quantity += 1;
  else state.cart.push({ productId, quantity: 1 });
  save(STORAGE_KEYS.cart, state.cart);
  renderCart();
}

function changeQuantity(productId, delta) {
  const item = state.cart.find((entry) => entry.productId === productId);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) state.cart = state.cart.filter((entry) => entry.productId !== productId);
  save(STORAGE_KEYS.cart, state.cart);
  renderCart();
}

function renderCart() {
  const totals = cartTotals();
  const productMap = new Map(state.products.map((product) => [product.id, product]));
  $('#cart-items').innerHTML = totals.items.map((item) => {
    const product = productMap.get(item.productId);
    return `<div class="cart-line">
      <div class="cart-line-main"><span class="line-emoji">${escapeHtml(product?.emoji || '☕')}</span><span class="cart-line-name"><strong>${escapeHtml(item.name)}</strong><small>${money.format(item.unitPrice)} / ชิ้น</small></span></div>
      <div class="cart-line-side"><strong class="line-total">${money.format(item.lineTotal)}</strong><div class="quantity-stepper"><button data-quantity="-1" data-product="${escapeHtml(item.productId)}" aria-label="ลดจำนวน">−</button><span>${item.quantity}</span><button data-quantity="1" data-product="${escapeHtml(item.productId)}" aria-label="เพิ่มจำนวน">＋</button></div></div>
    </div>`;
  }).join('');
  $('#cart-empty').hidden = totals.itemCount > 0;
  $('#cart-count').textContent = `${totals.itemCount} ชิ้น`;
  $('#cart-total').textContent = money.format(totals.total);
  $('#checkout-total').textContent = money.format(totals.total);
  $('#checkout-button').disabled = totals.itemCount === 0;
}

function updatePayment() {
  const totals = cartTotals();
  const method = new FormData($('#payment-form')).get('payment');
  const cash = method === 'cash';
  $('#cash-section').hidden = !cash;
  const received = Number($('#cash-received').value || 0);
  $('#cash-change').textContent = money.format(Math.max(0, received - totals.total));
  $('#confirm-payment').disabled = cash && received < totals.total;
}

function openCheckout() {
  const totals = cartTotals();
  if (!totals.itemCount) return;
  $('#payment-total').textContent = money.format(totals.total);
  $('#payment-error').textContent = '';
  $('#cash-received').value = '';
  const rounded = [totals.total, Math.ceil(totals.total / 100) * 100, 500, 1000]
    .filter((value, index, values) => value >= totals.total && values.indexOf(value) === index);
  $('#quick-cash').innerHTML = rounded.map((value) => `<button type="button" data-cash="${value}">${money.format(value)}</button>`).join('');
  $('#payment-dialog').showModal();
  updatePayment();
}

function completePayment(event) {
  event.preventDefault();
  const method = new FormData(event.currentTarget).get('payment');
  const day = todayKey().replaceAll('-', '');
  const sequence = state.orders.filter((order) => order.orderNumber.includes(day)).length + 1;
  try {
    const order = createOrder({
      cart: state.cart,
      products: state.products,
      paymentMethod: method,
      amountReceived: Number($('#cash-received').value || 0),
      sequence,
    });
    state.orders.unshift(order);
    state.cart = [];
    save(STORAGE_KEYS.orders, state.orders);
    save(STORAGE_KEYS.cart, state.cart);
    $('#payment-dialog').close();
    renderCart();
    renderOrders();
    renderReports();
    showReceipt(order);
    showToast(`ชำระเงินสำเร็จ · ${order.orderNumber}`);
  } catch (error) {
    $('#payment-error').textContent = error.message;
  }
}

function filteredOrders(inputId) {
  const selectedDate = $(inputId).value;
  return state.orders.filter((order) => !selectedDate || dateKey(order.createdAt) === selectedDate);
}

function renderOrders() {
  const orders = filteredOrders('#orders-date');
  const rows = orders.map((order) => `<div class="table-row">
    <span class="order-id"><strong>${escapeHtml(order.orderNumber)}</strong><small>${dateTime.format(new Date(order.createdAt))}</small></span>
    <span>${order.itemCount} ชิ้น</span><strong>${money.format(order.total)}</strong>
    <span><span class="status-pill ${order.status === 'void' ? 'void' : ''}">${order.status === 'void' ? 'ยกเลิก' : 'สำเร็จ'}</span></span>
    <span class="row-actions"><button data-receipt="${escapeHtml(order.id)}">ใบเสร็จ</button>${order.status === 'completed' ? `<button class="danger" data-void="${escapeHtml(order.id)}">ยกเลิก</button>` : ''}</span>
  </div>`).join('');
  $('#orders-table').innerHTML = `<div class="table-row header"><span>เลขออเดอร์</span><span>สินค้า</span><span>ยอดรวม</span><span>สถานะ</span><span>จัดการ</span></div>${rows || '<div class="empty-state"><span>☷</span><strong>ยังไม่มีรายการขาย</strong><p>รายการที่ชำระแล้วจะแสดงที่นี่</p></div>'}`;
}

function voidOrder(orderId) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order || order.status !== 'completed') return;
  if (!window.confirm(`ยกเลิกรายการ ${order.orderNumber}?\nยอดขายจะถูกหักออกจากรายงาน`)) return;
  order.status = 'void';
  order.voidedAt = new Date().toISOString();
  save(STORAGE_KEYS.orders, state.orders);
  renderOrders();
  renderReports();
  showToast('ยกเลิกรายการแล้ว');
}

function renderReports() {
  const summary = summarizeOrders(filteredOrders('#report-date'));
  $('#metric-revenue').textContent = money.format(summary.revenue);
  $('#metric-orders').textContent = summary.orderCount.toLocaleString('th-TH');
  $('#metric-average').textContent = money.format(summary.averageOrderValue);
  const paymentData = [
    ['💵', 'เงินสด', summary.paymentTotals.cash],
    ['▦', 'สแกน QR', summary.paymentTotals.qr],
  ];
  $('#payment-breakdown').innerHTML = paymentData.map(([icon, label, total]) => `<div class="payment-item"><span class="payment-icon">${icon}</span><div><strong>${label}</strong><small>${summary.revenue ? Math.round(total / summary.revenue * 100) : 0}% ของยอดขาย</small></div><strong>${money.format(total)}</strong></div>`).join('');
  $('#top-products').innerHTML = summary.topProducts.slice(0, 6).map((product, index) => `<div class="rank-item"><span class="rank-number">${String(index + 1).padStart(2, '0')}</span><div><strong>${escapeHtml(product.name)}</strong><small>${product.quantity} ชิ้น</small></div><strong>${money.format(product.revenue)}</strong></div>`).join('') || '<div class="empty-state"><strong>ยังไม่มีข้อมูล</strong><p>เริ่มขายสินค้าเพื่อดูอันดับ</p></div>';
}

function renderProductAdmin() {
  $('#product-admin-grid').innerHTML = state.products.map((product) => `<article class="admin-card ${product.active ? '' : 'is-inactive'}"><span class="admin-emoji">${escapeHtml(product.emoji || '☕')}</span><span class="admin-info"><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.category)} · ${money.format(product.price)}${product.active ? '' : ' · พักขาย'}</small></span><span class="admin-actions"><button data-edit-product="${escapeHtml(product.id)}" title="แก้ไข">✎</button><button data-toggle-product="${escapeHtml(product.id)}" title="${product.active ? 'พักขาย' : 'เปิดขาย'}">${product.active ? 'Ⅱ' : '▶'}</button></span></article>`).join('');
}

function openProductForm(productId = '') {
  const product = state.products.find((item) => item.id === productId);
  $('#product-form').reset();
  $('#product-id').value = product?.id || '';
  $('#product-name').value = product?.name || '';
  $('#product-price').value = product?.price || '';
  $('#product-category').value = product?.category || '';
  $('#product-emoji').value = product?.emoji || '☕';
  $('#product-form-title').textContent = product ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า';
  $('#product-error').textContent = '';
  $('#product-dialog').showModal();
}

function saveProduct(event) {
  event.preventDefault();
  const id = $('#product-id').value;
  const name = $('#product-name').value.trim();
  const category = $('#product-category').value.trim();
  const price = Number($('#product-price').value);
  const emoji = $('#product-emoji').value.trim() || '☕';
  if (!name || !category || !Number.isFinite(price) || price <= 0) {
    $('#product-error').textContent = 'กรุณากรอกชื่อ หมวดหมู่ และราคาให้ถูกต้อง';
    return;
  }
  if (id) {
    const product = state.products.find((item) => item.id === id);
    Object.assign(product, { name, category, price, emoji });
  } else {
    const newId = `product-${Date.now()}`;
    state.products.push({ id: newId, name, category, price, emoji, active: true });
  }
  save(STORAGE_KEYS.products, state.products);
  $('#product-dialog').close();
  renderCategories();
  renderProducts();
  renderProductAdmin();
  renderCart();
  showToast(id ? 'แก้ไขสินค้าแล้ว' : 'เพิ่มสินค้าแล้ว');
}

function toggleProduct(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) return;
  product.active = !product.active;
  save(STORAGE_KEYS.products, state.products);
  renderCategories();
  renderProducts();
  renderProductAdmin();
}

function showReceipt(order) {
  const method = order.paymentMethod === 'cash' ? 'เงินสด' : 'สแกน QR';
  $('#receipt-content').innerHTML = `<div class="receipt"><div class="modal-head"><span></span><button class="close-button" data-close-receipt aria-label="ปิด">×</button></div><div class="receipt-head"><img src="assets/rai-suk-anan-logo.webp" alt=""><h2>ไร่สุขอนันต์</h2><span>ขอบคุณที่แวะมาพักใจ</span></div><div class="receipt-meta"><span>เลขที่</span><span>${escapeHtml(order.orderNumber)}</span><span>วันที่</span><span>${dateTime.format(new Date(order.createdAt))}</span><span>ชำระโดย</span><span>${method}</span></div><div class="receipt-lines">${order.items.map((item) => `<div class="receipt-line"><span>${escapeHtml(item.name)} × ${item.quantity}</span><span>${money.format(item.lineTotal)}</span></div>`).join('')}</div><div class="receipt-total"><strong>ยอดสุทธิ</strong><strong>${money.format(order.total)}</strong></div>${order.paymentMethod === 'cash' ? `<div class="receipt-meta"><span>รับเงิน</span><span>${money.format(order.amountReceived)}</span><span>เงินทอน</span><span>${money.format(order.change)}</span></div>` : ''}<div class="receipt-actions"><button class="primary-button" data-print-receipt>พิมพ์ใบเสร็จ</button><button class="primary-button" data-close-receipt>ปิด</button></div></div>`;
  $('#receipt-dialog').showModal();
}

function switchView(viewName) {
  const labels = {
    sale: ['หน้าขาย', 'รับออเดอร์ใหม่'],
    orders: ['ประวัติการขาย', 'รายการขาย'],
    reports: ['ข้อมูลร้าน', 'รายงานยอดขาย'],
    products: ['เมนูร้าน', 'จัดการสินค้า'],
  };
  $$('.view').forEach((view) => view.classList.toggle('is-active', view.id === `${viewName}-view`));
  $$('[data-view]').forEach((button) => button.classList.toggle('is-active', button.dataset.view === viewName));
  [$('#view-eyebrow').textContent, $('#view-title').textContent] = labels[viewName];
  $('.cart-panel').classList.remove('is-open');
  if (viewName === 'orders') renderOrders();
  if (viewName === 'reports') renderReports();
  if (viewName === 'products') renderProductAdmin();
}

function exportData() {
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), products: state.products, orders: state.orders }, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `rai-pos-backup-${todayKey()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('ดาวน์โหลดไฟล์สำรองแล้ว');
}

$$('[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
$('#product-search').addEventListener('input', (event) => { state.query = event.target.value; renderProducts(); });
$('#category-tabs').addEventListener('click', (event) => { const button = event.target.closest('[data-category]'); if (!button) return; state.category = button.dataset.category; renderCategories(); renderProducts(); });
$('#product-grid').addEventListener('click', (event) => { const button = event.target.closest('[data-add-product]'); if (button) addToCart(button.dataset.addProduct); });
$('#cart-items').addEventListener('click', (event) => { const button = event.target.closest('[data-quantity]'); if (button) changeQuantity(button.dataset.product, Number(button.dataset.quantity)); });
$('#clear-cart').addEventListener('click', () => { if (!state.cart.length || window.confirm('ล้างสินค้าทั้งหมดในออเดอร์?')) { state.cart = []; save(STORAGE_KEYS.cart, state.cart); renderCart(); } });
$('#checkout-button').addEventListener('click', openCheckout);
$('#payment-form').addEventListener('submit', completePayment);
$('#payment-form').addEventListener('change', updatePayment);
$('#cash-received').addEventListener('input', updatePayment);
$('#quick-cash').addEventListener('click', (event) => { const button = event.target.closest('[data-cash]'); if (button) { $('#cash-received').value = button.dataset.cash; updatePayment(); } });
$('#orders-date').addEventListener('change', renderOrders);
$('#report-date').addEventListener('change', renderReports);
$('#orders-table').addEventListener('click', (event) => { const receipt = event.target.closest('[data-receipt]'); const voidButton = event.target.closest('[data-void]'); if (receipt) showReceipt(state.orders.find((order) => order.id === receipt.dataset.receipt)); if (voidButton) voidOrder(voidButton.dataset.void); });
$('#add-product').addEventListener('click', () => openProductForm());
$('#product-admin-grid').addEventListener('click', (event) => { const edit = event.target.closest('[data-edit-product]'); const toggle = event.target.closest('[data-toggle-product]'); if (edit) openProductForm(edit.dataset.editProduct); if (toggle) toggleProduct(toggle.dataset.toggleProduct); });
$('#product-form').addEventListener('submit', saveProduct);
$('#receipt-dialog').addEventListener('click', (event) => { if (event.target.closest('[data-close-receipt]')) $('#receipt-dialog').close(); if (event.target.closest('[data-print-receipt]')) window.print(); });
$('#export-button').addEventListener('click', exportData);
$('.cart-head').addEventListener('click', (event) => { if (window.innerWidth <= 760 && !event.target.closest('button')) $('.cart-panel').classList.toggle('is-open'); });

function tickClock() {
  const now = new Date();
  $('#clock-time').textContent = timeLabel.format(now);
  $('#clock-date').textContent = dayLabel.format(now);
}

$('#orders-date').value = todayKey();
$('#report-date').value = todayKey();
renderCategories();
renderProducts();
renderCart();
renderOrders();
renderReports();
renderProductAdmin();
tickClock();
setInterval(tickClock, 30000);
