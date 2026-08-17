export const DEFAULT_PRODUCTS = [
  { id: 'americano', name: 'อเมริกาโน่', category: 'กาแฟ', price: 65, emoji: '☕', active: true },
  { id: 'latte', name: 'ลาเต้', category: 'กาแฟ', price: 75, emoji: '🥛', active: true },
  { id: 'cappuccino', name: 'คาปูชิโน่', category: 'กาแฟ', price: 75, emoji: '☕', active: true },
  { id: 'espresso', name: 'เอสเปรสโซ่', category: 'กาแฟ', price: 60, emoji: '🫘', active: true },
  { id: 'thai-tea', name: 'ชาไทย', category: 'ชาและนม', price: 65, emoji: '🧋', active: true },
  { id: 'matcha', name: 'มัทฉะลาเต้', category: 'ชาและนม', price: 85, emoji: '🍵', active: true },
  { id: 'cocoa', name: 'โกโก้', category: 'ชาและนม', price: 70, emoji: '🍫', active: true },
  { id: 'lemon-soda', name: 'เลมอนโซดา', category: 'โซดา', price: 65, emoji: '🍋', active: true },
  { id: 'coconut-cake', name: 'เค้กมะพร้าว', category: 'เบเกอรี่', price: 95, emoji: '🍰', active: true },
  { id: 'croissant', name: 'ครัวซองต์', category: 'เบเกอรี่', price: 75, emoji: '🥐', active: true },
  { id: 'brownie', name: 'บราวนี่', category: 'เบเกอรี่', price: 70, emoji: '🍫', active: true },
  { id: 'toast', name: 'ขนมปังปิ้ง', category: 'เบเกอรี่', price: 55, emoji: '🍞', active: true },
];

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
    subtotal += lineTotal;
    itemCount += quantity;
    return {
      productId: product.id,
      name: product.name,
      unitPrice: product.price,
      quantity,
      lineTotal,
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
