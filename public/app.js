const varieties = ['FREEDOM', 'PINK FLOYD', 'MONDIAL', 'HUMMER', 'MOMENTUM', 'CORAL REEF', 'QUICK SAND', 'HILUX', 'CANDLELIGHT', 'DEEP PURPLE', 'SUMMERSAND', 'STAR PLATINUM', 'SHIMMER', 'PINK OHARA', 'WHITE OHARA', 'PINK MONDIAL', 'BLESSING', 'PINK AMARETO', 'TIFFANY', 'YELLOW BIKINI', 'QUEEN BERRY', 'MOODY BLUE', 'SWAN', 'HIGH MAGIC', 'EXPLORER', 'DANCING RED'];
const state = { inventory: [], remissions: [], prices: [], lines: [], activeRemission: null, stepGrade: 'ALL', config: {}, totals: {}, activeView: 'dashboard', selectedDate: '', selectedGrade: 'ALL' };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const money = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value || 0));
const number = value => new Intl.NumberFormat('es-CO').format(Number(value || 0));
const bunchLabel = value => `${number(value)} ${Number(value) === 1 ? 'ramo' : 'ramos'}`;
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
  const [dashboard, config, prices] = await Promise.all([api('/api/dashboard'), api('/api/config'), api('/api/price-lists')]);
  state.inventory = dashboard.inventory;
  state.remissions = dashboard.remissions;
  state.config = config;
  state.prices = prices;
  state.totals = dashboard.totals;
  renderDashboard(dashboard.totals);
  renderInventory();
  renderVarietyOptions();
  renderHistory();
  renderPrices();
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
  $('#dashboard-remissions').innerHTML = state.remissions.slice(0, 6).map(item => `<button class="activity-item text-button" data-remission-action="${statusMeta(item.status).action}" data-remission-id="${item.id}">
    <span class="activity-icon">↗</span><span><strong>${escapeHtml(item.clientName)}</strong><span>${escapeHtml(item.remissionNumber)} · ${statusMeta(item.status).label}</span></span><b class="activity-amount">${item.status === 'FINALIZADA' ? money(item.total) : bunchLabel(item.requestedBunches)}</b>
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
  const rows = state.inventory.filter(item => state.stepGrade === 'ALL' || item.gradeCm === state.stepGrade);
  $('#line-variety').innerHTML = '<option value="">Seleccione una variedad</option>' + rows.map(item => `<option value="${item.key}">${escapeHtml(item.variety)} · ${escapeHtml(item.gradeCm)} · ${inventoryDate(item.date)} · ${item.bunches} ${item.bunches === 1 ? 'ramo disponible' : 'ramos disponibles'}</option>`).join('') + (rows.length ? '' : '<option disabled>Sin inventario para este grado</option>');
  renderStockPreview();
}

function renderStockPreview() {
  const item = state.inventory.find(row => row.key === $('#line-variety').value);
  if (!item) return $('#line-stock-preview').textContent = 'Seleccione una variedad para ver su fecha, grado y disponibilidad.';
  const price = selectedPrice($('#remission-client-name').value, item.variety, item.gradeCm);
  const priceText = price ? ` · <b>Precio: ${money(price.pricePerBunch)}</b>` : ' · <b class="selection-over">Sin precio configurado</b>';
  $('#line-stock-preview').innerHTML = `<strong>${escapeHtml(item.variety)}</strong><span>${escapeHtml(item.gradeCm)} · ${inventoryDate(item.date)} · ${number(item.stemsPerBunch)} tallos por ramo · <b>${number(item.bunches)} ramos disponibles</b>${priceText}</span>`;
}

function renderHistory() {
  const query = ($('#history-search').value || '').toLowerCase();
  const rows = state.remissions.filter(item => `${item.remissionNumber} ${item.clientName} ${item.deliveredBy}`.toLowerCase().includes(query));
  $('#history-body').innerHTML = rows.map(item => { const meta = statusMeta(item.status); const cancelButton = item.status === 'ANULADA' ? '' : `<button class="small-button small-button--danger" data-cancel-remission="${item.id}">Anular</button>`; return `<tr><td><strong>${escapeHtml(item.remissionNumber)}</strong></td><td>${dateTime(item.createdAt)}</td><td>${escapeHtml(item.clientName)}</td><td><strong>${bunchLabel(item.requestedBunches)}</strong> · ${number(item.requestedStems)} tallos</td><td><span class="workflow-status workflow-status--${meta.kind}">${meta.label}</span></td><td class="money"><strong>${item.status === 'FINALIZADA' ? money(item.total) : '—'}</strong></td><td><div class="table-actions"><button class="small-button" data-remission-action="${meta.action}" data-remission-id="${item.id}">${meta.button}</button>${cancelButton}</div></td></tr>`; }).join('');
  $('#history-empty').classList.toggle('is-hidden', rows.length > 0);
}

function statusMeta(status) {
  if (status === 'PENDIENTE_VARIEDADES' || status === 'PENDIENTE_PRECIOS') return { label: 'Pendiente anterior', button: 'Ver detalle', action: 'view', kind: 'pending' };
  if (status === 'ANULADA') return { label: 'Anulada', button: 'Ver detalle', action: 'view', kind: 'canceled' };
  return { label: 'Finalizada', button: 'Ver / Imprimir', action: 'view', kind: 'done' };
}

function renderLines() {
  $('#remission-lines').innerHTML = state.lines.map(line => `<div class="line-item line-item--complete"><strong>${escapeHtml(line.variety)}</strong><span>${escapeHtml(line.gradeCm)} · ${inventoryDate(line.date)}</span><span>${bunchLabel(line.bunches)}</span><span>${number(line.stems)} tallos</span><b>${money(line.subtotal)}</b><button type="button" class="remove-line" data-remove-line="${line.key}" aria-label="Quitar ${escapeHtml(line.variety)}">×</button></div>`).join('');
  const bunches = state.lines.reduce((sum, row) => sum + row.bunches, 0);
  const stems = state.lines.reduce((sum, row) => sum + row.stems, 0);
  const total = state.lines.reduce((sum, row) => sum + row.subtotal, 0);
  $('#summary-count').textContent = `${state.lines.length} ${state.lines.length === 1 ? 'variedad' : 'variedades'}`;
  $('#summary-bunches').textContent = number(bunches);
  $('#summary-stems').textContent = number(stems);
  $('#summary-total').textContent = money(total);
}

function clientKey(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function selectedPrice(clientName, variety, gradeCm) {
  const client = clientKey(clientName);
  return state.prices.find(row => client && clientKey(row.clientName) === client && clientKey(row.variety) === clientKey(variety) && row.gradeCm === gradeCm)
    || state.prices.find(row => !row.clientName && clientKey(row.variety) === clientKey(variety) && row.gradeCm === gradeCm);
}

function renderPrices() {
  $('#price-variety').innerHTML = '<option value="">Seleccione una variedad</option>' + varieties.map(variety => `<option value="${escapeHtml(variety)}">${escapeHtml(variety)}</option>`).join('');
  const clients = [...new Set(state.prices.map(row => row.clientName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  $('#known-clients').innerHTML = clients.map(client => `<option value="${escapeHtml(client)}"></option>`).join('');
  $('#price-count').textContent = `${state.prices.length} ${state.prices.length === 1 ? 'PRECIO' : 'PRECIOS'}`;
  $('#price-list-body').innerHTML = state.prices.map(row => `<tr><td>${escapeHtml(row.clientName || 'General')}</td><td><strong>${escapeHtml(row.variety)}</strong></td><td><span class="grade-chip">${escapeHtml(row.gradeCm)}</span></td><td class="money"><strong>${money(row.pricePerBunch)}</strong></td><td class="date-cell">${dateTime(row.updatedAt)}</td></tr>`).join('');
  $('#price-list-empty').classList.toggle('is-hidden', state.prices.length > 0);
}

function switchView(view) {
  state.activeView = view;
  $$('.view').forEach(element => element.classList.toggle('active', element.id === `view-${view}`));
  $$('.nav-link').forEach(element => element.classList.toggle('active', element.dataset.view === view));
  const titles = { dashboard: 'Resumen', inventory: 'Inventario', prices: 'Lista de precios', 'new-remission': 'Nueva remisión', history: 'Historial' };
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
  state.lines = []; state.stepGrade = 'ALL';
  $('#step-grade-filter').value = 'ALL';
  $('#line-bunches').value = 1;
  renderVarietyOptions(); renderLines();
  $('#remission-error').textContent = '';
  $('#line-error').textContent = '';
}

function continueRemission(remission) {
  renderDocument(remission); $('#remission-dialog').showModal();
}

async function openRemission(id) {
  try {
    const documentData = await api(`/api/remissions/${id}`);
    continueRemission(documentData);
  } catch (error) { toast(error.message); }
}

function openCancelRemission(id) {
  const remission = state.remissions.find(item => item.id === Number(id));
  if (!remission) return toast('Actualice el historial e intente nuevamente.');
  state.activeRemission = remission;
  $('#cancel-remission-heading').textContent = `${remission.remissionNumber} · ${remission.clientName}`;
  $('#cancellation-reason').value = '';
  $('#cancel-remission-error').textContent = '';
  $('#cancel-remission-dialog').showModal();
}

function renderDocument(data) {
  const company = state.config;
  const documentElement = $('#printable-document');
  documentElement.dataset.filename = data.remissionNumber;
  documentElement.innerHTML = `
    ${data.status === 'ANULADA' ? '<div class="doc-canceled-mark">ANULADA</div>' : ''}
    <header class="doc-head"><div class="doc-brand"><span class="brand-logo brand-logo--document"><img src="/logo-prestige.jpeg" alt="Prestige Roses"></span><div><h2>${escapeHtml(company.companyName)}</h2><p>${escapeHtml(company.companyNit ? `NIT ${company.companyNit}` : 'Salida nacional de flor')}</p><p>${escapeHtml(company.companyAddress)} ${escapeHtml(company.companyPhone)}</p></div></div><div class="doc-number"><span>REMISIÓN</span><strong>${escapeHtml(data.remissionNumber)}</strong><p>${dateTime(data.createdAt)}</p></div></header>
    <section class="doc-client"><div class="doc-field"><span>Cliente</span><strong>${escapeHtml(data.clientName)}</strong></div><div class="doc-field"><span>NIT / Documento</span><strong>${escapeHtml(data.clientDocument || '—')}</strong></div><div class="doc-field"><span>Entregado por</span><strong>${escapeHtml(data.deliveredBy || '—')}</strong></div></section>
    <table class="doc-table"><thead><tr><th>Fecha</th><th>Variedad</th><th>Grado</th><th>Tallos/ramo</th><th>Ramos</th><th>Total tallos</th><th>Precio ramo</th><th>Subtotal</th></tr></thead><tbody>${data.items.map(item => `<tr><td>${item.sourceDate ? inventoryDate(item.sourceDate) : '—'}</td><td><strong>${escapeHtml(item.variety)}</strong></td><td>${escapeHtml(item.gradeCm || '—')}</td><td>${number(item.stemsPerBunch)}</td><td>${number(item.bunches)}</td><td>${number(item.stems)}</td><td>${money(item.unitPriceBunch)}</td><td>${money(item.subtotal)}</td></tr>`).join('')}</tbody></table>
    <div class="doc-total"><span>TOTAL</span><span>${money(data.total)}</span></div>
    ${data.notes ? `<div class="doc-notes"><strong>Observaciones:</strong> ${escapeHtml(data.notes)}</div>` : ''}
    ${data.status === 'ANULADA' ? `<div class="doc-cancellation"><strong>Remisión anulada:</strong> ${escapeHtml(data.cancellationReason || 'Sin motivo registrado')} · ${data.canceledAt ? dateTime(data.canceledAt) : ''}</div>` : ''}
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
$('#step-grade-filter').addEventListener('change', event => { state.stepGrade = event.target.value; renderVarietyOptions(); });
$('#line-variety').addEventListener('change', renderStockPreview);
$('#remission-client-name').addEventListener('input', renderStockPreview);
$('#remission-client-name').addEventListener('change', () => {
  if (!state.lines.length) return;
  state.lines = [];
  renderLines();
  toast('Se ajustó el cliente; agregue nuevamente las variedades para aplicar sus precios.');
});

document.addEventListener('click', async event => {
  const remissionButton = event.target.closest('[data-remission-id]');
  const cancelButton = event.target.closest('[data-cancel-remission]');
  const removeButton = event.target.closest('[data-remove-line]');
  const closeButton = event.target.closest('[data-close-dialog]');
  if (remissionButton) {
    openRemission(remissionButton.dataset.remissionId);
  }
  if (cancelButton) openCancelRemission(cancelButton.dataset.cancelRemission);
  if (removeButton) { state.lines = state.lines.filter(row => row.key !== removeButton.dataset.removeLine); $('#remission-error').textContent = ''; renderLines(); }
  if (closeButton) $(`#${closeButton.dataset.closeDialog}`).close();
});

$('#add-line-button').addEventListener('click', () => {
  const item = state.inventory.find(row => row.key === $('#line-variety').value);
  const bunches = Math.max(0, Number.parseInt($('#line-bunches').value, 10) || 0);
  const error = $('#line-error'); error.textContent = '';
  if (!item) return error.textContent = 'Seleccione una variedad.';
  if (!bunches) return error.textContent = 'Ingrese al menos un ramo.';
  const price = selectedPrice($('#remission-client-name').value, item.variety, item.gradeCm);
  if (!price) return error.textContent = `No hay precio para ${item.variety} · ${item.gradeCm}. Regístrelo en Lista de precios.`;
  if (bunches > item.bunches) return error.textContent = `Disponibles: ${item.bunches} ramos.`;
  if (state.lines.some(row => row.key === item.key)) return error.textContent = 'Este grupo ya está agregado.';
  const unitPriceBunch = price.pricePerBunch;
  state.lines.push({ key: item.key, date: item.date, variety: item.variety, gradeCm: item.gradeCm, stemsPerBunch: item.stemsPerBunch, bunches, stems: bunches * item.stemsPerBunch, unitPriceBunch, subtotal: bunches * unitPriceBunch });
  $('#remission-error').textContent = '';
  $('#line-variety').value = ''; $('#line-bunches').value = 1; renderStockPreview(); renderLines();
});

$('#remission-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  $('#remission-error').textContent = '';
  if (!state.lines.length) return $('#remission-error').textContent = 'Agregue al menos una variedad.';
  const payload = { ...Object.fromEntries(new FormData(event.currentTarget)), items: state.lines.map(({ key, bunches }) => ({ key, bunches })) };
  button.disabled = true;
  try {
    const remission = await api('/api/remissions', { method: 'POST', body: JSON.stringify(payload) });
    renderDocument(remission); clearRemission(); await refreshAll(); $('#remission-dialog').showModal(); toast('Remisión finalizada e inventario actualizado.');
  } catch (error) { $('#remission-error').textContent = error.message; }
  finally { button.disabled = false; }
});

$('#price-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  const error = $('#price-error');
  error.textContent = '';
  button.disabled = true;
  try {
    await api('/api/price-lists', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    event.currentTarget.reset();
    await refreshAll();
    toast('Precio guardado. Las próximas remisiones usarán este valor.');
  } catch (requestError) { error.textContent = requestError.message; }
  finally { button.disabled = false; }
});

$('#cancel-remission-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter; const error = $('#cancel-remission-error'); error.textContent = '';
  const reason = $('#cancellation-reason').value.trim();
  if (!reason) return error.textContent = 'Ingrese el motivo de la anulación.';
  button.disabled = true;
  try {
    const remission = await api(`/api/remissions/${state.activeRemission.id}/cancel`, { method: 'PUT', body: JSON.stringify({ reason }) });
    $('#cancel-remission-dialog').close(); await refreshAll(); switchView('history'); toast(`${remission.remissionNumber} fue anulada. La flor volvió al inventario.`);
  } catch (requestError) { error.textContent = requestError.message; }
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
  } else if (appVisible && state.activeView === 'history') {
    loadFullHistory().catch(() => {});
  }
}, 10000);
