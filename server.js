require('dotenv').config();
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const XLSX = require('xlsx');
const store = require('./src/store');

const app = express();
const port = Number(process.env.PORT) || 3000;
const production = process.env.NODE_ENV === 'production';
const appUser = process.env.APP_USER || 'administrador';
const appPassword = process.env.APP_PASSWORD || 'admin123';
const reportsPassword = process.env.REPORTS_PASSWORD || appPassword;
const sessionSecret = process.env.SESSION_SECRET || (production ? '' : 'desarrollo-local-flora-remisiones');

if (production && (!process.env.APP_USER || !process.env.APP_PASSWORD || !sessionSecret)) {
  throw new Error('Configure APP_USER, APP_PASSWORD y SESSION_SECRET antes de iniciar en producción.');
}

app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false }));

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map(part => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
  }));
}

function sign(value) {
  return crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url');
}

function createSession() {
  const payload = Buffer.from(JSON.stringify({ user: appUser, expires: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function createReportsSession() {
  const payload = Buffer.from(JSON.stringify({ scope: 'reports', expires: Date.now() + 30 * 60 * 1000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function hasReportsAccess(request) {
  const token = parseCookies(request).flora_reports;
  if (!token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = sign(payload);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try { const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); return data.scope === 'reports' && data.expires > Date.now(); } catch { return false; }
}

function isAuthenticated(request) {
  const token = parseCookies(request).flora_session;
  if (!token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = sign(payload);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.user === appUser && data.expires > Date.now();
  } catch { return false; }
}

function requireAuth(request, response, next) {
  if (!isAuthenticated(request)) return response.status(401).json({ error: 'Sesión vencida. Inicie sesión nuevamente.' });
  next();
}

function requireReportsAccess(request, response, next) {
  if (!isAuthenticated(request)) return response.status(401).json({ error: 'Sesión vencida. Inicie sesión nuevamente.' });
  if (!hasReportsAccess(request)) return response.status(403).json({ error: 'Ingrese la contraseña de informes para continuar.' });
  next();
}

app.get('/api/health', (_request, response) => response.json({ ok: true, database: store.usePostgres ? 'postgresql' : 'local' }));
app.get('/api/auth/session', (request, response) => response.json({ authenticated: isAuthenticated(request), user: isAuthenticated(request) ? appUser : null }));
app.post('/api/auth/login', (request, response) => {
  const validUser = String(request.body.user || '') === appUser;
  const candidate = Buffer.from(String(request.body.password || ''));
  const expected = Buffer.from(appPassword);
  const validPassword = candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  if (!validUser || !validPassword) return response.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  response.setHeader('Set-Cookie', `flora_session=${encodeURIComponent(createSession())}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${production ? '; Secure' : ''}`);
  response.json({ ok: true, user: appUser });
});
app.post('/api/auth/logout', (_request, response) => {
  response.setHeader('Set-Cookie', [`flora_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${production ? '; Secure' : ''}`, `flora_reports=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${production ? '; Secure' : ''}`]);
  response.json({ ok: true });
});

app.post('/api/reports/unlock', requireAuth, (request, response) => {
  const candidate = Buffer.from(String(request.body.password || ''));
  const expected = Buffer.from(reportsPassword);
  if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected)) return response.status(401).json({ error: 'Contraseña de informes incorrecta.' });
  response.setHeader('Set-Cookie', `flora_reports=${encodeURIComponent(createReportsSession())}; Path=/; HttpOnly; SameSite=Strict; Max-Age=1800${production ? '; Secure' : ''}`);
  response.json({ ok: true });
});

app.get('/api/config', requireAuth, (_request, response) => response.json({
  companyName: process.env.COMPANY_NAME || 'Prestige Roses',
  companyNit: process.env.COMPANY_NIT || '900 149 336-5',
  companyPhone: process.env.COMPANY_PHONE || 'Oficina: (0571) 880 9538 · Cels.: 315 291 3753 · 315 294 4064',
  companyAddress: process.env.COMPANY_ADDRESS || 'Nemocón - Vereda Checua (Finca Rincón)',
  companyEmail: process.env.COMPANY_EMAIL || 'administracion@prestigeroses.com · ventas@prestigeroses.com'
}));
app.get('/api/dashboard', requireAuth, async (_request, response, next) => { try { response.json(await store.dashboard()); } catch (error) { next(error); } });
app.get('/api/reports/sales', requireReportsAccess, async (request, response, next) => { try { response.json(await store.salesReport(request.query.from, request.query.to)); } catch (error) { next(error); } });
app.get('/api/reports/sales.xlsx', requireReportsAccess, async (request, response, next) => {
  try {
    const rows = await store.salesReport(request.query.from, request.query.to);
    const byVariety = new Map(); const byGrade = new Map();
    rows.forEach(row => {
      const varietyKey = `${row.variety}|${row.gradeCm}`;
      const variety = byVariety.get(varietyKey) || { Variedad: row.variety, Grado: row.gradeCm, Ramos: 0, Tallos: 0, 'Total COP': 0 };
      variety.Ramos += row.bunches; variety.Tallos += row.stems; variety['Total COP'] += row.subtotal; byVariety.set(varietyKey, variety);
      const grade = byGrade.get(row.gradeCm) || { Grado: row.gradeCm, Ramos: 0, Tallos: 0, 'Total COP': 0 };
      grade.Ramos += row.bunches; grade.Tallos += row.stems; grade['Total COP'] += row.subtotal; byGrade.set(row.gradeCm, grade);
    });
    const total = rows.reduce((sum, row) => sum + row.subtotal, 0);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ 'Desde': request.query.from, 'Hasta': request.query.to, 'Total vendido COP': total, 'Ramos vendidos': rows.reduce((sum, row) => sum + row.bunches, 0), 'Tallos vendidos': rows.reduce((sum, row) => sum + row.stems, 0) }]), 'Resumen');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([...byVariety.values()]), 'Por variedad');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([...byGrade.values()]), 'Por grado');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.map(row => ({ Fecha: new Date(row.createdAt).toLocaleDateString('es-CO'), Remisión: row.remissionNumber, Cliente: row.clientName, Variedad: row.variety, Grado: row.gradeCm, Ramos: row.bunches, Tallos: row.stems, 'Precio ramo COP': row.unitPriceBunch, 'Total COP': row.subtotal }))), 'Detalle remisiones');
    const output = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="informe-ventas-${request.query.from}-a-${request.query.to}.xlsx"`);
    response.send(output);
  } catch (error) { next(error); }
});
app.get('/api/inventory', requireAuth, async (_request, response, next) => { try { response.json(await store.listInventory()); } catch (error) { next(error); } });
app.get('/api/export-transfers', requireAuth, async (_request, response, next) => { try { response.json(await store.listExportTransfers()); } catch (error) { next(error); } });
app.post('/api/export-transfers', requireAuth, async (request, response, next) => { try { response.status(201).json(await store.createExportTransfer(request.body)); } catch (error) { next(error); } });
app.put('/api/export-transfers/:id/cancel', requireAuth, async (request, response, next) => { try { response.json(await store.cancelExportTransfer(request.params.id)); } catch (error) { next(error); } });
app.get('/api/price-lists', requireAuth, async (_request, response, next) => { try { response.json(await store.listPriceLists()); } catch (error) { next(error); } });
app.put('/api/price-lists', requireAuth, async (request, response, next) => { try { response.json(await store.savePriceList(request.body)); } catch (error) { next(error); } });
app.delete('/api/price-lists/:id', requireAuth, async (request, response, next) => { try { response.json(await store.deletePriceList(request.params.id)); } catch (error) { next(error); } });
app.get('/api/remissions', requireAuth, async (_request, response, next) => { try { response.json(await store.listRemissions()); } catch (error) { next(error); } });
app.get('/api/remissions/:id', requireAuth, async (request, response, next) => { try { const row = await store.getRemission(request.params.id); if (!row) return response.status(404).json({ error: 'Remisión no encontrada.' }); response.json(row); } catch (error) { next(error); } });
app.post('/api/remissions', requireAuth, async (request, response, next) => { try { response.status(201).json(await store.createRemission(request.body)); } catch (error) { next(error); } });
app.put('/api/remissions/:id/items', requireAuth, async (request, response, next) => { try { response.json(await store.assignRemissionItems(request.params.id, request.body)); } catch (error) { next(error); } });
app.put('/api/remissions/:id/prices', requireAuth, async (request, response, next) => { try { response.json(await store.setRemissionPrices(request.params.id, request.body)); } catch (error) { next(error); } });
app.put('/api/remissions/:id/cancel', requireAuth, async (request, response, next) => { try { response.json(await store.cancelRemission(request.params.id, request.body)); } catch (error) { next(error); } });

app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: true }));
app.use((_request, response) => response.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((error, _request, response, _next) => {
  console.error(error);
  const known = /obligatori|insuficiente|suficientes|negativ|no encontr|repetida|no es válida|no válido|cantidad válida|seleccione una variedad|ingrese el responsable|ingrese el motivo|precio por ramo|precio configurado|quedan|pendiente|exactamente|superar|asignadas|bloqueada|desbloquear|anulada|anulación/i.test(error.message);
  response.status(known ? 400 : 500).json({ error: known ? error.message : 'No fue posible completar la operación.' });
});

store.init().then(() => {
  app.listen(port, '0.0.0.0', () => console.log(`Flora Remisiones disponible en el puerto ${port}`));
}).catch(error => {
  console.error('No fue posible inicializar la base de datos.', error);
  process.exit(1);
});
