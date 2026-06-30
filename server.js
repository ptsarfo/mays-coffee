const express = require('express');
const cors    = require('cors');
const bcrypt  = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { pool, init } = require('./database');

const app         = express();
const PORT        = process.env.PORT || 3000;
const SALT_ROUNDS = 10;

app.use(cors());
app.use(express.json());

// In local dev, serve the HTML/CSS/images from the project folder
if (require.main === module) {
  app.use(require('express').static(__dirname));
}

// ════════════════════════════════════════════════════════
// HEALTH CHECK
// ════════════════════════════════════════════════════════
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════

// POST /api/register   { name, email, password }
app.post('/api/register', async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ error: 'name, email and password are required.' });

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Invalid email address.' });

    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length)
      return res.status(409).json({ error: 'An account with that email already exists.' });

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const id   = uuidv4();
    await pool.query(
      'INSERT INTO users (id, name, email, password_hash, created_at) VALUES ($1,$2,$3,$4,$5)',
      [id, name.trim(), email.trim().toLowerCase(), hash, new Date().toISOString()]
    );

    res.status(201).json({ message: 'Account created!', user: { id, name, email } });
  } catch (err) { next(err); }
});

// POST /api/login   { email, password }
app.post('/api/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: 'email and password are required.' });

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    const user   = result.rows[0];

    if (!user)
      return res.status(401).json({ error: 'Invalid email or password.' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match)
      return res.status(401).json({ error: 'Invalid email or password.' });

    res.json({ message: 'Logged in!', user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) { next(err); }
});

// GET /api/users  (admin)
app.get('/api/users', async (_req, res, next) => {
  try {
    const result = await pool.query('SELECT id, name, email, created_at FROM users ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════
// NEWSLETTER
// ════════════════════════════════════════════════════════

// POST /api/subscribe   { email }
app.post('/api/subscribe', async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Invalid email address.' });

    const existing = await pool.query('SELECT id FROM subscribers WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length)
      return res.status(409).json({ error: 'Already subscribed.' });

    await pool.query(
      'INSERT INTO subscribers (id, email, subscribed_at) VALUES ($1,$2,$3)',
      [uuidv4(), email.trim().toLowerCase(), new Date().toISOString()]
    );

    res.json({ message: 'Subscribed successfully!' });
  } catch (err) { next(err); }
});

// GET /api/subscribers  (admin)
app.get('/api/subscribers', async (_req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM subscribers ORDER BY subscribed_at DESC');
    res.json(result.rows);
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════
// RESERVATIONS
// ════════════════════════════════════════════════════════

// POST /api/reserve   { name, email, phone, date, time, guests, notes }
app.post('/api/reserve', async (req, res, next) => {
  try {
    const { name, email, phone, date, time, guests, notes } = req.body;

    if (!name || !email || !date || !time || !guests)
      return res.status(400).json({ error: 'name, email, date, time and guests are required.' });

    const id = uuidv4();
    await pool.query(
      `INSERT INTO reservations (id, name, email, phone, date, time, guests, notes, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)`,
      [id, name.trim(), email.trim(), phone || '', date, time, Number(guests), notes || '', new Date().toISOString()]
    );

    const result = await pool.query('SELECT * FROM reservations WHERE id = $1', [id]);
    res.status(201).json({ message: 'Reservation received!', reservation: result.rows[0] });
  } catch (err) { next(err); }
});

// GET /api/reservations  (admin)
app.get('/api/reservations', async (_req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM reservations ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════
// ORDERS
// ════════════════════════════════════════════════════════

// POST /api/order   { items: [{ name, price, qty }], customerName, email }
app.post('/api/order', async (req, res) => {
  const { items, customerName, email } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'Order must contain at least one item.' });

  if (!customerName || !email)
    return res.status(400).json({ error: 'customerName and email are required.' });

  const total  = items.reduce((sum, i) => sum + Number(i.price) * Number(i.qty || 1), 0);
  const id     = uuidv4();
  const now    = new Date().toISOString();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO orders (id, customer_name, email, total, status, created_at)
       VALUES ($1,$2,$3,$4,'received',$5)`,
      [id, customerName.trim(), email.trim(), total.toFixed(2), now]
    );
    for (const item of items) {
      await client.query(
        'INSERT INTO order_items (order_id, name, price, qty) VALUES ($1,$2,$3,$4)',
        [id, item.name, Number(item.price), Number(item.qty || 1)]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
  const itemsResult = await pool.query('SELECT name, price, qty FROM order_items WHERE order_id = $1', [id]);
  const order       = { ...orderResult.rows[0], items: itemsResult.rows };

  res.status(201).json({ message: 'Order placed!', order });
});

// GET /api/orders  (admin) — includes items
app.get('/api/orders', async (_req, res, next) => {
  try {
    const orders = (await pool.query('SELECT * FROM orders ORDER BY created_at DESC')).rows;
    for (const order of orders) {
      const items  = await pool.query('SELECT name, price, qty FROM order_items WHERE order_id = $1', [order.id]);
      order.items  = items.rows;
    }
    res.json(orders);
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════
// GLOBAL ERROR HANDLER — always returns JSON, never HTML
// ════════════════════════════════════════════════════════
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
});

// ════════════════════════════════════════════════════════
// START
// ════════════════════════════════════════════════════════
if (require.main === module) {
  // Local: node server.js
  init()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`May's Coffee server → http://localhost:${PORT}`);
        console.log(`  Site  : http://localhost:${PORT}/coffee.html`);
        console.log(`  Login : http://localhost:${PORT}/login.html`);
      });
    })
    .catch(err => {
      console.error('Failed to connect to database:', err.message);
      process.exit(1);
    });
} else {
  // Vercel serverless — init tables on cold start
  init().catch(console.error);
}

module.exports = app;
