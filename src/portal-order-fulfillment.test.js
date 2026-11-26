const test = require('node:test');
const assert = require('node:assert/strict');
const { missingOrderItems } = require('./portal-order-fulfillment');

test('una remisión cubre los grados y colores del pedido, incluidos surtidos y Eucalipto', () => {
  const order = [
    { color: 'ROJOS', grade: 'NACIONAL', bunches: 2 },
    { color: 'COLORES SURTIDOS', grade: 'BAJAS', bunches: 3 },
    { color: 'EUCALIPTO', grade: 'EUCALIPTO', bunches: 12 }
  ];
  const remission = [
    { variety: 'FREEDOM', gradeCm: 'NACIONAL', bunches: 2, stems: 50 },
    { variety: 'MONDIAL', gradeCm: 'BAJAS', bunches: 2, stems: 50 },
    { variety: 'PINK FLOYD', gradeCm: 'BAJAS', bunches: 1, stems: 25 },
    { variety: 'EUCALIPTO', gradeCm: 'HOJA', bunches: 0, stems: 12 }
  ];
  assert.deepEqual(missingOrderItems(order, remission), []);
});

test('no cuenta dos veces un ramo ni usa rojos para surtidos', () => {
  const order = [
    { color: 'BLANCOS', grade: 'NACIONAL', bunches: 2 },
    { color: 'COLORES SURTIDOS', grade: 'NACIONAL', bunches: 2 }
  ];
  const remission = [
    { variety: 'MONDIAL', gradeCm: 'NACIONAL', bunches: 3, stems: 75 },
    { variety: 'FREEDOM', gradeCm: 'NACIONAL', bunches: 2, stems: 50 }
  ];
  assert.deepEqual(missingOrderItems(order, remission), ['1 ramo de COLORES SURTIDOS · NACIONAL']);
});
