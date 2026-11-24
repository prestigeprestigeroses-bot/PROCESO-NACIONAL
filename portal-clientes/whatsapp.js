const adminPhone = String(process.env.WHATSAPP_ADMIN_PHONE || '573002543548').replace(/\D/g, '');

function configurationIssues() {
  const values = {
    WHATSAPP_PHONE_NUMBER_ID: String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim(),
    WHATSAPP_ACCESS_TOKEN: String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim(),
    WHATSAPP_GRAPH_VERSION: String(process.env.WHATSAPP_GRAPH_VERSION || '').trim(),
    WHATSAPP_TEMPLATE_NAME: String(process.env.WHATSAPP_TEMPLATE_NAME || '').trim(),
    WHATSAPP_TEMPLATE_LANGUAGE: String(process.env.WHATSAPP_TEMPLATE_LANGUAGE || '').trim(),
    PORTAL_PUBLIC_URL: String(process.env.PORTAL_PUBLIC_URL || '').trim()
  };
  const issues = Object.entries(values).filter(([, value]) => !value).map(([key]) => `${key}: falta configurar`);
  if (values.WHATSAPP_PHONE_NUMBER_ID && !/^\d+$/.test(values.WHATSAPP_PHONE_NUMBER_ID)) issues.push('WHATSAPP_PHONE_NUMBER_ID: debe contener solo dígitos');
  if (values.WHATSAPP_GRAPH_VERSION && !/^v\d+\.\d+$/.test(values.WHATSAPP_GRAPH_VERSION)) issues.push('WHATSAPP_GRAPH_VERSION: usa el formato v25.0');
  if (values.WHATSAPP_TEMPLATE_NAME && !/^[a-z0-9_]+$/.test(values.WHATSAPP_TEMPLATE_NAME)) issues.push('WHATSAPP_TEMPLATE_NAME: usa minúsculas, números y guiones bajos');
  if (values.WHATSAPP_TEMPLATE_LANGUAGE && !/^[a-z]{2}(?:_[A-Z]{2})?$/.test(values.WHATSAPP_TEMPLATE_LANGUAGE)) issues.push('WHATSAPP_TEMPLATE_LANGUAGE: usa el formato es_CO');
  if (values.PORTAL_PUBLIC_URL && !/^https:\/\/[^\s/]+(?:\/.*)?$/.test(values.PORTAL_PUBLIC_URL)) issues.push('PORTAL_PUBLIC_URL: debe ser una dirección https:// válida');
  if (!/^\d{10,15}$/.test(adminPhone)) issues.push('WHATSAPP_ADMIN_PHONE: debe tener entre 10 y 15 dígitos');
  return issues;
}

function config() {
  const phoneId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const token = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const version = String(process.env.WHATSAPP_GRAPH_VERSION || '').trim();
  const template = String(process.env.WHATSAPP_TEMPLATE_NAME || '').trim();
  const language = String(process.env.WHATSAPP_TEMPLATE_LANGUAGE || '').trim();
  const publicUrl = String(process.env.PORTAL_PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (configurationIssues().length) return null;
  return { phoneId, token, version, template, language, publicUrl };
}

async function sendOrderNotice(order) {
  const settings = config();
  if (!settings) throw new Error('WhatsApp Business Platform no está configurado.');
  const reviewUrl = `${settings.publicUrl}/?pedido=${order.id}`;
  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.length) throw new Error('El pedido no tiene productos para notificar.');
  const parts = [];
  if (order.pickup_date) parts.push(`*Recogida:* ${String(order.pickup_date).slice(0, 10)} a las ${String(order.pickup_hour).padStart(2, '0')}:00`);
  let truncated = false;
  for (const item of items) {
    const part = `*${item.color}* — ${item.grade}: ${item.bunches} ${item.bunches === 1 ? 'ramo' : 'ramos'}`;
    if ([...parts, part].join(' | ').length > 650) { truncated = true; break; }
    parts.push(part);
  }
  if (truncated) parts.push('Ver el resto del pedido en el enlace');
  const detail = parts.join(' | ');
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
          { type: 'text', text: detail },
          { type: 'text', text: new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Number(order.total)) },
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
    const details = String(result.error?.error_data?.details || '').replace(/[\r\n\t]/g, ' ').slice(0, 180);
    throw new Error(`Meta rechazó el aviso${code}${details ? `: ${details}` : ''}.`);
  }
  return result.messages[0].id;
}

module.exports = { adminPhone, config, configurationIssues, sendOrderNotice };
