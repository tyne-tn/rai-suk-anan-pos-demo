import { LOYVERSE_PRODUCTS } from './pos-products.js';

export const DEFAULT_PRODUCTS = LOYVERSE_PRODUCTS;

export function getProductCategories(products) {
  return [...new Set(products.map((product) => product.category).filter(Boolean))];
}

export function groupCatalogProducts(products) {
  const groups = new Map();
  products.forEach((product) => {
    const groupId = product.groupId || product.id;
    const current = groups.get(groupId) || {
      groupId,
      displayName: product.displayName || product.name,
      category: product.category,
      emoji: product.emoji,
      image: product.image || '',
      products: [],
      minPrice: product.price,
      maxPrice: product.price,
    };
    current.products.push(product);
    current.minPrice = Math.min(current.minPrice, product.price);
    current.maxPrice = Math.max(current.maxPrice, product.price);
    if (!current.image && product.image) current.image = product.image;
    groups.set(groupId, current);
  });
  return [...groups.values()];
}

const NON_SPICY_CATEGORIES = new Set([
  '(05) กางเต้น & อุปกรณ์เล่นน้ํา',
  '(09) เครื่องดื่ม',
]);

export const SPICE_LEVELS = ['ไม่เผ็ด', 'เผ็ดน้อย', 'เผ็ดกลาง', 'เผ็ดมาก'];

function categorySupportsFoodCustomization(product) {
  return Boolean(product?.category) && !NON_SPICY_CATEGORIES.has(product.category);
}

export function supportsSpiceLevel(product) {
  if (typeof product?.spiceLevelEnabled === 'boolean') return product.spiceLevelEnabled;
  return categorySupportsFoodCustomization(product);
}

export function supportsAddOns(product) {
  if (typeof product?.addOnsEnabled === 'boolean') return product.addOnsEnabled;
  return categorySupportsFoodCustomization(product);
}

const PAYMENT_METHODS = new Set(['cash', 'qr']);

export const DEFAULT_SERVICE_ZONES = ['A', 'B', 'C', 'D', 'โต๊ะเสริม'].map((name) => ({
  id: name === 'โต๊ะเสริม' ? 'extra' : name,
  name,
  tables: Array.from({ length: 10 }, (_, index) => index + 1),
}));

function normalizeServiceLocation(value) {
  if (!value) throw new Error('กรุณาเลือกโซนและโต๊ะ');
  if (value.type === 'takeaway') return { type: 'takeaway', label: 'กลับบ้าน' };
  const zone = DEFAULT_SERVICE_ZONES.find((entry) => entry.name === value.zone);
  const table = Number(value.table);
  if (value.type !== 'table' || !zone || !zone.tables.includes(table)) {
    throw new Error('โซนหรือโต๊ะไม่ถูกต้อง');
  }
  return { type: 'table', zone: zone.name, table, label: `โซน ${zone.name} · โต๊ะ ${table}` };
}

export function isSameServiceLocation(first, second) {
  if (first?.type !== 'table' || second?.type !== 'table') return false;
  return first.zone === second.zone && Number(first.table) === Number(second.table);
}

function assertFinitePositive(value, message) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(message);
}

function normalizeAddOns(value) {
  if (!Array.isArray(value)) return [];
  return value.map((addOn) => {
    const price = Number(addOn?.price);
    if (!addOn?.id || !addOn?.name || !Number.isFinite(price) || price <= 0) {
      throw new Error('ราคาของเพิ่มไม่ถูกต้อง');
    }
    return { id: String(addOn.id), name: String(addOn.name), price };
  });
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeDiscount(value) {
  if (!value || value.type === 'none' || value.value === '' || value.value === null || value.value === undefined) return undefined;
  if (!['amount', 'percent'].includes(value.type)) throw new Error('ประเภทส่วนลดไม่ถูกต้อง');
  const amount = Number(value.value);
  if (!Number.isFinite(amount) || amount < 0 || (value.type === 'percent' && amount > 100)) {
    throw new Error('ส่วนลดไม่ถูกต้อง');
  }
  return { type: value.type, value: amount };
}

function discountAmount(discount, base) {
  if (!discount) return 0;
  const amount = discount.type === 'percent' ? base * discount.value / 100 : discount.value;
  return roundMoney(Math.min(base, amount));
}

export function calculateCart(cart, products, orderDiscountValue) {
  const productMap = new Map(products.map((product) => [product.id, product]));
  let subtotal = 0;
  let grossSubtotal = 0;
  let itemDiscountTotal = 0;
  let itemCount = 0;

  const items = cart.map((entry) => {
    const product = productMap.get(entry.productId);
    if (!product) throw new Error(`ไม่พบสินค้า: ${entry.productId}`);
    assertFinitePositive(entry.quantity, 'จำนวนสินค้าต้องมากกว่า 0');
    assertFinitePositive(product.price, 'ราคาสินค้าต้องมากกว่า 0');

    const quantity = Math.floor(entry.quantity);
    if (quantity !== entry.quantity) throw new Error('จำนวนสินค้าต้องเป็นจำนวนเต็ม');
    const addOns = supportsAddOns(product) ? normalizeAddOns(entry.addOns) : [];
    const addOnTotal = addOns.reduce((total, addOn) => total + addOn.price, 0);
    const unitPrice = product.price + addOnTotal;
    const grossLineTotal = roundMoney(unitPrice * quantity);
    const discount = normalizeDiscount(entry.discount);
    const itemDiscountAmount = discountAmount(discount, grossLineTotal);
    const lineTotal = roundMoney(grossLineTotal - itemDiscountAmount);
    const hasCost = product.cost !== undefined && product.cost !== null && product.cost !== '' && Number.isFinite(Number(product.cost)) && Number(product.cost) >= 0;
    const unitCost = hasCost ? Number(product.cost) : null;
    const lineCost = hasCost ? unitCost * quantity : null;
    const spiceLevel = supportsSpiceLevel(product) ? entry.spiceLevel || 'เผ็ดกลาง' : undefined;
    if (spiceLevel && !SPICE_LEVELS.includes(spiceLevel)) throw new Error('ระดับความเผ็ดไม่ถูกต้อง');
    grossSubtotal += grossLineTotal;
    subtotal += lineTotal;
    itemDiscountTotal += itemDiscountAmount;
    itemCount += quantity;
    return {
      lineId: entry.lineId || product.id,
      productId: product.id,
      name: product.name,
      basePrice: product.price,
      unitPrice,
      quantity,
      grossLineTotal,
      lineTotal,
      discount,
      discountAmount: itemDiscountAmount,
      unitCost,
      lineCost,
      addOns,
      note: String(entry.note || '').trim().slice(0, 120),
      ...(spiceLevel ? { spiceLevel } : {}),
    };
  });

  const orderDiscount = normalizeDiscount(orderDiscountValue);
  const orderDiscountAmount = discountAmount(orderDiscount, subtotal);
  const total = roundMoney(subtotal - orderDiscountAmount);
  return {
    items,
    grossSubtotal: roundMoney(grossSubtotal),
    subtotal: roundMoney(subtotal),
    itemDiscountTotal: roundMoney(itemDiscountTotal),
    orderDiscount,
    orderDiscountAmount,
    discountTotal: roundMoney(itemDiscountTotal + orderDiscountAmount),
    total,
    itemCount,
  };
}

function bangkokDateParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

export function createOrder({
  cart,
  products,
  paymentMethod,
  amountReceived = 0,
  now = new Date(),
  sequence = 1,
  serviceLocation,
  orderDiscount,
}) {
  if (!PAYMENT_METHODS.has(paymentMethod)) throw new Error('วิธีชำระเงินไม่ถูกต้อง');
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error('ลำดับออเดอร์ไม่ถูกต้อง');

  const totals = calculateCart(cart, products, orderDiscount);
  if (totals.itemCount === 0) throw new Error('กรุณาเลือกสินค้า');

  const received = paymentMethod === 'cash' ? Number(amountReceived) : totals.total;
  if (!Number.isFinite(received) || received < totals.total) {
    throw new Error('ยอดรับเงินไม่เพียงพอ');
  }

  const isoDate = now.toISOString();
  const location = normalizeServiceLocation(serviceLocation);
  return {
    id: `${now.getTime()}-${sequence}`,
    orderNumber: `RS-${bangkokDateParts(now)}-${String(sequence).padStart(3, '0')}`,
    createdAt: isoDate,
    items: totals.items,
    itemCount: totals.itemCount,
    grossSubtotal: totals.grossSubtotal,
    subtotal: totals.subtotal,
    itemDiscountTotal: totals.itemDiscountTotal,
    orderDiscount: totals.orderDiscount,
    orderDiscountAmount: totals.orderDiscountAmount,
    discountTotal: totals.discountTotal,
    total: totals.total,
    paymentMethod,
    amountReceived: received,
    change: received - totals.total,
    status: 'completed',
    serviceLocation: location,
  };
}

export function createHeldOrder({
  cart,
  products,
  serviceLocation,
  now = new Date(),
  id = `held-${now.getTime()}`,
  createdAt,
  orderDiscount,
}) {
  const totals = calculateCart(cart, products, orderDiscount);
  if (totals.itemCount === 0) throw new Error('กรุณาเลือกสินค้า');
  const location = normalizeServiceLocation(serviceLocation);
  const timestamp = now.toISOString();
  return {
    id,
    status: 'held',
    createdAt: createdAt || timestamp,
    updatedAt: timestamp,
    cart: structuredClone(cart),
    orderDiscount: totals.orderDiscount,
    serviceLocation: location,
    itemCount: totals.itemCount,
    grossSubtotal: totals.grossSubtotal,
    discountTotal: totals.discountTotal,
    total: totals.total,
  };
}

export function summarizeOrders(orders) {
  const completed = orders.filter((order) => order.status === 'completed');
  const productTotals = new Map();
  const paymentTotals = { cash: 0, qr: 0 };
  let revenue = 0;
  let costOfGoods = 0;
  let missingCostItemCount = 0;

  completed.forEach((order) => {
    revenue += order.total;
    if (Object.hasOwn(paymentTotals, order.paymentMethod)) {
      paymentTotals[order.paymentMethod] += order.total;
    }
    order.items.forEach((item) => {
      if (Number.isFinite(item.lineCost)) costOfGoods += item.lineCost;
      else missingCostItemCount += item.quantity;
      const current = productTotals.get(item.productId) || {
        productId: item.productId,
        name: item.name,
        quantity: 0,
        revenue: 0,
      };
      current.quantity += item.quantity;
      current.revenue += item.lineTotal;
      productTotals.set(item.productId, current);
    });
  });

  const orderCount = completed.length;
  const grossProfit = revenue - costOfGoods;
  return {
    revenue,
    costOfGoods,
    grossProfit,
    grossMargin: revenue ? grossProfit / revenue * 100 : 0,
    missingCostItemCount,
    orderCount,
    averageOrderValue: orderCount ? revenue / orderCount : 0,
    paymentTotals,
    topProducts: [...productTotals.values()].sort(
      (a, b) => b.quantity - a.quantity || b.revenue - a.revenue,
    ),
  };
}
