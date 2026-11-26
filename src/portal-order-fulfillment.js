const { colorOf, normalizeVariety } = require('../portal-clientes/colors');

function missingOrderItems(orderItems, remissionItems) {
  const available = new Map();
  let eucalyptusStems = 0;
  for (const item of remissionItems) {
    if (item.gradeCm === 'HOJA' && normalizeVariety(item.variety) === 'EUCALIPTO') {
      eucalyptusStems += Number(item.stems);
      continue;
    }
    const color = colorOf.get(normalizeVariety(item.variety));
    if (!color) continue;
    const key = `${color}|${item.gradeCm}`;
    available.set(key, (available.get(key) || 0) + Number(item.bunches));
  }
  const missing = [];
  for (const item of orderItems.filter(row => row.color !== 'COLORES SURTIDOS')) {
    const needed = Number(item.bunches);
    if (item.grade === 'EUCALIPTO') {
      if (eucalyptusStems < needed) missing.push(`${needed - eucalyptusStems} tallos de Eucalipto`);
      eucalyptusStems = Math.max(0, eucalyptusStems - needed);
      continue;
    }
    const key = `${item.color}|${item.grade}`;
    const remaining = available.get(key) || 0;
    if (remaining < needed) missing.push(`${needed - remaining} ${needed - remaining === 1 ? 'ramo' : 'ramos'} de ${item.color} · ${item.grade}`);
    available.set(key, Math.max(0, remaining - needed));
  }
  for (const item of orderItems.filter(row => row.color === 'COLORES SURTIDOS')) {
    let needed = Number(item.bunches);
    for (const [key, remaining] of available) {
      const [color, grade] = key.split('|');
      if (color === 'ROJOS' || grade !== item.grade) continue;
      const taken = Math.min(needed, remaining);
      available.set(key, remaining - taken);
      needed -= taken;
      if (!needed) break;
    }
    if (needed) missing.push(`${needed} ${needed === 1 ? 'ramo' : 'ramos'} de COLORES SURTIDOS · ${item.grade}`);
  }
  return missing;
}

module.exports = { missingOrderItems };
