const test = require('node:test');
const assert = require('node:assert/strict');
const { allocateReservations } = require('./reservations');

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
