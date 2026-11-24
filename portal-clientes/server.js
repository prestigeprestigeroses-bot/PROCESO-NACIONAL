const dotenv = require('dotenv');
const rootPath = require('node:path');
dotenv.config({ path: rootPath.join(__dirname, '..', '.env') });
dotenv.config({ path: rootPath.join(__dirname, '.env'), override: true });
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');
const { listInventory } = require('./inventory');
const { allocateReservations } = require('./reservations');
const whatsapp = require('./whatsapp');

if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL en las variables del servicio o en portal-clientes/.env');
const adminPassword = process.env.PORTAL_ADMIN_PASSWORD || process.env.APP_PASSWORD;
const sessionSecret = process.env.PORTAL_SESSION_SECRET || process.env.SESSION_SECRET;
if (!adminPassword || !sessionSecret) throw new Error('Configure PORTAL_ADMIN_PASSWORD y PORTAL_SESSION_SECRET.');
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
const secret = sessionSecret;
const grades = ['NACIONAL', 'BAJAS', 'NACIONAL GRANEL', 'BAJAS GRANEL', 'EXPORTACION GRANEL'];
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
function loginIdentifier(value) {
  const identifier = String(value || '').trim();
  if (identifier && (!/^[A-Za-z0-9._-]{3,30}$/.test(identifier) || !/[A-Za-z]/.test(identifier))) {
    throw new Error('El usuario debe tener entre 3 y 30 caracteres, incluir una letra y usar solo letras, números, punto, guion o guion bajo.');
  }
  return identifier || null;
}
const money = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
const loginFailures = new Map();

app.disable('x-powered-by');
app.use('/webhooks/whatsapp', express.json({ limit: '2mb', verify(req, _res, body) { req.rawBody = Buffer.from(body); } }));
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
function auth(role) { return async (req, res, next) => {
  req.session = session(req);
  if (req.session?.role !== role) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
  if (role === 'customer') {
    try {
      const { rowCount } = await pool.query('SELECT 1 FROM portal_customers WHERE id=$1 AND active=TRUE', [req.session.id]);
      if (!rowCount) return res.status(401).json({ error: 'La cuenta de cliente ya no está activa.' });
    } catch (error) { return fail(res, error, 500); }
  }
  next();
}; }
function setSession(res, value) { res.setHeader('Set-Cookie', `portal_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`); }
function fail(res, error, code = 400) { res.status(code).json({ error: error.message || String(error) }); }
async function prices() { const { rows } = await pool.query('SELECT grade, price_per_bunch FROM portal_prices ORDER BY grade'); return Object.fromEntries(rows.map(row => [row.grade, Number(row.price_per_bunch)])); }
function summarize(lots) {
  const result = Object.fromEntries(colors.map(color => [color, { color, grades: Object.fromEntries(grades.map(grade => [grade, { bunches: 0, stems: 0 }])) }]));
  for (const lot of lots) {
    const color = colorOf.get(norm(lot.variety));
    if (!color || !result[color].grades[lot.gradeCm]) continue;
    result[color].grades[lot.gradeCm].bunches += lot.bunches;
    result[color].grades[lot.gradeCm].stems += lot.stems;
  }
  for (const color of assortedColors) {
    for (const grade of grades) {
      result[assortedColor].grades[grade].bunches += result[color].grades[grade].bunches;
      result[assortedColor].grades[grade].stems += result[color].grades[grade].stems;
    }
  }
  return Object.values(result);
}
async function availability(connection = pool, excludeOrderId = null) {
  const { rows: stockRows } = await connection.query('SELECT color,grade,bunches,stems FROM portal_stock');
  const { rows: reservations } = await connection.query(`
    SELECT r.color,r.grade,SUM(r.bunches)::int AS bunches
    FROM portal_inventory_reservations r JOIN portal_orders o ON o.id=r.order_id
    WHERE o.status IN ('PENDIENTE','APROBADO') AND ($1::bigint IS NULL OR o.id<>$1)
    GROUP BY r.color,r.grade
  `, [excludeOrderId]);
  const catalog = Object.fromEntries(colors.map(color => [color, { color, grades: Object.fromEntries(grades.map(grade => [grade, { bunches: 0, stems: 0 }])) }]));
  for (const row of stockRows) {
    const cell = catalog[row.color]?.grades[row.grade];
    if (cell) { cell.bunches = Number(row.bunches); cell.stems = Number(row.stems); }
  }
  for (const row of reservations) {
    const cell = catalog[row.color]?.grades[row.grade];
    if (!cell) continue;
    const stemsPerBunch = cell.bunches ? cell.stems / cell.bunches : 0;
    cell.bunches = Math.max(0, cell.bunches - Number(row.bunches));
    cell.stems = Math.max(0, Math.round(cell.stems - Number(row.bunches) * stemsPerBunch));
  }
  for (const color of assortedColors) for (const grade of grades) {
    catalog[assortedColor].grades[grade].bunches += catalog[color].grades[grade].bunches;
    catalog[assortedColor].grades[grade].stems += catalog[color].grades[grade].stems;
  }
  return Object.values(catalog);
}
let whatsappBusy = false;
let customerWhatsAppBusy = false;
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
        const { rows } = await pool.query("SELECT o.id,o.total,to_char(o.pickup_date,'YYYY-MM-DD') AS pickup_date,o.pickup_hour,c.name FROM portal_orders o JOIN portal_customers c ON c.id=o.customer_id WHERE o.id=$1", [job.order_id]);
        if (!rows[0]) throw new Error('Pedido no encontrado.');
        const { rows: items } = await pool.query('SELECT color,grade,bunches FROM portal_order_items WHERE order_id=$1 ORDER BY id', [job.order_id]);
        const messageId = await whatsapp.sendOrderNotice({ ...rows[0], items });
        await pool.query("UPDATE portal_whatsapp_notifications SET status='SOLICITADO',message_id=$2,last_error='',updated_at=NOW() WHERE order_id=$1", [job.order_id, messageId]);
      } catch (error) {
        await pool.query("UPDATE portal_whatsapp_notifications SET status='ERROR',last_error=$2,updated_at=NOW() WHERE order_id=$1", [job.order_id, String(error.message || error).slice(0, 300)]);
        console.error('No se pudo solicitar el aviso de WhatsApp para el pedido', job.order_id);
      }
    }
  } catch (error) { console.error('No se pudo procesar la cola de WhatsApp:', error.message); }
  finally { whatsappBusy = false; }
}
async function processCustomerWhatsAppQueue() {
  if (customerWhatsAppBusy || !whatsapp.approvalConfig()) return;
  customerWhatsAppBusy = true;
  try {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const connection = await pool.connect();
      let job;
      try {
        await connection.query('BEGIN');
        const { rows } = await connection.query(`
          SELECT order_id FROM portal_customer_notifications
          WHERE status='PENDIENTE'
            OR (status IN ('ERROR','ENVIANDO') AND attempts < 10 AND updated_at < NOW() - INTERVAL '5 minutes')
          ORDER BY order_id LIMIT 1 FOR UPDATE SKIP LOCKED
        `);
        job = rows[0];
        if (job) await connection.query("UPDATE portal_customer_notifications SET status='ENVIANDO',attempts=attempts+1,updated_at=NOW() WHERE order_id=$1", [job.order_id]);
        await connection.query('COMMIT');
      } catch (error) { await connection.query('ROLLBACK'); throw error; }
      finally { connection.release(); }
      if (!job) break;
      try {
        const { rows } = await pool.query("SELECT o.id,o.total,to_char(o.pickup_date,'YYYY-MM-DD') AS pickup_date,o.pickup_hour,c.name,c.phone FROM portal_orders o JOIN portal_customers c ON c.id=o.customer_id WHERE o.id=$1 AND o.status='APROBADO'", [job.order_id]);
        if (!rows[0]) throw new Error('Pedido aprobado no encontrado.');
        const messageId = await whatsapp.sendCustomerApproval(rows[0]);
        await pool.query("UPDATE portal_customer_notifications SET status='SOLICITADO',message_id=$2,last_error='',updated_at=NOW() WHERE order_id=$1", [job.order_id, messageId]);
      } catch (error) {
        await pool.query("UPDATE portal_customer_notifications SET status='ERROR',last_error=$2,updated_at=NOW() WHERE order_id=$1", [job.order_id, String(error.message || error).slice(0, 300)]);
        console.error('No se pudo solicitar la confirmación para el pedido', job.order_id);
      }
    }
  } catch (error) { console.error('No se pudo procesar la cola de confirmaciones:', error.message); }
  finally { customerWhatsAppBusy = false; }
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
      total NUMERIC(14,2) NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', pickup_date DATE, pickup_hour SMALLINT, rejection_reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), decided_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS portal_order_items (
      id BIGSERIAL PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES portal_orders(id), color VARCHAR(40) NOT NULL,
      grade VARCHAR(40) NOT NULL, bunches INTEGER NOT NULL CHECK (bunches > 0), price_per_bunch NUMERIC(12,2) NOT NULL,
      subtotal NUMERIC(14,2) NOT NULL
    );
    CREATE TABLE IF NOT EXISTS portal_stock (
      color VARCHAR(40) NOT NULL, grade VARCHAR(40) NOT NULL,
      bunches INTEGER NOT NULL CHECK (bunches >= 0), stems INTEGER NOT NULL DEFAULT 0 CHECK (stems >= 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (color,grade)
    );
    CREATE TABLE IF NOT EXISTS portal_inventory_reservations (
      order_id BIGINT NOT NULL REFERENCES portal_orders(id) ON DELETE CASCADE,
      color VARCHAR(40) NOT NULL, grade VARCHAR(40) NOT NULL,
      bunches INTEGER NOT NULL CHECK (bunches > 0)
    );
    CREATE TABLE IF NOT EXISTS portal_whatsapp_notifications (
      order_id BIGINT PRIMARY KEY REFERENCES portal_orders(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      message_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS portal_customer_notifications (
      order_id BIGINT PRIMARY KEY REFERENCES portal_orders(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      message_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query('ALTER TABLE portal_orders ADD COLUMN IF NOT EXISTS pickup_date DATE');
  await pool.query('ALTER TABLE portal_orders ADD COLUMN IF NOT EXISTS pickup_hour SMALLINT');
  await pool.query('ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS login_identifier VARCHAR(30)');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS portal_customers_login_identifier_unique ON portal_customers (LOWER(login_identifier)) WHERE login_identifier IS NOT NULL');
  const stockClient = await pool.connect();
  try {
    await stockClient.query('BEGIN');
    await stockClient.query("SELECT pg_advisory_xact_lock(hashtext('portal-stock-init'))");
    const { rows } = await stockClient.query('SELECT COUNT(*)::int AS count FROM portal_stock');
    if (!rows[0].count) {
      const initial = summarize(await listInventory(stockClient));
      for (const row of initial.filter(item => item.color !== assortedColor)) for (const grade of grades.filter(item => item !== 'EXPORTACION GRANEL')) {
        const value = row.grades[grade];
        await stockClient.query('INSERT INTO portal_stock(color,grade,bunches,stems) VALUES($1,$2,$3,$4)', [row.color, grade, value.bunches, value.stems]);
      }
    }
    await stockClient.query('COMMIT');
  } catch (error) { await stockClient.query('ROLLBACK'); throw error; } finally { stockClient.release(); }
  const count = await pool.query('SELECT COUNT(*)::int AS n FROM portal_prices');
  if (!count.rows[0].n) {
    for (const [grade, price] of [['NACIONAL', 10000], ['BAJAS', 12000], ['NACIONAL GRANEL', 8000], ['BAJAS GRANEL', 7000]]) {
      await pool.query('INSERT INTO portal_prices(grade,price_per_bunch) VALUES($1,$2) ON CONFLICT DO NOTHING', [grade, price]);
    }
  }
  await pool.query("INSERT INTO portal_prices(grade,price_per_bunch) VALUES('EXPORTACION GRANEL',9000) ON CONFLICT DO NOTHING");
}
app.get('/api/session', async (req, res) => {
  try { const s = session(req); if (!s) return res.json({ role: null }); if (s.role === 'admin') return res.json({ role: 'admin' }); const { rows } = await pool.query('SELECT id,name FROM portal_customers WHERE id=$1 AND active=TRUE', [s.id]); res.json(rows[0] ? { role: 'customer', name: rows[0].name } : { role: null }); } catch (e) { fail(res, e, 500); }
});
app.post('/api/login', async (req, res) => {
  try {
    if (req.body.role === 'admin') { if (!secureEqual(req.body.password, adminPassword)) throw new Error('Clave incorrecta.'); setSession(res, token('admin', 0)); return res.json({ role: 'admin' }); }
    const phone = String(req.body.phone || '').trim();
    const failureKey = `${req.ip}:${phone.toLowerCase()}`;
    const failure = loginFailures.get(failureKey);
    if (failure && failure.until > Date.now() && failure.count >= 5) return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos antes de volver a ingresar.' });
    const { rows } = await pool.query('SELECT * FROM portal_customers WHERE active=TRUE AND (phone=$1 OR LOWER(login_identifier)=LOWER($1))', [phone]);
    if (!rows[0] || !matchPassword(String(req.body.password || ''), rows[0].password_hash)) {
      const count = failure && failure.until > Date.now() ? failure.count + 1 : 1;
      if (loginFailures.size > 10000) loginFailures.clear();
      loginFailures.set(failureKey, { count, until: Date.now() + 15 * 60 * 1000 });
      throw new Error('Usuario, teléfono o clave incorrectos.');
    }
    loginFailures.delete(failureKey);
    setSession(res, token('customer', rows[0].id)); res.json({ role: 'customer', name: rows[0].name });
  } catch (e) { fail(res, e, 401); }
});
app.post('/api/logout', (_req, res) => { res.setHeader('Set-Cookie', 'portal_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); res.json({ ok: true }); });
app.get('/api/catalog', auth('customer'), async (_req, res) => { try { res.json({ colors: await availability(), prices: await prices(), automaticWhatsApp: Boolean(whatsapp.config()) }); } catch (e) { fail(res, e, 500); } });
app.get('/api/my-orders', auth('customer'), async (req, res) => { try { const { rows } = await pool.query(`SELECT o.*,COALESCE(json_agg(json_build_object('color',i.color,'grade',i.grade,'bunches',i.bunches,'subtotal',i.subtotal)) FILTER (WHERE i.id IS NOT NULL),'[]') AS items FROM portal_orders o LEFT JOIN portal_order_items i ON i.order_id=o.id WHERE o.customer_id=$1 GROUP BY o.id ORDER BY o.id DESC LIMIT 50`, [req.session.id]); res.json(rows); } catch (e) { fail(res, e, 500); } });
app.post('/api/orders', auth('customer'), async (req, res) => {
  if (!whatsapp.config()) return res.status(503).json({ error: 'Los avisos automáticos de WhatsApp aún no están configurados. Comunícate con el administrador.' });
  const client = await pool.connect();
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length || items.length > 40) throw new Error('Selecciona al menos un producto.');
    const pickupDate = String(req.body.pickupDate || '');
    const pickupHour = Number(req.body.pickupHour);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate) || req.body.pickupHour === '' || req.body.pickupHour == null || !Number.isSafeInteger(pickupHour) || pickupHour < 0 || pickupHour > 23) throw new Error('Selecciona el día y la hora de recogida.');
    const selectedDate = new Date(`${pickupDate}T12:00:00Z`);
    if (Number.isNaN(selectedDate.getTime()) || selectedDate.toISOString().slice(0, 10) !== pickupDate) throw new Error('Selecciona una fecha válida.');
    const lastPickupHour = selectedDate.getUTCDay() === 2 ? 14 : 13;
    if (pickupHour < 6 || pickupHour > lastPickupHour) throw new Error(`El horario de recogida es de 6 a. m. a ${lastPickupHour === 14 ? '2' : '1'} p. m. ese día.`);
    const todayParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]));
    if (pickupDate < `${todayParts.year}-${todayParts.month}-${todayParts.day}`) throw new Error('El día de recogida no puede estar en el pasado.');
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('portal-orders'))");
    const catalog = await availability(client); const p = await prices();
    const requested = new Map(); let total = 0;
    for (const item of items) {
      const color = norm(item.color), grade = norm(item.grade), bunches = Number(item.bunches);
      if (!colors.includes(color) || !grades.includes(grade) || !Number.isSafeInteger(bunches) || bunches < 1 || bunches > 10000) throw new Error('Cantidad o producto no válido.');
      const key = `${color}|${grade}`; requested.set(key, (requested.get(key) || 0) + bunches);
      total += bunches * p[grade];
    }
    const requestedItems = [...requested].map(([key, bunches]) => {
      const [color, grade] = key.split('|'); return { color, grade, bunches };
    });
    const allocations = allocateReservations(catalog, requestedItems, assortedColors);
    const order = await client.query('INSERT INTO portal_orders(customer_id,total,notes,pickup_date,pickup_hour) VALUES($1,$2,$3,$4,$5) RETURNING id', [req.session.id, total, String(req.body.notes || '').trim().slice(0, 1000), pickupDate, pickupHour]);
    for (const [key, bunches] of requested) { const [color, grade] = key.split('|'); await client.query('INSERT INTO portal_order_items(order_id,color,grade,bunches,price_per_bunch,subtotal) VALUES($1,$2,$3,$4,$5,$6)', [order.rows[0].id, color, grade, bunches, p[grade], bunches * p[grade]]); }
    for (const item of allocations) await client.query('INSERT INTO portal_inventory_reservations(order_id,color,grade,bunches) VALUES($1,$2,$3,$4)', [order.rows[0].id, item.color, item.grade, item.bunches]);
    await client.query('INSERT INTO portal_whatsapp_notifications(order_id) VALUES($1)', [order.rows[0].id]);
    await client.query('COMMIT');
    res.status(201).json({ id: order.rows[0].id, total, status: 'PENDIENTE' });
    void processWhatsAppQueue();
  } catch (e) { await client.query('ROLLBACK'); fail(res, e); } finally { client.release(); }
});
app.get('/api/admin', auth('admin'), async (_req, res) => {
  try {
    const [orders, customers, p, stock] = await Promise.all([
      pool.query(`SELECT o.*,c.name,c.phone,(SELECT n.status FROM portal_whatsapp_notifications n WHERE n.order_id=o.id) AS whatsapp_status,(SELECT n.last_error FROM portal_whatsapp_notifications n WHERE n.order_id=o.id) AS whatsapp_error,(SELECT n.status FROM portal_customer_notifications n WHERE n.order_id=o.id) AS customer_whatsapp_status,(SELECT n.last_error FROM portal_customer_notifications n WHERE n.order_id=o.id) AS customer_whatsapp_error,COALESCE(json_agg(json_build_object('color',i.color,'grade',i.grade,'bunches',i.bunches,'subtotal',i.subtotal)) FILTER (WHERE i.id IS NOT NULL),'[]') AS items FROM portal_orders o JOIN portal_customers c ON c.id=o.customer_id LEFT JOIN portal_order_items i ON i.order_id=o.id GROUP BY o.id,c.id ORDER BY o.id DESC LIMIT 100`),
      pool.query('SELECT c.id,c.name,c.phone,c.login_identifier,c.active,(SELECT COUNT(*)::int FROM portal_orders o WHERE o.customer_id=c.id) AS order_count FROM portal_customers c ORDER BY c.name'), prices(), availability()
    ]);
    res.json({ orders: orders.rows, customers: customers.rows, prices: p, stock, automaticWhatsApp: Boolean(whatsapp.config()), automaticApproval: Boolean(whatsapp.approvalConfig()), whatsappConfigurationIssues: whatsapp.configurationIssues(), approvalConfigurationIssues: whatsapp.approvalConfigurationIssues() });
  } catch (e) { fail(res, e, 500); }
});
app.post('/api/admin/customers', auth('admin'), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim(), phone = String(req.body.phone || '').trim(), password = String(req.body.password || '');
    const identifier = loginIdentifier(req.body.loginIdentifier);
    if (!name || !/^\+?\d{10,15}$/.test(phone) || password.length !== 4) throw new Error('Ingrese nombre, WhatsApp válido y una clave de exactamente 4 caracteres.');
    const { rows } = await pool.query('INSERT INTO portal_customers(name,phone,login_identifier,password_hash) VALUES($1,$2,$3,$4) RETURNING id,name,phone,login_identifier', [name, phone, identifier, hashPassword(password)]);
    res.status(201).json(rows[0]);
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'Ese usuario o WhatsApp ya está asignado a otro cliente.' }); fail(res, e); }
});
app.put('/api/admin/customers/:id', auth('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body.name || '').trim();
    const phone = String(req.body.phone || '').trim();
    const identifier = loginIdentifier(req.body.loginIdentifier);
    const password = String(req.body.password || '');
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Cliente no válido.');
    if (!name || name.length > 160 || !/^\+?\d{10,15}$/.test(phone)) throw new Error('Ingrese nombre y teléfono internacional válidos.');
    if (password && password.length !== 4) throw new Error('La nueva clave debe tener exactamente 4 caracteres.');
    const result = await pool.query(
      `UPDATE portal_customers SET name=$1,phone=$2,login_identifier=$3,password_hash=COALESCE($4,password_hash)
       WHERE id=$5 RETURNING id,name,phone,login_identifier,active`,
      [name, phone, identifier, password ? hashPassword(password) : null, id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Cliente no encontrado.' });
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Ese usuario o WhatsApp ya está asignado a otro cliente.' });
    fail(res, error);
  }
});
app.delete('/api/admin/customers/:id', auth('admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Cliente no válido.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT id FROM portal_customers WHERE id=$1 FOR UPDATE', [id]);
    if (!found.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Cliente no encontrado.' }); }
    await client.query('DELETE FROM portal_order_items WHERE order_id IN (SELECT id FROM portal_orders WHERE customer_id=$1)', [id]);
    await client.query('DELETE FROM portal_orders WHERE customer_id=$1', [id]);
    await client.query('DELETE FROM portal_customers WHERE id=$1', [id]);
    await client.query('COMMIT');
    res.json({ deleted: true });
  } catch (error) { await client.query('ROLLBACK'); fail(res, error, 500); } finally { client.release(); }
});
app.put('/api/admin/prices', auth('admin'), async (req, res) => {
  try { for (const grade of grades) { const value = Number(req.body[grade]); if (!Number.isSafeInteger(value) || value < 1 || value > 100000000) throw new Error(`Precio inválido para ${grade}.`); } for (const grade of grades) await pool.query('UPDATE portal_prices SET price_per_bunch=$1,updated_at=NOW() WHERE grade=$2', [req.body[grade], grade]); res.json({ prices: await prices() }); } catch (e) { fail(res, e); }
});
app.put('/api/admin/stock', auth('admin'), async (req, res) => {
  const color = norm(req.body.color), grade = norm(req.body.grade), available = Number(req.body.available);
  if (!regularColors.includes(color) || !grades.includes(grade) || grade === 'EXPORTACION GRANEL' || !Number.isSafeInteger(available) || available < 0 || available > 1000000) {
    return res.status(400).json({ error: 'Selecciona color, grado y cantidad disponible válidos.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('portal-orders'))");
    const { rows } = await client.query(`SELECT COALESCE(SUM(r.bunches),0)::int AS reserved FROM portal_inventory_reservations r JOIN portal_orders o ON o.id=r.order_id WHERE r.color=$1 AND r.grade=$2 AND o.status IN ('PENDIENTE','APROBADO')`, [color, grade]);
    const reserved = rows[0].reserved;
    await client.query(`UPDATE portal_stock SET bunches=$3,stems=$3*25,updated_at=NOW() WHERE color=$1 AND grade=$2`, [color, grade, available + reserved]);
    await client.query('COMMIT');
    res.json({ color, grade, available });
  } catch (error) { await client.query('ROLLBACK'); fail(res, error, 500); } finally { client.release(); }
});
app.delete('/api/admin/orders/:id', auth('admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Pedido no válido.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT id FROM portal_orders WHERE id=$1 FOR UPDATE', [id]);
    if (!found.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Pedido no encontrado.' }); }
    await client.query('DELETE FROM portal_order_items WHERE order_id=$1', [id]);
    await client.query('DELETE FROM portal_orders WHERE id=$1', [id]);
    await client.query('COMMIT');
    res.json({ deleted: true });
  } catch (error) { await client.query('ROLLBACK'); fail(res, error, 500); } finally { client.release(); }
});
async function decideOrder(id, decision, reason = '', notificationMessageId = null) {
  const client = await pool.connect();
  try {
    if (!['APROBADO', 'RECHAZADO'].includes(decision)) throw new Error('Decisión no válida.');
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('portal-orders'))");
    const { rows } = await client.query('SELECT o.*,c.name,c.phone FROM portal_orders o JOIN portal_customers c ON c.id=o.customer_id WHERE o.id=$1 FOR UPDATE OF o', [id]);
    const order = rows[0]; if (!order || order.status !== 'PENDIENTE') throw new Error('El pedido ya fue procesado o no existe.');
    if (notificationMessageId) {
      const notice = await client.query("SELECT 1 FROM portal_whatsapp_notifications WHERE order_id=$1 AND message_id=$2 AND status='SOLICITADO'", [id, notificationMessageId]);
      if (!notice.rowCount) throw new Error('El botón no corresponde al aviso de este pedido.');
    }
    if (decision === 'APROBADO') {
      const catalog = await availability(client, order.id); const { rows: items } = await client.query('SELECT color,grade,bunches FROM portal_order_items WHERE order_id=$1', [order.id]);
      const allocations = allocateReservations(catalog, items, assortedColors);
      await client.query('DELETE FROM portal_inventory_reservations WHERE order_id=$1', [order.id]);
      for (const item of allocations) await client.query('INSERT INTO portal_inventory_reservations(order_id,color,grade,bunches) VALUES($1,$2,$3,$4)', [order.id, item.color, item.grade, item.bunches]);
    } else {
      await client.query('DELETE FROM portal_inventory_reservations WHERE order_id=$1', [order.id]);
    }
    await client.query('UPDATE portal_orders SET status=$1,rejection_reason=$2,decided_at=NOW() WHERE id=$3', [decision, String(reason || '').trim().slice(0, 500), order.id]);
    const automaticConfirmation = decision === 'APROBADO' && Boolean(whatsapp.approvalConfig());
    if (automaticConfirmation) await client.query('INSERT INTO portal_customer_notifications(order_id) VALUES($1) ON CONFLICT DO NOTHING', [order.id]);
    await client.query('COMMIT');
    if (automaticConfirmation) void processCustomerWhatsAppQueue();
    const message = decision === 'APROBADO' ? `Hola ${order.name}, tu pedido #${order.id} de Prestige Roses fue aprobado. Total a pagar: ${money(order.total)}. Pronto coordinaremos la entrega.` : `Hola ${order.name}, tu pedido #${order.id} de Prestige Roses no pudo ser aprobado. ${String(reason || '').trim()}`;
    return { id: order.id, status: decision, automaticConfirmation, message, whatsappUrl: automaticConfirmation ? null : `https://wa.me/${order.phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}` };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
app.put('/api/admin/orders/:id', auth('admin'), async (req, res) => {
  try { res.json(await decideOrder(req.params.id, norm(req.body.decision), req.body.reason)); }
  catch (error) { fail(res, error); }
});
app.get('/webhooks/whatsapp', (req, res) => {
  const verifyToken = String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').trim();
  if (verifyToken && req.query['hub.mode'] === 'subscribe' && secureEqual(req.query['hub.verify_token'], verifyToken)) return res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
  res.sendStatus(403);
});
app.post('/webhooks/whatsapp', async (req, res) => {
  const settings = whatsapp.approvalConfig();
  if (!settings || !req.rawBody) return res.sendStatus(503);
  const expected = `sha256=${crypto.createHmac('sha256', settings.appSecret).update(req.rawBody).digest('hex')}`;
  if (!secureEqual(req.get('x-hub-signature-256'), expected)) return res.sendStatus(403);
  try {
    if (req.body?.object !== 'whatsapp_business_account') return res.sendStatus(200);
    for (const entry of req.body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages' || String(change.value?.metadata?.phone_number_id) !== settings.phoneId) continue;
        for (const message of change.value.messages || []) {
          if (String(message.from || '').replace(/\D/g, '') !== whatsapp.adminPhone || message.type !== 'button') continue;
          const orderId = whatsapp.approvedPayloadOrderId(message.button?.payload, settings.appSecret);
          if (!orderId || !message.context?.id) continue;
          try {
            await decideOrder(orderId, 'APROBADO', '', message.context.id);
            void whatsapp.sendText(whatsapp.adminPhone, `Pedido #${orderId} aprobado. Se está enviando la confirmación al cliente.`).catch(error => console.error('No se pudo responder al administrador por WhatsApp:', error.message));
          } catch (error) {
            console.error(`No se pudo aprobar el pedido ${orderId} desde WhatsApp:`, error.message);
            void whatsapp.sendText(whatsapp.adminPhone, `No se pudo aprobar el pedido #${orderId}: ${String(error.message).slice(0, 180)} Revisa el portal.`).catch(sendError => console.error('No se pudo responder al administrador por WhatsApp:', sendError.message));
          }
        }
      }
    }
    res.sendStatus(200);
  } catch (error) { console.error('Error al procesar webhook de WhatsApp:', error.message); res.sendStatus(500); }
});
app.use((err, _req, res, _next) => fail(res, err, 500));
init().then(() => {
  const port = Number(process.env.PORT) || Number(process.env.PORTAL_PORT) || 3018;
  app.listen(port, '0.0.0.0', () => console.log(`Portal de clientes escuchando en el puerto ${port}`));
  void processWhatsAppQueue();
  void processCustomerWhatsAppQueue();
  setInterval(() => { void processWhatsAppQueue(); void processCustomerWhatsAppQueue(); }, 30000);
}).catch(error => { console.error(error); process.exitCode = 1; });
