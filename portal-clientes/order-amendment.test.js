const test = require('node:test');
const assert = require('node:assert/strict');
const { customerPrices, planAdditions } = require('./order-amendment');

test('PRESTIGE paga 5.000 por Nacional y los demás clientes conservan su precio', () => {
  const general = { NACIONAL: 10500, BAJAS: 12000 };
  const prestige = customerPrices(general, 'PRESTIGIO PERSONAL', ' prestige ');
  const other = customerPrices(general, 'OTRO CLIENTE');
  assert.equal(prestige.NACIONAL, 5000);
  assert.equal(prestige.BAJAS, 12000);
  assert.equal(other.NACIONAL, 10500);
  assert.equal(general.NACIONAL, 10500);
  const requested = new Map([['ROJOS|NACIONAL', 2]]);
  assert.equal(planAdditions(requested, [], prestige).addedTotal, 10000);
  assert.equal(planAdditions(requested, [], other).addedTotal, 21000);
});

test('ampliar un pedido conserva el precio anterior del mismo producto y cobra el nuevo al precio actual', () => {
  const requested = new Map([['BLANCOS|NACIONAL', 2], ['PEACH|BAJAS', 3]]);
  const previous = [{ id: 7, color: 'BLANCOS', grade: 'NACIONAL', price_per_bunch: 10000 }];
  const result = planAdditions(requested, previous, { NACIONAL: 11000, BAJAS: 12000 });
  assert.deepEqual(result.additions, [
    { color: 'BLANCOS', grade: 'NACIONAL', bunches: 2, price: 10000, subtotal: 20000 },
    { color: 'PEACH', grade: 'BAJAS', bunches: 3, price: 12000, subtotal: 36000 }
  ]);
  assert.equal(result.addedTotal, 56000);
  assert.equal(result.previousByKey.get('BLANCOS|NACIONAL').id, 7);
});
