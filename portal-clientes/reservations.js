function insufficientInventory(message) {
  const error = new Error(message);
  error.code = 'INSUFFICIENT_INVENTORY';
  return error;
}

function allocateReservations(catalog, requested, assortedColors) {
  const remaining = new Map(catalog.flatMap(row => Object.entries(row.grades).map(([grade, stock]) => [`${row.color}|${grade}`, Number(stock.bunches)])));
  const allocations = [];
  for (const item of requested.filter(item => item.color !== 'COLORES SURTIDOS' && !['EXPORTACION GRANEL', 'EUCALIPTO'].includes(item.grade))) {
    const key = `${item.color}|${item.grade}`;
    const available = remaining.get(key) || 0;
    if (item.bunches > available) throw insufficientInventory(`Inventario insuficiente de ${item.color} · ${item.grade}. Revisa las cantidades disponibles.`);
    remaining.set(key, available - item.bunches);
    allocations.push({ color: item.color, grade: item.grade, bunches: item.bunches });
  }
  for (const item of requested.filter(item => item.color === 'COLORES SURTIDOS' && !['EXPORTACION GRANEL', 'EUCALIPTO'].includes(item.grade))) {
    let needed = item.bunches;
    for (const color of assortedColors) {
      const key = `${color}|${item.grade}`;
      const taken = Math.min(needed, remaining.get(key) || 0);
      if (taken) {
        remaining.set(key, (remaining.get(key) || 0) - taken);
        allocations.push({ color, grade: item.grade, bunches: taken });
        needed -= taken;
      }
      if (!needed) break;
    }
    if (needed) throw insufficientInventory(`No hay suficientes ramos para colores surtidos · ${item.grade}. Revisa las cantidades disponibles.`);
  }
  return allocations;
}

function applyReservations(catalog, reservations, assortedColors) {
  const available = catalog.map(row => ({ color: row.color, grades: Object.fromEntries(Object.entries(row.grades).map(([grade, stock]) => [grade, { ...stock }])) }));
  const byColor = new Map(available.map(row => [row.color, row]));
  for (const reservation of reservations) {
    const cell = byColor.get(reservation.color)?.grades[reservation.grade];
    if (!cell) continue;
    const stemsPerBunch = cell.bunches ? cell.stems / cell.bunches : 0;
    cell.bunches = Math.max(0, cell.bunches - Number(reservation.bunches));
    cell.stems = Math.max(0, Math.round(cell.stems - Number(reservation.bunches) * stemsPerBunch));
  }
  const assorted = byColor.get('COLORES SURTIDOS');
  if (assorted) for (const grade of Object.keys(assorted.grades)) {
    assorted.grades[grade] = { bunches: 0, stems: 0 };
    for (const color of assortedColors) {
      const cell = byColor.get(color)?.grades[grade];
      if (cell) { assorted.grades[grade].bunches += cell.bunches; assorted.grades[grade].stems += cell.stems; }
    }
  }
  return available;
}

module.exports = { allocateReservations, applyReservations };
