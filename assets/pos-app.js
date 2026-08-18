import { DEFAULT_PRODUCTS, DEFAULT_SERVICE_ZONES, SPICE_LEVELS, calculateCart, createHeldOrder, createOrder, groupCatalogProducts, isSameServiceLocation, summarizeOrders, supportsAddOns, supportsSpiceLevel } from './pos-core.js?v=held-orders-v1';

const STORAGE_KEYS = {
  products: 'rai-pos-products-v2',
  orders: 'rai-pos-orders-v2',
  cart: 'rai-pos-cart-v2',
  serviceLocation: 'rai-pos-service-location-v1',
  heldOrders: 'rai-pos-held-orders-v1',
  currentHeldOrder: 'rai-pos-current-held-order-v1',
};

const productMetadata = new Map(DEFAULT_PRODUCTS.map((product) => [product.id, product]));

const state = {
  products: load(STORAGE_KEYS.products, DEFAULT_PRODUCTS).map((product) => ({ ...productMetadata.get(product.id), ...product })),
  orders: load(STORAGE_KEYS.orders, []),
  cart: load(STORAGE_KEYS.cart, []),
  serviceLocation: loadObject(STORAGE_KEYS.serviceLocation),
  heldOrders: load(STORAGE_KEYS.heldOrders, []),
  currentHeldOrderId: localStorage.getItem(STORAGE_KEYS.currentHeldOrder) || '',
  category: 'ทั้งหมด',
  query: '',
};

const FOOD_ADD_ONS = [
  { id: 'extra-rice', name: 'เพิ่มข้าว', price: 10 },
  { id: 'fried-egg', name: 'เพิ่มไข่ดาว', price: 20 },
  { id: 'omelet', name: 'เพิ่มไข่เจียว', price: 20 },
];

let itemDraft = null;
let locationDraft = null;

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

function loadObject(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
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

let pendingProductImage = '';

function safeProductImage(value) {
  return typeof value === 'string' && /^data:image\/(?:jpeg|png|webp);base64,/i.test(value) ? value : '';
}

function productVisual(product, imageClass, emojiClass) {
  const image = safeProductImage(product?.image);
  return image
    ? `<img class="${imageClass}" src="${image}" alt="">`
    : `<span class="${emojiClass}">${escapeHtml(product?.emoji || '☕')}</span>`;
}

function updateProductImagePreview(image = '') {
  const safeImage = safeProductImage(image);
  const preview = $('#product-image-preview');
  preview.hidden = !safeImage;
  preview.src = safeImage;
  $('#product-image-placeholder').hidden = Boolean(safeImage);
  $('#remove-product-image').hidden = !safeImage;
}

function compressProductImage(file) {
  return new Promise((resolve, reject) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      reject(new Error('รองรับเฉพาะไฟล์ JPG, PNG และ WebP'));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      reject(new Error('รูปต้องมีขนาดไม่เกิน 8 MB'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('อ่านไฟล์รูปไม่สำเร็จ'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('ไฟล์รูปไม่ถูกต้อง'));
      image.onload = () => {
        const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/webp', 0.76));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
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

function saveServiceLocation(location) {
  state.serviceLocation = location;
  if (location) localStorage.setItem(STORAGE_KEYS.serviceLocation, JSON.stringify(location));
  else localStorage.removeItem(STORAGE_KEYS.serviceLocation);
  renderLocationLabel();
}

function setCurrentHeldOrder(orderId = '') {
  state.currentHeldOrderId = orderId;
  if (orderId) localStorage.setItem(STORAGE_KEYS.currentHeldOrder, orderId);
  else localStorage.removeItem(STORAGE_KEYS.currentHeldOrder);
}

function renderLocationLabel() {
  const label = state.serviceLocation?.label || 'ยังไม่เลือกโต๊ะ';
  $('#order-location-label').textContent = label;
  $('#choose-location strong').textContent = state.serviceLocation ? 'เปลี่ยนโซน / โต๊ะ' : 'เลือกโซน / โต๊ะ';
  $('#choose-location').classList.toggle('is-selected', Boolean(state.serviceLocation));
}

function renderLocationOptions() {
  const selectedZone = locationDraft?.zone || '';
  const selectedTable = Number(locationDraft?.table || 0);
  $('#zone-options').innerHTML = DEFAULT_SERVICE_ZONES.map((zone) => `<button type="button" class="location-choice ${zone.name === selectedZone ? 'is-selected' : ''}" data-zone="${escapeHtml(zone.name)}">${escapeHtml(zone.name === 'โต๊ะเสริม' ? zone.name : `โซน ${zone.name}`)}</button>`).join('');
  const zone = DEFAULT_SERVICE_ZONES.find((entry) => entry.name === selectedZone);
  $('#table-options').innerHTML = zone ? zone.tables.map((table) => `<button type="button" class="table-choice ${table === selectedTable ? 'is-selected' : ''}" data-table="${table}"><span>โต๊ะ</span><strong>${table}</strong></button>`).join('') : '<p class="location-hint">เลือกโซนก่อน แล้วจึงเลือกโต๊ะ</p>';
}

function openLocationDialog() {
  locationDraft = state.serviceLocation?.type === 'table'
    ? { ...state.serviceLocation }
    : { type: 'table', zone: 'A', table: null };
  $('#location-error').textContent = '';
  renderLocationOptions();
  $('#location-dialog').showModal();
}

function confirmLocation(event) {
  event.preventDefault();
  if (!locationDraft?.zone || !locationDraft?.table) {
    $('#location-error').textContent = 'กรุณาเลือกโซนและโต๊ะ';
    return;
  }
  const location = { type: 'table', zone: locationDraft.zone, table: Number(locationDraft.table) };
  location.label = `โซน ${location.zone} · โต๊ะ ${location.table}`;
  saveServiceLocation(location);
  $('#location-dialog').close();
  showToast(`เลือก ${location.label} แล้ว`);
}

function selectTakeaway() {
  saveServiceLocation({ type: 'takeaway', label: 'กลับบ้าน' });
  $('#location-dialog').close();
  showToast('เลือกออเดอร์กลับบ้านแล้ว');
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
  const filtered = state.products.filter((product) => product.active)
    .filter((product) => state.category === 'ทั้งหมด' || product.category === state.category)
    .filter((product) => !query || `${product.name} ${product.displayName || ''} ${product.category}`.toLocaleLowerCase('th').includes(query));
  const groups = groupCatalogProducts(filtered);

  $('#product-grid').innerHTML = groups.map((group) => {
    const representative = { ...group.products[0], image: group.image, emoji: group.emoji };
    const price = group.minPrice === group.maxPrice ? money.format(group.minPrice) : `${money.format(group.minPrice)}–${money.format(group.maxPrice)}`;
    return `<button class="product-card" data-product-group="${escapeHtml(group.groupId)}">
      ${productVisual(representative, 'product-photo', 'product-emoji')}
      <span class="product-category">${escapeHtml(group.category)}</span>
      <strong>${escapeHtml(group.displayName)}</strong>
      <span class="product-price">${price}</span>
      <span class="add-badge">＋</span>
    </button>`;
  }).join('');
  $('#product-empty').hidden = groups.length > 0;
}

function selectedDraftProduct() {
  return state.products.find((product) => product.id === itemDraft?.productId);
}

function renderItemForm() {
  const product = selectedDraftProduct();
  if (!product) return;
  const variants = state.products.filter((item) => item.active && (item.groupId || item.id) === itemDraft.groupId);
  $('#variant-section').hidden = variants.length < 2;
  $('#variant-options').innerHTML = variants.map((item) => `<button type="button" class="choice-button ${item.id === itemDraft.productId ? 'is-selected' : ''}" data-variant="${escapeHtml(item.id)}"><span>${escapeHtml(item.optionName || item.name)}</span><strong>${money.format(item.price)}</strong></button>`).join('');
  const food = supportsSpiceLevel(product);
  $('#spice-section').hidden = !food;
  const addOnsEnabled = supportsAddOns(product);
  $('#addon-section').hidden = !addOnsEnabled;
  if (!addOnsEnabled) itemDraft.addOnIds = [];
  $('#item-spice-options').innerHTML = SPICE_LEVELS.map((level) => `<button type="button" class="choice-button ${level === itemDraft.spiceLevel ? 'is-selected' : ''}" data-item-spice="${escapeHtml(level)}">${escapeHtml(level)}</button>`).join('');
  $('#addon-options').innerHTML = FOOD_ADD_ONS.map((addOn) => `<button type="button" class="choice-button ${itemDraft.addOnIds.includes(addOn.id) ? 'is-selected' : ''}" data-addon="${escapeHtml(addOn.id)}"><span>${escapeHtml(addOn.name)}</span><strong>+${money.format(addOn.price)}</strong></button>`).join('');
  $('#item-quantity').textContent = itemDraft.quantity;
  const extras = addOnsEnabled ? FOOD_ADD_ONS.filter((addOn) => itemDraft.addOnIds.includes(addOn.id)).reduce((sum, addOn) => sum + addOn.price, 0) : 0;
  $('#item-total').textContent = money.format((product.price + extras) * itemDraft.quantity);
}

function openItemForm(groupId) {
  const variants = state.products.filter((product) => product.active && (product.groupId || product.id) === groupId);
  if (!variants.length) return;
  const product = variants[0];
  itemDraft = { groupId, productId: product.id, quantity: 1, spiceLevel: 'เผ็ดกลาง', addOnIds: [] };
  $('#item-title').textContent = product.displayName || product.name;
  $('#item-note').value = '';
  $('#item-error').textContent = '';
  renderItemForm();
  $('#item-dialog').showModal();
}

function confirmItem(event) {
  event.preventDefault();
  const product = selectedDraftProduct();
  if (!product) return;
  const addOns = supportsAddOns(product) ? FOOD_ADD_ONS.filter((addOn) => itemDraft.addOnIds.includes(addOn.id)) : [];
  state.cart.push({
    lineId: globalThis.crypto?.randomUUID?.() || `line-${Date.now()}`,
    productId: product.id,
    quantity: itemDraft.quantity,
    addOns,
    note: $('#item-note').value.trim(),
    ...(supportsSpiceLevel(product) ? { spiceLevel: itemDraft.spiceLevel } : {}),
  });
  save(STORAGE_KEYS.cart, state.cart);
  $('#item-dialog').close();
  renderCart();
  showToast('เพิ่มลงออเดอร์แล้ว');
}

function changeSpiceLevel(lineId, spiceLevel) {
  const item = state.cart.find((entry) => (entry.lineId || entry.productId) === lineId);
  if (!item || !SPICE_LEVELS.includes(spiceLevel)) return;
  item.spiceLevel = spiceLevel;
  save(STORAGE_KEYS.cart, state.cart);
  renderCart();
}

function changeQuantity(lineId, delta) {
  const item = state.cart.find((entry) => (entry.lineId || entry.productId) === lineId);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) state.cart = state.cart.filter((entry) => (entry.lineId || entry.productId) !== lineId);
  save(STORAGE_KEYS.cart, state.cart);
  renderCart();
}

function renderCart() {
  const totals = cartTotals();
  const productMap = new Map(state.products.map((product) => [product.id, product]));
  $('#cart-items').innerHTML = totals.items.map((item) => {
    const product = productMap.get(item.productId);
    const lineId = item.lineId || item.productId;
    const spiceSelector = item.spiceLevel ? `<label class="spice-picker">ระดับความเผ็ด <select data-spice-line="${escapeHtml(lineId)}" aria-label="ระดับความเผ็ดของ ${escapeHtml(item.name)}">${SPICE_LEVELS.map((level) => `<option value="${escapeHtml(level)}"${level === item.spiceLevel ? ' selected' : ''}>${escapeHtml(level)}</option>`).join('')}</select></label>` : '';
    const details = [
      ...item.addOns.map((addOn) => `${addOn.name} +${money.format(addOn.price)}`),
      ...(item.note ? [`หมายเหตุ: ${item.note}`] : []),
    ];
    return `<div class="cart-line">
      <div class="cart-line-main">${productVisual(product, 'line-photo', 'line-emoji')}<span class="cart-line-name"><strong>${escapeHtml(item.name)}</strong><small>${money.format(item.unitPrice)} / ชิ้น</small>${details.length ? `<small class="line-options">${escapeHtml(details.join(' · '))}</small>` : ''}${spiceSelector}</span></div>
      <div class="cart-line-side"><strong class="line-total">${money.format(item.lineTotal)}</strong><div class="quantity-stepper"><button data-quantity="-1" data-line="${escapeHtml(lineId)}" aria-label="ลดจำนวน">−</button><span>${item.quantity}</span><button data-quantity="1" data-line="${escapeHtml(lineId)}" aria-label="เพิ่มจำนวน">＋</button></div></div>
    </div>`;
  }).join('');
  $('#cart-empty').hidden = totals.itemCount > 0;
  $('#cart-count').textContent = `${totals.itemCount} ชิ้น`;
  $('#cart-total').textContent = money.format(totals.total);
  $('#checkout-total').textContent = money.format(totals.total);
  $('#checkout-button').disabled = totals.itemCount === 0;
  $('#hold-order').disabled = totals.itemCount === 0;
  $('#hold-order-label').textContent = state.currentHeldOrderId ? 'อัปเดตบิลพัก' : 'พักบิล';
}

function holdCurrentOrder() {
  const totals = cartTotals();
  if (!totals.itemCount) return;
  if (!state.serviceLocation) {
    openLocationDialog();
    showToast('เลือกโซนและโต๊ะก่อนพักบิล');
    return;
  }
  const current = state.heldOrders.find((order) => order.id === state.currentHeldOrderId);
  const duplicate = state.heldOrders.find((order) => order.id !== state.currentHeldOrderId && isSameServiceLocation(order.serviceLocation, state.serviceLocation));
  if (duplicate) {
    showToast(`${duplicate.serviceLocation.label} มีบิลพักอยู่แล้ว`);
    return;
  }
  const held = createHeldOrder({
    cart: state.cart,
    products: state.products,
    serviceLocation: state.serviceLocation,
    id: current?.id,
    createdAt: current?.createdAt,
  });
  if (current) state.heldOrders = state.heldOrders.map((order) => order.id === held.id ? held : order);
  else state.heldOrders.unshift(held);
  save(STORAGE_KEYS.heldOrders, state.heldOrders);
  state.cart = [];
  save(STORAGE_KEYS.cart, state.cart);
  saveServiceLocation(null);
  setCurrentHeldOrder();
  renderCart();
  renderHeldOrders();
  showToast(`พักบิล ${held.serviceLocation.label} แล้ว`);
}

function resumeHeldOrder(orderId) {
  const held = state.heldOrders.find((order) => order.id === orderId);
  if (!held) return;
  if (state.cart.length && state.currentHeldOrderId !== orderId && !window.confirm('แทนที่ออเดอร์ที่กำลังทำด้วยบิลพักนี้?')) return;
  state.cart = structuredClone(held.cart);
  save(STORAGE_KEYS.cart, state.cart);
  saveServiceLocation(held.serviceLocation);
  setCurrentHeldOrder(held.id);
  renderCart();
  renderHeldOrders();
  switchView('sale');
  showToast(`เรียกบิล ${held.serviceLocation.label} แล้ว`);
}

function cancelHeldOrder(orderId) {
  const held = state.heldOrders.find((order) => order.id === orderId);
  if (!held || !window.confirm(`ยกเลิกบิลพัก ${held.serviceLocation.label}?`)) return;
  state.heldOrders = state.heldOrders.filter((order) => order.id !== orderId);
  save(STORAGE_KEYS.heldOrders, state.heldOrders);
  if (state.currentHeldOrderId === orderId) {
    state.cart = [];
    save(STORAGE_KEYS.cart, state.cart);
    saveServiceLocation(null);
    setCurrentHeldOrder();
    renderCart();
  }
  renderHeldOrders();
  showToast('ยกเลิกบิลพักแล้ว');
}

function renderHeldOrders() {
  $('#held-order-count').textContent = `${state.heldOrders.length} บิล`;
  $('#held-orders').innerHTML = state.heldOrders.map((order) => `<article class="held-order-card ${order.id === state.currentHeldOrderId ? 'is-active' : ''}">
    <div><strong>${escapeHtml(order.serviceLocation.label)}</strong><small>พักเมื่อ ${dateTime.format(new Date(order.updatedAt))} · ${order.itemCount} ชิ้น</small></div>
    <strong>${money.format(order.total)}</strong>
    <div class="held-order-actions"><button type="button" data-resume-held="${escapeHtml(order.id)}">${order.id === state.currentHeldOrderId ? 'กำลังเปิด' : 'เรียกบิล'}</button><button type="button" class="danger" data-cancel-held="${escapeHtml(order.id)}">ยกเลิก</button></div>
  </article>`).join('') || '<div class="held-orders-empty">ยังไม่มีบิลที่พักไว้</div>';
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
  if (!state.serviceLocation) {
    openLocationDialog();
    showToast('เลือกโซนและโต๊ะก่อนชำระเงิน');
    return;
  }
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
      serviceLocation: state.serviceLocation,
    });
    state.orders.unshift(order);
    if (state.currentHeldOrderId) {
      state.heldOrders = state.heldOrders.filter((held) => held.id !== state.currentHeldOrderId);
      save(STORAGE_KEYS.heldOrders, state.heldOrders);
      setCurrentHeldOrder();
    }
    state.cart = [];
    save(STORAGE_KEYS.orders, state.orders);
    save(STORAGE_KEYS.cart, state.cart);
    saveServiceLocation(null);
    $('#payment-dialog').close();
    renderCart();
    renderHeldOrders();
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
  renderHeldOrders();
  const orders = filteredOrders('#orders-date');
  const rows = orders.map((order) => `<div class="table-row">
    <span class="order-id"><strong>${escapeHtml(order.orderNumber)}</strong><small>${escapeHtml(order.serviceLocation?.label || 'ไม่ระบุโต๊ะ')} · ${dateTime.format(new Date(order.createdAt))}</small></span>
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
  $('#product-admin-grid').innerHTML = state.products.map((product) => `<article class="admin-card ${product.active ? '' : 'is-inactive'}">${productVisual(product, 'admin-photo', 'admin-emoji')}<span class="admin-info"><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.category)} · ${money.format(product.price)}${product.active ? '' : ' · พักขาย'}</small></span><span class="admin-actions"><button data-edit-product="${escapeHtml(product.id)}" title="แก้ไข">✎</button><button data-toggle-product="${escapeHtml(product.id)}" title="${product.active ? 'พักขาย' : 'เปิดขาย'}">${product.active ? 'Ⅱ' : '▶'}</button></span></article>`).join('');
}

function openProductForm(productId = '') {
  const product = state.products.find((item) => item.id === productId);
  $('#product-form').reset();
  $('#product-id').value = product?.id || '';
  $('#product-name').value = product?.name || '';
  $('#product-price').value = product?.price || '';
  $('#product-category').value = product?.category || '';
  $('#product-emoji').value = product?.emoji || '☕';
  $('#product-addons-enabled').checked = product ? supportsAddOns(product) : true;
  pendingProductImage = safeProductImage(product?.image);
  updateProductImagePreview(pendingProductImage);
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
  const addOnsEnabled = $('#product-addons-enabled').checked;
  if (!name || !category || !Number.isFinite(price) || price <= 0) {
    $('#product-error').textContent = 'กรุณากรอกชื่อ หมวดหมู่ และราคาให้ถูกต้อง';
    return;
  }
  if (id) {
    const product = state.products.find((item) => item.id === id);
    Object.assign(product, { name, category, price, emoji, image: pendingProductImage, addOnsEnabled });
  } else {
    const newId = `product-${Date.now()}`;
    state.products.push({ id: newId, name, category, price, emoji, image: pendingProductImage, addOnsEnabled, active: true });
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
  $('#receipt-content').innerHTML = `<div class="receipt"><div class="modal-head"><span></span><button class="close-button" data-close-receipt aria-label="ปิด">×</button></div><div class="receipt-head"><img src="assets/rai-suk-anan-logo.webp" alt=""><h2>ไร่สุขอนันต์</h2><span>ขอบคุณที่แวะมาพักใจ</span></div><div class="receipt-meta"><span>เลขที่</span><span>${escapeHtml(order.orderNumber)}</span><span>วันที่</span><span>${dateTime.format(new Date(order.createdAt))}</span><span>ชำระโดย</span><span>${method}</span><span>โซน / โต๊ะ</span><span>${escapeHtml(order.serviceLocation?.label || 'ไม่ระบุโต๊ะ')}</span></div><div class="receipt-lines">${order.items.map((item) => `<div class="receipt-line"><span>${escapeHtml(item.name)} × ${item.quantity}${item.spiceLevel ? `<small class="receipt-spice">${escapeHtml(item.spiceLevel)}</small>` : ''}${item.addOns?.length ? `<small class="receipt-spice">${escapeHtml(item.addOns.map((addOn) => `${addOn.name} +${money.format(addOn.price)}`).join(' · '))}</small>` : ''}${item.note ? `<small class="receipt-spice">หมายเหตุ: ${escapeHtml(item.note)}</small>` : ''}</span><span>${money.format(item.lineTotal)}</span></div>`).join('')}</div><div class="receipt-total"><strong>ยอดสุทธิ</strong><strong>${money.format(order.total)}</strong></div>${order.paymentMethod === 'cash' ? `<div class="receipt-meta"><span>รับเงิน</span><span>${money.format(order.amountReceived)}</span><span>เงินทอน</span><span>${money.format(order.change)}</span></div>` : ''}<div class="receipt-actions"><button class="primary-button" data-print-receipt>พิมพ์ใบเสร็จ</button><button class="primary-button" data-close-receipt>ปิด</button></div></div>`;
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
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), products: state.products, orders: state.orders, heldOrders: state.heldOrders }, null, 2);
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
$('#product-grid').addEventListener('click', (event) => { const button = event.target.closest('[data-product-group]'); if (button) openItemForm(button.dataset.productGroup); });
$('#cart-items').addEventListener('click', (event) => { const button = event.target.closest('[data-quantity]'); if (button) changeQuantity(button.dataset.line, Number(button.dataset.quantity)); });
$('#cart-items').addEventListener('change', (event) => { const select = event.target.closest('[data-spice-line]'); if (select) changeSpiceLevel(select.dataset.spiceLine, select.value); });
$('#hold-order').addEventListener('click', holdCurrentOrder);
$('#held-orders').addEventListener('click', (event) => {
  const resume = event.target.closest('[data-resume-held]');
  const cancel = event.target.closest('[data-cancel-held]');
  if (resume) resumeHeldOrder(resume.dataset.resumeHeld);
  if (cancel) cancelHeldOrder(cancel.dataset.cancelHeld);
});
$('#item-form').addEventListener('submit', confirmItem);
$('#item-form').addEventListener('click', (event) => {
  if (!itemDraft) return;
  const variant = event.target.closest('[data-variant]');
  const spice = event.target.closest('[data-item-spice]');
  const addOn = event.target.closest('[data-addon]');
  if (variant) itemDraft.productId = variant.dataset.variant;
  if (spice) itemDraft.spiceLevel = spice.dataset.itemSpice;
  if (addOn) itemDraft.addOnIds = itemDraft.addOnIds.includes(addOn.dataset.addon) ? itemDraft.addOnIds.filter((id) => id !== addOn.dataset.addon) : [...itemDraft.addOnIds, addOn.dataset.addon];
  if (event.target.closest('#item-quantity-minus')) itemDraft.quantity = Math.max(1, itemDraft.quantity - 1);
  if (event.target.closest('#item-quantity-plus')) itemDraft.quantity += 1;
  if (variant || spice || addOn || event.target.closest('#item-quantity-minus, #item-quantity-plus')) renderItemForm();
});
$('#clear-cart').addEventListener('click', () => { if ((!state.cart.length && !state.serviceLocation) || window.confirm('ล้างออเดอร์ปัจจุบัน?\nบิลที่พักไว้จะยังอยู่ในหน้ารายการขาย')) { state.cart = []; save(STORAGE_KEYS.cart, state.cart); saveServiceLocation(null); setCurrentHeldOrder(); renderCart(); renderHeldOrders(); } });
$('#choose-location').addEventListener('click', openLocationDialog);
$('#location-form').addEventListener('submit', confirmLocation);
$('#cancel-location').addEventListener('click', () => $('#location-dialog').close('cancel'));
$('#select-takeaway').addEventListener('click', selectTakeaway);
$('#zone-options').addEventListener('click', (event) => { const button = event.target.closest('[data-zone]'); if (button) { locationDraft = { type: 'table', zone: button.dataset.zone, table: null }; renderLocationOptions(); } });
$('#table-options').addEventListener('click', (event) => { const button = event.target.closest('[data-table]'); if (button) { locationDraft.table = Number(button.dataset.table); renderLocationOptions(); } });
$('#checkout-button').addEventListener('click', openCheckout);
$('#payment-form').addEventListener('submit', completePayment);
$('#cancel-payment').addEventListener('click', () => $('#payment-dialog').close('cancel'));
$$('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.closeDialog}`).close('cancel')));
$('#payment-form').addEventListener('change', updatePayment);
$('#cash-received').addEventListener('input', updatePayment);
$('#quick-cash').addEventListener('click', (event) => { const button = event.target.closest('[data-cash]'); if (button) { $('#cash-received').value = button.dataset.cash; updatePayment(); } });
$('#orders-date').addEventListener('change', renderOrders);
$('#report-date').addEventListener('change', renderReports);
$('#orders-table').addEventListener('click', (event) => { const receipt = event.target.closest('[data-receipt]'); const voidButton = event.target.closest('[data-void]'); if (receipt) showReceipt(state.orders.find((order) => order.id === receipt.dataset.receipt)); if (voidButton) voidOrder(voidButton.dataset.void); });
$('#add-product').addEventListener('click', () => openProductForm());
$('#product-admin-grid').addEventListener('click', (event) => { const edit = event.target.closest('[data-edit-product]'); const toggle = event.target.closest('[data-toggle-product]'); if (edit) openProductForm(edit.dataset.editProduct); if (toggle) toggleProduct(toggle.dataset.toggleProduct); });
$('#product-form').addEventListener('submit', saveProduct);
$('#cancel-product').addEventListener('click', () => $('#product-dialog').close('cancel'));
$('#product-image').addEventListener('change', async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  $('#product-error').textContent = 'กำลังเตรียมรูป...';
  try {
    pendingProductImage = await compressProductImage(file);
    updateProductImagePreview(pendingProductImage);
    $('#product-error').textContent = '';
  } catch (error) {
    event.target.value = '';
    $('#product-error').textContent = error.message;
  }
});
$('#remove-product-image').addEventListener('click', () => {
  pendingProductImage = '';
  $('#product-image').value = '';
  updateProductImagePreview();
});
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
renderLocationLabel();
renderCategories();
renderProducts();
renderCart();
renderHeldOrders();
renderOrders();
renderReports();
renderProductAdmin();
tickClock();
setInterval(tickClock, 30000);
