const { colorOf, normalizeVariety } = require('../portal-clientes/colors');

function buildPortalShortages(inventory, reservations) {
  const cells = new Map();
  const cell = (color, grade) => {
    const key = `${color}|${grade}`;
    if (!cells.has(key)) cells.set(key, { color, grade, physical: 0, reserved: 0, shortage: 0, orders: [] });
    return cells.get(key);
  };
  for (const lot of inventory) {
    const color = colorOf.get(normalizeVariety(lot.variety));
    if (color) cell(color, lot.gradeCm).physical += Number(lot.bunches);
  }
  for (const reservation of reservations) {
    const group = cell(reservation.color, reservation.grade);
    const bunches = Number(reservation.bunches);
    group.reserved += bunches;
    group.orders.push({ id: Number(reservation.order_id), name: reservation.name, pickupDate: reservation.pickup_date ? String(reservation.pickup_date).slice(0, 10) : 'Sin fecha', bunches });
  }
  return [...cells.values()].map(group => ({
    ...group, shortage: Math.max(0, group.reserved - group.physical)
  })).filter(group => group.shortage > 0).sort((a, b) => b.shortage - a.shortage || a.color.localeCompare(b.color) || a.grade.localeCompare(b.grade));
}

module.exports = { buildPortalShortages };
