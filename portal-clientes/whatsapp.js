const adminPhone = '573002543548';

function config() {
  const phoneId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const token = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const version = String(process.env.WHATSAPP_GRAPH_VERSION || '').trim();
  const template = String(process.env.WHATSAPP_TEMPLATE_NAME || '').trim();
  const language = String(process.env.WHATSAPP_TEMPLATE_LANGUAGE || '').trim();
  const publicUrl = String(process.env.PORTAL_PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (!phoneId || !token || !version || !template || !language || !publicUrl) return null;
  if (!/^\d+$/.test(phoneId) || !/^v\d+\.\d+$/.test(version) || !/^[a-z0-9_]+$/.test(template) || !/^[a-z]{2}(?:_[A-Z]{2})?$/.test(language) || !/^https:\/\//.test(publicUrl)) return null;
  return { phoneId, token, version, template, language, publicUrl };
}

async function sendOrderNotice(order) {
  const settings = config();
  if (!settings) throw new Error('WhatsApp Business Platform no está configurado.');
  const reviewUrl = `${settings.publicUrl}/?pedido=${order.id}`;
  const payload = {
    messaging_product: 'whatsapp',
    to: adminPhone,
    type: 'template',
    template: {
      name: settings.template,
      language: { code: settings.language },
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: String(order.id) },
          { type: 'text', text: String(order.name) },
          { type: 'text', text: String(order.total) },
          { type: 'text', text: reviewUrl }
        ]
      }]
    }
  };
  const response = await fetch(`https://graph.facebook.com/${settings.version}/${settings.phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.messages?.[0]?.id) {
    const code = result.error?.code ? ` (código ${result.error.code})` : '';
    throw new Error(`Meta rechazó el aviso${code}.`);
  }
  return result.messages[0].id;
}

module.exports = { adminPhone, config, sendOrderNotice };
