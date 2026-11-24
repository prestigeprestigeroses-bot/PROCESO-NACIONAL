function allocateReservations(catalog, requested, assortedColors) {
  const remaining = new Map(catalog.flatMap(row => Object.entries(row.grades).map(([grade, stock]) => [`${row.color}|${grade}`, Number(stock.bunches)])));
  const allocations = [];
  for (const item of requested.filter(item => item.color !== 'COLORES SURTIDOS' && item.grade !== 'EXPORTACION GRANEL')) {
    const key = `${item.color}|${item.grade}`;
    const available = remaining.get(key) || 0;
    if (item.bunches > available) throw new Error(`Inventario insuficiente de ${item.color} · ${item.grade}.`);
    remaining.set(key, available - item.bunches);
    allocations.push({ color: item.color, grade: item.grade, bunches: item.bunches });
  }
  for (const item of requested.filter(item => item.color === 'COLORES SURTIDOS' && item.grade !== 'EXPORTACION GRANEL')) {
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
    if (needed) throw new Error(`No hay suficientes ramos para colores surtidos · ${item.grade}.`);
  }
  return allocations;
}

module.exports = { allocateReservations };
