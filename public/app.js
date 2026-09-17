const state = { inventory: [], remissions: [], lines: [], config: {}, activeView: 'dashboard' };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const money = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value || 0));
const number = value => new Intl.NumberFormat('es-CO').format(Number(value || 0));
const shortDate = value => new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(value));
const dateTime = value => new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
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
  renderDashboard(dashboard.totals);
  renderInventory();
  renderVarietyOptions();
  renderHistory();
}

function stockStatus(item) {
  if (item.bunches <= 10 || item.stems <= item.stemsPerBunch * 10) return '<span class="status status--low">Stock bajo</span>';
  return '<span class="status">Disponible</span>';
}

function flowerColor(color) {
  const name = color.toLowerCase();
  if (name.includes('blanco')) return '#d6d4ca';
  if (name.includes('ros')) return '#d884a3';
  if (name.includes('amar')) return '#e9bd52';
  if (name.includes('naran')) return '#dc8252';
  if (name.includes('morado')) return '#8b70a4';
  return '#c75e57';
}

function renderDashboard(totals) {
  $('#metric-varieties').textContent = number(totals.varieties);
  $('#metric-bunches').textContent = number(totals.bunches);
  $('#metric-stems').textContent = number(totals.stems);
  $('#metric-sales').textContent = money(totals.todaySales);
  $('#dashboard-inventory').innerHTML = state.inventory.slice(0, 7).map(item => `<tr>
    <td><div class="variety-cell"><i class="flower-dot" style="--flower-color:${flowerColor(item.color)}"></i>${escapeHtml(item.variety)}</div></td>
    <td>${escapeHtml(item.color || '—')}</td><td class="quantity">${number(item.bunches)}</td><td class="quantity">${number(item.stems)}</td><td>${stockStatus(item)}</td>
  </tr>`).join('') || '<tr><td colspan="5">No hay variedades registradas.</td></tr>';
  $('#dashboard-remissions').innerHTML = state.remissions.slice(0, 6).map(item => `<button class="activity-item text-button" data-remission-id="${item.id}">
    <span class="activity-icon">↗</span><span><strong>${escapeHtml(item.clientName)}</strong><span>${escapeHtml(item.remissionNumber)} · ${shortDate(item.createdAt)}</span></span><b class="activity-amount">${money(item.total)}</b>
  </button>`).join('') || '<div class="empty-state"><strong>Aún no hay salidas</strong><span>La actividad aparecerá aquí.</span></div>';
}

function renderInventory() {
  const query = ($('#inventory-search').value || '').toLowerCase();
  const rows = state.inventory.filter(item => `${item.variety} ${item.color}`.toLowerCase().includes(query));
  $('#inventory-body').innerHTML = rows.map(item => `<tr>
    <td><div class="variety-cell"><i class="flower-dot" style="--flower-color:${flowerColor(item.color)}"></i>${escapeHtml(item.variety)}</div></td>
    <td>${escapeHtml(item.color || '—')}</td><td class="quantity">${number(item.bunches)}</td><td class="quantity">${number(item.stems)}</td>
    <td class="money">${money(item.pricePerBunch)}</td><td class="money">${money(item.pricePerStem)}</td><td class="date-cell">${dateTime(item.updatedAt)}</td>
    <td><button class="small-button" data-adjust-id="${item.id}">Ajustar</button></td>
  </tr>`).join('');
  $('#inventory-empty').classList.toggle('is-hidden', rows.length > 0);
  $('#stock-summary').textContent = `${number(state.inventory.reduce((sum, row) => sum + row.bunches, 0))} ramos · ${number(state.inventory.reduce((sum, row) => sum + row.stems, 0))} tallos`;
}

function renderVarietyOptions() {
  $('#line-variety').innerHTML = '<option value="">Seleccione una variedad</option>' + state.inventory.map(item => `<option value="${item.id}">${escapeHtml(item.variety)} · ${item.bunches} ramos / ${item.stems} tallos</option>`).join('');
}

function renderHistory() {
  const query = ($('#history-search').value || '').toLowerCase();
  const rows = state.remissions.filter(item => `${item.remissionNumber} ${item.clientName} ${item.destination}`.toLowerCase().includes(query));
  $('#history-body').innerHTML = rows.map(item => `<tr><td><strong>${escapeHtml(item.remissionNumber)}</strong></td><td>${dateTime(item.createdAt)}</td><td>${escapeHtml(item.clientName)}</td><td>${escapeHtml(item.destination || '—')}</td><td class="money"><strong>${money(item.total)}</strong></td><td><button class="small-button" data-remission-id="${item.id}">Ver / Imprimir</button></td></tr>`).join('');
  $('#history-empty').classList.toggle('is-hidden', rows.length > 0);
}

function renderLines() {
  $('#remission-lines').innerHTML = state.lines.map(line => `<div class="line-item"><strong>${escapeHtml(line.variety)}</strong><span>${line.bunches} ramos</span><span>${line.stems} tallos</span><b>${money(line.subtotal)}</b><button type="button" class="remove-line" data-remove-line="${line.id}" aria-label="Quitar ${escapeHtml(line.variety)}">×</button></div>`).join('');
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
  $('#printable-document').innerHTML = `
    <header class="doc-head"><div class="doc-brand"><div class="brand-mark">F</div><div><h2>${escapeHtml(company.companyName)}</h2><p>${escapeHtml(company.companyNit ? `NIT ${company.companyNit}` : 'Salida nacional de flor')}</p><p>${escapeHtml(company.companyAddress)} ${escapeHtml(company.companyPhone)}</p></div></div><div class="doc-number"><span>REMISIÓN</span><strong>${escapeHtml(data.remissionNumber)}</strong><p>${dateTime(data.createdAt)}</p></div></header>
    <section class="doc-client"><div class="doc-field"><span>Cliente</span><strong>${escapeHtml(data.clientName)}</strong></div><div class="doc-field"><span>NIT / Documento</span><strong>${escapeHtml(data.clientDocument || '—')}</strong></div><div class="doc-field"><span>Destino</span><strong>${escapeHtml(data.destination || '—')}</strong></div><div class="doc-field"><span>Teléfono</span><strong>${escapeHtml(data.clientPhone || '—')}</strong></div></section>
    <table class="doc-table"><thead><tr><th>Variedad</th><th>Ramos</th><th>Tallos</th><th>Precio ramo</th><th>Precio tallo</th><th>Subtotal</th></tr></thead><tbody>${data.items.map(item => `<tr><td><strong>${escapeHtml(item.variety)}</strong></td><td>${number(item.bunches)}</td><td>${number(item.stems)}</td><td>${money(item.unitPriceBunch)}</td><td>${money(item.unitPriceStem)}</td><td>${money(item.subtotal)}</td></tr>`).join('')}</tbody></table>
    <div class="doc-total"><span>TOTAL</span><span>${money(data.total)}</span></div>
    ${data.notes ? `<div class="doc-notes"><strong>Observaciones:</strong> ${escapeHtml(data.notes)}</div>` : ''}
    <footer class="doc-signatures"><div class="doc-signature">Entregado por</div><div class="doc-signature">Recibido por</div></footer>`;
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
$('#add-variety-button').addEventListener('click', () => $('#inventory-dialog').showModal());

$('#inventory-form').addEventListener('submit', async event => {
  event.preventDefault();
  const submitter = event.submitter;
  if (submitter?.value === 'cancel') return $('#inventory-dialog').close();
  $('#inventory-error').textContent = '';
  try {
    const formData = Object.fromEntries(new FormData(event.currentTarget));
    await api('/api/inventory', { method: 'POST', body: JSON.stringify(formData) });
    $('#inventory-dialog').close(); event.currentTarget.reset(); toast('Variedad guardada correctamente.'); await refreshAll();
  } catch (error) { $('#inventory-error').textContent = error.message; }
});

document.addEventListener('click', async event => {
  const adjustButton = event.target.closest('[data-adjust-id]');
  const remissionButton = event.target.closest('[data-remission-id]');
  const removeButton = event.target.closest('[data-remove-line]');
  if (adjustButton) {
    const item = state.inventory.find(row => row.id === Number(adjustButton.dataset.adjustId));
    $('#adjust-title').textContent = `Ajustar ${item.variety}`;
    $('#adjust-form').elements.id.value = item.id;
    $('#adjust-dialog').showModal();
  }
  if (remissionButton) openRemission(remissionButton.dataset.remissionId);
  if (removeButton) { state.lines = state.lines.filter(row => row.id !== Number(removeButton.dataset.removeLine)); renderLines(); }
});

$('#adjust-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') return $('#adjust-dialog').close();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  $('#adjust-error').textContent = '';
  try {
    await api(`/api/inventory/${data.id}/adjust`, { method: 'PATCH', body: JSON.stringify(data) });
    $('#adjust-dialog').close(); event.currentTarget.reset(); toast('Existencia actualizada.'); await refreshAll();
  } catch (error) { $('#adjust-error').textContent = error.message; }
});

$('#add-line-button').addEventListener('click', () => {
  const item = state.inventory.find(row => row.id === Number($('#line-variety').value));
  const bunches = Math.max(0, Number.parseInt($('#line-bunches').value, 10) || 0);
  const stems = Math.max(0, Number.parseInt($('#line-stems').value, 10) || 0);
  const error = $('#line-error'); error.textContent = '';
  if (!item) return error.textContent = 'Seleccione una variedad.';
  if (!bunches && !stems) return error.textContent = 'Ingrese al menos un ramo o un tallo.';
  if (bunches > item.bunches || stems > item.stems) return error.textContent = `Disponibles: ${item.bunches} ramos y ${item.stems} tallos.`;
  if (state.lines.some(row => row.id === item.id)) return error.textContent = 'Esta variedad ya está agregada.';
  state.lines.push({ id: item.id, variety: item.variety, bunches, stems, subtotal: bunches * item.pricePerBunch + stems * item.pricePerStem });
  $('#line-variety').value = ''; $('#line-bunches').value = 0; $('#line-stems').value = 0; renderLines();
});

$('#remission-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  $('#remission-error').textContent = '';
  if (!state.lines.length) return $('#remission-error').textContent = 'Agregue al menos una variedad.';
  const payload = { ...Object.fromEntries(new FormData(event.currentTarget)), items: state.lines.map(({ id, bunches, stems }) => ({ id, bunches, stems })) };
  button.disabled = true;
  try {
    const remission = await api('/api/remissions', { method: 'POST', body: JSON.stringify(payload) });
    renderDocument(remission); clearRemission(); await refreshAll(); $('#remission-dialog').showModal(); toast('Remisión confirmada e inventario actualizado.');
  } catch (error) { $('#remission-error').textContent = error.message; }
  finally { button.disabled = false; }
});

$('#clear-remission').addEventListener('click', clearRemission);
$('#close-document').addEventListener('click', () => $('#remission-dialog').close());
$('#print-document').addEventListener('click', () => window.print());

(async function init() {
  try { const session = await api('/api/auth/session'); if (session.authenticated) await showApp(); else showLogin(); }
  catch { showLogin(); }
})();
