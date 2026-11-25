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

test('eucalipto se pide por tallos sin reservar ramos de rosas', () => {
  assert.deepEqual(allocateReservations(catalog, [
    { color: 'EUCALIPTO', grade: 'EUCALIPTO', bunches: 10 }
  ], ['BLANCOS', 'AMARILLOS']), []);
});

test('surtidos comparte los 16 ramos no rojos sin duplicar el inventario', () => {
  const real = [
    { color: 'ROJOS', grades: { NACIONAL: { bunches: 5, stems: 125 } } },
    { color: 'BLANCOS', grades: { NACIONAL: { bunches: 9, stems: 225 } } },
    { color: 'AMARILLOS', grades: { NACIONAL: { bunches: 7, stems: 175 } } },
    { color: 'COLORES SURTIDOS', grades: { NACIONAL: { bunches: 16, stems: 400 } } }
  ];
  assert.equal(applyReservations(real, [], ['BLANCOS', 'AMARILLOS'])[3].grades.NACIONAL.bunches, 16);
  const allocations = allocateReservations(real, [{ color: 'COLORES SURTIDOS', grade: 'NACIONAL', bunches: 10 }], ['BLANCOS', 'AMARILLOS']);
  const available = applyReservations(real, allocations, ['BLANCOS', 'AMARILLOS']);
  assert.equal(available[3].grades.NACIONAL.bunches, 6);
  assert.equal(available[0].grades.NACIONAL.bunches, 5);
  assert.throws(() => allocateReservations(real, [
    { color: 'BLANCOS', grade: 'NACIONAL', bunches: 9 },
    { color: 'COLORES SURTIDOS', grade: 'NACIONAL', bunches: 8 }
  ], ['BLANCOS', 'AMARILLOS']), error => error.code === 'INSUFFICIENT_INVENTORY');
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
