function buildInventoryOverview(root, reservations, grades, assortedColor) {
  const cells = new Map();
  for (const row of root) {
    if (row.color === assortedColor || row.color === 'EUCALIPTO') continue;
    for (const grade of grades) {
      if (grade === 'EXPORTACION GRANEL' || grade === 'EUCALIPTO') continue;
      cells.set(`${row.color}|${grade}`, { color: row.color, grade, real: Number(row.grades[grade].bunches), pending: 0, approved: 0, orders: [] });
    }
  }
  for (const reservation of reservations) {
    const cell = cells.get(`${reservation.color}|${reservation.grade}`);
    if (!cell) continue;
    const bunches = Number(reservation.bunches);
    if (reservation.status === 'PENDIENTE') cell.pending += bunches;
    else cell.approved += bunches;
    cell.orders.push({ id: reservation.order_id, name: reservation.name, status: reservation.status, bunches });
  }
  return [...cells.values()].filter(cell => cell.real || cell.pending || cell.approved).map(cell => ({
    ...cell, available: Math.max(0, cell.real - cell.pending - cell.approved),
    shortage: Math.max(0, cell.pending + cell.approved - cell.real)
  }));
}

module.exports = { buildInventoryOverview };
