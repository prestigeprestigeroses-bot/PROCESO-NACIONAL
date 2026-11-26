const test = require('node:test');
const assert = require('node:assert/strict');
const { planAdditions } = require('./order-amendment');

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
