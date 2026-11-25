const test = require('node:test');
const assert = require('node:assert/strict');
const { checkProtectedStock, validateRemissionItems } = require('./portal-link');

test('la remisión puede cubrir varios pedidos del mismo cliente, incluidos colores surtidos', () => {
  const orders = [
    { color: 'ROJOS', grade: 'NACIONAL', bunches: 1 },
    { color: 'ROJOS', grade: 'NACIONAL', bunches: 22 },
    { color: 'BLANCOS', grade: 'BAJAS', bunches: 2 },
    { color: 'COLORES SURTIDOS', grade: 'BAJAS', bunches: 3 }
  ];
  const shipped = [
    { variety: 'Freedom', grade_cm: 'NACIONAL', bunches: 23 },
    { variety: 'Mondial', grade_cm: 'BAJAS', bunches: 2 },
    { variety: 'Pink Floyd', grade_cm: 'BAJAS', bunches: 3 }
  ];
  assert.doesNotThrow(() => validateRemissionItems(orders, shipped));
  assert.throws(() => validateRemissionItems(orders, shipped.map(item => item.variety === 'Freedom' ? { ...item, bunches: 22 } : item)), /ROJOS · NACIONAL/);
  assert.throws(() => validateRemissionItems(orders, shipped.map(item => item.variety === 'Pink Floyd' ? { ...item, variety: 'Explorer' } : item)), /colores surtidos · BAJAS/);
});

test('el eucalipto del portal se compara con los tallos de la remisión', () => {
  const order = [{ color: 'EUCALIPTO', grade: 'EUCALIPTO', bunches: 50 }];
  assert.doesNotThrow(() => validateRemissionItems(order, [{ variety: 'EUCALIPTO', gradeCm: 'HOJA', stems: 50, bunches: 0 }]));
  assert.throws(() => validateRemissionItems(order, [{ variety: 'EUCALIPTO', gradeCm: 'HOJA', stems: 25, bunches: 0 }]), /EUCALIPTO/);
});

test('una salida aparte no puede consumir la flor reservada', () => {
  const real = new Map([['ROJOS|NACIONAL', 20]]);
  const reserved = new Map([['ROJOS|NACIONAL', 10]]);
  assert.doesNotThrow(() => checkProtectedStock(real, reserved, new Map([['ROJOS|NACIONAL', 10]])));
  assert.throws(() => checkProtectedStock(real, reserved, new Map([['ROJOS|NACIONAL', 15]])), /Disponibles para otras salidas: 10/);
  assert.doesNotThrow(() => checkProtectedStock(real, new Map(), new Map([['ROJOS|NACIONAL', 15]])));
});
