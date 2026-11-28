function customerPrices(basePrices, customerName, loginIdentifier) {
  const name = String(customerName || '').trim().replace(/\s+/g, ' ').toUpperCase();
  const user = String(loginIdentifier || '').trim().toUpperCase();
  return user === 'PRESTIGE' || name === 'PRESTIGE' ? { ...basePrices, NACIONAL: 5000 } : basePrices;
}

function planAdditions(requested, previousItems, prices) {
  const previousByKey = new Map(previousItems.map(item => [`${item.color}|${item.grade}`, item]));
  const additions = [...requested].map(([key, bunches]) => {
    const [color, grade] = key.split('|');
    const price = Number(previousByKey.get(key)?.price_per_bunch ?? prices[grade]);
    if (!Number.isFinite(price) || price <= 0) throw new Error(`Falta configurar el precio de ${grade}.`);
    return { color, grade, bunches, price, subtotal: bunches * price };
  });
  const addedTotal = additions.reduce((sum, item) => sum + item.subtotal, 0);
  return { additions, previousByKey, addedTotal };
}

module.exports = { customerPrices, planAdditions };
