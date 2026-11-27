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
    color: 'ROJOS', grade: 'NACIONAL', real: 29, pending: 10, approved: 23, dispatched: 0,
    available: 0, shortage: 4,
    orders: [
      { id: 30, name: 'Cliente A', status: 'APROBADO', bunches: 1 },
      { id: 31, name: 'Cliente B', status: 'APROBADO', bunches: 22 },
      { id: 33, name: 'Cliente C', status: 'PENDIENTE', bunches: 10 }
    ]
  });
});

test('un despacho ya descontado del inventario real no reduce de nuevo lo disponible', () => {
  const root = [{ color: 'ROJOS', grades: { NACIONAL: { bunches: 5 } } }];
  const reservations = [
    { order_id: 42, name: 'Rita', status: 'DESPACHADO_MANUAL', color: 'ROJOS', grade: 'NACIONAL', bunches: 3 },
    { order_id: 43, name: 'Anibal', status: 'APROBADO', color: 'ROJOS', grade: 'NACIONAL', bunches: 5 }
  ];
  const [cell] = buildInventoryOverview(root, reservations, ['NACIONAL'], 'COLORES SURTIDOS');
  assert.equal(cell.dispatched, 3);
  assert.equal(cell.approved, 5);
  assert.equal(cell.available, 0);
  assert.equal(cell.shortage, 0);
});

test('el disponible se calcula por color y categoría solo con pedidos activos', () => {
  const root = [
    { color: 'ROJOS', grades: { NACIONAL: { bunches: 39 } } },
    { color: 'BLANCOS', grades: { NACIONAL: { bunches: 22 } } }
  ];
  const reservations = [
    { order_id: 45, name: 'Rita', status: 'DESPACHADO_MANUAL', color: 'ROJOS', grade: 'NACIONAL', bunches: 21 },
    { order_id: 43, name: 'Anibal', status: 'APROBADO', color: 'ROJOS', grade: 'NACIONAL', bunches: 39 },
    { order_id: 44, name: 'Carlos', status: 'APROBADO', color: 'BLANCOS', grade: 'NACIONAL', bunches: 21 }
  ];
  const cells = buildInventoryOverview(root, reservations, ['NACIONAL'], 'COLORES SURTIDOS');
  assert.equal(cells.reduce((sum, cell) => sum + cell.real, 0), 61);
  assert.equal(cells.reduce((sum, cell) => sum + cell.approved, 0), 60);
  assert.equal(cells.reduce((sum, cell) => sum + cell.available, 0), 1);
  assert.equal(cells.reduce((sum, cell) => sum + cell.shortage, 0), 0);
});

test('la alerta permanece si los pedidos activos superan el inventario real', () => {
  const root = [{ color: 'ROJOS', grades: { NACIONAL: { bunches: 5 } } }];
  const reservations = [
    { order_id: 42, name: 'Rita', status: 'DESPACHADO_MANUAL', color: 'ROJOS', grade: 'NACIONAL', bunches: 3 },
    { order_id: 43, name: 'Anibal', status: 'APROBADO', color: 'ROJOS', grade: 'NACIONAL', bunches: 6 }
  ];
  const [cell] = buildInventoryOverview(root, reservations, ['NACIONAL'], 'COLORES SURTIDOS');
  assert.equal(cell.shortage, 1);
});
