const test = require('node:test');
const assert = require('node:assert/strict');
const { allocateReservations, applyReservations } = require('./reservations');

const catalog = [
  { color: 'ROJOS', grades: { NACIONAL: { bunches: 3 } } },
  { color: 'BLANCOS', grades: { NACIONAL: { bunches: 2 } } },
  { color: 'AMARILLOS', grades: { NACIONAL: { bunches: 2 } } }
];

test('reserva colores específicos antes de distribuir surtidos sin usar rojos', () => {
  assert.deepEqual(allocateReservations(catalog, [
    { color: 'BLANCOS', grade: 'NACIONAL', bunches: 1 },
    { color: 'COLORES SURTIDOS', grade: 'NACIONAL', bunches: 3 }
  ], ['BLANCOS', 'AMARILLOS']), [
    { color: 'BLANCOS', grade: 'NACIONAL', bunches: 1 },
    { color: 'BLANCOS', grade: 'NACIONAL', bunches: 1 },
    { color: 'AMARILLOS', grade: 'NACIONAL', bunches: 2 }
  ]);
});

test('rechaza un surtido que supera los colores disponibles', () => {
  assert.throws(() => allocateReservations(catalog, [
    { color: 'COLORES SURTIDOS', grade: 'NACIONAL', bunches: 5 }
  ], ['BLANCOS', 'AMARILLOS']), /No hay suficientes ramos/);
});

test('exportación granel mantiene cantidad libre sin reserva', () => {
  assert.deepEqual(allocateReservations(catalog, [
    { color: 'ROJOS', grade: 'EXPORTACION GRANEL', bunches: 10 }
  ], ['BLANCOS', 'AMARILLOS']), []);
});

test('eucalipto se pide por tallos sin reservar rosas', () => {
  const catalog = [{ color: 'EUCALIPTO', grades: { EUCALIPTO: { bunches: 0, stems: 0 } } }];
  assert.deepEqual(allocateReservations(catalog, [{ color: 'EUCALIPTO', grade: 'EUCALIPTO', bunches: 50 }], []), []);
});

test('el pedido reduce solo la vista del portal y cancelarlo restaura la existencia real', () => {
  const real = [
    { color: 'ROJOS', grades: { NACIONAL: { bunches: 10, stems: 250 } } },
    { color: 'COLORES SURTIDOS', grades: { NACIONAL: { bunches: 0, stems: 0 } } }
  ];
  const requested = [{ color: 'ROJOS', grade: 'NACIONAL', bunches: 3 }];
  assert.equal(applyReservations(real, requested, [])[0].grades.NACIONAL.bunches, 7);
  assert.equal(real[0].grades.NACIONAL.bunches, 10);
  assert.equal(applyReservations(real, [], [])[0].grades.NACIONAL.bunches, 10);
});
