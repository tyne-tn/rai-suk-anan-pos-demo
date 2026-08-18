import { LOYVERSE_PRODUCTS } from './pos-products.js';

export const DEFAULT_PRODUCTS = LOYVERSE_PRODUCTS;

const NON_SPICY_CATEGORIES = new Set([
  '(05) กางเต้น & อุปกรณ์เล่นน้ํา',
  '(09) เครื่องดื่ม',
]);

export const SPICE_LEVELS = ['ไม่เผ็ด', 'เผ็ดน้อย', 'เผ็ดกลาง', 'เผ็ดมาก'];

export function supportsSpiceLevel(product) {
  return Boolean(product?.category) && !NON_SPICY_CATEGORIES.has(product.category);
}

const PAYMENT_METHODS = new Set(['cash', 'qr']);

function assertFinitePositive(value, message) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(message);
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
    const lineTotal = product.price * quantity;
    const spiceLevel = supportsSpiceLevel(product) ? entry.spiceLevel || 'เผ็ดกลาง' : undefined;
    if (spiceLevel && !SPICE_LEVELS.includes(spiceLevel)) {
      throw new Error('ระดับความเผ็ดไม่ถูกต้อง');
    }
    subtotal += lineTotal;
    itemCount += quantity;
    return {
      productId: product.id,
      name: product.name,
      unitPrice: product.price,
      quantity,
      lineTotal,
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
