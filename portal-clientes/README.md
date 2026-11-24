# Portal de pedidos de Prestige Roses

Aplicación separada del programa de remisiones. Lee el mismo PostgreSQL, muestra existencias por **color y grado** y guarda pedidos en tablas `portal_*`. No modifica las tablas ni el código de las remisiones.

## Iniciar

Desde esta carpeta: `npm install` y `npm start`. Se abre en `http://127.0.0.1:3018/`.

En este repositorio, toma `DATABASE_URL`, `APP_PASSWORD` y `SESSION_SECRET` del `.env` principal. Si quiere credenciales distintas para el portal, cree un `.env` aquí siguiendo `.env.example` y configure `PORTAL_ADMIN_PASSWORD` y `PORTAL_SESSION_SECRET`. Para desplegarlo aparte son obligatorias `DATABASE_URL`, `PORTAL_ADMIN_PASSWORD` y `PORTAL_SESSION_SECRET`; use HTTPS.

El administrador entra marcando **Ingresar como administrador** y usando la contraseña configurada. Desde su panel crea, edita y elimina clientes y pedidos. Al eliminar un cliente también se borran sus pedidos; al eliminar un pedido se borran sus productos y su aviso de WhatsApp. Estas acciones no afectan las remisiones ni devuelven flor al inventario. Las claves nuevas de clientes tienen exactamente 4 caracteres; las claves existentes siguen funcionando hasta cambiarlas. El acceso bloquea temporalmente los intentos repetidos con una clave incorrecta. El administrador también cambia los cinco precios generales. Se cargan con importes **de ejemplo** de 10.000, 12.000, 8.000, 7.000 y 9.000 COP **por ramo**. Cámbielos antes de usar el portal comercialmente. Los pedidos guardan una copia del precio vigente al enviarse.

Los clientes entran con su teléfono y clave y ven una tabla con colores por fila y grados por columna. La opción final, **Colores surtidos**, permite pedir ramos mezclados por grado sin elegir la mezcla exacta. **No incluye rojos (Freedom y Explorer)**. Pueden agregar ramos de varios colores al mismo pedido. Al combinar surtidos y colores individuales, el portal comprueba que las cantidades juntas no superen las existencias. **Exportación granel** tiene precio editable en el administrador y permite que el cliente indique la cantidad por color sin consultar inventario. Esta cantidad queda como solicitud y requiere revisión manual. El panel del administrador muestra las solicitudes pendientes con etiquetas de su color y avisa en el navegador si entra una nueva. Actualiza cada 10 segundos.

Cada pedido nuevo pide día y hora de recogida (hora completa, sin minutos). Las horas van desde las 6 a. m. hasta la 1 p. m., excepto los martes, cuando llegan hasta las 2 p. m. Ambos datos se guardan en el pedido, se muestran al cliente y al administrador y se incluyen en el aviso de WhatsApp.

Cuando el portal tiene configurada la **WhatsApp Business Platform**, al registrar un pedido solicita automáticamente a Meta que envíe un aviso a **+57 300 254 3548** (o al número definido en `WHATSAPP_ADMIN_PHONE`). El aviso incluye número de pedido, cliente, colores, grados, cantidades, total estimado y un enlace para abrirlo desde el teléfono. Si el detalle es demasiado largo, el mensaje muestra el inicio y el enlace permite ver el pedido completo. El administrador inicia sesión en el portal desde ese enlace y aprueba o rechaza. Sin la configuración adicional de aprobación por botón, al decidir se abre un mensaje preparado para responder al cliente manualmente.

Para activar los avisos automáticos, configure `PORTAL_PUBLIC_URL` (HTTPS), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_GRAPH_VERSION`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANGUAGE` y opcionalmente `WHATSAPP_ADMIN_PHONE` en el entorno del portal. El número remitente debe estar conectado a Meta Cloud API y la plantilla de utilidad aprobada debe tener cinco parámetros de cuerpo, en este orden: **número de pedido, nombre del cliente, detalle de colores/grados/ramos, total COP, enlace al pedido**. Texto sugerido: `Nuevo pedido #{{1}} de {{2}}. Productos: {{3}}. Total estimado COP {{4}}. Ver pedido: {{5}}`. El nombre e idioma deben coincidir exactamente con los de la plantilla aprobada. Guarde el token solo en variables de entorno, nunca en Git.

Cada pedido nuevo queda en la cola `portal_whatsapp_notifications`. Si Meta rechaza el envío, el portal lo reintenta y muestra el estado en el panel. `SOLICITADO` significa que Meta aceptó la solicitud; no confirma entrega al teléfono. Si la integración no está configurada, el portal deshabilita los pedidos nuevos y muestra un aviso. El cliente no necesita abrir WhatsApp para enviar el pedido.

## Aprobar desde WhatsApp y confirmar al cliente

El portal admite un botón **Aprobar pedido** en el mensaje que recibe el administrador. Al pulsarlo, Meta envía la respuesta al webhook `PORTAL_PUBLIC_URL/webhooks/whatsapp`. El portal verifica la firma de Meta, el número del administrador, el identificador del mensaje original y que el pedido siga pendiente. Después comprueba de nuevo el inventario y lo aprueba. La confirmación al cliente se envía mediante una cola con reintentos; también se usa cuando el administrador aprueba desde el portal. La respuesta al administrador indica si se aprobó o por qué no pudo aprobarse. Para rechazar, se sigue usando el portal.

Para activar esta función, además de las variables de la sección anterior, configure en Railway:

- `WHATSAPP_APPROVAL_TEMPLATE_NAME`: nombre de una **nueva** plantilla de utilidad aprobada con los mismos cinco parámetros de cuerpo del aviso actual y un botón de respuesta rápida **Aprobar pedido** como primer botón. El cuerpo puede tener saltos de línea fijos. El portal envía el identificador seguro del pedido como carga útil del botón.
- `WHATSAPP_CUSTOMER_TEMPLATE_NAME`: nombre de otra plantilla de utilidad aprobada para la confirmación al cliente, con cuatro parámetros de cuerpo en este orden: nombre, número de pedido, total COP y fecha/hora de recogida.
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`: cadena secreta elegida por usted, idéntica a la que ingrese al configurar el webhook en Meta.
- `WHATSAPP_APP_SECRET`: clave secreta de la app en Meta Developers > Configuración de la app > Básica. No es el token de acceso de WhatsApp.

Texto sugerido para la plantilla del administrador (cinco variables en el cuerpo, un botón de respuesta rápida **Aprobar pedido**):

```text
Prestige Roses recibió un nuevo pedido.

*Pedido:* #{{1}}
*Cliente:* {{2}}

*Recogida y productos:* {{3}}

*Total estimado:* COP {{4}}

*Ver pedido:* {{5}}

Revisa los detalles antes de aprobar.
```

Texto sugerido para la plantilla al cliente (cuatro variables en el cuerpo):

```text
Hola {{1}}, tu pedido #{{2}} de Prestige Roses fue aprobado.

*Total a pagar:* COP {{3}}
*Recogida:* {{4}}

Gracias por tu pedido.
```

En Meta Developers > su app > WhatsApp > Configuración de producción > Webhooks, coloque como URL de devolución de llamada `https://SU-DOMINIO/webhooks/whatsapp` y el token de verificación anterior. Suscriba el campo **messages** de la cuenta de WhatsApp y publique la app para recibir eventos de producción. Mantenga las plantillas anteriores activas hasta que las nuevas sean aprobadas. Los nombres e idioma de ambas nuevas plantillas deben coincidir exactamente con los configurados. Guarde las claves solo en Railway, nunca en Git. Si la confirmación falla, `portal_customer_notifications` conserva el error y la reintenta hasta diez veces. La aceptación de Meta no garantiza entrega al teléfono.

## Límites actuales

- Sin cuenta de WhatsApp Business Platform, número remitente, plantillas aprobadas y dirección pública HTTPS, el envío automático no se puede activar. La aprobación desde WhatsApp requiere además el botón y el webhook configurados; escribir «aprobar» como texto no cambia el pedido.
- El pedido aprobado **no crea una remisión ni descuenta o reserva inventario**. El inventario se vuelve a comprobar al aprobar. El personal debe registrar la remisión en el programa principal para descontar la flor; si cambia el inventario entre aprobación y remisión, hay que coordinar con el cliente.
- Bajas y Bajas granel son grados de inventario independientes. El portal valida cada grado por separado. El precio mostrado es por ramo, incluidos los grados granel.
- Las variedades que no estén en la tabla de colores proporcionada no se muestran. Los nombres alternativos `QUICKSAND`/`QUICK SAND`, `SOMMERSAND`/`SUMMERSAND` y `MOODY BLUE`/`MOODY BLUES` se agrupan en el mismo color.
