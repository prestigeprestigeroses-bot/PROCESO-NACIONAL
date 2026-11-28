const dotenv = require('dotenv');
const rootPath = require('node:path');
dotenv.config({ path: rootPath.join(__dirname, '..', '.env') });
dotenv.config({ path: rootPath.join(__dirname, '.env'), override: true });
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');
const { listInventory } = require('./inventory');
const { allocateReservations, applyReservations } = require('./reservations');
const { customerPrices, planAdditions } = require('./order-amendment');
const { buildInventoryOverview } = require('./inventory-overview');
const { colorGroups, colorOf } = require('./colors');
const whatsapp = require('./whatsapp');

if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL en las variables del servicio o en portal-clientes/.env');
const adminPassword = process.env.PORTAL_ADMIN_PASSWORD || process.env.APP_PASSWORD;
const sessionSecret = process.env.PORTAL_SESSION_SECRET || process.env.SESSION_SECRET;
if (!adminPassword || !sessionSecret) throw new Error('Configure PORTAL_ADMIN_PASSWORD y PORTAL_SESSION_SECRET.');
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
const secret = sessionSecret;
const grades = ['NACIONAL', 'BAJAS', 'NACIONAL GRANEL', 'BAJAS GRANEL', 'EUCALIPTO'];
const assortedColor = 'COLORES SURTIDOS';
const regularColors = colorGroups.map(([name]) => name);
const assortedColors = regularColors.filter(color => color !== 'ROJOS');
const colors = [...regularColors, assortedColor, 'EUCALIPTO'];
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
const catalogListeners = new Set();
function broadcastCatalogChanged() {
  for (const response of catalogListeners) response.write('event: inventory\ndata: changed\n\n');
}

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
async function prices(connection = pool, customerId = null) {
  const { rows } = await connection.query('SELECT grade, price_per_bunch FROM portal_prices ORDER BY grade');
  const result = Object.fromEntries(rows.map(row => [row.grade, Number(row.price_per_bunch)]));
  if (customerId === null) return result;
  const customer = await connection.query('SELECT name,login_identifier FROM portal_customers WHERE id=$1', [customerId]);
  return customerPrices(result, customer.rows[0]?.name, customer.rows[0]?.login_identifier);
}
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
  const lots = await listInventory(connection);
  const { rows: reservations } = await connection.query(`
    SELECT r.color,r.grade,SUM(r.bunches)::int AS bunches
    FROM portal_inventory_reservations r JOIN portal_orders o ON o.id=r.order_id
    WHERE o.status IN ('PENDIENTE','APROBADO') AND ($1::bigint IS NULL OR o.id<>$1)
    GROUP BY r.color,r.grade
  `, [excludeOrderId]);
  return applyReservations(summarize(lots), reservations, assortedColors);
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
          SELECT order_id,order_revision FROM portal_whatsapp_notifications
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
        const { rows } = await pool.query(`SELECT o.id,o.status,o.total,o.revision,to_char(o.pickup_date,'YYYY-MM-DD') AS pickup_date,o.pickup_hour,c.name,
          COALESCE(json_agg(json_build_object('color',i.color,'grade',i.grade,'bunches',i.bunches) ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL),'[]') AS items
          FROM portal_orders o JOIN portal_customers c ON c.id=o.customer_id LEFT JOIN portal_order_items i ON i.order_id=o.id
          WHERE o.id=$1 AND o.revision=$2 AND o.status IN ('PENDIENTE','APROBADO','DESPACHADO_MANUAL') GROUP BY o.id,c.id`, [job.order_id, job.order_revision]);
        if (!rows[0]) { await pool.query("UPDATE portal_whatsapp_notifications SET status='CANCELADO',updated_at=NOW() WHERE order_id=$1 AND order_revision=$2", [job.order_id, job.order_revision]); continue; }
        const messageId = await whatsapp.sendOrderNotice(rows[0]);
        await pool.query("UPDATE portal_whatsapp_notifications SET status='SOLICITADO',message_id=$2,last_error='',updated_at=NOW() WHERE order_id=$1 AND order_revision=$3 AND status='ENVIANDO'", [job.order_id, messageId, job.order_revision]);
      } catch (error) {
        await pool.query("UPDATE portal_whatsapp_notifications SET status='ERROR',last_error=$2,updated_at=NOW() WHERE order_id=$1 AND order_revision=$3 AND status='ENVIANDO'", [job.order_id, String(error.message || error).slice(0, 300), job.order_revision]);
        console.error('No se pudo solicitar el aviso de WhatsApp para el pedido', job.order_id);
      }
    }
  } catch (error) { console.error('No se pudo procesar la cola de WhatsApp:', error.message); }
  finally { whatsappBusy = false; }
}
async function processCustomerWhatsAppQueue() {
  if (customerWhatsAppBusy || !whatsapp.customerConfig()) return;
  customerWhatsAppBusy = true;
  try {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const connection = await pool.connect();
      let job;
      try {
        await connection.query('BEGIN');
        const { rows } = await connection.query(`
          SELECT order_id,order_revision FROM portal_customer_notifications
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
        const { rows } = await pool.query(`SELECT o.id,o.total,o.revision,to_char(o.pickup_date,'YYYY-MM-DD') AS pickup_date,o.pickup_hour,c.name,c.phone,
          COALESCE(json_agg(json_build_object('color',i.color,'grade',i.grade,'bunches',i.bunches) ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL),'[]') AS items
          FROM portal_orders o JOIN portal_customers c ON c.id=o.customer_id LEFT JOIN portal_order_items i ON i.order_id=o.id
          WHERE o.id=$1 AND o.revision=$2 AND o.status IN ('APROBADO','DESPACHADO_MANUAL') GROUP BY o.id,c.id`, [job.order_id, job.order_revision]);
        if (!rows[0]) { await pool.query("UPDATE portal_customer_notifications SET status='CANCELADO',updated_at=NOW() WHERE order_id=$1 AND order_revision=$2", [job.order_id, job.order_revision]); continue; }
        const messageId = await whatsapp.sendCustomerApproval(rows[0]);
        await pool.query("UPDATE portal_customer_notifications SET status='SOLICITADO',message_id=$2,last_error='',updated_at=NOW() WHERE order_id=$1 AND order_revision=$3 AND status='ENVIANDO'", [job.order_id, messageId, job.order_revision]);
      } catch (error) {
        await pool.query("UPDATE portal_customer_notifications SET status='ERROR',last_error=$2,updated_at=NOW() WHERE order_id=$1 AND order_revision=$3 AND status='ENVIANDO'", [job.order_id, String(error.message || error).slice(0, 300), job.order_revision]);
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
    CREATE TABLE IF NOT EXISTS portal_order_amendments (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES portal_orders(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      added_items JSONB NOT NULL,
      added_total NUMERIC(14,2) NOT NULL,
      added_notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query('ALTER TABLE portal_orders ADD COLUMN IF NOT EXISTS pickup_date DATE');
  await pool.query('ALTER TABLE portal_orders ADD COLUMN IF NOT EXISTS pickup_hour SMALLINT');
  await pool.query('ALTER TABLE portal_orders ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1');
  await pool.query('ALTER TABLE portal_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
  await pool.query('ALTER TABLE portal_orders ADD COLUMN IF NOT EXISTS modifications_locked BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query('ALTER TABLE portal_orders ADD COLUMN IF NOT EXISTS manual_dispatch_prior_locked BOOLEAN');
  await pool.query('ALTER TABLE portal_whatsapp_notifications ADD COLUMN IF NOT EXISTS order_revision INTEGER NOT NULL DEFAULT 1');
  await pool.query('ALTER TABLE portal_customer_notifications ADD COLUMN IF NOT EXISTS order_revision INTEGER NOT NULL DEFAULT 1');
  await pool.query('ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS login_identifier VARCHAR(30)');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS portal_customers_login_identifier_unique ON portal_customers (LOWER(login_identifier)) WHERE login_identifier IS NOT NULL');
  for (const [grade, price] of [['NACIONAL', 10500], ['BAJAS', 12000], ['NACIONAL GRANEL', 7500], ['BAJAS GRANEL', 9500], ['EUCALIPTO', 700]]) {
    await pool.query('INSERT INTO portal_prices(grade,price_per_bunch) VALUES($1,$2) ON CONFLICT DO NOTHING', [grade, price]);
  }
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
    const localPhone = /^(?:\+?57)?3\d{9}$/.test(phone) ? phone.replace(/\D/g, '').slice(-10) : null;
    const phoneOptions = localPhone ? [localPhone, `57${localPhone}`, `+57${localPhone}`] : [phone];
    const { rows } = await pool.query('SELECT * FROM portal_customers WHERE active=TRUE AND (phone=ANY($1::text[]) OR LOWER(login_identifier)=LOWER($2))', [phoneOptions, phone]);
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
app.get('/api/catalog', auth('customer'), async (req, res) => { try { res.json({ colors: await availability(), prices: await prices(pool, req.session.id), automaticWhatsApp: Boolean(whatsapp.customerConfig()) }); } catch (e) { fail(res, e, 500); } });
app.get('/api/catalog/events', auth('customer'), (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  catalogListeners.add(res);
  const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 25000);
  req.on('close', () => { clearInterval(heartbeat); catalogListeners.delete(res); });
});
app.get('/api/my-orders', auth('customer'), async (req, res) => { try { const { rows } = await pool.query(`SELECT o.*,COALESCE(json_agg(json_build_object('color',i.color,'grade',i.grade,'bunches',i.bunches,'subtotal',i.subtotal)) FILTER (WHERE i.id IS NOT NULL),'[]') AS items FROM portal_orders o LEFT JOIN portal_order_items i ON i.order_id=o.id WHERE o.customer_id=$1 GROUP BY o.id ORDER BY o.id DESC LIMIT 50`, [req.session.id]); res.json(rows); } catch (e) { fail(res, e, 500); } });
app.post('/api/orders', auth('customer'), async (req, res) => {
  if (!whatsapp.customerConfig()) return res.status(503).json({ error: 'La confirmación automática de WhatsApp aún no está configurada. Comunícate con el administrador.' });
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
    const { rows: matchingOrders } = await client.query("SELECT id,total,notes,pickup_hour,revision,modifications_locked FROM portal_orders WHERE customer_id=$1 AND pickup_date=$2::date AND status='APROBADO' ORDER BY id LIMIT 1 FOR UPDATE", [req.session.id, pickupDate]);
    const existing = matchingOrders[0] || null;
    if (existing?.modifications_locked) { const error = new Error(`El pedido #${existing.id} ya está en preparación. No se pueden agregar productos para ese día.`); error.code = 'ORDER_LOCKED'; throw error; }
    const catalog = await availability(client); const p = await prices(client, req.session.id);
    const requested = new Map();
    for (const item of items) {
      const color = norm(item.color), grade = norm(item.grade), bunches = Number(item.bunches);
      if (!colors.includes(color) || !grades.includes(grade) || (grade === 'EUCALIPTO') !== (color === 'EUCALIPTO') || !Number.isSafeInteger(bunches) || bunches < 1 || bunches > 10000) throw new Error('Cantidad o producto no válido.');
      const key = `${color}|${grade}`; requested.set(key, (requested.get(key) || 0) + bunches);
    }
    const requestedItems = [...requested].map(([key, bunches]) => {
      const [color, grade] = key.split('|'); return { color, grade, bunches };
    });
    const allocations = allocateReservations(catalog, requestedItems, assortedColors);
    const previousItems = existing ? (await client.query('SELECT id,color,grade,price_per_bunch FROM portal_order_items WHERE order_id=$1 ORDER BY id', [existing.id])).rows : [];
    const { additions, previousByKey, addedTotal } = planAdditions(requested, previousItems, p);
    const addedNotes = String(req.body.notes || '').trim().slice(0, 1000);
    let orderId, revision, total, orderHour;
    if (existing) {
      orderId = existing.id; revision = Number(existing.revision) + 1;
      total = Number(existing.total) + addedTotal;
      orderHour = Number(existing.pickup_hour);
      const notes = addedNotes ? [existing.notes, addedNotes].filter(Boolean).join('\n').slice(-1000) : existing.notes;
      await client.query('UPDATE portal_orders SET total=$1,notes=$2,revision=$3,updated_at=NOW() WHERE id=$4', [total, notes, revision, orderId]);
    } else {
      total = addedTotal; revision = 1; orderHour = pickupHour;
      const order = await client.query("INSERT INTO portal_orders(customer_id,status,total,notes,pickup_date,pickup_hour,decided_at) VALUES($1,'APROBADO',$2,$3,$4,$5,NOW()) RETURNING id", [req.session.id, total, addedNotes, pickupDate, pickupHour]);
      orderId = order.rows[0].id;
    }
    for (const item of additions) {
      const previous = previousByKey.get(`${item.color}|${item.grade}`);
      if (previous) await client.query('UPDATE portal_order_items SET bunches=bunches+$1,subtotal=subtotal+$2 WHERE id=$3', [item.bunches, item.subtotal, previous.id]);
      else await client.query('INSERT INTO portal_order_items(order_id,color,grade,bunches,price_per_bunch,subtotal) VALUES($1,$2,$3,$4,$5,$6)', [orderId, item.color, item.grade, item.bunches, item.price, item.subtotal]);
    }
    for (const item of allocations) await client.query('INSERT INTO portal_inventory_reservations(order_id,color,grade,bunches) VALUES($1,$2,$3,$4)', [orderId, item.color, item.grade, item.bunches]);
    if (existing) await client.query('INSERT INTO portal_order_amendments(order_id,revision,added_items,added_total,added_notes) VALUES($1,$2,$3,$4,$5)', [orderId, revision, JSON.stringify(additions), addedTotal, addedNotes]);
    for (const table of ['portal_whatsapp_notifications', 'portal_customer_notifications']) {
      await client.query(`INSERT INTO ${table}(order_id,order_revision) VALUES($1,$2) ON CONFLICT (order_id) DO UPDATE SET order_revision=$2,status='PENDIENTE',attempts=0,last_error='',message_id=NULL,updated_at=NOW()`, [orderId, revision]);
    }
    await client.query('COMMIT');
    res.status(existing ? 200 : 201).json({ id: orderId, total, status: 'APROBADO', updated: Boolean(existing), revision, pickupHour: orderHour });
    broadcastCatalogChanged();
    void processWhatsAppQueue();
    void processCustomerWhatsAppQueue();
  } catch (e) { await client.query('ROLLBACK'); fail(res, e, ['INSUFFICIENT_INVENTORY', 'ORDER_LOCKED'].includes(e.code) ? 409 : 400); } finally { client.release(); }
});
app.get('/api/admin', auth('admin'), async (_req, res) => {
  try {
    const [orders, customers, p] = await Promise.all([
      pool.query(`SELECT o.*,c.name,c.phone,(SELECT n.status FROM portal_whatsapp_notifications n WHERE n.order_id=o.id) AS whatsapp_status,(SELECT n.last_error FROM portal_whatsapp_notifications n WHERE n.order_id=o.id) AS whatsapp_error,(SELECT n.status FROM portal_customer_notifications n WHERE n.order_id=o.id) AS customer_whatsapp_status,(SELECT n.last_error FROM portal_customer_notifications n WHERE n.order_id=o.id) AS customer_whatsapp_error,COALESCE(json_agg(json_build_object('color',i.color,'grade',i.grade,'bunches',i.bunches,'subtotal',i.subtotal)) FILTER (WHERE i.id IS NOT NULL),'[]') AS items FROM portal_orders o JOIN portal_customers c ON c.id=o.customer_id LEFT JOIN portal_order_items i ON i.order_id=o.id GROUP BY o.id,c.id ORDER BY o.id DESC`),
      pool.query('SELECT c.id,c.name,c.phone,c.login_identifier,c.active,(SELECT COUNT(*)::int FROM portal_orders o WHERE o.customer_id=c.id) AS order_count FROM portal_customers c ORDER BY c.name'), prices()
    ]);
    res.json({ orders: orders.rows, customers: customers.rows, prices: p, automaticWhatsApp: Boolean(whatsapp.customerConfig()), automaticApproval: Boolean(whatsapp.customerConfig()), whatsappConfigurationIssues: whatsapp.customerConfigurationIssues(), approvalConfigurationIssues: whatsapp.approvalConfigurationIssues() });
  } catch (e) { fail(res, e, 500); }
});
app.get('/api/admin/inventory', auth('admin'), async (_req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const root = summarize(await listInventory(client));
    const { rows: reservations } = await client.query(`
      SELECT o.id AS order_id,o.status,c.name,r.color,r.grade,SUM(r.bunches)::int AS bunches
      FROM portal_inventory_reservations r
      JOIN portal_orders o ON o.id=r.order_id
      JOIN portal_customers c ON c.id=o.customer_id
      WHERE o.status IN ('PENDIENTE','APROBADO','DESPACHADO_MANUAL')
      GROUP BY o.id,o.status,c.name,r.color,r.grade
      ORDER BY o.id DESC
    `);
    await client.query('COMMIT');
    const inventory = buildInventoryOverview(root, reservations, grades, assortedColor);
    res.json({ inventory, updatedAt: new Date().toISOString() });
  } catch (error) { await client.query('ROLLBACK'); fail(res, error, 500); }
  finally { client.release(); }
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
    await client.query("SELECT pg_advisory_xact_lock(hashtext('portal-orders'))");
    const found = await client.query('SELECT id FROM portal_customers WHERE id=$1 FOR UPDATE', [id]);
    if (!found.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Cliente no encontrado.' }); }
    const shipped = await client.query("SELECT id FROM portal_orders WHERE customer_id=$1 AND status IN ('DESPACHADO','DESPACHADO_MANUAL') LIMIT 1", [id]);
    if (shipped.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Este cliente tiene pedidos despachados. Revise o revierta los despachos antes de eliminarlo.' }); }
    await client.query('DELETE FROM portal_order_items WHERE order_id IN (SELECT id FROM portal_orders WHERE customer_id=$1)', [id]);
    await client.query('DELETE FROM portal_orders WHERE customer_id=$1', [id]);
    await client.query('DELETE FROM portal_customers WHERE id=$1', [id]);
    await client.query('COMMIT');
    broadcastCatalogChanged();
    res.json({ deleted: true });
  } catch (error) { await client.query('ROLLBACK'); fail(res, error, 500); } finally { client.release(); }
});
app.put('/api/admin/prices', auth('admin'), async (req, res) => {
  try { for (const grade of grades) { const value = Number(req.body[grade]); if (!Number.isSafeInteger(value) || value < 1 || value > 100000000) throw new Error(`Precio inválido para ${grade}.`); } for (const grade of grades) await pool.query('UPDATE portal_prices SET price_per_bunch=$1,updated_at=NOW() WHERE grade=$2', [req.body[grade], grade]); broadcastCatalogChanged(); res.json({ prices: await prices() }); } catch (e) { fail(res, e); }
});
app.post('/api/admin/orders/:id/modifications', auth('admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1 || typeof req.body.locked !== 'boolean') return res.status(400).json({ error: 'Pedido o acción no válidos.' });
  try {
    const { rows } = await pool.query("UPDATE portal_orders SET modifications_locked=$1 WHERE id=$2 AND status='APROBADO' RETURNING id,modifications_locked", [req.body.locked, id]);
    if (!rows[0]) return res.status(404).json({ error: 'Pedido aprobado no encontrado.' });
    res.json(rows[0]);
  } catch (error) { fail(res, error, 500); }
});
app.delete('/api/admin/orders/:id', auth('admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Pedido no válido.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('portal-orders'))");
    const found = await client.query('SELECT id,status FROM portal_orders WHERE id=$1 FOR UPDATE', [id]);
    if (!found.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Pedido no encontrado.' }); }
    if (['DESPACHADO','DESPACHADO_MANUAL'].includes(found.rows[0].status)) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Este pedido ya fue despachado. Revierta el despacho manual o anule la remisión antes de eliminarlo.' }); }
    await client.query('DELETE FROM portal_order_items WHERE order_id=$1', [id]);
    await client.query('DELETE FROM portal_orders WHERE id=$1', [id]);
    await client.query('COMMIT');
    broadcastCatalogChanged();
    res.json({ deleted: true });
  } catch (error) { await client.query('ROLLBACK'); fail(res, error, 500); } finally { client.release(); }
});
app.post('/api/admin/orders/:id/cancel', auth('admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Pedido no válido.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('portal-orders'))");
    const { rows } = await client.query('SELECT status FROM portal_orders WHERE id=$1 FOR UPDATE', [id]);
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Pedido no encontrado.' }); }
    if (!['PENDIENTE', 'APROBADO'].includes(rows[0].status)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Este pedido ya fue cerrado.' }); }
    await client.query("UPDATE portal_orders SET status='CANCELADO',rejection_reason='Cancelado por el administrador',decided_at=NOW() WHERE id=$1", [id]);
    await client.query('DELETE FROM portal_inventory_reservations WHERE order_id=$1', [id]);
    await client.query("UPDATE portal_whatsapp_notifications SET status='CANCELADO',updated_at=NOW() WHERE order_id=$1 AND status<>'SOLICITADO'", [id]);
    await client.query("UPDATE portal_customer_notifications SET status='CANCELADO',updated_at=NOW() WHERE order_id=$1 AND status<>'SOLICITADO'", [id]);
    await client.query('COMMIT');
    broadcastCatalogChanged();
    res.json({ id, status: 'CANCELADO' });
  } catch (error) { await client.query('ROLLBACK'); fail(res, error, 500); } finally { client.release(); }
});
app.post('/api/admin/orders/:id/dispatch', auth('admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Pedido no válido.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('portal-orders'))");
    const { rows } = await client.query('SELECT status,modifications_locked FROM portal_orders WHERE id=$1 FOR UPDATE', [id]);
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Pedido no encontrado.' }); }
    if (rows[0].status !== 'APROBADO') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Solo se puede despachar manualmente un pedido aprobado.' }); }
    await client.query(`UPDATE portal_orders SET status='DESPACHADO_MANUAL',manual_dispatch_prior_locked=modifications_locked,
      modifications_locked=TRUE,updated_at=NOW() WHERE id=$1`, [id]);
    await client.query('COMMIT');
    broadcastCatalogChanged();
    res.json({ id, status: 'DESPACHADO_MANUAL' });
  } catch (error) { await client.query('ROLLBACK'); fail(res, error, 500); } finally { client.release(); }
});
app.post('/api/admin/orders/:id/undo-dispatch', auth('admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Pedido no válido.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('portal-orders'))");
    const { rows } = await client.query('SELECT status FROM portal_orders WHERE id=$1 FOR UPDATE', [id]);
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Pedido no encontrado.' }); }
    if (rows[0].status !== 'DESPACHADO_MANUAL') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Este pedido no tiene un despacho manual para revertir.' }); }
    await client.query(`UPDATE portal_orders SET status='APROBADO',modifications_locked=COALESCE(manual_dispatch_prior_locked,FALSE),
      manual_dispatch_prior_locked=NULL,updated_at=NOW() WHERE id=$1`, [id]);
    await client.query('COMMIT');
    broadcastCatalogChanged();
    res.json({ id, status: 'APROBADO' });
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
    const automaticConfirmation = decision === 'APROBADO' && Boolean(whatsapp.customerConfig());
    if (automaticConfirmation) await client.query('INSERT INTO portal_customer_notifications(order_id) VALUES($1) ON CONFLICT DO NOTHING', [order.id]);
    await client.query('COMMIT');
    broadcastCatalogChanged();
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
          const action = whatsapp.payloadDecision(message.button?.payload, settings.appSecret);
          if (!action || !message.context?.id) continue;
          try {
            await decideOrder(action.orderId, action.decision, action.decision === 'RECHAZADO' ? 'Rechazado por el administrador desde WhatsApp' : '', message.context.id);
            const reply = action.decision === 'RECHAZADO' ? `Pedido #${action.orderId} rechazado. Los ramos reservados volvieron a estar disponibles en el portal.` : `Pedido #${action.orderId} aprobado. Se está enviando la confirmación al cliente.`;
            void whatsapp.sendText(whatsapp.adminPhone, reply).catch(error => console.error('No se pudo responder al administrador por WhatsApp:', error.message));
          } catch (error) {
            console.error(`No se pudo procesar el pedido ${action.orderId} desde WhatsApp:`, error.message);
            void whatsapp.sendText(whatsapp.adminPhone, `No se pudo procesar el pedido #${action.orderId}: ${String(error.message).slice(0, 180)} Revisa el portal.`).catch(sendError => console.error('No se pudo responder al administrador por WhatsApp:', sendError.message));
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
