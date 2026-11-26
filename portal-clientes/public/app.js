const $ = id => document.getElementById(id);
const format = n => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(n || 0));
const gradeNames = { NACIONAL: 'Nacional bonchado', BAJAS: 'Bajas bonchadas', 'NACIONAL GRANEL': 'Nacional granel', 'BAJAS GRANEL': 'Bajas granel', EUCALIPTO: 'Eucalipto', 'EXPORTACION GRANEL': 'Exportación granel' };
const gradeOrder = ['NACIONAL', 'BAJAS', 'NACIONAL GRANEL', 'BAJAS GRANEL', 'EUCALIPTO'];
const unit = (grade, quantity) => grade === 'EUCALIPTO' ? `${quantity} ${quantity === 1 ? 'tallo' : 'tallos'}` : `${quantity} ${quantity === 1 ? 'ramo' : 'ramos'}`;
let myOrders = [];
const swatches = { ROJOS:'#bb2137',BLANCOS:'#ece9e2','ROSADOS CLAROS':'#f5b4ca','ROSADOS MEDIOS':'#e77aa4','ROSADOS FUERTES':'#ca4178',AMARILLOS:'#efc84d',MORADOS:'#80619b',NARANJAS:'#e88745',PEACH:'#f3a98e',ARENA:'#c4ac88',EUCALIPTO:'#3d8a60','COLORES SURTIDOS':'linear-gradient(135deg,#d74453,#f2cf55,#83bb9c,#9d7ac3)' };
const colorTints = { ROJOS:'#ffe5e8',BLANCOS:'#f0efeb','ROSADOS CLAROS':'#ffe8f0','ROSADOS MEDIOS':'#ffd9e8','ROSADOS FUERTES':'#ffd2e4',AMARILLOS:'#fff0b5',MORADOS:'#eee1fa',NARANJAS:'#ffe2cb',PEACH:'#ffe8d9',ARENA:'#eee2d1',EUCALIPTO:'#e1f3e6','COLORES SURTIDOS':'#e8ebfa' };
const rainbow = 'linear-gradient(135deg,#e74f59,#f3b64c,#e9db56,#74c993,#70b4e4,#a68bd1)';
const pickupHourSelect = document.getElementById('pickup-hour');
function updatePickupHours() {
  const date = $('pickup-date').value;
  const previous = pickupHourSelect.value;
  pickupHourSelect.replaceChildren(new Option(date ? 'Selecciona la hora' : 'Elige primero el día', ''));
  pickupHourSelect.disabled = !date;
  $('existing-order-hint').textContent = '';
  if (!date) return;
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const lastHour = day === 2 ? 14 : 13;
  for (let hour = 6; hour <= lastHour; hour += 1) pickupHourSelect.add(new Option(new Intl.DateTimeFormat('es-CO', { hour: 'numeric', hour12: true, timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 1, hour))), String(hour)));
  const existing = existingPickupOrder(date);
  if (existing) {
    pickupHourSelect.value = String(existing.pickup_hour);
    pickupHourSelect.disabled = true;
    $('existing-order-hint').textContent = existing.modifications_locked ? `El pedido #${existing.id} ya está en preparación y no admite más productos para este día.` : `Ya tienes el pedido #${existing.id} para este día. Los productos nuevos se agregarán a ese pedido y se conservará la hora de recogida.`;
  } else if ([...pickupHourSelect.options].some(option => option.value === previous)) pickupHourSelect.value = previous;
  syncOrderState();
}
$('pickup-date').addEventListener('change', updatePickupHours);
$('pickup-date').addEventListener('click', event => { try { event.currentTarget.showPicker?.(); } catch { event.currentTarget.focus(); } });
let role = null, catalog = [], prices = {}, cart = new Map(), lastOrderId = null, automaticWhatsApp = false, previewMode = false, adminCustomers = [], adminInventory = [], catalogEvents = null, ordering = false;
updatePickupHours();
async function api(url, options = {}) { const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } }); const body = await res.json(); if (!res.ok) { const error = new Error(body.error || 'No se pudo completar la solicitud.'); error.status = res.status; throw error; } return body; }
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
function show(id) { for (const name of ['login','customer','admin']) $(name).classList.toggle('hidden', name !== id); $('logout').classList.toggle('hidden', id === 'login'); $('cart-bar').classList.toggle('hidden', id !== 'customer' || cart.size === 0); }
function toast(message) { $('toast').textContent = message; $('toast').classList.remove('hidden'); setTimeout(() => $('toast').classList.add('hidden'), 4200); }
function cartKey(color, grade) { return `${color}|${grade}`; }
function existingPickupOrder(date) {
  return myOrders.filter(order => order.status === 'APROBADO' && String(order.pickup_date || '').slice(0, 10) === date)
    .sort((a, b) => Number(a.id) - Number(b.id))[0] || null;
}
function cartIssue() {
  const byColor = new Map(catalog.map(row => [row.color, row]));
  for (const [key, quantity] of cart) {
    const [color, grade] = key.split('|');
    if (color === 'EUCALIPTO' && grade === 'EUCALIPTO') continue;
    const available = byColor.get(color)?.grades[grade]?.bunches || 0;
    if (quantity > available) return `${gradeNames[grade] || grade} de ${color}: quedan ${available} ramos. Ajusta el pedido según el inventario actualizado.`;
  }
  for (const grade of gradeOrder.filter(value => value !== 'EUCALIPTO')) {
    const stock = catalog.filter(row => !['ROJOS', 'COLORES SURTIDOS', 'EUCALIPTO'].includes(row.color))
      .reduce((sum, row) => sum + (row.grades[grade]?.bunches || 0), 0);
    const selected = [...cart].filter(([key]) => {
      const [color, itemGrade] = key.split('|');
      return itemGrade === grade && !['ROJOS', 'EUCALIPTO'].includes(color);
    }).reduce((sum, [, quantity]) => sum + quantity, 0);
    if (selected > stock) return `${gradeNames[grade]}: los colores surtidos y los colores individuales comparten ${stock} ramos. Reduce el pedido para continuar.`;
  }
  return '';
}
function syncOrderState(updateError = true) {
  const existing = existingPickupOrder($('pickup-date').value);
  const issue = existing?.modifications_locked ? `El pedido #${existing.id} ya está en preparación. No puedes agregar más productos para este día.` : cartIssue();
  $('submit-order').textContent = existing ? 'Agregar al pedido existente' : 'Realizar pedido';
  $('submit-order').disabled = ordering || !automaticWhatsApp || !cart.size || Boolean(issue);
  if (updateError && $('review-dialog').open) $('order-error').textContent = issue;
  return issue;
}
function renderCatalog() {
  const previousScroll = $('catalog').querySelector('.order-matrix-scroll')?.scrollLeft || 0;
  const available = catalog;
  if (!available.length) { $('catalog').innerHTML = '<p class="catalog-hint">No hay flor disponible por ahora.</p>'; renderCart(); return; }
  $('catalog').innerHTML = `<p class="matrix-scroll-hint">Desliza hacia la derecha para ver más categorías <span aria-hidden="true">→</span></p><div class="order-matrix-scroll"><table class="order-matrix"><thead><tr><th scope="col">Color</th>${gradeOrder.map(grade => `<th scope="col"><span>${esc(gradeNames[grade])}</span><small>${format(prices[grade])} / ${grade === 'EUCALIPTO' ? 'tallo' : 'ramo'}</small></th>`).join('')}</tr></thead><tbody>${available.map(row => `<tr><th scope="row"><span class="matrix-color"><span class="swatch" style="background:${row.color === 'COLORES SURTIDOS' ? rainbow : (swatches[row.color] || '#ddd')}"></span>${esc(row.color)}</span></th>${gradeOrder.map(grade => { const eucalyptus = row.color === 'EUCALIPTO' && grade === 'EUCALIPTO', stock = row.grades[grade]?.bunches || 0, qty = cart.get(cartKey(row.color,grade)) || 0, limit = eucalyptus ? 10000 : stock; return `<td>${stock || eucalyptus || qty ? `<div class="matrix-cell ${eucalyptus ? 'matrix-cell--free' : ''} ${qty ? 'matrix-cell--selected' : ''}"><button data-action="minus" data-color="${esc(row.color)}" data-grade="${esc(grade)}" ${qty ? '' : 'disabled'} aria-label="Quitar ${esc(gradeNames[grade])} de ${esc(row.color)}">−</button><input data-color="${esc(row.color)}" data-grade="${esc(grade)}" type="number" inputmode="numeric" min="0" max="${limit}" value="${qty}" aria-label="${eucalyptus ? 'Tallos de eucalipto' : `Ramos de ${esc(row.color)}, ${esc(gradeNames[grade])}`}"><button data-action="plus" data-color="${esc(row.color)}" data-grade="${esc(grade)}" ${qty >= limit ? 'disabled' : ''} aria-label="Agregar ${esc(gradeNames[grade])} de ${esc(row.color)}">+</button><small>${eucalyptus ? 'Tallos · cantidad libre' : `● ${stock} disponibles`}</small></div>` : '<div class="matrix-empty" aria-label="Sin disponibilidad">—</div>'}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div><p class="matrix-help">Colores surtidos usa los mismos ramos de los demás colores, excepto rojos. Eucalipto se pide por tallos y no descuenta rosas.</p>`;
  $('catalog').querySelector('.order-matrix-scroll').scrollLeft = previousScroll;
  renderCart();
  syncOrderState();
}
function setQuantity(color, grade, value) {
  const stock = color === 'EUCALIPTO' && grade === 'EUCALIPTO' ? 10000 : (catalog.find(x => x.color === color)?.grades[grade]?.bunches || 0);
  const quantity = Math.max(0, Math.min(stock, Math.trunc(Number(value) || 0)));
  const key = cartKey(color, grade), previous = cart.get(key) || 0;
  if (quantity) cart.set(key, quantity); else cart.delete(key);
  const issue = cartIssue();
  if (issue && quantity > previous) { if (previous) cart.set(key, previous); else cart.delete(key); toast(issue); }
  renderCatalog();
}
function renderCart() { const count = [...cart.values()].reduce((a,b) => a+b,0), total = [...cart].reduce((sum,[key,n]) => sum+n*(prices[key.split('|')[1]]||0),0); $('cart-count').textContent = count ? `${count} unidades` : 'Sin productos'; $('cart-total').textContent = format(total); $('cart-bar').classList.toggle('hidden', role !== 'customer' || !count); }
async function loadCatalog() {
  const priorIssue = cartIssue();
  const data = await api('/api/catalog'); catalog = data.colors; prices = data.prices; automaticWhatsApp = data.automaticWhatsApp; previewMode = Boolean(data.previewMode);
  $('notification-hint').textContent = previewMode ? 'Vista previa: los pedidos son de muestra. No se usa la base de datos real ni se envían mensajes de WhatsApp.' : automaticWhatsApp ? 'Al realizar el pedido, quedará aprobado de inmediato. Te enviaremos la confirmación por WhatsApp y avisaremos al administrador.' : 'Los pedidos están temporalmente deshabilitados: falta configurar la confirmación automática de WhatsApp.';
  $('submit-order').textContent = 'Realizar pedido';
  const picker = $('color-select'), selected = picker.value; picker.replaceChildren(new Option('Selecciona un color', ''));
  const available = catalog.filter(row => row.color === 'EUCALIPTO' || gradeOrder.some(grade => row.grades[grade].bunches > 0) || [...cart.keys()].some(key => key.startsWith(`${row.color}|`)));
  for (const row of available) picker.add(new Option(row.color, row.color));
  $('color-options').innerHTML = available.map(row => `<button type="button" class="color-option ${row.color === 'COLORES SURTIDOS' ? 'assorted' : ''}" data-color-option="${esc(row.color)}" style="background-color:${colorTints[row.color] || '#fff'}"><span class="swatch" style="background:${swatches[row.color] || '#ddd'}"></span>${esc(row.color)}</button>`).join('');
  if ([...picker.options].some(option => option.value === selected)) picker.value = selected;
  renderCatalog();
  if (!priorIssue && cartIssue()) toast('El inventario cambió. Ajusta tu pedido antes de continuar.');
}
async function loadMyOrders() { myOrders = await api('/api/my-orders'); $('my-orders').innerHTML = myOrders.map(order => orderHtml(order,false)).join('') || '<p>Aún no tienes pedidos.</p>'; for (const order of myOrders) { const card = document.getElementById(`order-${order.id}`); if (!card) continue; if (Number(order.revision) > 1) card.insertAdjacentHTML('beforeend', `<p class="pickup-summary">Actualizado ${Number(order.revision) - 1} ${Number(order.revision) === 2 ? 'vez' : 'veces'} · ${new Date(order.updated_at).toLocaleString('es-CO')}</p>`); if (order.modifications_locked && order.status === 'APROBADO') card.insertAdjacentHTML('beforeend', '<p class="pickup-summary">En preparación: ya no se pueden agregar productos.</p>'); } if ($('review-dialog').open) updatePickupHours(); }
function orderHtml(order, admin) {
  const status = order.status === 'APROBADO' ? 'approved' : ['RECHAZADO','CANCELADO'].includes(order.status) ? 'rejected' : '';
  const active = ['PENDIENTE','APROBADO'].includes(order.status);
  return `<article class="order-card" id="order-${order.id}"><div class="order-top"><div><h3>Pedido #${order.id}${admin ? ` · ${esc(order.name)}` : ''}</h3><p>${new Date(order.created_at).toLocaleString('es-CO')}${admin ? ` · ${esc(order.phone)}` : ''}</p></div><span class="pill ${status}">${esc(order.status)}</span></div><div class="item-list">${order.items.map(item => `<span class="color-item" style="background:${item.color === 'COLORES SURTIDOS' ? rainbow : (colorTints[item.color] || '#f7eff2')};border-left:5px solid ${item.color === 'COLORES SURTIDOS' ? '#7a68b0' : (swatches[item.color] || '#ddd')}">${esc(item.color)} · ${esc(gradeNames[item.grade] || item.grade)} · ${unit(item.grade, item.bunches)}</span>`).join('')}</div>${order.pickup_date ? `<p class="pickup-summary">Recogida: ${esc(String(order.pickup_date).slice(0,10))} · ${String(order.pickup_hour).padStart(2,'0')}:00</p>` : ''}<p><strong>${format(order.total)}</strong>${order.notes ? ` · ${esc(order.notes)}` : ''}</p>${admin && order.whatsapp_status ? `<p class="notice-status">Aviso WhatsApp: ${order.whatsapp_status === 'SOLICITADO' ? 'aceptado por Meta' : order.whatsapp_status === 'ERROR' ? 'falló; se reintentará' : order.whatsapp_status === 'CANCELADO' ? 'cancelado' : automaticWhatsApp ? 'en proceso' : 'pendiente de configurar'}${order.whatsapp_status === 'ERROR' && order.whatsapp_error ? `<br><strong>${esc(order.whatsapp_error)}</strong>` : ''}</p>` : ''}${order.rejection_reason ? `<p>Motivo: ${esc(order.rejection_reason)}</p>` : ''}${admin ? `<div class="order-actions">${order.status === 'PENDIENTE' ? `<button class="primary" data-decision="APROBADO" data-id="${order.id}">Aprobar pedido</button><button class="danger" data-decision="RECHAZADO" data-id="${order.id}">Rechazar</button>` : ''}${active ? `<button class="secondary" data-cancel-order="${order.id}">Cancelar pedido</button>` : ''}<button class="danger" data-delete-order="${order.id}">Eliminar pedido</button></div>` : ''}</article>`;
}
function renderCustomers(customers) {
  adminCustomers = customers;
  $('customer-count').textContent = customers.length;
  $('admin-customers').innerHTML = customers.map(customer => `<div class="customer-row"><div><strong>${esc(customer.name)}</strong><span>${customer.login_identifier ? `Usuario: ${esc(customer.login_identifier)} · ` : ''}WhatsApp: ${esc(customer.phone)} · ${customer.active ? 'Activo' : 'Inactivo'}</span></div><div class="customer-actions"><button class="secondary" type="button" data-edit-customer="${customer.id}">Editar</button><button class="danger" type="button" data-delete-customer="${customer.id}">Eliminar</button></div></div>`).join('') || '<p class="catalog-hint">Todavía no hay clientes registrados.</p>';
}
function renderAdminInventory() {
  const container = $('admin-inventory');
  const openCells = new Set([...container.querySelectorAll('details[open]')].map(details => details.dataset.cell));
  const grade = $('inventory-grade').value;
  const cells = adminInventory.filter(cell => !grade || cell.grade === grade);
  const totals = cells.reduce((sum, cell) => {
    for (const key of ['real', 'pending', 'approved', 'available', 'shortage']) sum[key] += cell[key];
    return sum;
  }, { real: 0, pending: 0, approved: 0, available: 0, shortage: 0 });
  $('inventory-summary').innerHTML = `<strong>Inventario real: ${totals.real}</strong><span>Pendientes: ${totals.pending}</span><span>Aprobados: ${totals.approved}</span><strong>Disponible: ${totals.available}</strong>${totals.shortage ? `<strong class="inventory-shortage">Faltan ${totals.shortage} ramos para cubrir todas las reservas</strong>` : ''}`;
  cells.sort((a, b) => gradeOrder.indexOf(a.grade) - gradeOrder.indexOf(b.grade) || Object.keys(swatches).indexOf(a.color) - Object.keys(swatches).indexOf(b.color));
  container.innerHTML = cells.map(cell => {
    const cellKey = `${cell.color}|${cell.grade}`;
    return `<article class="inventory-card ${cell.shortage ? 'inventory-card--shortage' : ''}" style="--inventory-color:${swatches[cell.color] || '#5f8c70'}"><h3>${esc(cell.color)}<small>${esc(gradeNames[cell.grade] || cell.grade)}</small></h3><div class="inventory-figures"><span>Real<strong>${cell.real}</strong></span><span>Pendientes<strong>${cell.pending}</strong></span><span>Aprobados<strong>${cell.approved}</strong></span><span>Disponible<strong>${cell.available}</strong></span></div>${cell.shortage ? `<p class="inventory-shortage">Faltan ${cell.shortage} ramos para cubrir las reservas.</p>` : ''}${cell.orders.length ? `<details data-cell="${esc(cellKey)}" ${openCells.has(cellKey) ? 'open' : ''}><summary>Ver ${cell.orders.length} pedido${cell.orders.length === 1 ? '' : 's'}</summary><ul>${cell.orders.map(order => `<li><strong>#${esc(order.id)}</strong> · ${esc(order.name)} · ${order.bunches} ramos · ${esc(order.status.toLowerCase())}</li>`).join('')}</ul></details>` : '<p class="inventory-no-orders">Sin pedidos reservados</p>'}</article>`;
  }).join('') || '<p>No hay ramos ni reservas para este grado.</p>';
}
async function loadAdminInventory() {
  const data = await api('/api/admin/inventory');
  adminInventory = data.inventory;
  renderAdminInventory();
}
function renderAdminOrders(orders) {
  const container = $('admin-orders');
  const previousGroups = [...container.querySelectorAll('.order-day')];
  const openDays = new Set(previousGroups.filter(group => group.open).map(group => group.dataset.day));
  const grouped = new Map();
  for (const order of orders) {
    const day = order.pickup_date ? String(order.pickup_date).slice(0,10) : 'Sin fecha';
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day).push(order);
  }
  const days = [...grouped.keys()].sort((a,b) => a === 'Sin fecha' ? 1 : b === 'Sin fecha' ? -1 : a.localeCompare(b));
  const target = new URLSearchParams(location.search).get('pedido');
  const targetOrder = orders.find(order => String(order.id) === target);
  const targetDay = targetOrder ? (targetOrder.pickup_date ? String(targetOrder.pickup_date).slice(0,10) : 'Sin fecha') : null;
  const defaultDay = days.find(day => grouped.get(day).some(order => order.status === 'PENDIENTE')) || days[0];
  container.innerHTML = days.map(day => {
    const dayOrders = grouped.get(day);
    const pending = dayOrders.filter(order => order.status === 'PENDIENTE').length;
    const label = day === 'Sin fecha' ? day : new Date(`${day}T12:00:00Z`).toLocaleDateString('es-CO', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'UTC' });
    const open = day === targetDay || (previousGroups.length ? openDays.has(day) : day === defaultDay);
    return `<details class="order-day" data-day="${esc(day)}" ${open ? 'open' : ''}><summary><span>${esc(label)}</span><span class="day-count">${dayOrders.length} pedido${dayOrders.length === 1 ? '' : 's'}${pending ? ` · ${pending} pendiente${pending === 1 ? '' : 's'}` : ''}</span></summary><div class="orders">${dayOrders.map(order => orderHtml(order,true)).join('')}</div></details>`;
  }).join('') || '<p>Aún no hay pedidos.</p>';
  for (const order of orders) {
    const card = document.getElementById(`order-${order.id}`);
    if (!card) continue;
    if (Number(order.revision) > 1) card.insertAdjacentHTML('beforeend', `<p class="pickup-summary">Pedido actualizado ${Number(order.revision) - 1} ${Number(order.revision) === 2 ? 'vez' : 'veces'} · ${new Date(order.updated_at).toLocaleString('es-CO')}</p>`);
    if (order.status === 'APROBADO') card.insertAdjacentHTML('beforeend', `<div class="order-actions"><button class="secondary" type="button" data-toggle-modifications="${order.id}" data-locked="${order.modifications_locked ? 'true' : 'false'}">${order.modifications_locked ? 'Permitir más productos' : 'Cerrar modificaciones'}</button></div>${order.modifications_locked ? '<p class="pickup-summary">En preparación: el cliente no puede agregar productos.</p>' : ''}`);
    if (!order.customer_whatsapp_status) continue;
    const status = order.customer_whatsapp_status;
    const label = status === 'SOLICITADO' ? 'aceptada por Meta' : status === 'ERROR' ? 'falló; se reintentará' : status === 'CANCELADO' ? 'cancelada' : 'en proceso';
    card.insertAdjacentHTML('beforeend', `<p class="notice-status">Confirmación WhatsApp al cliente: ${label}${status === 'ERROR' && order.customer_whatsapp_error ? `<br><strong>${esc(order.customer_whatsapp_error)}</strong>` : ''}</p>`);
  }
}
async function loadAdmin() {
  const data = await api('/api/admin');
  prices = data.prices;
  automaticWhatsApp = data.automaticWhatsApp;
  $('whatsapp-state').textContent = automaticWhatsApp ? 'Cada pedido nuevo se aprueba al registrarse. Se solicita un aviso a tu WhatsApp y una confirmación al cliente.' : 'La confirmación automática no está configurada: ' + data.whatsappConfigurationIssues.join('; ');
  $('prices-form').innerHTML = gradeOrder.map(g => `<label>${gradeNames[g]} · COP / ${g === 'EUCALIPTO' ? 'tallo' : 'ramo'}<input name="${g}" type="number" min="1" step="1" value="${prices[g] || ''}" required></label>`).join('') + '<button class="primary">Guardar precios</button>';
  $('pending-count').textContent = data.orders.length;
  renderAdminOrders(data.orders);
  const target = new URLSearchParams(location.search).get('pedido');
  if (target && /^\d+$/.test(target)) { const card = document.getElementById(`order-${target}`); if (card) { card.classList.add('highlighted-order'); if (!loadAdmin.highlighted) { card.scrollIntoView({ behavior:'smooth', block:'center' }); loadAdmin.highlighted = true; } } }
  const newestId = data.orders.reduce((max, order) => Math.max(max, Number(order.id)), 0);
  if (lastOrderId !== null && newestId > lastOrderId) { toast('Llegó un pedido nuevo.'); if (Notification.permission === 'granted') new Notification('Prestige Roses', { body: 'Llegó un pedido nuevo aprobado automáticamente.' }); }
  lastOrderId = newestId;
  renderCustomers(data.customers);
  await loadAdminInventory().catch(error => { $('inventory-summary').textContent = `No se pudo cargar el inventario: ${error.message}`; });
}
async function init() { const s = await api('/api/session'); role = s.role; catalogEvents?.close(); catalogEvents = null; if (role === 'customer') { show('customer'); $('greeting').textContent = `Hola, ${s.name} 👋`; await loadCatalog(); await loadMyOrders(); catalogEvents = new EventSource('/api/catalog/events'); catalogEvents.addEventListener('inventory', () => { if (!ordering) void loadCatalog().catch(() => {}); }); } else if (role === 'admin') { show('admin'); await loadAdmin(); if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } else show('login'); }
$('login-form').addEventListener('submit', async e => { e.preventDefault(); $('login-error').textContent=''; try { await api('/api/login', { method:'POST',body:JSON.stringify({ role:$('admin-mode').checked?'admin':'customer',phone:$('phone').value,password:$('password').value }) }); $('password').value=''; await init(); } catch (err) { $('login-error').textContent=err.message; } });
$('logout').addEventListener('click', async () => { await api('/api/logout',{method:'POST'}); catalogEvents?.close(); catalogEvents = null; cart.clear(); role=null; show('login'); });
$('catalog').addEventListener('click', e => { const b=e.target.closest('button[data-action]'); if (!b) return; const key=cartKey(b.dataset.color,b.dataset.grade); setQuantity(b.dataset.color,b.dataset.grade,(cart.get(key)||0)+(b.dataset.action==='plus'?1:-1)); });
$('catalog').addEventListener('change', e => { const input=e.target.closest('input[data-color]'); if(input) setQuantity(input.dataset.color,input.dataset.grade,input.value); });
$('color-select').addEventListener('change', renderCatalog);
$('color-options').addEventListener('click', e => { const option = e.target.closest('[data-color-option]'); if (!option) return; $('color-select').value = option.dataset.colorOption; $('color-menu').open = false; renderCatalog(); });
$('refresh').addEventListener('click', async () => { try { await loadCatalog(); toast('Inventario actualizado.'); } catch(e) { toast(e.message); } });
$('review').addEventListener('click', () => { $('review-items').innerHTML=`<div class="review-list">${[...cart].map(([key,n])=>{const [color,grade]=key.split('|');const background=color === 'COLORES SURTIDOS' ? rainbow : (colorTints[color] || '#f7eff2');return `<div class="review-product" style="--review-tint:${background}"><div class="review-product-name"><span class="review-swatch" style="background:${color === 'COLORES SURTIDOS' ? rainbow : (swatches[color] || '#ddd')}"></span><div><strong>${esc(color)}</strong><small>${esc(gradeNames[grade] || grade)}</small></div></div><div class="review-product-numbers"><span>${unit(grade,n)}</span><strong>${format(n*prices[grade])}</strong></div></div>`;}).join('')}</div><div class="review-total"><span>Total estimado</span><strong>${$('cart-total').textContent}</strong></div>`; $('order-error').textContent=''; const today = new Date(); $('pickup-date').min = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`; $('review-dialog').showModal(); syncOrderState(); });
$('review').addEventListener('click', updatePickupHours);
$('submit-order').addEventListener('click', async () => {
  if (ordering) return;
  ordering = true;
  syncOrderState();
  try {
    const date = $('pickup-date').value, hour = $('pickup-hour').value;
    if (!date || hour === '') throw new Error('Selecciona el día y la hora de recogida.');
    await loadCatalog();
    const issue = syncOrderState();
    if (issue) throw new Error(issue);
    const items = [...cart].map(([key,bunches]) => { const [color,grade] = key.split('|'); return { color,grade,bunches }; });
    const result = await api('/api/orders', { method:'POST', body:JSON.stringify({ items, notes:$('order-notes').value, pickupDate:date, pickupHour:hour }) });
    cart.clear();
    $('review-dialog').close();
    $('order-notes').value = ''; $('pickup-date').value = ''; updatePickupHours();
    $('order-success-title').textContent = result.updated ? '¡Pedido actualizado!' : '¡Pedido confirmado!';
    $('order-success-summary').textContent = `Pedido #${result.id} · Total acumulado ${format(result.total)} · Recogida ${date} a las ${String(result.pickupHour).padStart(2,'0')}:00`;
    $('order-success-message').textContent = previewMode ? 'Pedido de muestra guardado. No se envió ningún WhatsApp.' : result.updated ? 'Agregamos los productos al mismo pedido. Te enviaremos el resumen actualizado por WhatsApp.' : 'Tu pedido quedó aprobado. Te enviaremos la confirmación por WhatsApp.';
    $('order-success-dialog').showModal();
    void Promise.all([loadCatalog(), loadMyOrders()]).catch(() => toast('Actualiza la página para ver el pedido y la disponibilidad.'));
  } catch (error) { if (error.status === 409) await Promise.all([loadCatalog(), loadMyOrders()]).catch(() => {}); $('order-error').textContent = error.message; }
  finally { ordering = false; syncOrderState(false); }
});
$('close-order-success').addEventListener('click', () => $('order-success-dialog').close());
$('prices-form').addEventListener('submit', async e => { e.preventDefault(); try { const values=Object.fromEntries(new FormData(e.target)); await api('/api/admin/prices',{method:'PUT',body:JSON.stringify(values)}); $('prices-message').textContent='Precios guardados para todos los clientes.'; } catch(err) { $('prices-message').textContent=err.message; } });
$('customer-form').addEventListener('submit', async e => { e.preventDefault(); try { await api('/api/admin/customers',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))}); e.target.reset(); $('customer-message').textContent='Cliente creado. Comparte sus datos de acceso por privado.'; await loadAdmin(); } catch(err) { $('customer-message').textContent=err.message; } });
$('admin-customers').addEventListener('click', e => { const button = e.target.closest('[data-edit-customer]'); if (!button) return; const customer = adminCustomers.find(row => String(row.id) === button.dataset.editCustomer); if (!customer) return; const form = $('edit-customer-form'); form.elements.id.value = customer.id; form.elements.name.value = customer.name; form.elements.phone.value = customer.phone; form.elements.loginIdentifier.value = customer.login_identifier || ''; form.elements.password.value = ''; $('edit-customer-error').textContent = ''; $('edit-customer-dialog').showModal(); });
$('admin-customers').addEventListener('click', async e => { const button = e.target.closest('[data-delete-customer]'); if (!button) return; const customer = adminCustomers.find(row => String(row.id) === button.dataset.deleteCustomer); if (!customer) return; const count = Number(customer.order_count || 0); if (!confirm(`¿Eliminar a ${customer.name} y sus ${count} pedido(s)? Esta acción no se puede deshacer.`)) return; button.disabled = true; try { await api(`/api/admin/customers/${customer.id}`, { method:'DELETE' }); await loadAdmin(); toast('Cliente y pedidos eliminados.'); } catch (error) { toast(error.message); button.disabled = false; } });
$('close-customer-dialog').addEventListener('click', () => $('edit-customer-dialog').close());
$('edit-customer-form').addEventListener('submit', async e => { e.preventDefault(); const form = e.currentTarget, button = form.querySelector('[type="submit"]'); button.disabled = true; $('edit-customer-error').textContent = ''; try { const values = Object.fromEntries(new FormData(form)); await api(`/api/admin/customers/${values.id}`, { method:'PUT', body:JSON.stringify({ name:values.name, phone:values.phone, loginIdentifier:values.loginIdentifier, password:values.password }) }); $('edit-customer-dialog').close(); await loadAdmin(); toast('Cliente actualizado.'); } catch(err) { $('edit-customer-error').textContent = err.message; } finally { button.disabled = false; } });
$('admin-orders').addEventListener('click', async e => { const b=e.target.closest('[data-decision]'); if(!b)return; const reason=b.dataset.decision==='RECHAZADO'?prompt('Motivo para el cliente:'):''; if(b.dataset.decision==='RECHAZADO'&&reason===null)return; b.disabled=true; try { const result=await api(`/api/admin/orders/${b.dataset.id}`,{method:'PUT',body:JSON.stringify({decision:b.dataset.decision,reason})}); await loadAdmin(); toast(result.automaticConfirmation ? 'Pedido aprobado. Se está enviando la confirmación al cliente.' : 'Pedido actualizado. Abre WhatsApp para enviar la respuesta.'); if (result.whatsappUrl) window.open(result.whatsappUrl,'_blank','noopener,noreferrer'); } catch(err) { toast(err.message); b.disabled=false; } });
$('admin-orders').addEventListener('click', async e => { const button = e.target.closest('[data-delete-order]'); if (!button) return; if (!confirm(`¿Eliminar el pedido #${button.dataset.deleteOrder}? Esta acción no se puede deshacer.`)) return; button.disabled = true; try { await api(`/api/admin/orders/${button.dataset.deleteOrder}`, { method:'DELETE' }); await loadAdmin(); toast('Pedido eliminado.'); } catch (error) { toast(error.message); button.disabled = false; } });
$('admin-orders').addEventListener('click', async e => { const button = e.target.closest('[data-cancel-order]'); if (!button) return; if (!confirm(`¿Cancelar el pedido #${button.dataset.cancelOrder} y devolver sus ramos al portal?`)) return; button.disabled = true; try { await api(`/api/admin/orders/${button.dataset.cancelOrder}/cancel`, { method:'POST' }); await loadAdmin(); toast('Pedido cancelado. Los ramos volvieron a estar disponibles.'); } catch (error) { toast(error.message); button.disabled = false; } });
$('admin-orders').addEventListener('click', async e => { const button = e.target.closest('[data-toggle-modifications]'); if (!button) return; button.disabled = true; try { const locked = button.dataset.locked !== 'true'; await api(`/api/admin/orders/${button.dataset.toggleModifications}/modifications`, { method:'POST', body:JSON.stringify({ locked }) }); await loadAdmin(); toast(locked ? 'Pedido en preparación: no admite más productos.' : 'El cliente puede volver a agregar productos a este pedido.'); } catch (error) { toast(error.message); button.disabled = false; } });
$('admin-refresh').addEventListener('click', () => loadAdmin().catch(e => toast(e.message)));
$('inventory-refresh').addEventListener('click', () => loadAdminInventory().then(() => toast('Inventario actualizado.')).catch(error => toast(error.message)));
$('inventory-grade').addEventListener('change', renderAdminInventory);
setInterval(() => { if(role==='customer' && !ordering) Promise.all([loadCatalog(),loadMyOrders()]).catch(()=>{}); if(role==='admin') loadAdmin().catch(()=>{}); },10000);
init().catch(e => { $('login-error').textContent=e.message; show('login'); });
