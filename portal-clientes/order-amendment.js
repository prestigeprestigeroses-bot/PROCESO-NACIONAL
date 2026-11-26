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

module.exports = { planAdditions };
