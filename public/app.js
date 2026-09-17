const state = { inventory: [], remissions: [], lines: [], config: {}, totals: {}, activeView: 'dashboard', selectedDate: '', selectedGrade: 'ALL' };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const money = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value || 0));
const number = value => new Intl.NumberFormat('es-CO').format(Number(value || 0));
const shortDate = value => new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(value));
const dateTime = value => new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const inventoryDate = value => new Intl.DateTimeFormat('es-CO', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && url !== '/api/auth/login') showLogin();
  if (!response.ok) throw new Error(data.error || 'No fue posible completar la operación.');
  return data;
}

function showLogin() {
  $('#login-screen').classList.remove('is-hidden');
  $('#app-shell').classList.add('is-hidden');
}

async function showApp() {
  $('#login-screen').classList.add('is-hidden');
  $('#app-shell').classList.remove('is-hidden');
  $('#today-label').textContent = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date());
  await refreshAll();
}

async function refreshAll() {
  const [dashboard, config] = await Promise.all([api('/api/dashboard'), api('/api/config')]);
  state.inventory = dashboard.inventory;
  state.remissions = dashboard.remissions;
  state.config = config;
  state.totals = dashboard.totals;
  renderDashboard(dashboard.totals);
  renderInventory();
  renderVarietyOptions();
  renderHistory();
}

function dateFilteredInventory() {
  return state.inventory.filter(item => {
    const matchesDate = !state.selectedDate || item.date === state.selectedDate;
    const matchesGrade = state.selectedGrade === 'ALL' || item.gradeCm === state.selectedGrade;
    return matchesDate && matchesGrade;
  });
}

function renderDashboard(totals = state.totals) {
  const visibleInventory = dateFilteredInventory();
  $('#metric-varieties').textContent = number(new Set(visibleInventory.map(item => item.variety)).size);
  $('#metric-bunches').textContent = number(visibleInventory.reduce((sum, item) => sum + item.bunches, 0));
  $('#metric-stems').textContent = number(visibleInventory.reduce((sum, item) => sum + item.stems, 0));
  $('#metric-sales').textContent = money(totals.todaySales);
  $('#dashboard-inventory').innerHTML = visibleInventory.slice(0, 7).map(item => `<tr>
    <td class="date-cell">${inventoryDate(item.date)}</td><td><div class="variety-cell">${escapeHtml(item.variety)}</div></td>
    <td><span class="grade-chip">${escapeHtml(item.gradeCm)}</span></td><td class="quantity">${number(item.stemsPerBunch)}</td>
    <td class="quantity">${number(item.bunches)}</td><td class="quantity">${number(item.stems)}</td>
  </tr>`).join('') || '<tr><td colspan="6">No hay registros BAJAS, NACIONAL o NACIONAL GRANEL disponibles.</td></tr>';
  $('#dashboard-remissions').innerHTML = state.remissions.slice(0, 6).map(item => `<button class="activity-item text-button" data-remission-id="${item.id}">
    <span class="activity-icon">↗</span><span><strong>${escapeHtml(item.clientName)}</strong><span>${escapeHtml(item.remissionNumber)} · ${shortDate(item.createdAt)}</span></span><b class="activity-amount">${money(item.total)}</b>
  </button>`).join('') || '<div class="empty-state"><strong>Aún no hay salidas</strong><span>La actividad aparecerá aquí.</span></div>';
}

function renderInventory() {
  const query = ($('#inventory-search').value || '').toLowerCase();
  const rows = dateFilteredInventory().filter(item => `${item.date} ${item.variety} ${item.gradeCm}`.toLowerCase().includes(query));
  $('#inventory-body').innerHTML = rows.map(item => `<tr>
    <td class="date-cell">${inventoryDate(item.date)}</td><td><div class="variety-cell">${escapeHtml(item.variety)}</div></td>
    <td><span class="grade-chip">${escapeHtml(item.gradeCm)}</span></td><td class="quantity">${number(item.stemsPerBunch)}</td>
    <td class="quantity">${number(item.bunches)}</td><td class="quantity">${number(item.stems)}</td>
  </tr>`).join('');
  $('#inventory-empty').classList.toggle('is-hidden', rows.length > 0);
  $('#stock-summary').textContent = `${number(rows.reduce((sum, row) => sum + row.bunches, 0))} ramos · ${number(rows.reduce((sum, row) => sum + row.stems, 0))} tallos`;
}

function renderVarietyOptions() {
  $('#line-variety').innerHTML = '<option value="">Seleccione una variedad</option>' + state.inventory.map(item => `<option value="${item.key}">${inventoryDate(item.date)} · ${escapeHtml(item.variety)} · ${escapeHtml(item.gradeCm)} · ${item.stemsPerBunch} tallos/ramo · ${item.bunches} ${item.bunches === 1 ? 'ramo' : 'ramos'}</option>`).join('');
}

function renderHistory() {
  const query = ($('#history-search').value || '').toLowerCase();
  const rows = state.remissions.filter(item => `${item.remissionNumber} ${item.clientName} ${item.deliveredBy}`.toLowerCase().includes(query));
  $('#history-body').innerHTML = rows.map(item => `<tr><td><strong>${escapeHtml(item.remissionNumber)}</strong></td><td>${dateTime(item.createdAt)}</td><td>${escapeHtml(item.clientName)}</td><td>${escapeHtml(item.deliveredBy || '—')}</td><td class="money"><strong>${money(item.total)}</strong></td><td><button class="small-button" data-remission-id="${item.id}">Ver / Imprimir</button></td></tr>`).join('');
  $('#history-empty').classList.toggle('is-hidden', rows.length > 0);
}

function renderLines() {
  $('#remission-lines').innerHTML = state.lines.map(line => `<div class="line-item"><strong>${escapeHtml(line.variety)}</strong><span>${escapeHtml(line.gradeCm)} · ${inventoryDate(line.date)}</span><span>${line.bunches} ramos</span><span>${line.stems} tallos</span><b>${money(line.subtotal)}</b><button type="button" class="remove-line" data-remove-line="${line.key}" aria-label="Quitar ${escapeHtml(line.variety)}">×</button></div>`).join('');
  const bunches = state.lines.reduce((sum, row) => sum + row.bunches, 0);
  const stems = state.lines.reduce((sum, row) => sum + row.stems, 0);
  const total = state.lines.reduce((sum, row) => sum + row.subtotal, 0);
  $('#summary-count').textContent = `${state.lines.length} ${state.lines.length === 1 ? 'variedad' : 'variedades'}`;
  $('#summary-bunches').textContent = number(bunches);
  $('#summary-stems').textContent = number(stems);
  $('#summary-total').textContent = money(total);
}

function switchView(view) {
  state.activeView = view;
  $$('.view').forEach(element => element.classList.toggle('active', element.id === `view-${view}`));
  $$('.nav-link').forEach(element => element.classList.toggle('active', element.dataset.view === view));
  const titles = { dashboard: 'Resumen', inventory: 'Inventario', 'new-remission': 'Nueva remisión', history: 'Historial' };
  $('#view-title').textContent = titles[view];
  $('#sidebar').classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (view === 'history') loadFullHistory();
}

async function loadFullHistory() {
  try { state.remissions = await api('/api/remissions'); renderHistory(); } catch (error) { toast(error.message); }
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 3200);
}

function clearRemission() {
  $('#remission-form').reset();
  state.lines = [];
  renderLines();
  $('#remission-error').textContent = '';
  $('#line-error').textContent = '';
}

async function openRemission(id) {
  try {
    const documentData = await api(`/api/remissions/${id}`);
    renderDocument(documentData);
    $('#remission-dialog').showModal();
  } catch (error) { toast(error.message); }
}

function renderDocument(data) {
  const company = state.config;
  const documentElement = $('#printable-document');
  documentElement.dataset.filename = data.remissionNumber;
  documentElement.innerHTML = `
    <header class="doc-head"><div class="doc-brand"><div class="brand-mark">F</div><div><h2>${escapeHtml(company.companyName)}</h2><p>${escapeHtml(company.companyNit ? `NIT ${company.companyNit}` : 'Salida nacional de flor')}</p><p>${escapeHtml(company.companyAddress)} ${escapeHtml(company.companyPhone)}</p></div></div><div class="doc-number"><span>REMISIÓN</span><strong>${escapeHtml(data.remissionNumber)}</strong><p>${dateTime(data.createdAt)}</p></div></header>
    <section class="doc-client"><div class="doc-field"><span>Cliente</span><strong>${escapeHtml(data.clientName)}</strong></div><div class="doc-field"><span>NIT / Documento</span><strong>${escapeHtml(data.clientDocument || '—')}</strong></div><div class="doc-field"><span>Entregado por</span><strong>${escapeHtml(data.deliveredBy || '—')}</strong></div></section>
    <table class="doc-table"><thead><tr><th>Fecha</th><th>Variedad</th><th>Grado</th><th>Tallos/ramo</th><th>Ramos</th><th>Total tallos</th><th>Precio ramo</th><th>Subtotal</th></tr></thead><tbody>${data.items.map(item => `<tr><td>${item.sourceDate ? inventoryDate(item.sourceDate) : '—'}</td><td><strong>${escapeHtml(item.variety)}</strong></td><td>${escapeHtml(item.gradeCm || '—')}</td><td>${number(item.stemsPerBunch)}</td><td>${number(item.bunches)}</td><td>${number(item.stems)}</td><td>${money(item.unitPriceBunch)}</td><td>${money(item.subtotal)}</td></tr>`).join('')}</tbody></table>
    <div class="doc-total"><span>TOTAL</span><span>${money(data.total)}</span></div>
    ${data.notes ? `<div class="doc-notes"><strong>Observaciones:</strong> ${escapeHtml(data.notes)}</div>` : ''}
    <footer class="doc-approval"><div class="doc-signature-card"><div class="doc-signature-space"></div><strong>Firma de quien recibe</strong><span>Nombre y documento</span></div><div class="doc-stamp"><strong>SELLO DE RECIBIDO</strong><span>Fecha: __________________</span><span>Hora: ___________________</span></div></footer>`;
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type=submit]');
  const form = new FormData(event.currentTarget);
  button.disabled = true; $('#login-error').textContent = '';
  try { await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) }); await showApp(); }
  catch (error) { $('#login-error').textContent = error.message; }
  finally { button.disabled = false; }
});

$('#logout-button').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST', body: '{}' }); showLogin(); });
$$('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
$$('[data-go]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.go)));
$('#menu-button').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
$('#inventory-search').addEventListener('input', renderInventory);
$('#history-search').addEventListener('input', renderHistory);
function setDateFilter(value) {
  state.selectedDate = value;
  $('#dashboard-date').value = value;
  $('#inventory-date').value = value;
  renderDashboard();
  renderInventory();
}
function setGradeFilter(value) {
  state.selectedGrade = value;
  $('#dashboard-grade').value = value;
  $('#inventory-grade').value = value;
  renderDashboard();
  renderInventory();
}
$('#dashboard-date').addEventListener('change', event => setDateFilter(event.target.value));
$('#inventory-date').addEventListener('change', event => setDateFilter(event.target.value));
$('#dashboard-grade').addEventListener('change', event => setGradeFilter(event.target.value));
$('#inventory-grade').addEventListener('change', event => setGradeFilter(event.target.value));
$$('[data-clear-filters]').forEach(button => button.addEventListener('click', () => { setDateFilter(''); setGradeFilter('ALL'); }));

document.addEventListener('click', async event => {
  const remissionButton = event.target.closest('[data-remission-id]');
  const removeButton = event.target.closest('[data-remove-line]');
  if (remissionButton) openRemission(remissionButton.dataset.remissionId);
  if (removeButton) { state.lines = state.lines.filter(row => row.key !== removeButton.dataset.removeLine); renderLines(); }
});

$('#add-line-button').addEventListener('click', () => {
  const item = state.inventory.find(row => row.key === $('#line-variety').value);
  const bunches = Math.max(0, Number.parseInt($('#line-bunches').value, 10) || 0);
  const unitPriceBunch = Math.max(0, Number($('#line-price').value) || 0);
  const error = $('#line-error'); error.textContent = '';
  if (!item) return error.textContent = 'Seleccione una variedad.';
  if (!bunches) return error.textContent = 'Ingrese al menos un ramo.';
  if (!unitPriceBunch) return error.textContent = 'Ingrese un precio por ramo mayor que cero.';
  if (bunches > item.bunches) return error.textContent = `Disponibles: ${item.bunches} ramos.`;
  if (state.lines.some(row => row.key === item.key)) return error.textContent = 'Este grupo ya está agregado.';
  state.lines.push({ key: item.key, date: item.date, variety: item.variety, gradeCm: item.gradeCm, stemsPerBunch: item.stemsPerBunch, bunches, stems: bunches * item.stemsPerBunch, unitPriceBunch, subtotal: bunches * unitPriceBunch });
  $('#line-variety').value = ''; $('#line-bunches').value = 1; $('#line-price').value = 0; renderLines();
});

$('#remission-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  $('#remission-error').textContent = '';
  if (!state.lines.length) return $('#remission-error').textContent = 'Agregue al menos una variedad.';
  const payload = { ...Object.fromEntries(new FormData(event.currentTarget)), items: state.lines.map(({ key, bunches, unitPriceBunch }) => ({ key, bunches, unitPriceBunch })) };
  button.disabled = true;
  try {
    const remission = await api('/api/remissions', { method: 'POST', body: JSON.stringify(payload) });
    renderDocument(remission); clearRemission(); await refreshAll(); $('#remission-dialog').showModal(); toast('Remisión confirmada e inventario actualizado.');
  } catch (error) { $('#remission-error').textContent = error.message; }
  finally { button.disabled = false; }
});

$('#clear-remission').addEventListener('click', clearRemission);
$('#close-document').addEventListener('click', () => $('#remission-dialog').close());
$('#print-document').addEventListener('click', () => {
  const originalTitle = document.title;
  document.title = $('#printable-document').dataset.filename || 'remision';
  window.addEventListener('afterprint', () => { document.title = originalTitle; }, { once: true });
  window.print();
});

(async function init() {
  try { const session = await api('/api/auth/session'); if (session.authenticated) await showApp(); else showLogin(); }
  catch { showLogin(); }
})();

setInterval(() => {
  const appVisible = !$('#app-shell').classList.contains('is-hidden');
  if (appVisible && ['dashboard', 'inventory'].includes(state.activeView)) {
    refreshAll().catch(() => {});
  }
}, 20000);
