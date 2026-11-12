# Portal de pedidos de Prestige Roses

Aplicación separada del programa de remisiones. Lee el mismo PostgreSQL, muestra existencias por **color y grado** y guarda pedidos en tablas `portal_*`. No modifica las tablas ni el código de las remisiones.

## Iniciar

Desde esta carpeta: `npm install` y `npm start`. Se abre en `http://127.0.0.1:3018/`.

En este repositorio, toma `DATABASE_URL`, `APP_PASSWORD` y `SESSION_SECRET` del `.env` principal. Si quiere credenciales distintas para el portal, cree un `.env` aquí siguiendo `.env.example` y configure `PORTAL_ADMIN_PASSWORD` y `PORTAL_SESSION_SECRET`. Para desplegarlo aparte son obligatorias `DATABASE_URL`, `PORTAL_ADMIN_PASSWORD` y `PORTAL_SESSION_SECRET`; use HTTPS.

El administrador entra marcando **Ingresar como administrador** y usando la contraseña configurada. Desde su panel crea cuentas de clientes y cambia los cuatro precios generales. Se cargan con importes **de ejemplo** de 10.000, 12.000, 8.000 y 7.000 COP **por ramo**. Cámbielos antes de usar el portal comercialmente. Los pedidos guardan una copia del precio vigente al enviarse.

Los clientes entran con su teléfono y clave, escogen un color y ven únicamente los grados disponibles de ese color. La opción final, **Colores surtidos**, permite pedir ramos mezclados por grado sin elegir la mezcla exacta. **No incluye rojos (Freedom y Explorer)**. Pueden agregar ramos de varios colores al mismo pedido. Al combinar surtidos y colores individuales, el portal comprueba que las cantidades juntas no superen las existencias. El panel del administrador muestra las solicitudes pendientes con etiquetas de su color y avisa en el navegador si entra una nueva. Actualiza cada 10 segundos.

Cuando el portal tiene configurada la **WhatsApp Business Platform**, al registrar un pedido solicita automáticamente a Meta que envíe un aviso a **+57 300 254 3548**. El aviso incluye número de pedido, cliente, total estimado y un enlace para abrirlo desde el teléfono. El administrador inicia sesión en el portal desde ese enlace y aprueba o rechaza. Al decidir, se abre un mensaje preparado para responder al cliente; el administrador aún debe pulsar Enviar en WhatsApp.

Para activar los avisos automáticos, configure `PORTAL_PUBLIC_URL` (HTTPS), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_GRAPH_VERSION`, `WHATSAPP_TEMPLATE_NAME` y `WHATSAPP_TEMPLATE_LANGUAGE` en el entorno del portal. El número remitente debe estar conectado a Meta Cloud API y la plantilla de utilidad aprobada debe tener cuatro parámetros de cuerpo, en este orden: **número de pedido, nombre del cliente, total COP, enlace al pedido**. Texto sugerido: `Nuevo pedido #{{1}} de {{2}}. Total estimado COP {{3}}. Revísalo y confírmalo aquí: {{4}}`. El nombre e idioma deben coincidir exactamente con los de la plantilla aprobada. Guarde el token solo en variables de entorno, nunca en Git.

Cada pedido nuevo queda en la cola `portal_whatsapp_notifications`. Si Meta rechaza el envío, el portal lo reintenta y muestra el estado en el panel. `SOLICITADO` significa que Meta aceptó la solicitud; no confirma entrega al teléfono. Si la integración no está configurada, el portal mantiene la alternativa manual: abre el mensaje para que el cliente pulse Enviar y no presenta esa acción como automática.

## Límites actuales

- Sin cuenta de WhatsApp Business Platform, número remitente, plantilla aprobada y dirección pública HTTPS, el envío automático no se puede activar. La aprobación se hace en el portal móvil al abrir el enlace del mensaje, no escribiendo «aprobar» en la conversación.
- El pedido aprobado **no crea una remisión ni descuenta o reserva inventario**. El inventario se vuelve a comprobar al aprobar. El personal debe registrar la remisión en el programa principal para descontar la flor; si cambia el inventario entre aprobación y remisión, hay que coordinar con el cliente.
- Bajas y Bajas granel son grados de inventario independientes. El portal valida cada grado por separado. El precio mostrado es por ramo, incluidos los grados granel.
- Las variedades que no estén en la tabla de colores proporcionada no se muestran. Los nombres alternativos `QUICKSAND`/`QUICK SAND`, `SOMMERSAND`/`SUMMERSAND` y `MOODY BLUE`/`MOODY BLUES` se agrupan en el mismo color.
