const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPortalShortages } = require('./portal-shortages');

test('avisa solo cuando las reservas superan la flor física tras un desecho', () => {
  const orders = [{ order_id: 12, name: 'Cliente', pickup_date: '2026-11-27', color: 'ROJOS', grade: 'NACIONAL', bunches: 8 }];
  const beforeWaste = [{ variety: 'Freedom', gradeCm: 'NACIONAL', bunches: 10 }];
  assert.deepEqual(buildPortalShortages(beforeWaste, orders), []);
  const afterWaste = [{ variety: 'Freedom', gradeCm: 'NACIONAL', bunches: 6 }];
  assert.deepEqual(buildPortalShortages(afterWaste, orders), [{
    color: 'ROJOS', grade: 'NACIONAL', physical: 6, reserved: 8, shortage: 2,
    orders: [{ id: 12, name: 'Cliente', pickupDate: '2026-11-27', bunches: 8 }]
  }]);
});

test('agrega variedades del mismo color y no confunde surtidos con existencias adicionales', () => {
  const inventory = [
    { variety: 'Freedom', gradeCm: 'NACIONAL', bunches: 3 },
    { variety: 'Explorer', gradeCm: 'NACIONAL', bunches: 4 }
  ];
  const reservations = [
    { order_id: 1, name: 'A', pickup_date: '2026-11-27', color: 'ROJOS', grade: 'NACIONAL', bunches: 5 },
    { order_id: 2, name: 'B', pickup_date: '2026-11-27', color: 'ROJOS', grade: 'NACIONAL', bunches: 4 }
  ];
  assert.equal(buildPortalShortages(inventory, reservations)[0].shortage, 2);
});
