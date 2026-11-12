const dotenv = require('dotenv');
const rootPath = require('node:path');
dotenv.config({ path: rootPath.join(__dirname, '..', '.env') });
dotenv.config({ path: rootPath.join(__dirname, '.env'), override: true });
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');
const { listInventory } = require('./inventory');
const whatsapp = require('./whatsapp');

if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL en las variables del servicio o en portal-clientes/.env');
const adminPassword = process.env.PORTAL_ADMIN_PASSWORD || process.env.APP_PASSWORD;
const sessionSecret = process.env.PORTAL_SESSION_SECRET || process.env.SESSION_SECRET;
if (!adminPassword || !sessionSecret) throw new Error('Configure PORTAL_ADMIN_PASSWORD y PORTAL_SESSION_SECRET.');
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
const secret = sessionSecret;
const grades = ['NACIONAL', 'BAJAS', 'NACIONAL GRANEL', 'BAJAS GRANEL'];
const colorGroups = [
  ['ROJOS', ['FREEDOM', 'EXPLORER']],
  ['BLANCOS', ['VENDELA', 'MONDIAL', 'CANDLELIGHT', 'WHITE OHARA']],
  ['ROSADOS CLAROS', ['PINK MONDIAL', 'BLESSING', 'PINK OHARA', 'SUMMERSAND', 'SOMMERSAND']],
  ['ROSADOS MEDIOS', ['SWAN']],
  ['ROSADOS FUERTES', ['PINK FLOYD', 'QUEEN BERRY']],
  ['AMARILLOS', ['MOMENTUM', 'YELLOW BIKINI', 'HUMMER']],
  ['MORADOS', ['STAR PLATINUM', 'DEEP PURPLE', 'MOODY BLUE', 'MOODY BLUES']],
  ['NARANJAS', ['HILUX', 'CORAL REEF']],
  ['PEACH', ['TIFFANY', 'SHIMMER']],
  ['ARENA', ['QUICK SAND', 'QUICKSAND']]
];
const assortedColor = 'COLORES SURTIDOS';
const regularColors = colorGroups.map(([name]) => name);
const assortedColors = regularColors.filter(color => color !== 'ROJOS');
const colors = [...regularColors, assortedColor];
const colorOf = new Map(colorGroups.flatMap(([color, names]) => names.map(name => [name, color])));
const norm = value => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
const money = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);

app.disable('x-powered-by');
app.use(express.json({ limit: '30kb' }));
app.use(express.static(path.join(__dirname, 'public')));
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function matchPassword(password, hash) {
  const [salt, digest] = String(hash).split(':');
  if (!salt || !digest) return false;
  const a = Buffer.from(digest, 'hex'); const b = crypto.scryptSync(password, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function secureEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function token(role, id) {
  const value = Buffer.from(JSON.stringify({ role, id, expires: Date.now() + 12 * 3600000 })).toString('base64url');
  return `${value}.${crypto.createHmac('sha256', secret).update(value).digest('base64url')}`;
}
function session(req) {
  try {
    const raw = (req.headers.cookie || '').split('; ').find(x => x.startsWith('portal_session='))?.slice(15);
    const [value, signature] = raw.split('.');
    const expected = crypto.createHmac('sha256', secret).update(value).digest('base64url');
    if (!secureEqual(signature, expected)) return null;
    const data = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return data.expires > Date.now() ? data : null;
  } catch { return null; }
}
function auth(role) { return (req, res, next) => { req.session = session(req); if (req.session?.role !== role) return res.status(401).json({ error: 'Inicia sesión para continuar.' }); next(); }; }
function setSession(res, value) { res.setHeader('Set-Cookie', `portal_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`); }
function fail(res, error, code = 400) { res.status(code).json({ error: error.message || String(error) }); }
async function prices() { const { rows } = await pool.query('SELECT grade, price_per_bunch FROM portal_prices ORDER BY grade'); return Object.fromEntries(rows.map(row => [row.grade, Number(row.price_per_bunch)])); }
function summarize(lots) {
  const result = Object.fromEntries(colors.map(color => [color, { color, grades: Object.fromEntries(grades.map(grade => [grade, { bunches: 0, stems: 0 }])) }]));
  for (const lot of lots) {
    const color = colorOf.get(norm(lot.variety));
    if (!color || !result[color].grades[lot.gradeCm]) continue;
    for (const grade of lot.gradeCm === 'BAJAS' ? ['BAJAS', 'BAJAS GRANEL'] : [lot.gradeCm]) {
      result[color].grades[grade].bunches += lot.bunches;
      result[color].grades[grade].stems += lot.stems;
    }
  }
  for (const color of assortedColors) {
    for (const grade of grades) {
      result[assortedColor].grades[grade].bunches += result[color].grades[grade].bunches;
      result[assortedColor].grades[grade].stems += result[color].grades[grade].stems;
    }
  }
  return Object.values(result);
}
function validateAvailability(items, catalog) {
  const requested = new Map();
  for (const item of items) {
    const key = `${item.color}|${item.grade}`;
    requested.set(key, (requested.get(key) || 0) + Number(item.bunches));
  }
  const amount = (color, grade) => requested.get(`${color}|${grade}`) || 0;
  for (const color of regularColors) {
    const stock = catalog.find(row => row.color === color).grades;
    for (const grade of ['NACIONAL', 'NACIONAL GRANEL']) {
      if (amount(color, grade) > stock[grade].bunches) throw new Error(`Inventario insuficiente de ${color} · ${grade}.`);
    }
    if (amount(color, 'BAJAS') + amount(color, 'BAJAS GRANEL') > stock.BAJAS.bunches) {
      throw new Error(`Inventario insuficiente de ${color} · BAJAS.`);
    }
  }
  const totalStock = catalog.find(row => row.color === assortedColor).grades;
  for (const grade of ['NACIONAL', 'NACIONAL GRANEL']) {
    const total = assortedColors.reduce((sum, color) => sum + amount(color, grade), amount(assortedColor, grade));
    if (total > totalStock[grade].bunches) throw new Error(`No hay suficientes ramos para combinar colores surtidos y ${grade}.`);
  }
  const totalBajas = [...assortedColors, assortedColor].reduce((sum, color) => sum + amount(color, 'BAJAS') + amount(color, 'BAJAS GRANEL'), 0);
  if (totalBajas > totalStock.BAJAS.bunches) throw new Error('No hay suficientes ramos de bajas para combinar colores surtidos e individuales.');
}
async function availability() { return summarize(await listInventory(pool)); }
function customerWhatsAppUrl(order, items) {
  const publicUrl = String(process.env.PORTAL_PUBLIC_URL || '').trim().replace(/\/$/, '');
  const reviewLink = publicUrl ? `\nRevisar y aprobar: ${publicUrl}/?pedido=${order.id}` : '\nRevisa el pedido en el panel del portal.';
  const detail = items.map(item => `${item.color} · ${item.grade} · ${item.bunches} ramos`).join('\n');
  const message = `Hola, soy ${order.name}. Acabo de hacer el pedido #${order.id} en Prestige Roses.\n\n${detail}\n\nTotal estimado: ${money(order.total)}\nObservaciones: ${order.notes || 'Ninguna'}${reviewLink}`;
  return `https://wa.me/${whatsapp.adminPhone}?text=${encodeURIComponent(message)}`;
}
let whatsappBusy = false;
async function processWhatsAppQueue() {
  if (whatsappBusy || !whatsapp.config()) return;
  whatsappBusy = true;
  try {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const connection = await pool.connect();
      let job;
      try {
        await connection.query('BEGIN');
        const { rows } = await connection.query(`
          SELECT order_id FROM portal_whatsapp_notifications
          WHERE status='PENDIENTE'
            OR (status IN ('ERROR','ENVIANDO') AND attempts < 10 AND updated_at < NOW() - INTERVAL '5 minutes')
          ORDER BY order_id LIMIT 1 FOR UPDATE SKIP LOCKED
        `);
        job = rows[0];
        if (job) await connection.query("UPDATE portal_whatsapp_notifications SET status='ENVIANDO',attempts=attempts+1,updated_at=NOW() WHERE order_id=$1", [job.order_id]);
        await connection.query('COMMIT');
      } catch (error) { await connection.query('ROLLBACK'); throw error; }
      finally { connection.release(); }
      if (!job) break;
      try {
        const { rows } = await pool.query('SELECT o.id,o.total,c.name FROM portal_orders o JOIN portal_customers c ON c.id=o.customer_id WHERE o.id=$1', [job.order_id]);
        if (!rows[0]) throw new Error('Pedido no encontrado.');
        const messageId = await whatsapp.sendOrderNotice(rows[0]);
        await pool.query("UPDATE portal_whatsapp_notifications SET status='SOLICITADO',message_id=$2,last_error='',updated_at=NOW() WHERE order_id=$1", [job.order_id, messageId]);
      } catch (error) {
        await pool.query("UPDATE portal_whatsapp_notifications SET status='ERROR',last_error=$2,updated_at=NOW() WHERE order_id=$1", [job.order_id, String(error.message || error).slice(0, 300)]);
        console.error('No se pudo solicitar el aviso de WhatsApp para el pedido', job.order_id);
      }
    }
  } catch (error) { console.error('No se pudo procesar la cola de WhatsApp:', error.message); }
  finally { whatsappBusy = false; }
}
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portal_customers (
      id BIGSERIAL PRIMARY KEY, name VARCHAR(160) NOT NULL, phone VARCHAR(30) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS portal_prices (
      grade VARCHAR(40) PRIMARY KEY, price_per_bunch NUMERIC(12,2) NOT NULL CHECK (price_per_bunch > 0), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS portal_orders (
      id BIGSERIAL PRIMARY KEY, customer_id BIGINT NOT NULL REFERENCES portal_customers(id), status VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
      total NUMERIC(14,2) NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', rejection_reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), decided_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS portal_order_items (
      id BIGSERIAL PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES portal_orders(id), color VARCHAR(40) NOT NULL,
      grade VARCHAR(40) NOT NULL, bunches INTEGER NOT NULL CHECK (bunches > 0), price_per_bunch NUMERIC(12,2) NOT NULL,
      subtotal NUMERIC(14,2) NOT NULL
    );
    CREATE TABLE IF NOT EXISTS portal_whatsapp_notifications (
      order_id BIGINT PRIMARY KEY REFERENCES portal_orders(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      message_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  const count = await pool.query('SELECT COUNT(*)::int AS n FROM portal_prices');
  if (!count.rows[0].n) {
    for (const [grade, price] of [['NACIONAL', 10000], ['BAJAS', 12000], ['NACIONAL GRANEL', 8000], ['BAJAS GRANEL', 7000]]) {
      await pool.query('INSERT INTO portal_prices(grade,price_per_bunch) VALUES($1,$2) ON CONFLICT DO NOTHING', [grade, price]);
    }
  }
}
app.get('/api/session', async (req, res) => {
  try { const s = session(req); if (!s) return res.json({ role: null }); if (s.role === 'admin') return res.json({ role: 'admin' }); const { rows } = await pool.query('SELECT id,name FROM portal_customers WHERE id=$1 AND active=TRUE', [s.id]); res.json(rows[0] ? { role: 'customer', name: rows[0].name } : { role: null }); } catch (e) { fail(res, e, 500); }
});
app.post('/api/login', async (req, res) => {
  try {
    if (req.body.role === 'admin') { if (!secureEqual(req.body.password, adminPassword)) throw new Error('Clave incorrecta.'); setSession(res, token('admin', 0)); return res.json({ role: 'admin' }); }
    const { rows } = await pool.query('SELECT * FROM portal_customers WHERE phone=$1 AND active=TRUE', [String(req.body.phone || '').trim()]);
    if (!rows[0] || !matchPassword(String(req.body.password || ''), rows[0].password_hash)) throw new Error('Teléfono o clave incorrectos.');
    setSession(res, token('customer', rows[0].id)); res.json({ role: 'customer', name: rows[0].name });
  } catch (e) { fail(res, e, 401); }
});
app.post('/api/logout', (_req, res) => { res.setHeader('Set-Cookie', 'portal_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); res.json({ ok: true }); });
app.get('/api/catalog', auth('customer'), async (_req, res) => { try { res.json({ colors: await availability(), prices: await prices(), automaticWhatsApp: Boolean(whatsapp.config()) }); } catch (e) { fail(res, e, 500); } });
app.get('/api/my-orders', auth('customer'), async (req, res) => { try { const { rows } = await pool.query(`SELECT o.*,COALESCE(json_agg(json_build_object('color',i.color,'grade',i.grade,'bunches',i.bunches,'subtotal',i.subtotal)) FILTER (WHERE i.id IS NOT NULL),'[]') AS items FROM portal_orders o LEFT JOIN portal_order_items i ON i.order_id=o.id WHERE o.customer_id=$1 GROUP BY o.id ORDER BY o.id DESC LIMIT 50`, [req.session.id]); res.json(rows); } catch (e) { fail(res, e, 500); } });
app.get('/api/my-orders/:id/whatsapp', auth('customer'), async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT o.*,c.name,COALESCE(json_agg(json_build_object('color',i.color,'grade',i.grade,'bunches',i.bunches)) FILTER (WHERE i.id IS NOT NULL),'[]') AS items FROM portal_orders o JOIN portal_customers c ON c.id=o.customer_id LEFT JOIN portal_order_items i ON i.order_id=o.id WHERE o.id=$1 AND o.customer_id=$2 GROUP BY o.id,c.id`, [req.params.id, req.session.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Pedido no encontrado.' });
    res.json({ whatsappUrl: customerWhatsAppUrl(rows[0], rows[0].items) });
  } catch (error) { fail(res, error, 500); }
});
app.post('/api/orders', auth('customer'), async (req, res) => {
  const client = await pool.connect();
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length || items.length > 40) throw new Error('Selecciona al menos un producto.');
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('portal-orders'))");
    const catalog = await availability(); const p = await prices();
    const requested = new Map(); let total = 0;
    for (const item of items) {
      const color = norm(item.color), grade = norm(item.grade), bunches = Number(item.bunches);
      if (!colors.includes(color) || !grades.includes(grade) || !Number.isSafeInteger(bunches) || bunches < 1 || bunches > 10000) throw new Error('Cantidad o producto no válido.');
      const key = `${color}|${grade}`; requested.set(key, (requested.get(key) || 0) + bunches);
      total += bunches * p[grade];
    }
    validateAvailability([...requested].map(([key, bunches]) => {
      const [color, grade] = key.split('|'); return { color, grade, bunches };
    }), catalog);
    const order = await client.query('INSERT INTO portal_orders(customer_id,total,notes) VALUES($1,$2,$3) RETURNING id', [req.session.id, total, String(req.body.notes || '').trim().slice(0, 1000)]);
    for (const [key, bunches] of requested) { const [color, grade] = key.split('|'); await client.query('INSERT INTO portal_order_items(order_id,color,grade,bunches,price_per_bunch,subtotal) VALUES($1,$2,$3,$4,$5,$6)', [order.rows[0].id, color, grade, bunches, p[grade], bunches * p[grade]]); }
    const { rows: customers } = await client.query('SELECT name FROM portal_customers WHERE id=$1', [req.session.id]);
    await client.query('INSERT INTO portal_whatsapp_notifications(order_id) VALUES($1)', [order.rows[0].id]);
    await client.query('COMMIT');
    const messageItems = [...requested].map(([key, bunches]) => { const [color, grade] = key.split('|'); return { color, grade, bunches }; });
    const whatsappUrl = customerWhatsAppUrl({ id: order.rows[0].id, name: customers[0].name, total, notes: String(req.body.notes || '').trim().slice(0, 1000) }, messageItems);
    res.status(201).json({ id: order.rows[0].id, total, status: 'PENDIENTE', whatsappUrl, automaticWhatsApp: Boolean(whatsapp.config()) });
    void processWhatsAppQueue();
  } catch (e) { await client.query('ROLLBACK'); fail(res, e); } finally { client.release(); }
});
app.get('/api/admin', auth('admin'), async (_req, res) => {
  try {
    const [orders, customers, p] = await Promise.all([
      pool.query(`SELECT o.*,c.name,c.phone,(SELECT n.status FROM portal_whatsapp_notifications n WHERE n.order_id=o.id) AS whatsapp_status,COALESCE(json_agg(json_build_object('color',i.color,'grade',i.grade,'bunches',i.bunches,'subtotal',i.subtotal)) FILTER (WHERE i.id IS NOT NULL),'[]') AS items FROM portal_orders o JOIN portal_customers c ON c.id=o.customer_id LEFT JOIN portal_order_items i ON i.order_id=o.id GROUP BY o.id,c.id ORDER BY o.id DESC LIMIT 100`),
      pool.query('SELECT id,name,phone,active FROM portal_customers ORDER BY name'), prices()
    ]);
    res.json({ orders: orders.rows, customers: customers.rows, prices: p, automaticWhatsApp: Boolean(whatsapp.config()) });
  } catch (e) { fail(res, e, 500); }
});
app.post('/api/admin/customers', auth('admin'), async (req, res) => {
  try { const name = String(req.body.name || '').trim(), phone = String(req.body.phone || '').trim(), password = String(req.body.password || ''); if (!name || !/^\+?\d{10,15}$/.test(phone) || password.length < 8) throw new Error('Ingrese nombre, teléfono internacional y una clave de 8 caracteres o más.'); const { rows } = await pool.query('INSERT INTO portal_customers(name,phone,password_hash) VALUES($1,$2,$3) RETURNING id,name,phone', [name, phone, hashPassword(password)]); res.status(201).json(rows[0]); } catch (e) { fail(res, e); }
});
app.put('/api/admin/prices', auth('admin'), async (req, res) => {
  try { for (const grade of grades) { const value = Number(req.body[grade]); if (!Number.isSafeInteger(value) || value < 1 || value > 100000000) throw new Error(`Precio inválido para ${grade}.`); } for (const grade of grades) await pool.query('UPDATE portal_prices SET price_per_bunch=$1,updated_at=NOW() WHERE grade=$2', [req.body[grade], grade]); res.json({ prices: await prices() }); } catch (e) { fail(res, e); }
});
app.put('/api/admin/orders/:id', auth('admin'), async (req, res) => {
  const client = await pool.connect();
  try {
    const decision = norm(req.body.decision); if (!['APROBADO', 'RECHAZADO'].includes(decision)) throw new Error('Decisión no válida.');
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT o.*,c.name,c.phone FROM portal_orders o JOIN portal_customers c ON c.id=o.customer_id WHERE o.id=$1 FOR UPDATE OF o', [req.params.id]);
    const order = rows[0]; if (!order || order.status !== 'PENDIENTE') throw new Error('El pedido ya fue procesado o no existe.');
    if (decision === 'APROBADO') {
      const catalog = await availability(); const { rows: items } = await client.query('SELECT color,grade,bunches FROM portal_order_items WHERE order_id=$1', [order.id]);
      validateAvailability(items, catalog);
    }
    await client.query('UPDATE portal_orders SET status=$1,rejection_reason=$2,decided_at=NOW() WHERE id=$3', [decision, String(req.body.reason || '').trim().slice(0, 500), order.id]);
    await client.query('COMMIT');
    const message = decision === 'APROBADO' ? `Hola ${order.name}, tu pedido #${order.id} de Prestige Roses fue aprobado. Total a pagar: ${money(order.total)}. Pronto coordinaremos la entrega.` : `Hola ${order.name}, tu pedido #${order.id} de Prestige Roses no pudo ser aprobado. ${String(req.body.reason || '').trim()}`;
    res.json({ id: order.id, status: decision, message, whatsappUrl: `https://wa.me/${order.phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}` });
  } catch (e) { await client.query('ROLLBACK'); fail(res, e); } finally { client.release(); }
});
app.use((err, _req, res, _next) => fail(res, err, 500));
init().then(() => {
  const port = Number(process.env.PORT) || Number(process.env.PORTAL_PORT) || 3018;
  app.listen(port, '0.0.0.0', () => console.log(`Portal de clientes escuchando en el puerto ${port}`));
  void processWhatsAppQueue();
  setInterval(() => { void processWhatsAppQueue(); }, 30000);
}).catch(error => { console.error(error); process.exitCode = 1; });
