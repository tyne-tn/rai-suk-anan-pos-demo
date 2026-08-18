import { LOYVERSE_PRODUCTS } from './pos-products.js';

export const DEFAULT_PRODUCTS = LOYVERSE_PRODUCTS;

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

export function supportsSpiceLevel(product) {
  return Boolean(product?.category) && !NON_SPICY_CATEGORIES.has(product.category);
}

export function supportsAddOns(product) {
  if (typeof product?.addOnsEnabled === 'boolean') return product.addOnsEnabled;
  return supportsSpiceLevel(product);
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

export function calculateCart(cart, products) {
  const productMap = new Map(products.map((product) => [product.id, product]));
  let subtotal = 0;
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
    const lineTotal = unitPrice * quantity;
    const spiceLevel = supportsSpiceLevel(product) ? entry.spiceLevel || 'เผ็ดกลาง' : undefined;
    if (spiceLevel && !SPICE_LEVELS.includes(spiceLevel)) throw new Error('ระดับความเผ็ดไม่ถูกต้อง');
    subtotal += lineTotal;
    itemCount += quantity;
    return {
      lineId: entry.lineId || product.id,
      productId: product.id,
      name: product.name,
      basePrice: product.price,
      unitPrice,
      quantity,
      lineTotal,
      addOns,
      note: String(entry.note || '').trim().slice(0, 120),
      ...(spiceLevel ? { spiceLevel } : {}),
    };
  });

  return { items, subtotal, total: subtotal, itemCount };
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
}) {
  if (!PAYMENT_METHODS.has(paymentMethod)) throw new Error('วิธีชำระเงินไม่ถูกต้อง');
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error('ลำดับออเดอร์ไม่ถูกต้อง');

  const totals = calculateCart(cart, products);
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
    subtotal: totals.subtotal,
    total: totals.total,
    paymentMethod,
    amountReceived: received,
    change: received - totals.total,
    status: 'completed',
    serviceLocation: location,
  };
}

export function summarizeOrders(orders) {
  const completed = orders.filter((order) => order.status === 'completed');
  const productTotals = new Map();
  const paymentTotals = { cash: 0, qr: 0 };
  let revenue = 0;

  completed.forEach((order) => {
    revenue += order.total;
    if (Object.hasOwn(paymentTotals, order.paymentMethod)) {
      paymentTotals[order.paymentMethod] += order.total;
    }
    order.items.forEach((item) => {
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
  return {
    revenue,
    orderCount,
    averageOrderValue: orderCount ? revenue / orderCount : 0,
    paymentTotals,
    topProducts: [...productTotals.values()].sort(
      (a, b) => b.quantity - a.quantity || b.revenue - a.revenue,
    ),
  };
}
