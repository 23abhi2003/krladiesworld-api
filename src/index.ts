import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();
app.use('*', cors());

// Dashboard KPI metrics
app.get('/api/dashboard/stats', async (c) => {
  const db = c.env.DB;
  const today = new Date().toISOString().split('T')[0];

  const orders = await db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as totalBilled, COALESCE(SUM(due_amount), 0) as totalDue FROM orders').first<{ count: number; totalBilled: number; totalDue: number }>();
  const todayRec = await db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM daily_payments WHERE payment_date = ?').bind(today).first<{ total: number }>();
  const totalRec = await db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM daily_payments').first<{ total: number }>();
  const totalInv = await db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM investments').first<{ total: number }>();

  return c.json({
    ordersCount: orders?.count || 0,
    totalBilled: orders?.totalBilled || 0,
    totalDue: orders?.totalDue || 0,
    todayReceived: todayRec?.total || 0,
    totalReceived: totalRec?.total || 0,
    totalInvestments: totalInv?.total || 0,
  });
});

// Orders & Order Items
app.get('/api/orders', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC, order_date DESC').all();
  return c.json(results);
});

app.get('/api/orders/:id', async (c) => {
  const id = c.req.param('id');
  const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!order) return c.json({ error: 'Order not found' }, 404);
  const items = await c.env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(id).all();
  return c.json({ ...order, items: items.results });
});

app.post('/api/orders', async (c) => {
  const body = await c.req.json();
  const db = c.env.DB;

  // Sequential order ID starting from 1 (KR-0001, KR-0002, ...)
  const allOrders = await db.prepare('SELECT id FROM orders').all<{ id: string }>();
  let maxSeq = 0;
  for (const o of allOrders.results || []) {
    const match = o.id.match(/^KR-(\d+)$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num < 100000 && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  const nextSeq = maxSeq + 1;
  const orderId = `KR-${String(nextSeq).padStart(4, '0')}`;

  const due = (Number(body.total_amount) || 0) - (Number(body.paid_amount) || 0);
  const status = due <= 0 ? 'paid' : 'due';

  const queries = [
    db.prepare('INSERT INTO orders (id, customer_name, customer_phone, order_date, total_amount, paid_amount, due_amount, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(orderId, body.customer_name, body.customer_phone || '', body.order_date, body.total_amount, body.paid_amount, due, status, body.notes || ''),
    ...(body.items || []).map((item: any, idx: number) =>
      db.prepare('INSERT INTO order_items (id, order_id, item_name, category, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(`ITM-${orderId}-${idx + 1}`, orderId, item.item_name, item.category, item.quantity, item.unit_price, item.total_price)
    )
  ];

  if (Number(body.paid_amount) > 0) {
    queries.push(
      db.prepare('INSERT INTO daily_payments (id, payment_date, amount, payment_mode, customer_name, order_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind('PAY-' + Date.now(), body.order_date, body.paid_amount, body.payment_mode || 'Cash', body.customer_name, orderId, 'Initial Advance')
    );
  }

  await db.batch(queries);
  return c.json({ success: true, orderId });
});

app.delete('/api/orders/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  await db.batch([
    db.prepare('DELETE FROM order_items WHERE order_id = ?').bind(id),
    db.prepare('DELETE FROM daily_payments WHERE order_id = ?').bind(id),
    db.prepare('DELETE FROM orders WHERE id = ?').bind(id),
  ]);
  return c.json({ success: true, id });
});

// Daily Payments Register
app.get('/api/daily-payments', async (c) => {
  const date = c.req.query('date');
  let q = 'SELECT * FROM daily_payments';
  const params: any[] = [];
  if (date) {
    q += ' WHERE payment_date = ?';
    params.push(date);
  }
  q += ' ORDER BY payment_date DESC, created_at DESC';
  const { results } = await c.env.DB.prepare(q).bind(...params).all();
  const total = results.reduce((sum: number, r: any) => sum + (r.amount || 0), 0);
  return c.json({ data: results, totalAmount: total });
});

app.post('/api/daily-payments', async (c) => {
  const body = await c.req.json();
  const id = 'PAY-' + Date.now();
  await c.env.DB.prepare('INSERT INTO daily_payments (id, payment_date, amount, payment_mode, customer_name, notes) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, body.payment_date, body.amount, body.payment_mode || 'Cash', body.customer_name || 'Walk-in Customer', body.notes || '')
    .run();
  return c.json({ success: true, id });
});

app.delete('/api/daily-payments/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  await db.prepare('DELETE FROM daily_payments WHERE id = ? OR payment_date = ?').bind(id, id).run();
  return c.json({ success: true, id });
});

// Investments Register
app.get('/api/investments', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM investments ORDER BY investment_date DESC, created_at DESC').all();
  const total = results.reduce((sum: number, r: any) => sum + (r.amount || 0), 0);
  return c.json({ data: results, totalInvested: total });
});

app.post('/api/investments', async (c) => {
  const body = await c.req.json();
  const id = 'INV-' + Date.now();
  await c.env.DB.prepare('INSERT INTO investments (id, investment_date, category, amount, description, payment_mode) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, body.investment_date, body.category, body.amount, body.description || '', body.payment_mode || 'Cash')
    .run();
  return c.json({ success: true, id });
});

app.delete('/api/investments/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  await db.prepare('DELETE FROM investments WHERE id = ?').bind(id).run();
  return c.json({ success: true, id });
});

// Analytics (Daily Received & Capital Flow)
app.get('/api/analytics', async (c) => {
  const db = c.env.DB;
  const receipts = await db.prepare('SELECT payment_date as date, SUM(amount) as received_amount FROM daily_payments GROUP BY payment_date ORDER BY payment_date ASC LIMIT 30').all();
  const investments = await db.prepare('SELECT investment_date as date, SUM(amount) as invested_amount FROM investments GROUP BY investment_date ORDER BY investment_date ASC LIMIT 30').all();
  return c.json({ receipts: receipts.results, investments: investments.results });
});

export default app;
