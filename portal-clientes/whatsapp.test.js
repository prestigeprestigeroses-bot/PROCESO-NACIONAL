const test = require('node:test');
const assert = require('node:assert/strict');

test('el botón identifica el pedido y la confirmación usa el teléfono del cliente', async () => {
  Object.assign(process.env, {
    WHATSAPP_PHONE_NUMBER_ID: '123456789',
    WHATSAPP_ACCESS_TOKEN: 'token-de-prueba',
    WHATSAPP_GRAPH_VERSION: 'v25.0',
    WHATSAPP_TEMPLATE_NAME: 'aviso_anterior',
    WHATSAPP_TEMPLATE_LANGUAGE: 'es_CO',
    PORTAL_PUBLIC_URL: 'https://portal.ejemplo.com',
    WHATSAPP_APPROVAL_TEMPLATE_NAME: 'aviso_con_boton',
    WHATSAPP_CUSTOMER_TEMPLATE_NAME: 'pedido_aprobado',
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verificacion-de-prueba',
    WHATSAPP_APP_SECRET: 'secreto-de-prueba'
  });
  const whatsapp = require('./whatsapp');
  const sent = [];
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ messages: [{ id: `wamid-${sent.length}` }] }) };
  };
  try {
    await whatsapp.sendOrderNotice({ id: 17, name: 'Cliente de prueba', total: 10000, pickup_date: '2026-11-24', pickup_hour: 7, items: [{ color: 'ROJOS', grade: 'NACIONAL', bunches: 1 }] });
    assert.equal(sent[0].template.name, 'aviso_con_boton');
    assert.equal(sent[0].template.components[0].parameters.length, 5);
    const payload = sent[0].template.components[1].parameters[0].payload;
    assert.equal(whatsapp.approvedPayloadOrderId(payload, process.env.WHATSAPP_APP_SECRET), 17);
    assert.equal(whatsapp.approvedPayloadOrderId(payload.replace('17:', '18:'), process.env.WHATSAPP_APP_SECRET), null);

    process.env.WHATSAPP_DECISION_TEMPLATE_NAME = 'pedido_con_dos_botones';
    await whatsapp.sendOrderNotice({ id: 18, name: 'Cliente de prueba', total: 10000, pickup_date: '2026-11-24', pickup_hour: 7, items: [{ color: 'ROJOS', grade: 'NACIONAL', bunches: 1 }] });
    assert.equal(sent[1].template.name, 'pedido_con_dos_botones');
    const buttons = sent[1].template.components.slice(1);
    assert.deepEqual(buttons.map(button => button.index), ['0', '1']);
    const approve = buttons[0].parameters[0].payload;
    const reject = buttons[1].parameters[0].payload;
    assert.deepEqual(whatsapp.payloadDecision(approve, process.env.WHATSAPP_APP_SECRET), { orderId: 18, decision: 'APROBADO' });
    assert.deepEqual(whatsapp.payloadDecision(reject, process.env.WHATSAPP_APP_SECRET), { orderId: 18, decision: 'RECHAZADO' });
    assert.equal(whatsapp.payloadDecision(reject.replace('rechazar:', 'aprobar:'), process.env.WHATSAPP_APP_SECRET), null);
    assert.equal(whatsapp.payloadDecision(reject.replace('18:', '19:'), process.env.WHATSAPP_APP_SECRET), null);
    assert.equal(whatsapp.approvedPayloadOrderId(reject, process.env.WHATSAPP_APP_SECRET), null);

    await whatsapp.sendCustomerApproval({ id: 17, name: 'Cliente de prueba', phone: '3123272558', total: 10000, pickup_date: '2026-11-24', pickup_hour: 7 });
    assert.equal(sent[2].to, '573123272558');
    assert.equal(sent[2].template.name, 'pedido_aprobado');
    assert.deepEqual(sent[2].template.components[0].parameters.map(p => p.text), ['Cliente de prueba', '17', '10.000', '2026-11-24 a las 07:00']);
  } finally { global.fetch = originalFetch; }
});
