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
const norm = value => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
const colorOf = new Map(colorGroups.flatMap(([color, names]) => names.map(name => [name, color])));

function checkProtectedStock(real, reserved, outgoing) {
  for (const [key, quantity] of outgoing) {
    const safe = Math.max(0, (real.get(key) || 0) - (reserved.get(key) || 0));
    if (quantity > safe) throw new Error(`La salida usa flor reservada por pedidos del portal (${key.replace('|', ' · ')}). Disponibles para otras salidas: ${safe} ramos.`);
  }
}

function validateRemissionItems(orderItems, remissionItems) {
  const required = new Map();
  const assorted = new Map();
  for (const item of orderItems) {
    const grade = norm(item.grade), color = norm(item.color), bunches = Number(item.bunches);
    if (color === 'COLORES SURTIDOS') assorted.set(grade, (assorted.get(grade) || 0) + bunches);
    else { const key = `${color}|${grade}`; required.set(key, (required.get(key) || 0) + bunches); }
  }
  const shipped = new Map();
  for (const item of remissionItems) {
    const isEucalyptus = norm(item.variety) === 'EUCALIPTO';
    const color = isEucalyptus ? 'EUCALIPTO' : colorOf.get(norm(item.variety));
    if (!color) continue;
    const saleGrade = norm(item.grade_cm ?? item.gradeCm);
    const grade = isEucalyptus ? 'EUCALIPTO' : ['40', '50', '60'].includes(saleGrade) ? 'EXPORTACION GRANEL' : saleGrade;
    const key = `${color}|${grade}`;
    shipped.set(key, (shipped.get(key) || 0) + Number(isEucalyptus ? item.stems : item.bunches));
  }
  for (const [key, bunches] of required) {
    if ((shipped.get(key) || 0) < bunches) throw new Error(`La remisión no cubre ${key.replace('|', ' · ')}: se necesitan ${bunches} ramos.`);
  }
  for (const [grade, bunches] of assorted) {
    let remaining = 0;
    for (const [key, shippedBunches] of shipped) {
      const [color, shippedGrade] = key.split('|');
      if (shippedGrade === grade && color !== 'ROJOS') remaining += Math.max(0, shippedBunches - (required.get(key) || 0));
    }
    if (remaining < bunches) throw new Error(`La remisión no cubre colores surtidos · ${grade}: se necesitan ${bunches} ramos.`);
  }
}

async function linkPortalOrders(client, remissionId, orderIds, clientName, remissionItems) {
  if (!Array.isArray(orderIds) || orderIds.length < 1 || orderIds.length > 50 || new Set(orderIds).size !== orderIds.length || orderIds.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('Selecciona pedidos del portal válidos.');
  const { rows: orders } = await client.query(`
    SELECT o.id,o.status,o.remission_id,c.id AS customer_id,c.name,m.status AS linked_remission_status
    FROM portal_orders o JOIN portal_customers c ON c.id=o.customer_id
    LEFT JOIN remissions m ON m.id=o.remission_id
    WHERE o.id=ANY($1::bigint[]) ORDER BY o.id FOR UPDATE OF o
  `, [orderIds]);
  if (orders.length !== orderIds.length || orders.some(o => o.status !== 'APROBADO')) throw new Error('Solo se pueden vincular pedidos aprobados que aún existan.');
  if (orders.some(o => o.remission_id && Number(o.remission_id) !== Number(remissionId) && o.linked_remission_status === 'FINALIZADA')) throw new Error('Uno de los pedidos ya está vinculado a otra remisión activa.');
  if (orders.some(o => Number(o.customer_id) !== Number(orders[0].customer_id) || norm(o.name) !== norm(clientName))) throw new Error('Los pedidos seleccionados deben ser del mismo cliente de la remisión.');
  const { rows: linked } = await client.query('SELECT id,customer_id FROM portal_orders WHERE remission_id=$1 AND status=\'APROBADO\' AND id<>ALL($2::bigint[])', [remissionId, orderIds]);
  if (linked.some(order => Number(order.customer_id) !== Number(orders[0].customer_id))) throw new Error('La remisión ya está vinculada a pedidos de otro cliente.');
  const allIds = [...orderIds, ...linked.map(row => Number(row.id))];
  const { rows: items } = await client.query('SELECT color,grade,bunches FROM portal_order_items WHERE order_id=ANY($1::bigint[])', [allIds]);
  validateRemissionItems(items, remissionItems);
  await client.query('UPDATE portal_orders SET remission_id=$1 WHERE id=ANY($2::bigint[])', [remissionId, orderIds]);
  return orders.length;
}

module.exports = { colorGroups, colorOf, norm, checkProtectedStock, validateRemissionItems, linkPortalOrders };
