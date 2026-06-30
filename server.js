const express = require('express');
const cors    = require('cors');
const bcrypt  = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const db      = require('./database');

const app         = express();
const PORT        = process.env.PORT || 3000;
const SALT_ROUNDS = 10;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════

// POST /api/register   { name, email, password }
app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password)
    return res.status(400).json({ error: 'name, email and password are required.' });

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Invalid email address.' });

  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email))
    return res.status(409).json({ error: 'An account with that email already exists.' });

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const id   = uuidv4();
  db.prepare(
    'INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, name.trim(), email.trim().toLowerCase(), hash, new Date().toISOString());

  res.status(201).json({ message: 'Account created!', user: { id, name, email } });
});

// POST /api/login   { email, password }
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: 'email and password are required.' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user)
    return res.status(401).json({ error: 'Invalid email or password.' });

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match)
    return res.status(401).json({ error: 'Invalid email or password.' });

  res.json({ message: 'Logged in!', user: { id: user.id, name: user.name, email: user.email } });
});

// GET /api/users  (admin)
app.get('/api/users', (_req, res) => {
  const users = db.prepare('SELECT id, name, email, created_at FROM users ORDER BY created_at DESC').all();
  res.json(users);
});

// ════════════════════════════════════════════════════════
// NEWSLETTER
// ════════════════════════════════════════════════════════

// POST /api/subscribe   { email }
app.post('/api/subscribe', (req, res) => {
  const { email } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Invalid email address.' });

  if (db.prepare('SELECT id FROM subscribers WHERE email = ?').get(email))
    return res.status(409).json({ error: 'Already subscribed.' });

  db.prepare('INSERT INTO subscribers (id, email, subscribed_at) VALUES (?, ?, ?)').run(
    uuidv4(), email.trim().toLowerCase(), new Date().toISOString()
  );

  res.json({ message: 'Subscribed successfully!' });
});

// GET /api/subscribers  (admin)
app.get('/api/subscribers', (_req, res) => {
  res.json(db.prepare('SELECT * FROM subscribers ORDER BY subscribed_at DESC').all());
});

// ════════════════════════════════════════════════════════
// RESERVATIONS
// ════════════════════════════════════════════════════════

// POST /api/reserve   { name, email, phone, date, time, guests, notes }
app.post('/api/reserve', (req, res) => {
  const { name, email, phone, date, time, guests, notes } = req.body;

  if (!name || !email || !date || !time || !guests)
    return res.status(400).json({ error: 'name, email, date, time and guests are required.' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO reservations (id, name, email, phone, date, time, guests, notes, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, name.trim(), email.trim(), phone || '', date, time, Number(guests), notes || '', new Date().toISOString());

  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  res.status(201).json({ message: 'Reservation received!', reservation });
});

// GET /api/reservations  (admin)
app.get('/api/reservations', (_req, res) => {
  res.json(db.prepare('SELECT * FROM reservations ORDER BY created_at DESC').all());
});

// ════════════════════════════════════════════════════════
// ORDERS
// ════════════════════════════════════════════════════════

// POST /api/order   { items: [{ name, price, qty }], customerName, email }
app.post('/api/order', (req, res) => {
  const { items, customerName, email } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'Order must contain at least one item.' });

  if (!customerName || !email)
    return res.status(400).json({ error: 'customerName and email are required.' });

  const total = items.reduce((sum, i) => sum + Number(i.price) * Number(i.qty || 1), 0);
  const id    = uuidv4();
  const now   = new Date().toISOString();

  // Insert order + items in one transaction so they either both succeed or both fail
  const insertOrder = db.prepare(`
    INSERT INTO orders (id, customer_name, email, total, status, created_at)
    VALUES (?, ?, ?, ?, 'received', ?)
  `);
  const insertItem = db.prepare(`
    INSERT INTO order_items (order_id, name, price, qty) VALUES (?, ?, ?, ?)
  `);

  db.transaction(() => {
    insertOrder.run(id, customerName.trim(), email.trim(), total.toFixed(2), now);
    for (const item of items) {
      insertItem.run(id, item.name, Number(item.price), Number(item.qty || 1));
    }
  })();

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  order.items = db.prepare('SELECT name, price, qty FROM order_items WHERE order_id = ?').all(id);

  res.status(201).json({ message: 'Order placed!', order });
});

// GET /api/orders  (admin) — includes items
app.get('/api/orders', (_req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  const getItems = db.prepare('SELECT name, price, qty FROM order_items WHERE order_id = ?');
  for (const order of orders) order.items = getItems.all(order.id);
  res.json(orders);
});

// ════════════════════════════════════════════════════════
// START
// ════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`May's Coffee server → http://localhost:${PORT}`);
  console.log(`  Site  : http://localhost:${PORT}/coffee.html`);
  console.log(`  Login : http://localhost:${PORT}/login.html`);
  console.log(`  DB    : mays_coffee.db`);
});
