const state = { inventory: [], remissions: [], lines: [], activeRemission: null, unlockToday: false, stepGrade: 'ALL', config: {}, totals: {}, activeView: 'dashboard', selectedDate: '', selectedGrade: 'ALL' };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const money = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value || 0));
const number = value => new Intl.NumberFormat('es-CO').format(Number(value || 0));
const bunchLabel = value => `${number(value)} ${Number(value) === 1 ? 'ramo' : 'ramos'}`;
const shortDate = value => new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(value));
const dateTime = value => new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const inventoryDate = value => new Intl.DateTimeFormat('es-CO', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const businessDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const isTodayInventory = item => item.date === businessDate();

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
    <td class="date-cell">${inventoryDate(item.date)} ${isTodayInventory(item) ? '<span class="inventory-lock">🔒 Disponible mañana</span>' : ''}</td><td><div class="variety-cell">${escapeHtml(item.variety)}</div></td>
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
    <td class="date-cell">${inventoryDate(item.date)} ${isTodayInventory(item) ? '<span class="inventory-lock">🔒 Disponible mañana</span>' : ''}</td><td><div class="variety-cell">${escapeHtml(item.variety)}</div></td>
    <td><span class="grade-chip">${escapeHtml(item.gradeCm)}</span></td><td class="quantity">${number(item.stemsPerBunch)}</td>
    <td class="quantity">${number(item.bunches)}</td><td class="quantity">${number(item.stems)}</td>
  </tr>`).join('');
  $('#inventory-empty').classList.toggle('is-hidden', rows.length > 0);
  $('#stock-summary').textContent = `${number(rows.reduce((sum, row) => sum + row.bunches, 0))} ramos · ${number(rows.reduce((sum, row) => sum + row.stems, 0))} tallos`;
}

function renderVarietyOptions() {
  const rows = state.inventory.filter(item => state.stepGrade === 'ALL' || item.gradeCm === state.stepGrade);
  $('#line-variety').innerHTML = '<option value="">Seleccione una variedad</option>' + rows.map(item => {
    const locked = isTodayInventory(item) && !state.unlockToday;
    return `<option value="${item.key}" ${locked ? 'disabled' : ''}>${locked ? '🔒 HOY · ' : ''}${escapeHtml(item.variety)} · ${escapeHtml(item.gradeCm)} · ${inventoryDate(item.date)} · ${item.bunches} ${item.bunches === 1 ? 'ramo disponible' : 'ramos disponibles'}</option>`;
  }).join('') + (rows.length ? '' : '<option disabled>Sin inventario para este grado</option>');
  renderStockPreview();
}

function renderStockPreview() {
  const item = state.inventory.find(row => row.key === $('#line-variety').value);
  if (!item) return $('#line-stock-preview').textContent = 'Seleccione una variedad para ver su fecha, grado y disponibilidad.';
  $('#line-stock-preview').innerHTML = `<strong>${escapeHtml(item.variety)}</strong><span>${escapeHtml(item.gradeCm)} · ${inventoryDate(item.date)} · ${number(item.stemsPerBunch)} tallos por ramo · <b>${number(item.bunches)} ramos disponibles</b></span>`;
}

function renderTodayUnlock() {
  const button = $('#unlock-today-button');
  button.classList.toggle('is-unlocked', state.unlockToday);
  button.innerHTML = state.unlockToday ? '<span>🔓</span> Flor de hoy desbloqueada' : '<span>🔒</span> Desbloquear flor de hoy';
  $('#today-lock-message').textContent = state.unlockToday ? 'Desbloqueo especial activo: podrá seleccionar flor recibida hoy.' : 'La flor recibida hoy se muestra bloqueada y estará disponible automáticamente mañana.';
  renderVarietyOptions();
}

function renderHistory() {
  const query = ($('#history-search').value || '').toLowerCase();
  const rows = state.remissions.filter(item => `${item.remissionNumber} ${item.clientName} ${item.deliveredBy}`.toLowerCase().includes(query));
  $('#history-body').innerHTML = rows.map(item => { const meta = statusMeta(item.status); const cancelButton = item.status === 'ANULADA' ? '' : `<button class="small-button small-button--danger" data-cancel-remission="${item.id}">Anular</button>`; return `<tr><td><strong>${escapeHtml(item.remissionNumber)}</strong></td><td>${dateTime(item.createdAt)}</td><td>${escapeHtml(item.clientName)}</td><td><strong>${bunchLabel(item.requestedBunches)}</strong> · ${number(item.requestedStems)} tallos</td><td><span class="workflow-status workflow-status--${meta.kind}">${meta.label}</span></td><td class="money"><strong>${item.status === 'FINALIZADA' ? money(item.total) : '—'}</strong></td><td><div class="table-actions"><button class="small-button" data-remission-action="${meta.action}" data-remission-id="${item.id}">${meta.button}</button>${cancelButton}</div></td></tr>`; }).join('');
  $('#history-empty').classList.toggle('is-hidden', rows.length > 0);
}

function statusMeta(status) {
  if (status === 'PENDIENTE_VARIEDADES') return { label: 'Paso 2 · Variedades', button: 'Asignar variedades', action: 'items', kind: 'pending' };
  if (status === 'PENDIENTE_PRECIOS') return { label: 'Paso 3 · Precios', button: 'Ingresar precios', action: 'prices', kind: 'pricing' };
  if (status === 'ANULADA') return { label: 'Anulada', button: 'Ver detalle', action: 'view', kind: 'canceled' };
  return { label: 'Finalizada', button: 'Ver / Imprimir', action: 'view', kind: 'done' };
}

function renderLines() {
  $('#remission-lines').innerHTML = state.lines.map(line => `<div class="line-item line-item--step"><strong>${escapeHtml(line.variety)}</strong><span>${escapeHtml(line.gradeCm)} · ${inventoryDate(line.date)}${isTodayInventory(line) ? ' · 🔓 Hoy' : ''}</span><span>${line.bunches} ramos</span><span>${line.stems} tallos</span><button type="button" class="remove-line" data-remove-line="${line.key}" aria-label="Quitar ${escapeHtml(line.variety)}">×</button></div>`).join('');
  const bunches = state.lines.reduce((sum, row) => sum + row.bunches, 0);
  const stems = state.lines.reduce((sum, row) => sum + row.stems, 0);
  const remission = state.activeRemission;
  if (remission) {
    const remainingBunches = remission.requestedBunches - bunches;
    const remainingStems = remission.requestedStems - stems;
    const exact = remainingBunches === 0 && remainingStems === 0;
    const exceeded = remainingBunches < 0 || remainingStems < 0;
    const status = exact ? '<b class="selection-ready">✓ Pedido completo</b>' : exceeded ? '<b class="selection-over">La selección supera el pedido</b>' : `<b class="selection-pending">Faltan ${bunchLabel(remainingBunches)} · ${number(remainingStems)} tallos</b>`;
    $('#items-step-totals').innerHTML = `<span>Seleccionado: <strong>${bunchLabel(bunches)} · ${number(stems)} tallos</strong></span><span>Pedido: <strong>${bunchLabel(remission.requestedBunches)} · ${number(remission.requestedStems)} tallos</strong></span>${status}`;
    $('#items-confirm-button').disabled = !exact;
  }
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
  $('#remission-error').textContent = '';
}

async function openItemsStep(id) {
  try {
    const [remission, inventory] = await Promise.all([api(`/api/remissions/${id}`), api('/api/inventory')]);
    if (remission.status !== 'PENDIENTE_VARIEDADES') return continueRemission(remission);
    state.inventory = inventory; state.activeRemission = remission; state.lines = []; state.unlockToday = false; state.stepGrade = 'ALL';
    $('#step-grade-filter').value = 'ALL'; renderTodayUnlock();
    $('#items-step-heading').textContent = `${remission.remissionNumber} · ${remission.clientName}`;
    $('#items-step-target').innerHTML = `<span>Pedido solicitado</span><strong>${bunchLabel(remission.requestedBunches)} · ${number(remission.requestedStems)} tallos</strong>`;
    $('#items-step-error').textContent = ''; $('#line-error').textContent = '';
    renderLines(); $('#items-step-dialog').showModal();
  } catch (error) { toast(error.message); }
}

async function openPricesStep(id) {
  try {
    const remission = await api(`/api/remissions/${id}`);
    if (remission.status !== 'PENDIENTE_PRECIOS') return continueRemission(remission);
    state.activeRemission = remission;
    $('#prices-step-heading').textContent = `${remission.remissionNumber} · ${remission.clientName}`;
    $('#prices-step-error').textContent = '';
    $('#price-lines').innerHTML = remission.items.map(item => `<label class="price-line"><span><strong>${escapeHtml(item.variety)}</strong><small>${escapeHtml(item.gradeCm)} · ${number(item.bunches)} ramos · ${number(item.stems)} tallos</small></span><span>Precio por ramo<input type="number" min="0.01" step="0.01" value="${item.unitPriceBunch || ''}" data-price-id="${item.id}" data-price-bunches="${item.bunches}" required></span></label>`).join('');
    updatePricesTotal(); $('#prices-step-dialog').showModal();
  } catch (error) { toast(error.message); }
}

function continueRemission(remission) {
  if (remission.status === 'PENDIENTE_VARIEDADES') return openItemsStep(remission.id);
  if (remission.status === 'PENDIENTE_PRECIOS') return openPricesStep(remission.id);
  renderDocument(remission); $('#remission-dialog').showModal();
}

function updatePricesTotal() {
  const total = $$('[data-price-id]').reduce((sum, input) => sum + (Number(input.value) || 0) * Number(input.dataset.priceBunches), 0);
  $('#prices-total').textContent = money(total);
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
    <header class="doc-head"><div class="doc-brand"><div class="brand-mark">F</div><div><h2>${escapeHtml(company.companyName)}</h2><p>${escapeHtml(company.companyNit ? `NIT ${company.companyNit}` : 'Salida nacional de flor')}</p><p>${escapeHtml(company.companyAddress)} ${escapeHtml(company.companyPhone)}</p></div></div><div class="doc-number"><span>REMISIÓN</span><strong>${escapeHtml(data.remissionNumber)}</strong><p>${dateTime(data.createdAt)}</p></div></header>
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
$('#requested-bunches').addEventListener('input', event => {
  const bunches = Math.max(0, Number.parseInt(event.target.value, 10) || 0);
  $('#requested-stems').value = bunches ? bunches * 25 : '';
});
$('#step-grade-filter').addEventListener('change', event => { state.stepGrade = event.target.value; renderVarietyOptions(); });
$('#line-variety').addEventListener('change', renderStockPreview);
$('#unlock-today-button').addEventListener('click', () => {
  if (!state.unlockToday && !window.confirm('La flor ingresada hoy normalmente solo se vende desde mañana. ¿Desea desbloquearla para esta remisión?')) return;
  state.unlockToday = !state.unlockToday;
  renderTodayUnlock();
});

document.addEventListener('click', async event => {
  const remissionButton = event.target.closest('[data-remission-id]');
  const cancelButton = event.target.closest('[data-cancel-remission]');
  const removeButton = event.target.closest('[data-remove-line]');
  const closeButton = event.target.closest('[data-close-dialog]');
  if (remissionButton) {
    const action = remissionButton.dataset.remissionAction;
    if (action === 'items') openItemsStep(remissionButton.dataset.remissionId);
    else if (action === 'prices') openPricesStep(remissionButton.dataset.remissionId);
    else openRemission(remissionButton.dataset.remissionId);
  }
  if (cancelButton) openCancelRemission(cancelButton.dataset.cancelRemission);
  if (removeButton) { state.lines = state.lines.filter(row => row.key !== removeButton.dataset.removeLine); $('#items-step-error').textContent = ''; renderLines(); }
  if (closeButton) $(`#${closeButton.dataset.closeDialog}`).close();
});

$('#add-line-button').addEventListener('click', () => {
  const item = state.inventory.find(row => row.key === $('#line-variety').value);
  const bunches = Math.max(0, Number.parseInt($('#line-bunches').value, 10) || 0);
  const error = $('#line-error'); error.textContent = '';
  if (!item) return error.textContent = 'Seleccione una variedad.';
  if (isTodayInventory(item) && !state.unlockToday) return error.textContent = 'La flor de hoy está bloqueada hasta mañana.';
  if (!bunches) return error.textContent = 'Ingrese al menos un ramo.';
  if (bunches > item.bunches) return error.textContent = `Disponibles: ${item.bunches} ramos.`;
  if (state.lines.some(row => row.key === item.key)) return error.textContent = 'Este grupo ya está agregado.';
  state.lines.push({ key: item.key, date: item.date, variety: item.variety, gradeCm: item.gradeCm, stemsPerBunch: item.stemsPerBunch, bunches, stems: bunches * item.stemsPerBunch });
  $('#items-step-error').textContent = '';
  $('#line-variety').value = ''; $('#line-bunches').value = 1; renderLines();
});

$('#remission-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  $('#remission-error').textContent = '';
  const payload = Object.fromEntries(new FormData(event.currentTarget));
  button.disabled = true;
  try {
    const remission = await api('/api/remissions', { method: 'POST', body: JSON.stringify(payload) });
    clearRemission(); await refreshAll(); switchView('history'); toast(`${remission.remissionNumber} creada. Continúe con las variedades en el paso 2.`);
  } catch (error) { $('#remission-error').textContent = error.message; }
  finally { button.disabled = false; }
});

$('#items-step-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter; const error = $('#items-step-error'); error.textContent = '';
  if (!state.lines.length) return error.textContent = 'Agregue al menos una variedad.';
  button.disabled = true;
  try {
    const remission = await api(`/api/remissions/${state.activeRemission.id}/items`, { method: 'PUT', body: JSON.stringify({ items: state.lines.map(({ key, bunches }) => ({ key, bunches })), unlockToday: state.unlockToday }) });
    $('#items-step-dialog').close(); await refreshAll(); switchView('history'); toast(`${remission.remissionNumber}: inventario actualizado. Falta ingresar precios.`);
  } catch (requestError) { error.textContent = requestError.message; }
  finally { button.disabled = false; }
});

$('#price-lines').addEventListener('input', updatePricesTotal);
$('#prices-step-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter; const error = $('#prices-step-error'); error.textContent = '';
  const items = $$('[data-price-id]').map(input => ({ id: Number(input.dataset.priceId), unitPriceBunch: Number(input.value) }));
  button.disabled = true;
  try {
    const remission = await api(`/api/remissions/${state.activeRemission.id}/prices`, { method: 'PUT', body: JSON.stringify({ items }) });
    $('#prices-step-dialog').close(); renderDocument(remission); await refreshAll(); $('#remission-dialog').showModal(); toast('Remisión finalizada y lista para imprimir.');
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
}, 20000);
