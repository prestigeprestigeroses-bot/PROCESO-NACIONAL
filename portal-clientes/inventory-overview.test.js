const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInventoryOverview } = require('./inventory-overview');

test('muestra inventario real, reservas por pedido y faltante sin duplicar colores surtidos', () => {
  const grades = ['NACIONAL', 'BAJAS', 'EUCALIPTO'];
  const root = [
    { color: 'ROJOS', grades: { NACIONAL: { bunches: 29 }, BAJAS: { bunches: 0 }, EUCALIPTO: { bunches: 0 } } },
    { color: 'COLORES SURTIDOS', grades: { NACIONAL: { bunches: 29 }, BAJAS: { bunches: 0 }, EUCALIPTO: { bunches: 0 } } },
    { color: 'EUCALIPTO', grades: { NACIONAL: { bunches: 0 }, BAJAS: { bunches: 0 }, EUCALIPTO: { bunches: 0 } } }
  ];
  const reservations = [
    { order_id: 30, name: 'Cliente A', status: 'APROBADO', color: 'ROJOS', grade: 'NACIONAL', bunches: 1 },
    { order_id: 31, name: 'Cliente B', status: 'APROBADO', color: 'ROJOS', grade: 'NACIONAL', bunches: 22 },
    { order_id: 33, name: 'Cliente C', status: 'PENDIENTE', color: 'ROJOS', grade: 'NACIONAL', bunches: 10 }
  ];
  const result = buildInventoryOverview(root, reservations, grades, 'COLORES SURTIDOS');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    color: 'ROJOS', grade: 'NACIONAL', real: 29, pending: 10, approved: 23,
    available: 0, shortage: 4,
    orders: [
      { id: 30, name: 'Cliente A', status: 'APROBADO', bunches: 1 },
      { id: 31, name: 'Cliente B', status: 'APROBADO', bunches: 22 },
      { id: 33, name: 'Cliente C', status: 'PENDIENTE', bunches: 10 }
    ]
  });
});
