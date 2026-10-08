const varieties = ['FREEDOM', 'PINK FLOYD', 'MONDIAL', 'HUMMER', 'MOMENTUM', 'CORAL REEF', 'QUICK SAND', 'HILUX', 'CANDLELIGHT', 'DEEP PURPLE', 'SUMMERSAND', 'STAR PLATINUM', 'SHIMMER', 'PINK OHARA', 'WHITE OHARA', 'PINK MONDIAL', 'BLESSING', 'PINK AMARETO', 'TIFFANY', 'YELLOW BIKINI', 'QUEEN BERRY', 'MOODY BLUE', 'SWAN', 'HIGH MAGIC', 'EXPLORER', 'DANCING RED', 'VENDELA'];
const state = { inventory: [], inventoryFingerprint: '', inventoryRefreshPromise: null, inventoryLastSyncedAt: null, inventorySyncError: '', refreshVersion: 0, reconciliationSources: [], adjustments: [], remissions: [], prices: [], transfers: [], gradeTransfers: [], waste: [], priceDrafts: [], editingPriceClientKey: null, expandedPriceClients: new Set(), selectedPriceGrades: new Map(), lines: [], activeRemission: null, editingDocumentPrices: false, reportsUnlocked: false, reportRows: [], wasteReport: [], movementsReport: { adjustments: [], transfers: [], gradeTransfers: [] }, inventoryReport: null, reportRange: '', stepGrade: 'ALL', config: {}, totals: {}, activeView: 'dashboard', selectedDate: '', selectedGrade: 'ALL' };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const money = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', currencyDisplay: 'code', maximumFractionDigits: 0 }).format(Number(value || 0));
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
  const version = ++state.refreshVersion;
  const fresh = { cache: 'no-store' };
  const inventoryRefresh = refreshInventory().catch(() => false);
  const results = await Promise.allSettled([api('/api/dashboard', fresh), api('/api/config', fresh), api('/api/price-lists', fresh), api('/api/export-transfers', fresh), api('/api/inventory/reconciliation', fresh), api('/api/inventory/waste', fresh), api('/api/inventory/grade-transfers', fresh)]);
  await inventoryRefresh;
  if (version !== state.refreshVersion) return;
  const [dashboard, config, prices, transfers, reconciliation, waste, gradeTransfers] = results;
  if (dashboard.status === 'fulfilled') { state.remissions = dashboard.value.remissions; state.totals = dashboard.value.totals; renderDashboard(); renderHistory(); }
  if (config.status === 'fulfilled') state.config = config.value;
  if (prices.status === 'fulfilled') { state.prices = normalizePriceList(prices.value); renderPrices(); }
  if (transfers.status === 'fulfilled') { state.transfers = transfers.value; renderTransfers(); }
  if (reconciliation.status === 'fulfilled') { state.reconciliationSources = reconciliation.value.sources; state.adjustments = reconciliation.value.adjustments; renderReconciliation(); }
  if (waste.status === 'fulfilled') { state.waste = waste.value; renderWaste(); }
  if (gradeTransfers.status === 'fulfilled') { state.gradeTransfers = gradeTransfers.value; renderGradeTransfers(); }
}

function renderInventorySyncStatus() {
  const time = state.inventoryLastSyncedAt ? new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(state.inventoryLastSyncedAt) : null;
  const message = state.inventorySyncError ? `No se pudo actualizar el inventario. ${time ? `Última actualización correcta: ${time}.` : 'No hay datos confirmados.'} Se reintentará automáticamente.` : time ? `Inventario actualizado a las ${time}.` : 'Consultando inventario...';
  for (const element of [$('#inventory-sync-status'), $('#remission-sync-status')]) { element.textContent = message; element.classList.toggle('is-error', Boolean(state.inventorySyncError)); }
}

async function refreshInventory() {
  if (state.inventoryRefreshPromise) return state.inventoryRefreshPromise;
  const operation = (async () => {
    try {
      const rows = await api('/api/inventory', { cache: 'no-store' });
      const changed = applyInventory(rows);
      state.inventoryLastSyncedAt = new Date();
      state.inventorySyncError = '';
      renderInventorySyncStatus();
      renderDashboard(); renderInventory(); renderReconciliation(); renderTransfers(); renderWaste(); renderGradeTransfers();
      return changed;
    } catch (error) {
      state.inventorySyncError = error.message;
      renderInventorySyncStatus();
      throw error;
    }
  })();
  state.inventoryRefreshPromise = operation;
  try { return await operation; } finally { state.inventoryRefreshPromise = null; }
}

function applyInventory(rows) {
  const fingerprint = JSON.stringify(rows.map(row => [row.key, row.bunches, row.stems]));
  if (fingerprint === state.inventoryFingerprint) return false;
  state.inventory = rows;
  state.inventoryFingerprint = fingerprint;
  renderVarietyOptions();
  return true;
}

function normalizePriceList(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.prices)) return value.prices;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function dateFilteredInventory() {
  return state.inventory.filter(item => {
    const matchesDate = !state.selectedDate || item.date === state.selectedDate;
    const matchesGrade = state.selectedGrade === 'ALL' || item.gradeCm === state.selectedGrade;
    return matchesDate && matchesGrade;
  });
}

function groupedInventory(rows) {
  const groups = new Map();
  rows.forEach(item => {
    const key = `${clientKey(item.variety)}|${item.gradeCm}`;
    const group = groups.get(key) || { variety: item.variety, gradeCm: item.gradeCm, bunches: 0, stems: 0 };
    group.bunches += Number(item.bunches || 0);
    group.stems += Number(item.stems || 0);
    groups.set(key, group);
  });
  return [...groups.values()].map(item => ({ ...item, stemsPerBunch: item.bunches ? item.stems / item.bunches : 0 })).sort((a, b) => a.variety.localeCompare(b.variety) || a.gradeCm.localeCompare(b.gradeCm));
}

function renderDashboard(totals = state.totals) {
  const visibleInventory = dateFilteredInventory();
  $('#metric-varieties').textContent = number(new Set(visibleInventory.map(item => item.variety)).size);
  $('#metric-bunches').textContent = number(visibleInventory.reduce((sum, item) => sum + item.bunches, 0));
  $('#metric-stems').textContent = number(visibleInventory.reduce((sum, item) => sum + item.stems, 0));
  $('#metric-sales').textContent = money(totals.todaySales);
  $('#dashboard-inventory').innerHTML = groupedInventory(visibleInventory).slice(0, 7).map(item => `<tr>
    <td><div class="variety-cell">${escapeHtml(item.variety)}</div></td>
    <td><span class="grade-chip">${escapeHtml(item.gradeCm)}</span></td><td class="quantity">${number(item.stemsPerBunch)}</td>
    <td class="quantity">${number(item.bunches)}</td><td class="quantity">${number(item.stems)}</td>
  </tr>`).join('') || '<tr><td colspan="5">No hay registros BAJAS, NACIONAL o NACIONAL GRANEL disponibles.</td></tr>';
  $('#dashboard-remissions').innerHTML = state.remissions.slice(0, 6).map(item => `<button class="activity-item text-button" data-remission-action="${statusMeta(item.status).action}" data-remission-id="${item.id}">
    <span class="activity-icon">↗</span><span><strong>${escapeHtml(item.clientName)}</strong><span>${item.status === 'ANULADA' ? 'ANULADA' : escapeHtml(item.remissionNumber || 'Pendiente')} · ${statusMeta(item.status).label}</span></span><b class="activity-amount">${item.status === 'FINALIZADA' ? money(item.total) : bunchLabel(item.requestedBunches)}</b>
  </button>`).join('') || '<div class="empty-state"><strong>Aún no hay salidas</strong><span>La actividad aparecerá aquí.</span></div>';
}

function renderInventory() {
  const query = ($('#inventory-search').value || '').toLowerCase();
  const sourceRows = dateFilteredInventory().filter(item => `${item.date} ${item.variety} ${item.gradeCm}`.toLowerCase().includes(query));
  const rows = groupedInventory(sourceRows);
  $('#inventory-body').innerHTML = rows.map(item => `<tr>
    <td><div class="variety-cell">${escapeHtml(item.variety)}</div></td>
    <td><span class="grade-chip">${escapeHtml(item.gradeCm)}</span></td><td class="quantity">${number(item.stemsPerBunch)}</td>
    <td class="quantity">${number(item.bunches)}</td><td class="quantity">${number(item.stems)}</td>
  </tr>`).join('');
  $('#inventory-empty').classList.toggle('is-hidden', rows.length > 0);
  $('#stock-summary').textContent = `${number(rows.reduce((sum, row) => sum + row.bunches, 0))} ramos · ${number(rows.reduce((sum, row) => sum + row.stems, 0))} tallos`;
}

function renderReconciliation() {
  const gradeSelect = $('#reconcile-grade');
  const varietySelect = $('#reconcile-variety');
  const grades = [...new Set(state.reconciliationSources.map(row => row.gradeCm))].sort();
  const selectedGrade = gradeSelect.value;
  gradeSelect.innerHTML = '<option value="">Seleccione un grado</option>' + grades.map(grade => `<option value="${escapeHtml(grade)}">${escapeHtml(grade)}</option>`).join('');
  gradeSelect.value = selectedGrade;
  const varietiesInGrade = [...new Set(state.reconciliationSources.filter(row => row.gradeCm === gradeSelect.value).map(row => row.variety))].sort();
  const selectedVariety = varietySelect.value;
  varietySelect.innerHTML = '<option value="">Seleccione una variedad</option>' + varietiesInGrade.map(variety => `<option value="${escapeHtml(variety)}">${escapeHtml(variety)}</option>`).join('');
  varietySelect.value = selectedVariety;
  const select = $('#reconcile-source');
  const selected = select.value;
  select.innerHTML = '<option value="">Seleccione un lote</option>' + state.reconciliationSources.filter(row => row.gradeCm === gradeSelect.value && row.variety === varietySelect.value).map(row => `<option value="${escapeHtml(row.key)}">${inventoryDate(row.date)} · ${number(row.stemsPerBunch)} tallos/ramo · ${number(row.bunches)} ramos</option>`).join('');
  select.value = selected;
  if (select.value !== selected) $('#reconcile-counted').value = '';
  updateReconciliationDifference();
  $('#reconcile-history-body').innerHTML = state.adjustments.map(row => `<tr><td>${dateTime(row.createdAt)}</td><td><strong>${escapeHtml(row.variety)}</strong><br>${escapeHtml(row.gradeCm)} · ${inventoryDate(row.date)} · ${number(row.stemsPerBunch)} tallos/ramo</td><td>${number(row.beforeBunches)}</td><td><strong>${number(row.countedBunches)}</strong></td><td>${row.deltaBunches > 0 ? '+' : ''}${number(row.deltaBunches)}</td><td><strong>${escapeHtml(row.responsible)}</strong><br>${escapeHtml(row.reason)}${row.cancellationReason ? `<br><small>Anulación: ${escapeHtml(row.cancellationReason)}</small>` : ''}</td><td>${row.canceledAt ? '<span class="workflow-status workflow-status--canceled">Anulado</span>' : '<span class="workflow-status workflow-status--done">Vigente</span>'}</td><td>${row.canceledAt ? '' : `<button class="small-button small-button--danger" type="button" data-cancel-adjustment="${row.id}">Anular</button>`}</td></tr>`).join('');
  $('#reconcile-history-empty').classList.toggle('is-hidden', state.adjustments.length > 0);
}

function updateReconciliationDifference() {
  const source = state.reconciliationSources.find(row => row.key === $('#reconcile-source').value);
  $('#reconcile-current').value = source ? source.bunches : '';
  const countedValue = $('#reconcile-counted').value;
  if (!source) return $('#reconcile-difference').textContent = 'Seleccione un lote para comparar el conteo.';
  if (countedValue === '') return $('#reconcile-difference').textContent = `Sistema: ${number(source.bunches)} ramos. Ingrese el conteo físico.`;
  const difference = Number(countedValue) - Number(source.bunches);
  $('#reconcile-difference').textContent = difference === 0 ? 'Sin diferencia: no hace falta registrar un ajuste.' : `Diferencia: ${difference > 0 ? '+' : ''}${number(difference)} ramos (${difference > 0 ? 'aumentará' : 'disminuirá'} el inventario).`;
}

function renderTransfers() {
  const available = groupedInventory(state.inventory.filter(row => row.gradeCm === 'BAJAS'));
  const select = $('#transfer-variety');
  const selected = select.value;
  select.innerHTML = '<option value="">Seleccione una variedad</option>' + available.map(row => `<option value="${escapeHtml(row.variety)}">${escapeHtml(row.variety)} · ${number(row.bunches)} ramos disponibles</option>`).join('');
  select.value = selected;
  $('#transfer-history-body').innerHTML = state.transfers.map(row => `<tr><td>${dateTime(row.createdAt)}</td><td><strong>${escapeHtml(row.variety)}</strong></td><td>${number(row.bunches)}</td><td>${number(row.stems)}</td><td>${escapeHtml(row.responsible)}</td><td>${escapeHtml(row.reason)}</td><td>${row.canceledAt ? '<span class="workflow-status workflow-status--canceled">Anulado</span>' : '<span class="workflow-status workflow-status--done">Registrado</span>'}</td><td>${row.canceledAt ? '' : `<button class="small-button small-button--danger" type="button" data-cancel-transfer="${row.id}">Anular</button>`}</td></tr>`).join('');
  $('#transfer-history-empty').classList.toggle('is-hidden', state.transfers.length > 0);
}

function renderGradeTransfers() {
  const fromGrade = $('#grade-transfer-from').value;
  const select = $('#grade-transfer-variety');
  const selected = select.value;
  const available = groupedInventory(state.inventory.filter(row => row.gradeCm === fromGrade && row.bunches > 0));
  select.innerHTML = '<option value="">Seleccione una variedad</option>' + available.map(row => `<option value="${escapeHtml(row.variety)}">${escapeHtml(row.variety)} · ${number(row.bunches)} ramos disponibles</option>`).join('');
  select.value = selected;
  const batches = new Map();
  state.gradeTransfers.forEach(row => {
    const entry = batches.get(row.batchId) || { ...row, bunches: 0, stems: 0, lots: [] };
    entry.bunches += row.bunches; entry.stems += row.stems;
    entry.lots.push(`${inventoryDate(row.date)} · ${number(row.bunches)} ramos de ${number(row.stemsPerBunch)} tallos`);
    batches.set(row.batchId, entry);
  });
  $('#grade-transfer-history-body').innerHTML = [...batches.values()].map(row => `<tr><td>${dateTime(row.createdAt)}</td><td><strong>${escapeHtml(row.variety)}</strong></td><td>${escapeHtml(row.fromGrade)} → ${escapeHtml(row.toGrade)}</td><td>${row.lots.map(escapeHtml).join('<br>')}</td><td>${number(row.bunches)}</td><td>${number(row.stems)}</td><td>${escapeHtml(row.responsible)}</td><td>${escapeHtml(row.reason)}</td></tr>`).join('');
  $('#grade-transfer-history-empty').classList.toggle('is-hidden', batches.size > 0);
}

function renderWaste() {
  const gradeSelect = $('#waste-grade');
  const groups = groupedInventory(state.inventory.filter(row => row.bunches > 0));
  const selectedGrade = gradeSelect.value;
  gradeSelect.innerHTML = '<option value="">Seleccione un grado</option>' + [...new Set(groups.map(row => row.gradeCm))].sort().map(grade => `<option value="${escapeHtml(grade)}">${escapeHtml(grade)}</option>`).join('');
  gradeSelect.value = selectedGrade;
  const select = $('#waste-source');
  const selected = select.value;
  select.innerHTML = '<option value="">Seleccione una variedad</option>' + groups.filter(row => row.gradeCm === gradeSelect.value).map(row => `<option value="${escapeHtml(JSON.stringify([row.variety, row.gradeCm]))}">${escapeHtml(row.variety)} · ${number(row.bunches)} ${row.bunches === 1 ? 'ramo disponible' : 'ramos disponibles'}</option>`).join('');
  select.value = selected;
  const history = new Map();
  state.waste.forEach(row => {
    const key = row.batchId || `legacy-${row.id}`;
    const entry = history.get(key) || { ...row, bunches: 0, stems: 0, lots: [] };
    entry.bunches += row.bunches; entry.stems += row.stems;
    entry.lots.push(`${inventoryDate(row.date)} · ${number(row.bunches)} ${row.bunches === 1 ? 'ramo' : 'ramos'} de ${number(row.stemsPerBunch)} tallos`);
    history.set(key, entry);
  });
  $('#waste-history-body').innerHTML = [...history.values()].map(row => `<tr><td>${dateTime(row.createdAt)}</td><td><strong>${escapeHtml(row.variety)} · ${escapeHtml(row.gradeCm)}</strong><br><small>${row.lots.map(escapeHtml).join('<br>')}</small></td><td>${number(row.bunches)}</td><td>${number(row.stems)}</td><td>${escapeHtml(row.responsible)}</td><td>${escapeHtml(row.reason)}${row.cancellationReason ? `<br><small>Anulación: ${escapeHtml(row.cancellationReason)}</small>` : ''}</td><td>${row.canceledAt ? '<span class="workflow-status workflow-status--canceled">Anulado</span>' : '<span class="workflow-status workflow-status--done">Descontado</span>'}</td><td>${row.canceledAt ? '' : `<button class="small-button small-button--danger" type="button" data-cancel-waste="${row.id}">Anular</button>`}</td></tr>`).join('');
  $('#waste-history-empty').classList.toggle('is-hidden', state.waste.length > 0);
}

function renderVarietyOptions() {
  const groups = remissionVarietyGroups();
  const selected = $('#line-variety').value;
  const pickerOpen = $('#line-variety-picker').classList.contains('is-open');
  const pickerScroll = $('#line-variety-picker .variety-picker-menu')?.scrollTop || 0;
  $('#line-variety').innerHTML = '<option value="">Seleccione una variedad</option>' + groups.map(group => `<option value="${escapeHtml(group.key)}">${escapeHtml(group.variety)} · ${group.availableBunches} ${group.availableBunches === 1 ? 'ramo disponible' : 'ramos disponibles'}</option>`).join('') + (groups.length ? '' : '<option disabled>Sin inventario para este grado</option>');
  $('#line-variety').value = selected;
  renderVarietyPicker(groups);
  $('#line-variety-picker').classList.toggle('is-open', pickerOpen);
  $('#line-variety-picker .variety-picker-trigger').setAttribute('aria-expanded', String(pickerOpen));
  if (pickerOpen) $('#line-variety-picker .variety-picker-menu').scrollTop = pickerScroll;
  renderStockPreview();
}

async function refreshRemissionInventory(showMessage = false) {
  const button = $('#refresh-remission-inventory');
  button.disabled = true;
  try {
    const changed = await refreshInventory();
    if (showMessage) toast(changed ? 'Aparecieron nuevas existencias en la lista de variedades.' : 'Inventario al día; la remisión en curso se conserva.');
  } catch (error) {
    if (showMessage) toast(error.message);
  } finally {
    button.disabled = false;
  }
}

function remissionVarietyGroups() {
  const groups = new Map();
  state.inventory.filter(item => state.stepGrade === 'ALL' || item.gradeCm === state.stepGrade).forEach(item => {
    const key = clientKey(item.variety);
    const used = state.lines.filter(line => (line.sourceKey || line.key) === item.key).reduce((sum, line) => sum + line.bunches, 0);
    const group = groups.get(key) || { key, variety: item.variety, availableBunches: 0, grades: new Map() };
    const available = Math.max(0, Number(item.bunches) - used);
    group.availableBunches += available;
    group.grades.set(item.gradeCm, (group.grades.get(item.gradeCm) || 0) + available);
    groups.set(key, group);
  });
  return [...groups.values()].sort((a, b) => a.variety.localeCompare(b.variety));
}

function renderVarietyPicker(rows) {
  const select = $('#line-variety');
  const selected = rows.find(item => item.key === select.value);
  const description = group => [...group.grades.entries()].map(([grade, bunches]) => `${grade}: ${bunches}`).join(' · ');
  const label = selected ? `<strong>${escapeHtml(selected.variety)}</strong><span>${description(selected)} · ${selected.availableBunches} ${selected.availableBunches === 1 ? 'ramo disponible' : 'ramos disponibles'}</span>` : '<span>Seleccione una variedad</span>';
  $('#line-variety-picker').innerHTML = `<button class="variety-picker-trigger" type="button" aria-expanded="false">${label}<b>⌄</b></button><div class="variety-picker-menu"><button type="button" class="variety-picker-option" data-line-variety-option=""><span>Seleccione una variedad</span></button>${rows.map(item => `<button type="button" class="variety-picker-option${item.availableBunches === 0 ? ' is-used' : ''}" data-line-variety-option="${escapeHtml(item.key)}" ${item.availableBunches === 0 ? 'disabled' : ''}><strong>${escapeHtml(item.variety)}</strong><span>${item.availableBunches === 0 ? 'Usada completamente en esta remisión' : `${description(item)} · ${item.availableBunches} ${item.availableBunches === 1 ? 'ramo disponible' : 'ramos disponibles'}`}</span></button>`).join('')}</div>`;
}

function renderStockPreview() {
  const item = remissionVarietyGroups().find(row => row.key === $('#line-variety').value);
  $('#bajas-presentation-field').hidden = !item?.grades.has('BAJAS');
  if (!item) return $('#line-stock-preview').textContent = 'Seleccione una variedad para ver su disponibilidad.';
  $('#line-stock-preview').innerHTML = `<strong>${escapeHtml(item.variety)}</strong><span>${[...item.grades.entries()].map(([grade, bunches]) => `${escapeHtml(grade)}: <b>${number(bunches)} ramos</b>`).join(' · ')} · <b>${number(item.availableBunches)} ramos disponibles</b></span>`;
}

function renderHistory() {
  const query = ($('#history-search').value || '').toLowerCase();
  const rows = state.remissions.filter(item => `${item.remissionNumber || ''} ${item.clientName} ${item.deliveredBy}`.toLowerCase().includes(query));
  $('#history-body').innerHTML = rows.map(item => { const meta = statusMeta(item.status); const cancelButton = item.status === 'ANULADA' ? '' : `<button class="small-button small-button--danger" data-cancel-remission="${item.id}">Anular</button>`; return `<tr><td><strong>${item.status === 'ANULADA' ? 'ANULADA' : escapeHtml(item.remissionNumber || 'Pendiente')}</strong></td><td>${dateTime(item.createdAt)}</td><td>${escapeHtml(item.clientName)}</td><td><strong>${bunchLabel(item.requestedBunches)}</strong> · ${number(item.requestedStems)} tallos</td><td><span class="workflow-status workflow-status--${meta.kind}">${meta.label}</span></td><td class="money"><strong>${item.status === 'FINALIZADA' ? money(item.total) : '—'}</strong></td><td><div class="table-actions"><button class="small-button" data-remission-action="${meta.action}" data-remission-id="${item.id}">${meta.button}</button>${cancelButton}</div></td></tr>`; }).join('');
  $('#history-empty').classList.toggle('is-hidden', rows.length > 0);
}

function statusMeta(status) {
  if (status === 'PENDIENTE_VARIEDADES' || status === 'PENDIENTE_PRECIOS') return { label: 'Pendiente anterior', button: 'Ver detalle', action: 'view', kind: 'pending' };
  if (status === 'ANULADA') return { label: 'Anulada', button: 'Ver detalle', action: 'view', kind: 'canceled' };
  return { label: 'Finalizada', button: 'Ver / Imprimir', action: 'view', kind: 'done' };
}

function renderLines() {
  $('#remission-lines').innerHTML = state.lines.map(line => `<div class="line-item line-item--complete${line.isDonation ? ' line-item--donation' : ''}"><strong>${escapeHtml(line.variety)}${line.isDonation ? ' · DONACIÓN' : ''}</strong><span>${line.type === 'eucalyptus' ? 'Hoja · precio por tallo' : line.type === 'export' ? `Exportación · ${escapeHtml(line.gradeCm)} cm` : `${escapeHtml(line.gradeCm)} · ${inventoryDate(line.date)}`}</span><span>${line.type === 'eucalyptus' ? '—' : bunchLabel(line.bunches)}</span><span>${number(line.stems)} tallos</span><b>${line.isDonation ? 'GRATIS' : money(line.subtotal)}</b><button type="button" class="remove-line" data-remove-line="${escapeHtml(line.key)}" aria-label="Quitar ${escapeHtml(line.variety)}">×</button></div>`).join('');
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
  const prices = Array.isArray(state.prices) ? state.prices : [];
  const client = clientKey(clientName);
  return prices.find(row => client && clientKey(row.clientName) === client && clientKey(row.variety) === clientKey(variety) && row.gradeCm === gradeCm)
    || prices.find(row => !row.clientName && clientKey(row.variety) === clientKey(variety) && row.gradeCm === gradeCm);
}

function renderPrices() {
  const prices = Array.isArray(state.prices) ? state.prices : [];
  const clients = [...new Set(prices.map(row => row.clientName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  $('#known-clients').innerHTML = clients.map(client => `<option value="${escapeHtml(client)}"></option>`).join('');
  $('#price-count').textContent = `${prices.length} ${prices.length === 1 ? 'PRECIO' : 'PRECIOS'}`;
  const groups = new Map();
  prices.forEach(row => {
    const key = clientKey(row.clientName) || '__GENERAL__';
    if (!groups.has(key)) groups.set(key, { clientName: row.clientName || 'Precio general', rows: [] });
    groups.get(key).rows.push(row);
  });
  const cardColors = ['#176b57', '#265f99', '#7955a2', '#a05a28', '#9a3f58', '#28736e'];
  const gradeOrder = ['NACIONAL', 'BAJAS', 'NACIONAL GRANEL', 'BAJAS GRANEL', '40', '50', '60', 'HOJA'];
  const gradeLabel = grade => grade === 'HOJA' ? 'Eucalipto · Hoja' : ['40', '50', '60'].includes(grade) ? `Exportación ${grade} cm` : grade === 'NACIONAL GRANEL' ? 'Nacional granel' : grade === 'BAJAS GRANEL' ? 'Bajas granel' : grade === 'BAJAS' ? 'Bajas' : 'Nacional';
  $('#price-list-body').innerHTML = [...groups.entries()].map(([key, group], index) => {
    const grades = gradeOrder.filter(grade => group.rows.some(row => row.gradeCm === grade));
    const selectedGrade = grades.includes(state.selectedPriceGrades.get(key)) ? state.selectedPriceGrades.get(key) : grades[0];
    state.selectedPriceGrades.set(key, selectedGrade);
    const visibleRows = group.rows.filter(row => row.gradeCm === selectedGrade).sort((a, b) => a.variety.localeCompare(b.variety));
    const expanded = state.expandedPriceClients.has(key);
    return `<article class="price-client-card${expanded ? ' is-expanded' : ''}" style="--client-color:${cardColors[index % cardColors.length]}"><header><div><span>CLIENTE</span><h4>${escapeHtml(group.clientName)}</h4><small>${group.rows.length} ${group.rows.length === 1 ? 'precio configurado' : 'precios configurados'} · ${grades.length} ${grades.length === 1 ? 'grado' : 'grados'}</small></div><div class="price-client-actions"><button class="small-button" type="button" data-toggle-price-client="${escapeHtml(key)}">${expanded ? 'Ocultar detalle' : 'Ver precios'}</button><button class="small-button" type="button" data-edit-price-client="${escapeHtml(key)}">Editar lista</button><button class="small-button small-button--danger" type="button" data-delete-price-client="${escapeHtml(key)}">Eliminar precios</button></div></header><div class="price-client-detail"><nav class="price-grade-tabs" aria-label="Grados de ${escapeHtml(group.clientName)}">${grades.map(grade => `<button class="price-grade-tab${grade === selectedGrade ? ' is-active' : ''}" type="button" data-price-client="${escapeHtml(key)}" data-price-grade="${escapeHtml(grade)}" aria-pressed="${grade === selectedGrade}">${escapeHtml(gradeLabel(grade))}<span>${group.rows.filter(row => row.gradeCm === grade).length}</span></button>`).join('')}</nav><div class="price-grade-heading"><strong>${escapeHtml(gradeLabel(selectedGrade))}</strong><span>${visibleRows.length} ${visibleRows.length === 1 ? 'variedad' : 'variedades'}</span></div><div class="price-client-items">${visibleRows.map(row => `<div><strong>${escapeHtml(row.variety)}</strong><b>${money(row.pricePerBunch)} <small>/ ${row.gradeCm === 'HOJA' ? 'tallo' : 'ramo'}</small></b></div>`).join('')}</div></div></article>`;
  }).join('');
  $('#price-list-empty').classList.toggle('is-hidden', prices.length > 0);
  renderPriceEntry();
}

function renderPriceEntry() {
  const grade = $('#price-form').elements.gradeCm.value;
  const labels = { NACIONAL: 'Nacional', BAJAS: 'Bajas', 'NACIONAL GRANEL': 'Nacional granel', 'BAJAS GRANEL': 'Bajas granel', 40: 'Exportación 40 cm', 50: 'Exportación 50 cm', 60: 'Exportación 60 cm', HOJA: 'Eucalipto · Hoja' };
  $('#price-entry-tabs').innerHTML = [...$('#price-form').elements.gradeCm.options].map(option => {
    const count = state.priceDrafts.filter(row => row.gradeCm === option.value).length;
    return `<button class="price-grade-tab${grade === option.value ? ' is-active' : ''}" type="button" data-price-entry-grade="${escapeHtml(option.value)}" aria-pressed="${grade === option.value}">${labels[option.value] || escapeHtml(option.value)}${count ? `<span>${count}</span>` : ''}</button>`;
  }).join('');
  const select = $('#price-variety');
  const selected = select.value;
  const options = grade === 'HOJA' ? ['EUCALIPTO'] : varieties;
  select.innerHTML = '<option value="">Seleccione una variedad</option>' + options.map(variety => `<option value="${escapeHtml(variety)}">${escapeHtml(variety)}</option>`).join('');
  select.value = options.includes(selected) ? selected : '';
  $('#price-unit-label').firstChild.textContent = grade === 'HOJA' ? 'Precio por tallo (COP)' : 'Precio por ramo (COP)';
  renderPriceDrafts();
}

function renderPriceDrafts() {
  const element = $('#price-draft-lines');
  if (!element) return;
  const grade = $('#price-form').elements.gradeCm.value;
  const visible = state.priceDrafts.map((row, index) => ({ row, index })).filter(item => item.row.gradeCm === grade);
  $('#price-draft-heading').textContent = `${state.priceDrafts.length} precios preparados en total · ${visible.length} en este grado. Al guardar se incluyen todos los grados.`;
  element.innerHTML = visible.map(({ row, index }) => `<div class="price-draft-row"><strong>${escapeHtml(row.variety)}</strong><b>${money(row.pricePerBunch)}${row.gradeCm === 'HOJA' ? ' / tallo' : ' / ramo'}</b><button type="button" class="remove-line" data-remove-price-draft="${index}" aria-label="Quitar ${escapeHtml(row.variety)}">×</button></div>`).join('') || '<span class="price-draft-empty">Aún no hay variedades agregadas en este grado.</span>';
}

function addPriceDraft() {
  const form = $('#price-form');
  const variety = $('#price-variety').value;
  const gradeCm = form.elements.gradeCm.value;
  const pricePerBunch = Math.max(0, Number(form.elements.pricePerBunch.value) || 0);
  const error = $('#price-error');
  error.textContent = '';
  if (!variety) return error.textContent = 'Seleccione una variedad.';
  if (variety === 'EUCALIPTO' ? gradeCm !== 'HOJA' : gradeCm === 'HOJA') return error.textContent = 'Eucalipto debe tener grado Hoja; las rosas usan los demás grados.';
  if (!pricePerBunch) return error.textContent = `Ingrese un precio por ${gradeCm === 'HOJA' ? 'tallo' : 'ramo'} en COP.`;
  const existing = state.priceDrafts.find(row => row.variety === variety && row.gradeCm === gradeCm);
  if (existing) existing.pricePerBunch = pricePerBunch;
  else state.priceDrafts.push({ variety, gradeCm, pricePerBunch });
  $('#price-variety').value = '';
  form.elements.pricePerBunch.value = '';
  renderPriceEntry();
}

function addRemainingPriceDrafts() {
  const form = $('#price-form');
  const gradeCm = form.elements.gradeCm.value;
  const pricePerBunch = Math.max(0, Number(form.elements.pricePerBunch.value) || 0);
  const error = $('#price-error');
  error.textContent = '';
  if (!pricePerBunch) return error.textContent = 'Ingrese el precio por ramo que aplicará a las variedades restantes.';
  if (gradeCm === 'HOJA') return error.textContent = 'El precio de Eucalipto se agrega directamente, por tallo.';
  const currentClient = clientKey(form.elements.clientName.value) || '__GENERAL__';
  const alreadyAdded = new Set([
    ...state.priceDrafts.filter(row => row.gradeCm === gradeCm).map(row => clientKey(row.variety)),
    ...state.prices.filter(row => (clientKey(row.clientName) || '__GENERAL__') === currentClient && row.gradeCm === gradeCm).map(row => clientKey(row.variety))
  ]);
  const remaining = varieties.filter(variety => !alreadyAdded.has(clientKey(variety)));
  if (!remaining.length) return error.textContent = `Ya están agregadas todas las variedades para ${gradeCm}.`;
  state.priceDrafts.push(...remaining.map(variety => ({ variety, gradeCm, pricePerBunch })));
  form.elements.pricePerBunch.value = '';
  renderPriceEntry();
  toast(`${remaining.length} variedades agregadas con el mismo precio.`);
}

function switchView(view) {
  if (view === 'reports' && !state.reportsUnlocked) {
    $('#reports-access-error').textContent = '';
    $('#reports-password').value = '';
    $('#reports-access-dialog').showModal();
    return;
  }
  state.activeView = view;
  $$('.view').forEach(element => element.classList.toggle('active', element.id === `view-${view}`));
  $$('.nav-link').forEach(element => element.classList.toggle('active', element.dataset.view === view));
  const titles = { dashboard: 'Resumen', inventory: 'Inventario', prices: 'Lista de precios', 'new-remission': 'Nueva remisión', history: 'Historial', reports: 'Informes' };
  $('#view-title').textContent = titles[view];
  $('#sidebar').classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (view === 'history') loadFullHistory();
  if (view === 'new-remission') refreshRemissionInventory();
}

function reportGroups(rows) {
  const groups = new Map();
  rows.forEach(row => {
    const key = `${clientKey(row.variety)}|${row.gradeCm}`;
    const group = groups.get(key) || { variety: row.variety, gradeCm: row.gradeCm, bunches: 0, stems: 0, subtotal: 0 };
    group.bunches += Number(row.bunches || 0); group.stems += Number(row.stems || 0); group.subtotal += Number(row.subtotal || 0);
    groups.set(key, group);
  });
  return [...groups.values()].sort((a, b) => a.variety.localeCompare(b.variety) || a.gradeCm.localeCompare(b.gradeCm));
}

function renderReport() {
  const rows = state.reportRows.filter(row => !row.isDonation);
  const donations = reportGroups(state.reportRows.filter(row => row.isDonation));
  const total = rows.reduce((sum, row) => sum + Number(row.subtotal || 0), 0);
  const bunches = rows.reduce((sum, row) => sum + Number(row.bunches || 0), 0);
  const stems = rows.reduce((sum, row) => sum + Number(row.stems || 0), 0);
  $('#report-money').textContent = money(total); $('#report-bunches').textContent = number(bunches); $('#report-stems').textContent = number(stems);
  $('#report-grades').innerHTML = ['NACIONAL', 'BAJAS', 'BAJAS GRANEL', 'NACIONAL GRANEL', '40', '50', '60', 'HOJA'].map(grade => {
    const subset = rows.filter(row => row.gradeCm === grade);
    return `<article class="report-grade"><span>${grade === 'HOJA' ? 'EUCALIPTO · HOJA' : ['40', '50', '60'].includes(grade) ? `EXPORTACIÓN ${grade} CM` : escapeHtml(grade)}</span><strong>${number(subset.reduce((sum, row) => sum + Number(row.stems || 0), 0))} tallos</strong><small>${grade === 'HOJA' ? 'Precio por tallo' : `${number(subset.reduce((sum, row) => sum + Number(row.bunches || 0), 0))} ramos`} · ${money(subset.reduce((sum, row) => sum + Number(row.subtotal || 0), 0))}</small></article>`;
  }).join('');
  const groups = reportGroups(rows);
  $('#report-body').innerHTML = groups.map(row => `<tr><td><strong>${escapeHtml(row.variety)}</strong></td><td><span class="grade-chip">${escapeHtml(row.gradeCm)}</span></td><td class="quantity">${number(row.bunches)}</td><td class="quantity">${number(row.stems)}</td><td class="money"><strong>${money(row.subtotal)}</strong></td></tr>`).join('');
  $('#report-empty').classList.toggle('is-hidden', groups.length > 0);
  if (!groups.length) $('#report-empty').innerHTML = '<strong>Sin ventas finalizadas</strong><span>No hay remisiones finalizadas en el período elegido.</span>';
  $('#report-donations-body').innerHTML = donations.map(row => `<tr><td><strong>${escapeHtml(row.variety)}</strong></td><td><span class="grade-chip">${escapeHtml(row.gradeCm)}</span></td><td class="quantity">${number(row.bunches)}</td><td class="quantity">${number(row.stems)}</td></tr>`).join('');
  $('#report-donations-empty').classList.toggle('is-hidden', donations.length > 0);
}

function renderInventoryReport() {
  const report = state.inventoryReport;
  if (!report) return;
  for (const [period, rows] of [['opening', report.opening], ['closing', report.closing]]) {
    $(`#report-${period}-bunches`).textContent = number(rows.reduce((sum, row) => sum + Number(row.bunches || 0), 0));
    $(`#report-${period}-stems`).textContent = number(rows.reduce((sum, row) => sum + Number(row.stems || 0), 0));
  }
  const groups = new Map();
  for (const [period, rows] of [['opening', report.opening], ['closing', report.closing]]) {
    for (const row of rows) {
      const key = `${row.variety}|${row.gradeCm}`;
      const group = groups.get(key) || { variety: row.variety, gradeCm: row.gradeCm, openingBunches: 0, openingStems: 0, closingBunches: 0, closingStems: 0 };
      group[`${period}Bunches`] += Number(row.bunches || 0);
      group[`${period}Stems`] += Number(row.stems || 0);
      groups.set(key, group);
    }
  }
  $('#report-inventory-body').innerHTML = [...groups.values()].sort((a, b) => a.variety.localeCompare(b.variety) || a.gradeCm.localeCompare(b.gradeCm)).map(row => `<tr><td><strong>${escapeHtml(row.variety)}</strong></td><td><span class="grade-chip">${escapeHtml(row.gradeCm)}</span></td><td class="quantity">${number(row.openingBunches)}</td><td class="quantity">${number(row.openingStems)}</td><td class="quantity">${number(row.closingBunches)}</td><td class="quantity">${number(row.closingStems)}</td></tr>`).join('');
  $('#report-inventory-empty').classList.toggle('is-hidden', groups.size > 0);
  if (!groups.size) $('#report-inventory-empty').innerHTML = '<strong>Sin inventario</strong><span>No hay flor nacional registrada en las fechas elegidas.</span>';
}

function renderWasteReport() {
  const rows = state.wasteReport;
  $('#report-waste-bunches').textContent = `${number(rows.reduce((sum, row) => sum + Number(row.bunches || 0), 0))} ramos`;
  $('#report-waste-stems').textContent = `${number(rows.reduce((sum, row) => sum + Number(row.stems || 0), 0))} tallos`;
  $('#report-waste-body').innerHTML = rows.map(row => `<tr><td>${dateTime(row.createdAt)}</td><td><strong>${escapeHtml(row.variety)}</strong></td><td><span class="grade-chip">${escapeHtml(row.gradeCm)}</span></td><td>${inventoryDate(row.date)} · ${number(row.stemsPerBunch)} tallos/ramo</td><td class="quantity">${number(row.bunches)}</td><td class="quantity">${number(row.stems)}</td><td>${escapeHtml(row.responsible)}</td><td>${escapeHtml(row.reason)}</td></tr>`).join('');
  $('#report-waste-empty').classList.toggle('is-hidden', rows.length > 0);
}

function renderMovementsReport() {
  const { adjustments, transfers, gradeTransfers = [] } = state.movementsReport;
  $('#report-adjustments-body').innerHTML = adjustments.map(row => `<tr><td>${dateTime(row.createdAt)}</td><td><strong>${escapeHtml(row.variety)}</strong></td><td>${escapeHtml(row.gradeCm)}</td><td>${inventoryDate(row.date)} · ${number(row.stemsPerBunch)} tallos/ramo</td><td>${number(row.beforeBunches)}</td><td>${number(row.countedBunches)}</td><td>${row.deltaBunches > 0 ? '+' : ''}${number(row.deltaBunches)}</td><td>${escapeHtml(row.responsible)}<br>${escapeHtml(row.reason)}${row.cancellationReason ? `<br><small>Anulación: ${escapeHtml(row.cancellationReason)}</small>` : ''}</td><td>${row.canceledAt ? 'Anulado' : 'Vigente'}</td></tr>`).join('');
  $('#report-adjustments-empty').classList.toggle('is-hidden', adjustments.length > 0);
  $('#report-transfers-body').innerHTML = transfers.map(row => `<tr><td>${dateTime(row.createdAt)}</td><td><strong>${escapeHtml(row.variety)}</strong></td><td>${number(row.bunches)}</td><td>${number(row.stems)}</td><td>${escapeHtml(row.responsible)}</td><td>${escapeHtml(row.reason)}</td></tr>`).join('');
  $('#report-transfers-empty').classList.toggle('is-hidden', transfers.length > 0);
  $('#report-grade-transfers-body').innerHTML = gradeTransfers.map(row => `<tr><td>${dateTime(row.createdAt)}</td><td><strong>${escapeHtml(row.variety)}</strong></td><td>${escapeHtml(row.fromGrade)} → ${escapeHtml(row.toGrade)}</td><td>${number(row.bunches)}</td><td>${number(row.stems)}</td><td>${escapeHtml(row.responsible)}</td><td>${escapeHtml(row.reason)}</td></tr>`).join('');
  $('#report-grade-transfers-empty').classList.toggle('is-hidden', gradeTransfers.length > 0);
}

async function generateReport() {
  const from = $('#report-from').value; const to = $('#report-to').value;
  if (!from || !to) return toast('Seleccione las dos fechas para generar el informe.');
  if (from > to) return toast('La fecha inicial no puede ser posterior a la final.');
  try {
    const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const [rows, inventory, waste, movements] = await Promise.all([api(`/api/reports/sales?${query}`), api(`/api/reports/inventory?${query}`), api(`/api/reports/waste?${query}`), api(`/api/reports/movements?${query}`)]);
    state.reportRows = rows; state.inventoryReport = inventory; state.wasteReport = waste; state.movementsReport = movements; state.reportRange = `${from}|${to}`;
    renderReport(); renderInventoryReport(); renderWasteReport(); renderMovementsReport();
  }
  catch (error) { toast(error.message); }
}

function exportReport() {
  if (!state.inventoryReport || state.reportRange !== `${$('#report-from').value}|${$('#report-to').value}`) return toast('Genere primero el informe para las fechas elegidas.');
  window.location.href = `/api/reports/sales.xlsx?from=${encodeURIComponent($('#report-from').value)}&to=${encodeURIComponent($('#report-to').value)}`;
}

async function loadFullHistory(silent = false) {
  try { state.remissions = await api('/api/remissions', { cache: 'no-store' }); renderHistory(); } catch (error) { if (!silent) toast(error.message); }
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
  $('#export-entry').open = false; $('#eucalyptus-entry').open = false;
  state.lines = []; state.stepGrade = 'ALL';
  $('#step-grade-filter').value = 'ALL';
  $('#bajas-presentation').value = 'BAJAS';
  $('#line-bunches').value = 1;
  $('#export-bunches').value = 1; $('#export-stems').value = 25;
  $('#eucalyptus-stems').value = 25;
  renderVarietyOptions(); renderLines();
  $('#remission-error').textContent = '';
  $('#line-error').textContent = '';
  $('#export-error').textContent = '';
  $('#eucalyptus-error').textContent = '';
}

function continueRemission(remission) {
  state.activeRemission = remission;
  state.editingDocumentPrices = false;
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
  $('#cancel-remission-heading').textContent = `${remission.remissionNumber || 'Remisión'} · ${remission.clientName}`;
  $('#cancellation-reason').value = '';
  $('#cancel-remission-error').textContent = '';
  $('#cancel-remission-dialog').showModal();
}

function renderDocument(data) {
  state.activeRemission = data;
  const company = state.config;
  const totalBunches = data.items.reduce((sum, item) => sum + Number(item.bunches || 0), 0);
  const totalStems = data.items.reduce((sum, item) => sum + Number(item.stems || 0), 0);
  const displayItems = Object.values(data.items.reduce((groups, item) => {
    const key = `${clientKey(item.variety)}|${item.gradeCm}|${Boolean(item.isDonation)}`;
    const group = groups[key] || { ...item, ids: [], originalPrices: [], bunches: 0, stems: 0, subtotal: 0 };
    group.ids.push(item.id);
    group.originalPrices.push(Number(item.gradeCm === 'HOJA' ? item.unitPriceStem : item.unitPriceBunch));
    group.bunches += Number(item.bunches || 0);
    group.stems += Number(item.stems || 0);
    group.subtotal += Number(item.subtotal || 0);
    group.stemsPerBunch = group.bunches ? group.stems / group.bunches : 0;
    group.unitPriceBunch = group.gradeCm === 'HOJA' ? 0 : group.bunches ? group.subtotal / group.bunches : 0;
    group.unitPriceStem = group.gradeCm === 'HOJA' ? group.subtotal / group.stems : 0;
    groups[key] = group;
    return groups;
  }, {}));
  const documentElement = $('#printable-document');
  documentElement.dataset.filename = data.remissionNumber || `anulada-${data.id}`;
  documentElement.innerHTML = `
    ${data.status === 'ANULADA' ? '<div class="doc-canceled-mark">ANULADA</div>' : ''}
    <header class="doc-head"><div class="doc-brand"><span class="brand-logo brand-logo--document"><img src="/logo-prestige.jpeg" alt="Prestige Roses"></span><div><h2>${escapeHtml(company.companyName)}</h2><p>${escapeHtml(company.companyNit ? `NIT: ${company.companyNit}` : 'Salida nacional de flor')}</p></div></div><div class="doc-number"><span>REMISIÓN</span><strong>${data.status === 'ANULADA' ? 'ANULADA' : escapeHtml(data.remissionNumber || 'Pendiente')}</strong><p>${dateTime(data.createdAt)}</p></div></header>
    <section class="doc-client"><div class="doc-field"><span>Cliente</span><strong>${escapeHtml(data.clientName)}</strong></div><div class="doc-field"><span>NIT / Documento</span><strong>${escapeHtml(data.clientDocument || '—')}</strong></div><div class="doc-field"><span>Entregado por</span><strong>${escapeHtml(data.deliveredBy || '—')}</strong></div></section>
    <table class="doc-table"><thead><tr><th>Variedad</th><th>Grado</th><th>Tallos/ramo</th><th>Ramos</th><th>Total tallos</th><th>Precio / unidad</th><th>Subtotal</th></tr></thead><tbody>${displayItems.map(item => `<tr${item.isDonation ? ' class="doc-donation-row"' : ''}><td><strong>${escapeHtml(item.variety)}</strong>${item.isDonation ? '<br><span>DONACIÓN</span>' : ''}</td><td>${['40', '50', '60'].includes(item.gradeCm) ? `Exportación ${item.gradeCm} cm` : escapeHtml(item.gradeCm || '—')}</td><td>${item.gradeCm === 'HOJA' ? '—' : number(item.stemsPerBunch)}</td><td>${item.gradeCm === 'HOJA' ? '—' : number(item.bunches)}</td><td>${number(item.stems)}</td><td>${item.isDonation ? 'GRATIS' : state.editingDocumentPrices ? `<input class="doc-price-input" type="number" min="1" step="1" value="${Number(item.gradeCm === 'HOJA' ? item.unitPriceStem : item.unitPriceBunch)}" data-document-price="${item.ids.join(',')}" data-document-original-prices="${item.originalPrices.join(',')}" data-document-display-price="${Number(item.gradeCm === 'HOJA' ? item.unitPriceStem : item.unitPriceBunch)}" aria-label="Precio por ${item.gradeCm === 'HOJA' ? 'tallo' : 'ramo'} de ${escapeHtml(item.variety)}">` : `${money(item.gradeCm === 'HOJA' ? item.unitPriceStem : item.unitPriceBunch)} / ${item.gradeCm === 'HOJA' ? 'tallo' : 'ramo'}`}</td><td>${money(item.subtotal)}</td></tr>`).join('')}</tbody><tfoot><tr class="doc-table-totals"><td colspan="3"><strong>TOTALES</strong></td><td><strong>${number(totalBunches)} ramos</strong></td><td><strong>${number(totalStems)} tallos</strong></td><td></td><td><strong>${money(data.total)}</strong></td></tr></tfoot></table>
    <div class="doc-total"><span>TOTAL</span><span>${money(data.total)}</span></div>
    ${data.notes ? `<div class="doc-notes"><strong>Observaciones:</strong> ${escapeHtml(data.notes)}</div>` : ''}
    ${data.status === 'ANULADA' ? `<div class="doc-cancellation"><strong>Remisión anulada:</strong> ${escapeHtml(data.cancellationReason || 'Sin motivo registrado')} · ${data.canceledAt ? dateTime(data.canceledAt) : ''}</div>` : ''}
    <div class="doc-company-contact"><span>${escapeHtml(company.companyAddress)}</span><span>${escapeHtml(company.companyPhone)}</span><span>${escapeHtml(company.companyEmail || '')}</span></div>
    <footer class="doc-approval"><div class="doc-signature-card"><div class="doc-signature-space"></div><strong>Firma de quien recibe la flor</strong><span>Nombre y documento</span></div><div class="doc-signature-card"><div class="doc-signature-space"></div><strong>Firma de quien recibe el pago</strong><span>Nombre, firma y documento</span></div></footer>`;
  const canEditPrices = data.status === 'FINALIZADA';
  $('#edit-document-prices').classList.toggle('is-hidden', !canEditPrices || state.editingDocumentPrices);
  $('#save-document-prices').classList.toggle('is-hidden', !state.editingDocumentPrices);
  $('#cancel-document-prices').classList.toggle('is-hidden', !state.editingDocumentPrices);
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
$('#reconcile-source').addEventListener('change', () => { $('#reconcile-counted').value = ''; $('#reconcile-error').textContent = ''; updateReconciliationDifference(); });
$('#reconcile-grade').addEventListener('change', () => { $('#reconcile-variety').value = ''; $('#reconcile-source').value = ''; $('#reconcile-counted').value = ''; renderReconciliation(); });
$('#reconcile-variety').addEventListener('change', () => { $('#reconcile-source').value = ''; $('#reconcile-counted').value = ''; renderReconciliation(); });
$('#waste-grade').addEventListener('change', () => { $('#waste-source').value = ''; renderWaste(); });
$('#grade-transfer-from').addEventListener('change', () => {
  $('#grade-transfer-variety').value = '';
  if ($('#grade-transfer-to').value === $('#grade-transfer-from').value) $('#grade-transfer-to').value = '';
  renderGradeTransfers();
});
$('#grade-transfer-to').addEventListener('change', () => { $('#grade-transfer-error').textContent = ''; });
$('#reconcile-counted').addEventListener('input', updateReconciliationDifference);
$('#reconcile-form').addEventListener('submit', async event => {
  event.preventDefault();
  const source = state.reconciliationSources.find(row => row.key === $('#reconcile-source').value);
  const countedBunches = Number($('#reconcile-counted').value);
  const responsible = $('#reconcile-responsible').value.trim();
  const reason = $('#reconcile-reason').value.trim();
  const error = $('#reconcile-error'); error.textContent = '';
  if (!source) return error.textContent = 'Seleccione un lote.';
  if (!Number.isSafeInteger(countedBunches) || countedBunches < 0) return error.textContent = 'Ingrese un conteo válido de ramos.';
  if (countedBunches === Number(source.bunches)) return error.textContent = 'El conteo coincide con el sistema; no hay diferencia que registrar.';
  if (!responsible || !reason) return error.textContent = 'Responsable y motivo son obligatorios.';
  if (!window.confirm(`¿Registrar el ajuste de ${source.variety} · ${source.gradeCm} de ${source.bunches} a ${countedBunches} ramos? Quedará en el historial.`)) return;
  const button = event.submitter; button.disabled = true;
  try {
    await api('/api/inventory/reconciliation', { method: 'POST', body: JSON.stringify({ key: source.key, expectedBunches: source.bunches, countedBunches, responsible, reason }) });
    $('#reconcile-source').value = ''; $('#reconcile-counted').value = ''; $('#reconcile-reason').value = '';
    await refreshAll();
    toast('Inventario conciliado. El ajuste quedó registrado en el historial.');
  } catch (requestError) { error.textContent = requestError.message; }
  finally { button.disabled = false; }
});
$('#export-transfer-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = event.submitter;
  const error = $('#transfer-error');
  error.textContent = '';
  button.disabled = true;
  try {
    const payload = Object.fromEntries(new FormData(form));
    await api('/api/export-transfers', { method: 'POST', body: JSON.stringify(payload) });
    form.reset();
    await refreshAll();
    toast('Traslado registrado. Los ramos salieron de Bajas.');
  } catch (requestError) { error.textContent = requestError.message; }
  finally { button.disabled = false; }
});
$('#grade-transfer-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));
  const error = $('#grade-transfer-error'); error.textContent = '';
  if (payload.fromGrade === payload.toGrade) return error.textContent = 'El grado de destino debe ser diferente al de origen.';
  if (!window.confirm(`¿Trasladar ${payload.bunches} ramos de ${payload.variety} de ${payload.fromGrade} a ${payload.toGrade}?`)) return;
  const button = event.submitter; button.disabled = true;
  try {
    await api('/api/inventory/grade-transfers', { method: 'POST', body: JSON.stringify(payload) });
    form.reset();
    await refreshAll();
    toast('Cambio de grado registrado. El inventario se actualizó.');
  } catch (requestError) { error.textContent = requestError.message; }
  finally { button.disabled = false; }
});
$('#waste-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = event.submitter;
  const error = $('#waste-error');
  error.textContent = '';
  if (!window.confirm('¿Confirmar el desecho? Los ramos se descontarán del inventario.')) return;
  button.disabled = true;
  try {
    await api('/api/inventory/waste', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    form.reset();
    await refreshAll();
    toast('Desecho registrado y descontado del inventario.');
  } catch (requestError) { error.textContent = requestError.message; }
  finally { button.disabled = false; }
});
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
$('#refresh-remission-inventory').addEventListener('click', () => refreshRemissionInventory(true));
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
  const cancelTransferButton = event.target.closest('[data-cancel-transfer]');
  const cancelWasteButton = event.target.closest('[data-cancel-waste]');
  const cancelAdjustmentButton = event.target.closest('[data-cancel-adjustment]');
  const removeButton = event.target.closest('[data-remove-line]');
  const removePriceDraft = event.target.closest('[data-remove-price-draft]');
  const editPriceClient = event.target.closest('[data-edit-price-client]');
  const deletePriceClient = event.target.closest('[data-delete-price-client]');
  const togglePriceClient = event.target.closest('[data-toggle-price-client]');
  const priceGradeButton = event.target.closest('[data-price-grade]');
  const priceEntryGradeButton = event.target.closest('[data-price-entry-grade]');
  const varietyPickerToggle = event.target.closest('.variety-picker-trigger');
  const varietyPickerOption = event.target.closest('[data-line-variety-option]');
  const closeButton = event.target.closest('[data-close-dialog]');
  if (remissionButton) {
    openRemission(remissionButton.dataset.remissionId);
  }
  if (cancelButton) openCancelRemission(cancelButton.dataset.cancelRemission);
  if (cancelTransferButton && window.confirm('¿Anular este traslado y devolver los ramos a Bajas?')) {
    cancelTransferButton.disabled = true;
    try {
      await api(`/api/export-transfers/${cancelTransferButton.dataset.cancelTransfer}/cancel`, { method: 'PUT', body: '{}' });
      await refreshAll();
      toast('Traslado anulado. Los ramos volvieron a Bajas.');
    } catch (requestError) { toast(requestError.message); cancelTransferButton.disabled = false; }
  }
  if (cancelWasteButton) {
    const reason = window.prompt('Motivo para anular el desecho y devolver los ramos al inventario:');
    if (reason === null) return;
    if (!reason.trim()) return toast('Indique el motivo de la anulación.');
    cancelWasteButton.disabled = true;
    try {
      await api(`/api/inventory/waste/${cancelWasteButton.dataset.cancelWaste}/cancel`, { method: 'PUT', body: JSON.stringify({ reason: reason.trim() }) });
      await refreshAll();
      toast('Desecho anulado. Los ramos volvieron al inventario.');
    } catch (requestError) { toast(requestError.message); cancelWasteButton.disabled = false; }
  }
  if (cancelAdjustmentButton) {
    const reason = window.prompt('Motivo para anular el ajuste y revertir su efecto en el inventario:');
    if (reason === null) return;
    if (!reason.trim()) return toast('Indique el motivo de la anulación.');
    if (!window.confirm('¿Confirmar la anulación de este ajuste? Quedará registrada en el historial.')) return;
    cancelAdjustmentButton.disabled = true;
    try {
      await api(`/api/inventory/reconciliation/${cancelAdjustmentButton.dataset.cancelAdjustment}/cancel`, { method: 'PUT', body: JSON.stringify({ reason: reason.trim() }) });
      await refreshAll();
      toast('Ajuste anulado. El inventario se actualizó.');
    } catch (requestError) { toast(requestError.message); cancelAdjustmentButton.disabled = false; }
  }
  if (removeButton) { state.lines = state.lines.filter(row => row.key !== removeButton.dataset.removeLine); $('#remission-error').textContent = ''; renderLines(); }
  if (removePriceDraft) { state.priceDrafts.splice(Number(removePriceDraft.dataset.removePriceDraft), 1); renderPriceEntry(); }
  if (varietyPickerToggle) {
    const picker = $('#line-variety-picker');
    const open = picker.classList.toggle('is-open');
    varietyPickerToggle.setAttribute('aria-expanded', String(open));
  } else if (varietyPickerOption) {
    $('#line-variety').value = varietyPickerOption.dataset.lineVarietyOption;
    renderVarietyPicker(remissionVarietyGroups());
    renderStockPreview();
  } else if (!event.target.closest('#line-variety-picker')) {
    $('#line-variety-picker')?.classList.remove('is-open');
  }
  if (togglePriceClient) {
    const key = togglePriceClient.dataset.togglePriceClient;
    if (state.expandedPriceClients.has(key)) state.expandedPriceClients.delete(key);
    else state.expandedPriceClients.add(key);
    renderPrices();
  }
  if (priceGradeButton) {
    state.selectedPriceGrades.set(priceGradeButton.dataset.priceClient, priceGradeButton.dataset.priceGrade);
    renderPrices();
  }
  if (priceEntryGradeButton) {
    $('#price-form').elements.gradeCm.value = priceEntryGradeButton.dataset.priceEntryGrade;
    $('#price-error').textContent = '';
    renderPriceEntry();
  }
  if (editPriceClient) {
    const key = editPriceClient.dataset.editPriceClient;
    const rows = state.prices.filter(row => (clientKey(row.clientName) || '__GENERAL__') === key);
    if (rows.length) {
      state.editingPriceClientKey = key;
      state.priceDrafts = rows.map(row => ({ variety: varieties.find(variety => clientKey(variety) === clientKey(row.variety)) || row.variety, gradeCm: row.gradeCm, pricePerBunch: row.pricePerBunch }));
      $('#price-client-name').value = rows[0].clientName || '';
      $('#price-form').elements.gradeCm.value = rows.some(row => row.gradeCm === 'NACIONAL') ? 'NACIONAL' : rows[0].gradeCm;
      $('#price-variety').value = '';
      $('#price-form').elements.pricePerBunch.value = '';
      $('#price-error').textContent = 'Editando la lista completa: puede cambiar, agregar o quitar variedades y luego guardar.';
      renderPriceEntry();
      switchView('prices');
    }
  }
  if (deletePriceClient) {
    const key = deletePriceClient.dataset.deletePriceClient;
    const rows = state.prices.filter(row => (clientKey(row.clientName) || '__GENERAL__') === key);
    const label = rows[0]?.clientName || 'el precio general';
    if (rows.length && window.confirm(`Se eliminarán los ${rows.length} precios de ${label}. ¿Desea continuar?`)) {
      deletePriceClient.disabled = true;
      try {
        await Promise.all(rows.map(row => api(`/api/price-lists/${row.id}`, { method: 'DELETE' })));
        if (state.editingPriceClientKey === key) { state.priceDrafts = []; state.editingPriceClientKey = null; $('#price-form').reset(); }
        await refreshAll();
        toast(`Precios de ${label} eliminados.`);
      } catch (error) { $('#price-error').textContent = error.message; }
      finally { deletePriceClient.disabled = false; }
    }
  }
  if (closeButton) $(`#${closeButton.dataset.closeDialog}`).close();
});

$('#add-line-button').addEventListener('click', () => {
  const isDonation = $('#line-donation').checked;
  const item = remissionVarietyGroups().find(row => row.key === $('#line-variety').value);
  const bunches = Math.max(0, Number.parseInt($('#line-bunches').value, 10) || 0);
  const error = $('#line-error'); error.textContent = '';
  if (!item) return error.textContent = 'Seleccione una variedad.';
  if (!bunches) return error.textContent = 'Ingrese al menos un ramo.';
  if (bunches > item.availableBunches) return error.textContent = `Disponibles: ${item.availableBunches} ramos.`;
  let pending = bunches;
  const sourceRows = state.inventory.filter(row => clientKey(row.variety) === item.key && (state.stepGrade === 'ALL' || row.gradeCm === state.stepGrade)).sort((a, b) => a.date.localeCompare(b.date));
  const presentation = $('#bajas-presentation').value;
  const remainingFor = source => Math.max(0, source.bunches - state.lines.filter(row => (row.sourceKey || row.key) === source.key).reduce((sum, row) => sum + row.bunches, 0));
  const saleGrade = source => source.gradeCm === 'BAJAS' ? presentation : source.gradeCm;
  const allocations = [];
  for (const source of sourceRows) {
    if (!pending) break;
    const gradeCm = saleGrade(source);
    const available = remainingFor(source);
    if (!available) continue;
    const price = selectedPrice($('#remission-client-name').value, source.variety, gradeCm);
    if (!isDonation && !price) return error.textContent = `No hay precio para ${source.variety} · ${gradeCm}. Regístrelo en Lista de precios.`;
    const use = Math.min(pending, available);
    allocations.push({ source, gradeCm, price, use });
    pending -= use;
  }
  for (const { source, gradeCm, price, use } of allocations) {
    const lineKey = `${source.key}:${gradeCm}:${isDonation ? 'donacion' : 'venta'}`;
    const existing = state.lines.find(row => row.key === lineKey);
    if (existing) { existing.bunches += use; existing.stems = existing.bunches * existing.stemsPerBunch; existing.subtotal = existing.bunches * existing.unitPriceBunch; }
    else state.lines.push({ key: lineKey, sourceKey: source.key, date: source.date, variety: source.variety, gradeCm, stemsPerBunch: source.stemsPerBunch, bunches: use, stems: use * source.stemsPerBunch, unitPriceBunch: isDonation ? 0 : price.pricePerBunch, subtotal: isDonation ? 0 : use * price.pricePerBunch, isDonation });
  }
  $('#remission-error').textContent = '';
  $('#line-variety').value = ''; $('#line-bunches').value = 1; $('#line-donation').checked = false; renderVarietyOptions(); renderLines();
});

$('#export-variety').innerHTML = '<option value="">Seleccione una variedad</option>' + varieties.map(variety => `<option value="${escapeHtml(variety)}">${escapeHtml(variety)}</option>`).join('');
$('#price-form').elements.gradeCm.addEventListener('change', renderPriceEntry);
$('#add-export-button').addEventListener('click', () => {
  const isDonation = $('#export-donation').checked;
  const variety = $('#export-variety').value;
  const gradeCm = $('#export-grade').value;
  const bunches = Number($('#export-bunches').value);
  const stemsPerBunch = Number($('#export-stems').value);
  const error = $('#export-error'); error.textContent = '';
  if (!variety) return error.textContent = 'Seleccione una variedad de exportación.';
  if (!Number.isSafeInteger(bunches) || bunches < 1 || !Number.isSafeInteger(stemsPerBunch) || stemsPerBunch < 1) return error.textContent = 'Ingrese ramos y tallos por ramo válidos.';
  const price = selectedPrice($('#remission-client-name').value, variety, gradeCm);
  if (!isDonation && !price) return error.textContent = `No hay precio para ${variety} · exportación ${gradeCm} cm. Regístrelo en Lista de precios.`;
  const key = `export:${clientKey(variety)}:${gradeCm}:${stemsPerBunch}:${isDonation ? 'donacion' : 'venta'}`;
  const existing = state.lines.find(row => row.key === key);
  if (existing) { existing.bunches += bunches; existing.stems = existing.bunches * stemsPerBunch; existing.subtotal = existing.bunches * existing.unitPriceBunch; }
  else state.lines.push({ type: 'export', key, variety, gradeCm, stemsPerBunch, bunches, stems: bunches * stemsPerBunch, unitPriceBunch: isDonation ? 0 : Number(price.pricePerBunch), subtotal: isDonation ? 0 : bunches * Number(price.pricePerBunch), isDonation });
  $('#export-variety').value = ''; $('#export-bunches').value = 1; $('#export-donation').checked = false; renderLines();
});
$('#add-eucalyptus-button').addEventListener('click', () => {
  const isDonation = $('#eucalyptus-donation').checked;
  const stems = Number($('#eucalyptus-stems').value);
  const error = $('#eucalyptus-error'); error.textContent = '';
  if (!Number.isSafeInteger(stems) || stems < 1) return error.textContent = 'Ingrese una cantidad válida de tallos.';
  const price = selectedPrice($('#remission-client-name').value, 'EUCALIPTO', 'HOJA');
  if (!isDonation && !price) return error.textContent = 'No hay precio por tallo de Eucalipto para este cliente. Regístrelo en Lista de precios.';
  const existing = state.lines.find(row => row.type === 'eucalyptus' && row.isDonation === isDonation);
  if (existing) { existing.stems += stems; existing.subtotal = existing.stems * existing.unitPriceStem; }
  else state.lines.push({ type: 'eucalyptus', key: `eucalyptus:${isDonation ? 'donacion' : 'venta'}`, variety: 'EUCALIPTO', gradeCm: 'HOJA', stemsPerBunch: 0, bunches: 0, stems, unitPriceStem: isDonation ? 0 : Number(price.pricePerBunch), subtotal: isDonation ? 0 : stems * Number(price.pricePerBunch), isDonation });
  $('#eucalyptus-stems').value = 25; $('#eucalyptus-donation').checked = false; renderLines();
});

$('#remission-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  $('#remission-error').textContent = '';
  if (!state.lines.length) return $('#remission-error').textContent = 'Agregue al menos una variedad.';
  const payload = { ...Object.fromEntries(new FormData(event.currentTarget)), items: state.lines.map(line => line.type === 'eucalyptus' ? { type: 'eucalyptus', stems: line.stems, isDonation: line.isDonation } : line.type === 'export' ? { type: 'export', variety: line.variety, gradeCm: line.gradeCm, stemsPerBunch: line.stemsPerBunch, bunches: line.bunches, isDonation: line.isDonation } : { key: line.sourceKey || line.key, presentation: line.gradeCm === 'BAJAS GRANEL' ? 'BAJAS GRANEL' : 'BAJAS', bunches: line.bunches, isDonation: line.isDonation }) };
  button.disabled = true;
  try {
    const remission = await api('/api/remissions', { method: 'POST', body: JSON.stringify(payload) });
    renderDocument(remission);
    clearRemission();
    $('#remission-dialog').showModal();
    try {
      await refreshAll();
      toast('Remisión finalizada. Inventario y resumen actualizados.');
    } catch {
      toast('Remisión guardada. No se pudo actualizar la pantalla; use Actualizar inventario.');
    }
  } catch (error) { $('#remission-error').textContent = error.message; }
  finally { button.disabled = false; }
});

$('#add-price-draft').addEventListener('click', addPriceDraft);
$('#add-remaining-price-drafts').addEventListener('click', addRemainingPriceDrafts);

$('#price-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = event.submitter;
  const error = $('#price-error');
  error.textContent = '';
  if (!state.priceDrafts.length) return error.textContent = 'Agregue al menos una variedad a la lista antes de guardar.';
  button.disabled = true;
  try {
    const clientName = form.elements.clientName.value.trim();
    const currentKey = clientKey(clientName) || '__GENERAL__';
    await Promise.all(state.priceDrafts.map(row => api('/api/price-lists', { method: 'PUT', body: JSON.stringify({ clientName, ...row }) })));
    if (state.editingPriceClientKey === currentKey) {
      const stillPresent = row => state.priceDrafts.some(draft => clientKey(draft.variety) === clientKey(row.variety) && draft.gradeCm === row.gradeCm);
      await Promise.all(state.prices.filter(row => (clientKey(row.clientName) || '__GENERAL__') === currentKey && !stillPresent(row)).map(row => api(`/api/price-lists/${row.id}`, { method: 'DELETE' })));
    }
    form.reset();
    state.priceDrafts = [];
    state.editingPriceClientKey = null;
    await refreshAll();
    toast('Precios guardados. Las próximas remisiones usarán estos valores.');
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
    $('#cancel-remission-dialog').close(); await refreshAll(); switchView('history'); toast('Remisión anulada. La flor volvió al inventario y se actualizó el consecutivo.');
  } catch (requestError) { error.textContent = requestError.message; }
  finally { button.disabled = false; }
});

$('#clear-remission').addEventListener('click', clearRemission);
$('#reports-access-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter; const error = $('#reports-access-error'); error.textContent = '';
  button.disabled = true;
  try {
    await api('/api/reports/unlock', { method: 'POST', body: JSON.stringify({ password: $('#reports-password').value }) });
    state.reportsUnlocked = true;
    $('#reports-access-dialog').close();
    switchView('reports');
  } catch (requestError) { error.textContent = requestError.message; }
  finally { button.disabled = false; }
});
$('#generate-report').addEventListener('click', generateReport);
$('#export-report').addEventListener('click', exportReport);
$('#close-document').addEventListener('click', () => $('#remission-dialog').close());
$('#edit-document-prices').addEventListener('click', () => {
  if (!state.activeRemission) return;
  state.editingDocumentPrices = true;
  renderDocument(state.activeRemission);
});
$('#cancel-document-prices').addEventListener('click', () => {
  if (!state.activeRemission) return;
  state.editingDocumentPrices = false;
  renderDocument(state.activeRemission);
});
$('#save-document-prices').addEventListener('click', async event => {
  if (!state.activeRemission) return;
  const items = $$('[data-document-price]').flatMap(input => {
    const ids = input.dataset.documentPrice.split(',').map(Number);
    const originalPrices = input.dataset.documentOriginalPrices.split(',').map(Number);
    const currentPrice = Number(input.value);
    const unchanged = currentPrice === Number(input.dataset.documentDisplayPrice);
    return ids.map((id, index) => ({ id, unitPriceBunch: unchanged ? originalPrices[index] : currentPrice }));
  });
  if (items.some(item => !(item.unitPriceBunch > 0))) return toast('Ingrese un precio por unidad mayor que cero para cada variedad.');
  event.currentTarget.disabled = true;
  try {
    const remission = await api(`/api/remissions/${state.activeRemission.id}/prices`, { method: 'PUT', body: JSON.stringify({ items }) });
    state.activeRemission = remission;
    state.editingDocumentPrices = false;
    renderDocument(remission);
    await refreshAll();
    toast('Precios de la remisión actualizados. La lista de precios no cambió.');
  } catch (error) { toast(error.message); }
  finally { event.currentTarget.disabled = false; }
});
$('#print-document').addEventListener('click', () => {
  const originalTitle = document.title;
  document.title = $('#printable-document').dataset.filename || 'remision';
  window.addEventListener('afterprint', () => { document.title = originalTitle; }, { once: true });
  window.print();
});

(async function init() {
  const today = new Date().toISOString().slice(0, 10);
  $('#report-from').value = today; $('#report-to').value = today;
  try { const session = await api('/api/auth/session'); if (session.authenticated) await showApp(); else showLogin(); }
  catch { showLogin(); }
})();

setInterval(async () => {
  const appVisible = !$('#app-shell').classList.contains('is-hidden');
  if (!appVisible) return;
  await refreshAll();
  if (state.activeView === 'history') await loadFullHistory(true);
  if (state.activeView === 'reports' && state.reportsUnlocked && $('#report-from').value && $('#report-to').value) await generateReport();
}, 10000);

let lastResumeRefresh = 0;
function refreshWhenReturning() {
  if (document.visibilityState !== 'visible' || $('#app-shell').classList.contains('is-hidden') || Date.now() - lastResumeRefresh < 2000) return;
  lastResumeRefresh = Date.now();
  refreshAll();
}
document.addEventListener('visibilitychange', refreshWhenReturning);
window.addEventListener('focus', refreshWhenReturning);

setInterval(() => {
  if (!$('#app-shell').classList.contains('is-hidden') && state.activeView === 'new-remission' && document.visibilityState === 'visible') {
    refreshRemissionInventory();
  }
}, 3000);
