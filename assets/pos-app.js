import { DEFAULT_PRODUCTS, DEFAULT_SERVICE_ZONES, SPICE_LEVELS, calculateCart, createHeldOrder, createOrder, getProductCategories, groupCatalogProducts, isSameServiceLocation, summarizeOrders, supportsAddOns, supportsSpiceLevel } from './pos-core.js?v=discounts-v1';

const STORAGE_KEYS = {
  products: 'rai-pos-products-v2',
  orders: 'rai-pos-orders-v2',
  cart: 'rai-pos-cart-v2',
  serviceLocation: 'rai-pos-service-location-v1',
  heldOrders: 'rai-pos-held-orders-v1',
  currentHeldOrder: 'rai-pos-current-held-order-v1',
  orderDiscount: 'rai-pos-order-discount-v1',
  options: 'rai-pos-options-v1',
};

const productMetadata = new Map(DEFAULT_PRODUCTS.map((product) => [product.id, product]));

const state = {
  products: load(STORAGE_KEYS.products, DEFAULT_PRODUCTS).map((product) => ({ ...productMetadata.get(product.id), ...product })),
  orders: load(STORAGE_KEYS.orders, []),
  cart: load(STORAGE_KEYS.cart, []),
  serviceLocation: loadObject(STORAGE_KEYS.serviceLocation),
  heldOrders: load(STORAGE_KEYS.heldOrders, []),
  currentHeldOrderId: localStorage.getItem(STORAGE_KEYS.currentHeldOrder) || '',
  orderDiscount: loadObject(STORAGE_KEYS.orderDiscount),
  options: loadObject(STORAGE_KEYS.options) || {},
  category: 'ทั้งหมด',
  query: '',
};

const FOOD_ADD_ONS = [
  { id: 'extra-rice', name: 'เพิ่มข้าว', price: 10 },
  { id: 'fried-egg', name: 'เพิ่มไข่ดาว', price: 20 },
  { id: 'omelet', name: 'เพิ่มไข่เจียว', price: 20 },
];
const DEFAULT_OPTION_GROUPS = [
  { id: 'addons', name: 'ของเพิ่ม', selection: 'multiple', choices: structuredClone(FOOD_ADD_ONS) },
  { id: 'spice', name: 'ระดับความเผ็ด', selection: 'single', choices: SPICE_LEVELS.map((name, index) => ({ id: `spice-${index}`, name, price: 0 })) },
];
state.options.groups = Array.isArray(state.options.groups)
  ? state.options.groups
  : DEFAULT_OPTION_GROUPS.map((group) => group.id === 'addons' && Array.isArray(state.options.addOns) ? { ...group, choices: structuredClone(state.options.addOns) } : structuredClone(group));
state.options.addOns = state.options.groups.find((group) => group.id === 'addons')?.choices || [];
state.options.categories = getProductCategories([
  ...state.products,
  ...(Array.isArray(state.options.categories) ? state.options.categories.map((category) => ({ category })) : []),
]);

let itemDraft = null;
let locationDraft = null;
let optionDraft = [];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const money = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 0, maximumFractionDigits: 2 });
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
    return calculateCart(state.cart, state.products, state.orderDiscount);
  } catch {
    state.cart = state.cart.filter((item) => state.products.some((product) => product.id === item.productId));
    save(STORAGE_KEYS.cart, state.cart);
    state.orderDiscount = null;
    localStorage.removeItem(STORAGE_KEYS.orderDiscount);
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
  if (cartTotals().itemCount) printKitchenOrder();
}

function renderCategories() {
  const allCategories = state.options.categories;
  const categories = ['ทั้งหมด', ...getProductCategories(state.products.filter((product) => product.active))];
  if (!categories.includes(state.category)) state.category = 'ทั้งหมด';
  $('#category-tabs').innerHTML = categories.map((category) => `
    <button class="${category === state.category ? 'is-active' : ''}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>
  `).join('');
  $('#product-category').innerHTML = `<option value="">เลือกหมวดหมู่สินค้า</option>${allCategories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('')}`;
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

function selectedDraftOptions() {
  return state.options.groups.flatMap((group) => group.choices
    .filter((choice) => itemDraft.optionSelections[group.id]?.includes(choice.id))
    .map((choice) => ({ id: `${group.id}:${choice.id}`, name: `${group.name}: ${choice.name}`, price: Number(choice.price) || 0 })));
}

function renderItemForm() {
  const product = selectedDraftProduct();
  if (!product) return;
  const variants = state.products.filter((item) => item.active && (item.groupId || item.id) === itemDraft.groupId);
  $('#variant-section').hidden = variants.length < 2;
  $('#variant-options').innerHTML = variants.map((item) => `<button type="button" class="choice-button ${item.id === itemDraft.productId ? 'is-selected' : ''}" data-variant="${escapeHtml(item.id)}"><span>${escapeHtml(item.optionName || item.name)}</span><strong>${money.format(item.price)}</strong></button>`).join('');
  const enabledGroups = state.options.groups.filter((group) => group.selection === 'multiple' ? supportsAddOns(product) : supportsSpiceLevel(product));
  const validGroupIds = new Set(enabledGroups.map((group) => group.id));
  Object.keys(itemDraft.optionSelections).forEach((groupId) => { if (!validGroupIds.has(groupId)) delete itemDraft.optionSelections[groupId]; });
  enabledGroups.forEach((group) => {
    if (group.selection === 'single' && !itemDraft.optionSelections[group.id]?.length && group.choices.length) itemDraft.optionSelections[group.id] = [group.choices[0].id];
  });
  $('#custom-option-sections').innerHTML = enabledGroups.map((group) => `<section class="item-option-section"><h3>${escapeHtml(group.name)}</h3><div class="choice-grid ${group.selection === 'single' ? 'compact' : ''}">${group.choices.map((choice) => `<button type="button" class="choice-button ${itemDraft.optionSelections[group.id]?.includes(choice.id) ? 'is-selected' : ''}" data-option-group="${escapeHtml(group.id)}" data-option-choice="${escapeHtml(choice.id)}"><span>${escapeHtml(choice.name)}</span>${choice.price ? `<strong>+${money.format(choice.price)}</strong>` : ''}</button>`).join('')}</div></section>`).join('');
  $('#item-quantity').textContent = itemDraft.quantity;
  const discountType = itemDraft.discount?.type || 'none';
  $('#item-discount-type').value = discountType;
  $('#item-discount-value').hidden = discountType === 'none';
  $('#item-discount-value').value = itemDraft.discount?.value ?? '';
  $('#item-discount-value').max = discountType === 'percent' ? '100' : '';
  const addOns = selectedDraftOptions();
  const totals = calculateCart([{ productId: product.id, quantity: itemDraft.quantity, addOns, discount: itemDraft.discount }], [product]);
  $('#item-total').textContent = money.format(totals.total);
}

function openItemForm(groupId) {
  const variants = state.products.filter((product) => product.active && (product.groupId || product.id) === groupId);
  if (!variants.length) return;
  const product = variants[0];
  itemDraft = { groupId, productId: product.id, quantity: 1, optionSelections: {} };
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
  const addOns = selectedDraftOptions();
  state.cart.push({
    lineId: globalThis.crypto?.randomUUID?.() || `line-${Date.now()}`,
    productId: product.id,
    quantity: itemDraft.quantity,
    addOns,
    discount: itemDraft.discount,
    note: $('#item-note').value.trim(),

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

function discountFromInputs(type, rawValue) {
  if (type === 'none') return undefined;
  const value = Math.max(0, Number(rawValue || 0));
  return { type, value: type === 'percent' ? Math.min(100, value) : value };
}

function discountLabel(discount, amount) {
  if (!discount || !amount) return '';
  const value = discount.type === 'percent' ? `${discount.value}%` : money.format(discount.value);
  return `ส่วนลด ${value} (−${money.format(amount)})`;
}

function updateItemDiscount() {
  if (!itemDraft) return;
  itemDraft.discount = discountFromInputs($('#item-discount-type').value, $('#item-discount-value').value);
  renderItemForm();
}

function updateOrderDiscount() {
  state.orderDiscount = discountFromInputs($('#order-discount-type').value, $('#order-discount-value').value) || null;
  if (state.orderDiscount) save(STORAGE_KEYS.orderDiscount, state.orderDiscount);
  else localStorage.removeItem(STORAGE_KEYS.orderDiscount);
  renderCart();
}

function clearOrderDiscount() {
  state.orderDiscount = null;
  localStorage.removeItem(STORAGE_KEYS.orderDiscount);
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
      ...(item.discountAmount ? [discountLabel(item.discount, item.discountAmount)] : []),
      ...(item.note ? [`หมายเหตุ: ${item.note}`] : []),
    ];
    return `<div class="cart-line">
      <div class="cart-line-main">${productVisual(product, 'line-photo', 'line-emoji')}<span class="cart-line-name"><strong>${escapeHtml(item.name)}</strong><small>${money.format(item.unitPrice)} / ชิ้น</small>${details.length ? `<small class="line-options">${escapeHtml(details.join(' · '))}</small>` : ''}${spiceSelector}</span></div>
      <div class="cart-line-side"><strong class="line-total">${money.format(item.lineTotal)}</strong><div class="quantity-stepper"><button data-quantity="-1" data-line="${escapeHtml(lineId)}" aria-label="ลดจำนวน">−</button><span>${item.quantity}</span><button data-quantity="1" data-line="${escapeHtml(lineId)}" aria-label="เพิ่มจำนวน">＋</button></div></div>
    </div>`;
  }).join('');
  $('#cart-empty').hidden = totals.itemCount > 0;
  $('#cart-count').textContent = `${totals.itemCount} ชิ้น`;
  $('#order-discount-type').value = state.orderDiscount?.type || 'none';
  $('#order-discount-value').hidden = !state.orderDiscount;
  $('#order-discount-value').value = state.orderDiscount?.value ?? '';
  $('#order-discount-value').max = state.orderDiscount?.type === 'percent' ? '100' : '';
  $('#cart-discount-row').hidden = totals.discountTotal === 0;
  $('#cart-discount').textContent = `−${money.format(totals.discountTotal)}`;
  $('#cart-total').textContent = money.format(totals.total);
  $('#checkout-total').textContent = money.format(totals.total);
  $('#checkout-button').disabled = totals.itemCount === 0;
  $('#hold-order').disabled = totals.itemCount === 0;
  $('#print-kitchen-order').disabled = totals.itemCount === 0;
  $('#hold-order-label').textContent = state.currentHeldOrderId ? 'อัปเดตบิลพัก' : 'พักบิล';
}

function printKitchenOrder({ cart = state.cart, serviceLocation = state.serviceLocation, printedAt = new Date() } = {}) {
  const totals = calculateCart(cart, state.products);
  if (!totals.itemCount) return;
  if (!serviceLocation) {
    openLocationDialog();
    showToast('เลือกโซนและโต๊ะก่อนพิมพ์ใบครัว');
    return;
  }
  const root = $('#kitchen-print-root');
  root.innerHTML = `<article class="kitchen-ticket">
    <header><strong>ใบออเดอร์ครัว</strong><span>ไร่สุขอนันต์</span></header>
    <section class="kitchen-location">${escapeHtml(serviceLocation.label)}</section>
    <div class="kitchen-meta"><span>${dateTime.format(new Date(printedAt))}</span><span>${totals.itemCount} ชิ้น</span></div>
    <div class="kitchen-items">${totals.items.map((item) => `<div class="kitchen-item"><strong><b>${item.quantity}×</b> ${escapeHtml(item.name)}</strong>${item.spiceLevel ? `<span>${escapeHtml(item.spiceLevel)}</span>` : ''}${item.addOns?.length ? `<span>+ ${escapeHtml(item.addOns.map((addOn) => addOn.name).join(' · '))}</span>` : ''}${item.note ? `<em>หมายเหตุ: ${escapeHtml(item.note)}</em>` : ''}</div>`).join('')}</div>
    <footer>— จบรายการ —</footer>
  </article>`;
  document.body.classList.add('kitchen-printing');
  requestAnimationFrame(() => window.print());
}

window.addEventListener('afterprint', () => {
  document.body.classList.remove('kitchen-printing');
  $('#kitchen-print-root').replaceChildren();
});

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
    orderDiscount: state.orderDiscount,
    serviceLocation: state.serviceLocation,
    id: current?.id,
    createdAt: current?.createdAt,
  });
  if (current) state.heldOrders = state.heldOrders.map((order) => order.id === held.id ? held : order);
  else state.heldOrders.unshift(held);
  save(STORAGE_KEYS.heldOrders, state.heldOrders);
  state.cart = [];
  save(STORAGE_KEYS.cart, state.cart);
  clearOrderDiscount();
  saveServiceLocation(null);
  setCurrentHeldOrder();
  renderCart();
  renderHeldOrders();
  showToast(`พักบิล ${held.serviceLocation.label} แล้ว`);
  printKitchenOrder({ cart: held.cart, serviceLocation: held.serviceLocation, printedAt: held.updatedAt });
}

function resumeHeldOrder(orderId) {
  const held = state.heldOrders.find((order) => order.id === orderId);
  if (!held) return;
  if (state.cart.length && state.currentHeldOrderId !== orderId && !window.confirm('แทนที่ออเดอร์ที่กำลังทำด้วยบิลพักนี้?')) return;
  state.cart = structuredClone(held.cart);
  save(STORAGE_KEYS.cart, state.cart);
  state.orderDiscount = held.orderDiscount || null;
  if (state.orderDiscount) save(STORAGE_KEYS.orderDiscount, state.orderDiscount);
  else localStorage.removeItem(STORAGE_KEYS.orderDiscount);
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
    clearOrderDiscount();
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
    <div class="held-order-actions"><button type="button" data-resume-held="${escapeHtml(order.id)}">${order.id === state.currentHeldOrderId ? 'กำลังเปิด' : 'เรียกบิล'}</button><button type="button" data-print-held="${escapeHtml(order.id)}">พิมพ์ครัว</button><button type="button" class="danger" data-cancel-held="${escapeHtml(order.id)}">ยกเลิก</button></div>
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
      orderDiscount: state.orderDiscount,
    });
    state.orders.unshift(order);
    if (state.currentHeldOrderId) {
      state.heldOrders = state.heldOrders.filter((held) => held.id !== state.currentHeldOrderId);
      save(STORAGE_KEYS.heldOrders, state.heldOrders);
      setCurrentHeldOrder();
    }
    state.cart = [];
    clearOrderDiscount();
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
  $('#metric-cost').textContent = money.format(summary.costOfGoods);
  $('#metric-profit').textContent = money.format(summary.grossProfit);
  $('#metric-margin').textContent = `${summary.grossMargin.toLocaleString('th-TH', { maximumFractionDigits: 1 })}%`;
  $('#metric-orders').textContent = summary.orderCount.toLocaleString('th-TH');
  $('#metric-average').textContent = money.format(summary.averageOrderValue);
  const costWarning = $('#profit-cost-warning');
  costWarning.hidden = summary.missingCostItemCount === 0;
  costWarning.textContent = summary.missingCostItemCount ? `กำไรยังไม่สมบูรณ์: มีสินค้าที่ขาย ${summary.missingCostItemCount.toLocaleString('th-TH')} ชิ้นที่ยังไม่ได้ระบุต้นทุน` : '';
  const paymentData = [
    ['💵', 'เงินสด', summary.paymentTotals.cash],
    ['▦', 'สแกน QR', summary.paymentTotals.qr],
  ];
  $('#payment-breakdown').innerHTML = paymentData.map(([icon, label, total]) => `<div class="payment-item"><span class="payment-icon">${icon}</span><div><strong>${label}</strong><small>${summary.revenue ? Math.round(total / summary.revenue * 100) : 0}% ของยอดขาย</small></div><strong>${money.format(total)}</strong></div>`).join('');
  $('#top-products').innerHTML = summary.topProducts.slice(0, 6).map((product, index) => `<div class="rank-item"><span class="rank-number">${String(index + 1).padStart(2, '0')}</span><div><strong>${escapeHtml(product.name)}</strong><small>${product.quantity} ชิ้น</small></div><strong>${money.format(product.revenue)}</strong></div>`).join('') || '<div class="empty-state"><strong>ยังไม่มีข้อมูล</strong><p>เริ่มขายสินค้าเพื่อดูอันดับ</p></div>';
}

function switchProductSection(section) {
  $$('[data-product-section]').forEach((button) => button.classList.toggle('is-active', button.dataset.productSection === section));
  $$('[data-product-panel]').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.productPanel === section));
  if (section === 'categories') renderCategoryAdmin();
  if (section === 'options') renderOptionsAdmin();
}

function renderCategoryAdmin() {
  $('#category-admin-list').innerHTML = state.options.categories.map((category) => {
    const count = state.products.filter((product) => product.category === category).length;
    return `<article class="catalog-admin-row"><span class="catalog-setting-icon">▦</span><div><strong>${escapeHtml(category)}</strong><small>${count.toLocaleString('th-TH')} สินค้า</small></div><span class="catalog-admin-actions"><button data-rename-category="${escapeHtml(category)}">แก้ไข</button><button class="danger" data-delete-category="${escapeHtml(category)}" ${count ? 'disabled title="ย้ายสินค้าออกจากหมวดหมู่นี้ก่อน"' : ''}>ลบ</button></span></article>`;
  }).join('') || '<div class="held-orders-empty">ยังไม่มีหมวดหมู่สินค้า</div>';
}

function addCategory() {
  const name = window.prompt('ชื่อหมวดหมู่ใหม่')?.trim();
  if (!name) return;
  if (state.options.categories.includes(name)) return showToast('มีหมวดหมู่นี้อยู่แล้ว');
  state.options.categories.push(name);
  save(STORAGE_KEYS.options, state.options);
  renderCategories();
  renderCategoryAdmin();
  showToast('เพิ่มหมวดหมู่แล้ว');
}

function renameCategory(category) {
  const name = window.prompt('แก้ไขชื่อหมวดหมู่', category)?.trim();
  if (!name || name === category) return;
  if (state.options.categories.includes(name)) return showToast('มีหมวดหมู่นี้อยู่แล้ว');
  state.options.categories = state.options.categories.map((item) => item === category ? name : item);
  state.products.forEach((product) => { if (product.category === category) product.category = name; });
  save(STORAGE_KEYS.options, state.options);
  save(STORAGE_KEYS.products, state.products);
  renderCategories();
  renderProducts();
  renderProductAdmin();
  renderCategoryAdmin();
  showToast('แก้ไขหมวดหมู่แล้ว');
}

function deleteCategory(category) {
  if (state.products.some((product) => product.category === category)) return showToast('ย้ายสินค้าออกจากหมวดหมู่นี้ก่อน');
  if (!window.confirm(`ลบหมวดหมู่ “${category}”?`)) return;
  state.options.categories = state.options.categories.filter((item) => item !== category);
  save(STORAGE_KEYS.options, state.options);
  renderCategories();
  renderCategoryAdmin();
  showToast('ลบหมวดหมู่แล้ว');
}

function renderOptionsAdmin() {
  $('#option-group-grid').innerHTML = state.options.groups.map((group) => `<article class="catalog-setting-card option-group-card"><span class="catalog-setting-icon">${group.selection === 'single' ? '◉' : '＋'}</span><div><h3>${escapeHtml(group.name)}</h3><p>${group.choices.map((choice) => `${escapeHtml(choice.name)}${choice.price ? ` ${money.format(choice.price)}` : ''}`).join(' · ') || 'ยังไม่มีรายการย่อย'}</p></div><span class="option-group-actions"><button type="button" data-edit-option-group="${escapeHtml(group.id)}" title="แก้ไขกลุ่ม">✎</button><button type="button" data-delete-option-group="${escapeHtml(group.id)}" title="ลบกลุ่ม">⌫</button></span></article>`).join('') || '<div class="held-orders-empty option-groups-empty">ยังไม่มีกลุ่มตัวเลือก กด “เพิ่มกลุ่มตัวเลือก” เพื่อสร้างเอง</div>';
}

function renderProductAdmin() {
  $('#product-admin-grid').innerHTML = state.products.map((product) => `<article class="admin-card ${product.active ? '' : 'is-inactive'}">${productVisual(product, 'admin-photo', 'admin-emoji')}<span class="admin-info"><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.category)} · ขาย ${money.format(product.price)} · ${Number.isFinite(Number(product.cost)) ? `ต้นทุน ${money.format(Number(product.cost))}` : 'ยังไม่ใส่ต้นทุน'}${product.active ? '' : ' · พักขาย'}</small></span><span class="admin-actions"><button data-edit-product="${escapeHtml(product.id)}" title="แก้ไข">✎</button><button data-toggle-product="${escapeHtml(product.id)}" title="${product.active ? 'พักขาย' : 'เปิดขาย'}">${product.active ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z"/><circle cx="12" cy="12" r="2.3"/><path d="m4 4 16 16"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z"/><circle cx="12" cy="12" r="2.3"/></svg>'}</button><button data-delete-product="${escapeHtml(product.id)}" title="ลบสินค้า"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m7 7 1 13h8l1-13"/><path d="M10 11v5M14 11v5"/></svg></button></span></article>`).join('');
}

function renderOptionSettingsRows() {
  $('#addon-settings').innerHTML = optionDraft.map((choice) => `<div class="option-setting-row"><label><span>ชื่อตัวเลือก</span><input data-option-name="${escapeHtml(choice.id)}" value="${escapeHtml(choice.name)}" maxlength="30" required></label><label><span>ราคาเพิ่ม (บาท)</span><input data-option-price="${escapeHtml(choice.id)}" type="number" min="0" step="1" value="${choice.price ?? ''}" required></label><button type="button" class="option-delete-button" data-delete-option="${escapeHtml(choice.id)}" title="ลบตัวเลือก" aria-label="ลบ ${escapeHtml(choice.name || 'ตัวเลือกนี้')}">⌫</button></div>`).join('') || '<div class="held-orders-empty">ยังไม่มีรายการย่อย กด “เพิ่มรายการย่อย” เพื่อสร้าง</div>';
}

function openOptionsForm(groupId = '') {
  const group = state.options.groups.find((item) => item.id === groupId);
  $('#options-form-error').textContent = '';
  $('#option-group-id').value = group?.id || '';
  $('#option-group-name').value = group?.name || '';
  $('#option-group-selection').value = group?.selection || 'multiple';
  $('#options-form-title').textContent = group ? 'แก้ไขกลุ่มตัวเลือก' : 'เพิ่มกลุ่มตัวเลือก';
  optionDraft = structuredClone(group?.choices || []);
  renderOptionSettingsRows();
  $('#options-dialog').showModal();
}

function addOptionRow() {
  optionDraft.push({ id: globalThis.crypto?.randomUUID?.() || `choice-${Date.now()}`, name: '', price: 0 });
  renderOptionSettingsRows();
  $('#addon-settings [data-option-name]:last-of-type')?.focus();
}

function deleteOptionRow(optionId) {
  optionDraft = optionDraft.filter((choice) => choice.id !== optionId);
  renderOptionSettingsRows();
}

function deleteOptionGroup(groupId) {
  const group = state.options.groups.find((item) => item.id === groupId);
  if (!group || !window.confirm(`ลบกลุ่มตัวเลือก “${group.name}”?\nออเดอร์เก่าจะยังเก็บรายละเอียดเดิมไว้`)) return;
  state.options.groups = state.options.groups.filter((item) => item.id !== groupId);
  state.options.addOns = state.options.groups.find((item) => item.id === 'addons')?.choices || [];
  save(STORAGE_KEYS.options, state.options);
  renderOptionsAdmin();
  showToast('ลบกลุ่มตัวเลือกแล้ว');
}

function saveOptions(event) {
  event.preventDefault();
  try {
    const id = $('#option-group-id').value || globalThis.crypto?.randomUUID?.() || `group-${Date.now()}`;
    const name = $('#option-group-name').value.trim();
    const selection = $('#option-group-selection').value;
    if (!name || !['single', 'multiple'].includes(selection)) throw new Error('กรุณากรอกชื่อกลุ่มและวิธีเลือก');
    if (!optionDraft.length) throw new Error('กรุณาเพิ่มรายการย่อยอย่างน้อย 1 รายการ');
    const choices = optionDraft.map((choice) => {
      const choiceName = $(`[data-option-name="${choice.id}"]`).value.trim();
      const price = Number($(`[data-option-price="${choice.id}"]`).value);
      if (!choiceName || !Number.isFinite(price) || price < 0) throw new Error('กรุณากรอกชื่อและราคาให้ถูกต้อง');
      return { id: choice.id, name: choiceName, price };
    });
    const nextGroup = { id, name, selection, choices };
    const index = state.options.groups.findIndex((group) => group.id === id);
    if (index >= 0) state.options.groups[index] = nextGroup;
    else state.options.groups.push(nextGroup);
    state.options.addOns = state.options.groups.find((group) => group.id === 'addons')?.choices || [];
    save(STORAGE_KEYS.options, state.options);
    renderOptionsAdmin();
    $('#options-dialog').close();
    showToast(index >= 0 ? 'แก้ไขกลุ่มตัวเลือกแล้ว' : 'เพิ่มกลุ่มตัวเลือกแล้ว');
  } catch (error) {
    $('#options-form-error').textContent = error.message;
  }
}

function openProductForm(productId = '') {
  const product = state.products.find((item) => item.id === productId);
  $('#product-form').reset();
  $('#product-id').value = product?.id || '';
  $('#product-name').value = product?.name || '';
  $('#product-price').value = product?.price || '';
  $('#product-cost').value = Number.isFinite(Number(product?.cost)) ? product.cost : '';
  $('#product-category').value = product?.category || '';
  $('#product-emoji').value = product?.emoji || '☕';
  $('#product-addons-enabled').checked = product ? supportsAddOns(product) : true;
  $('#product-spice-enabled').checked = product ? supportsSpiceLevel(product) : true;
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
  const costValue = $('#product-cost').value.trim();
  const cost = costValue === '' ? undefined : Number(costValue);
  const emoji = $('#product-emoji').value.trim() || '☕';
  const addOnsEnabled = $('#product-addons-enabled').checked;
  const spiceLevelEnabled = $('#product-spice-enabled').checked;
  if (!name || !category || !Number.isFinite(price) || price <= 0 || (cost !== undefined && (!Number.isFinite(cost) || cost < 0))) {
    $('#product-error').textContent = 'กรุณากรอกชื่อ หมวดหมู่ ราคาขาย และต้นทุนให้ถูกต้อง';
    return;
  }
  if (id) {
    const product = state.products.find((item) => item.id === id);
    Object.assign(product, { name, category, price, cost, emoji, image: pendingProductImage, addOnsEnabled, spiceLevelEnabled });
    if (cost === undefined) delete product.cost;
  } else {
    const newId = `product-${Date.now()}`;
    state.products.push({ id: newId, name, category, price, ...(cost === undefined ? {} : { cost }), emoji, image: pendingProductImage, addOnsEnabled, spiceLevelEnabled, active: true });
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

function deleteProduct(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product || !window.confirm(`ลบสินค้า “${product.name}” ออกจากระบบ?\nรายการขายย้อนหลังจะไม่ถูกลบ`)) return;
  state.products = state.products.filter((item) => item.id !== productId);
  state.cart = state.cart.filter((line) => line.productId !== productId);
  state.heldOrders = state.heldOrders.filter((order) => !order.cart.some((line) => line.productId === productId));
  if (state.currentHeldOrderId && !state.heldOrders.some((order) => order.id === state.currentHeldOrderId)) setCurrentHeldOrder();
  save(STORAGE_KEYS.products, state.products);
  save(STORAGE_KEYS.cart, state.cart);
  save(STORAGE_KEYS.heldOrders, state.heldOrders);
  renderCategories();
  renderProducts();
  renderProductAdmin();
  renderCart();
  renderHeldOrders();
  showToast('ลบสินค้าแล้ว');
}

function showReceipt(order) {
  document.body.classList.remove('kitchen-printing');
  $('#kitchen-print-root').replaceChildren();
  const method = order.paymentMethod === 'cash' ? 'เงินสด' : 'สแกน QR';
  $('#receipt-content').innerHTML = `<div class="receipt"><div class="modal-head"><span></span><button class="close-button" data-close-receipt aria-label="ปิด">×</button></div><div class="receipt-head"><img src="assets/rai-suk-anan-logo.webp" alt=""><h2>ไร่สุขอนันต์</h2><span>ขอบคุณที่แวะมาพักใจ</span></div><div class="receipt-meta"><span>เลขที่</span><span>${escapeHtml(order.orderNumber)}</span><span>วันที่</span><span>${dateTime.format(new Date(order.createdAt))}</span><span>ชำระโดย</span><span>${method}</span><span>โซน / โต๊ะ</span><span>${escapeHtml(order.serviceLocation?.label || 'ไม่ระบุโต๊ะ')}</span></div><div class="receipt-lines">${order.items.map((item) => `<div class="receipt-line"><span>${escapeHtml(item.name)} × ${item.quantity}${item.spiceLevel ? `<small class="receipt-spice">${escapeHtml(item.spiceLevel)}</small>` : ''}${item.addOns?.length ? `<small class="receipt-spice">${escapeHtml(item.addOns.map((addOn) => `${addOn.name} +${money.format(addOn.price)}`).join(' · '))}</small>` : ''}${item.discountAmount ? `<small class="receipt-spice">${escapeHtml(discountLabel(item.discount, item.discountAmount))}</small>` : ''}${item.note ? `<small class="receipt-spice">หมายเหตุ: ${escapeHtml(item.note)}</small>` : ''}</span><span>${money.format(item.lineTotal)}</span></div>`).join('')}</div>${order.discountTotal ? `<div class="receipt-meta"><span>ยอดก่อนส่วนลด</span><span>${money.format(order.grossSubtotal ?? order.subtotal + order.discountTotal)}</span><span>ส่วนลดรวม</span><span>−${money.format(order.discountTotal)}</span></div>` : ''}<div class="receipt-total"><strong>ยอดสุทธิ</strong><strong>${money.format(order.total)}</strong></div>${order.paymentMethod === 'cash' ? `<div class="receipt-meta"><span>รับเงิน</span><span>${money.format(order.amountReceived)}</span><span>เงินทอน</span><span>${money.format(order.change)}</span></div>` : ''}<div class="receipt-actions"><button class="primary-button" data-print-receipt>พิมพ์ใบเสร็จ</button><button class="primary-button" data-close-receipt>ปิด</button></div></div>`;
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
$('#print-kitchen-order').addEventListener('click', () => printKitchenOrder());
$('#held-orders').addEventListener('click', (event) => {
  const resume = event.target.closest('[data-resume-held]');
  const print = event.target.closest('[data-print-held]');
  const cancel = event.target.closest('[data-cancel-held]');
  if (resume) resumeHeldOrder(resume.dataset.resumeHeld);
  if (print) {
    const held = state.heldOrders.find((order) => order.id === print.dataset.printHeld);
    if (held) printKitchenOrder({ cart: held.cart, serviceLocation: held.serviceLocation, printedAt: held.updatedAt });
  }
  if (cancel) cancelHeldOrder(cancel.dataset.cancelHeld);
});
$('#item-form').addEventListener('submit', confirmItem);
$('#item-discount-type').addEventListener('change', updateItemDiscount);
$('#item-discount-value').addEventListener('input', updateItemDiscount);
$('#item-form').addEventListener('click', (event) => {
  if (!itemDraft) return;
  const variant = event.target.closest('[data-variant]');
  const option = event.target.closest('[data-option-group][data-option-choice]');
  if (variant) itemDraft.productId = variant.dataset.variant;
  if (option) {
    const group = state.options.groups.find((item) => item.id === option.dataset.optionGroup);
    const current = itemDraft.optionSelections[group.id] || [];
    itemDraft.optionSelections[group.id] = group.selection === 'single'
      ? [option.dataset.optionChoice]
      : current.includes(option.dataset.optionChoice) ? current.filter((id) => id !== option.dataset.optionChoice) : [...current, option.dataset.optionChoice];
  }
  if (event.target.closest('#item-quantity-minus')) itemDraft.quantity = Math.max(1, itemDraft.quantity - 1);
  if (event.target.closest('#item-quantity-plus')) itemDraft.quantity += 1;
  if (variant || option || event.target.closest('#item-quantity-minus, #item-quantity-plus')) renderItemForm();
});
$('#clear-cart').addEventListener('click', () => { if ((!state.cart.length && !state.serviceLocation) || window.confirm('ล้างออเดอร์ปัจจุบัน?\nบิลที่พักไว้จะยังอยู่ในหน้ารายการขาย')) { state.cart = []; save(STORAGE_KEYS.cart, state.cart); clearOrderDiscount(); saveServiceLocation(null); setCurrentHeldOrder(); renderCart(); renderHeldOrders(); } });
$('#order-discount-type').addEventListener('change', updateOrderDiscount);
$('#order-discount-value').addEventListener('input', updateOrderDiscount);
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
$('.product-management-menu').addEventListener('click', (event) => { const button = event.target.closest('[data-product-section]'); if (button) switchProductSection(button.dataset.productSection); });
$('#add-category').addEventListener('click', addCategory);
$('#category-admin-list').addEventListener('click', (event) => { const rename = event.target.closest('[data-rename-category]'); const remove = event.target.closest('[data-delete-category]'); if (rename) renameCategory(rename.dataset.renameCategory); if (remove) deleteCategory(remove.dataset.deleteCategory); });
$('#manage-options').addEventListener('click', () => openOptionsForm());
$('#option-group-grid').addEventListener('click', (event) => {
  const edit = event.target.closest('[data-edit-option-group]');
  const remove = event.target.closest('[data-delete-option-group]');
  if (edit) openOptionsForm(edit.dataset.editOptionGroup);
  if (remove) deleteOptionGroup(remove.dataset.deleteOptionGroup);
});
$('#add-option-row').addEventListener('click', addOptionRow);
$('#addon-settings').addEventListener('click', (event) => { const remove = event.target.closest('[data-delete-option]'); if (remove) deleteOptionRow(remove.dataset.deleteOption); });
$('#options-form').addEventListener('submit', saveOptions);
$('#cancel-options').addEventListener('click', () => $('#options-dialog').close('cancel'));
$('#product-admin-grid').addEventListener('click', (event) => { const edit = event.target.closest('[data-edit-product]'); const toggle = event.target.closest('[data-toggle-product]'); const remove = event.target.closest('[data-delete-product]'); if (edit) openProductForm(edit.dataset.editProduct); if (toggle) toggleProduct(toggle.dataset.toggleProduct); if (remove) deleteProduct(remove.dataset.deleteProduct); });
$('#product-form').addEventListener('submit', saveProduct);
$('#product-category').addEventListener('change', (event) => {
  if (!$('#product-id').value) $('#product-spice-enabled').checked = supportsSpiceLevel({ category: event.target.value.trim() });
});
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
