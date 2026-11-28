# Portal de pedidos de Prestige Roses

Aplicación separada del programa de remisiones. Lee el inventario real del mismo PostgreSQL por **color y grado**, y descuenta únicamente las reservas de pedidos guardadas en tablas `portal_*`. No modifica las tablas ni el código de las remisiones.

## Iniciar

Desde esta carpeta: `npm install` y `npm start`. Se abre en `http://127.0.0.1:3018/`.

En este repositorio, toma `DATABASE_URL`, `APP_PASSWORD` y `SESSION_SECRET` del `.env` principal. Si quiere credenciales distintas para el portal, cree un `.env` aquí siguiendo `.env.example` y configure `PORTAL_ADMIN_PASSWORD` y `PORTAL_SESSION_SECRET`. Para desplegarlo aparte son obligatorias `DATABASE_URL`, `PORTAL_ADMIN_PASSWORD` y `PORTAL_SESSION_SECRET`; use HTTPS.

El administrador entra marcando **Ingresar como administrador** y usando la contraseña configurada. Desde su panel crea, edita, cancela y elimina clientes y pedidos. Cancelar un pedido pendiente o aprobado conserva el registro y devuelve sus ramos a la disponibilidad del portal. Al eliminar un cliente también se borran sus pedidos; al eliminar un pedido se borran sus productos y su aviso de WhatsApp. Estas acciones no afectan las remisiones. Las claves nuevas de clientes tienen exactamente 4 caracteres; las claves existentes siguen funcionando hasta cambiarlas. El acceso bloquea temporalmente los intentos repetidos con una clave incorrecta. El administrador también cambia los cinco precios generales. Si falta una categoría, se crea con los valores base Nacional COP 10.500, Bajas COP 12.000, Nacional granel COP 7.500, Bajas granel COP 9.500 y Eucalipto COP 700; los precios existentes se conservan. El perfil **PRESTIGIO PERSONAL**, cuyo usuario es **PRESTIGE**, ve y paga COP 5.000 por Nacional bonchado, sin cambiar el precio de los demás clientes. Los pedidos guardan una copia del precio vigente al enviarse.

Los clientes entran con su teléfono o un usuario con letras y su clave. El administrador puede asignar o editar ese usuario; el WhatsApp del cliente se conserva como número real para las confirmaciones. Ven una tabla con colores por fila y grados por columna. **Colores surtidos** suma las existencias de los demás colores de cada grado, **excepto rojos (Freedom y Explorer)**; no es inventario adicional. Si hay 16 ramos elegibles de Nacional bonchado, surtidos muestra 16, y un pedido de surtidos consume esos mismos ramos. Al combinar surtidos y colores individuales, el portal comprueba que las cantidades juntas no superen las existencias. **Eucalipto** se pide por tallos, tiene precio editable y no descuenta el inventario de rosas; su existencia física se coordina directamente con Prestige Roses. El panel del administrador muestra los pedidos por día y avisa en el navegador si entra uno nuevo. Los clientes conectados reciben la actualización de disponibilidad al registrarse o cancelarse un pedido; una consulta periódica respalda esa actualización.

El portal consulta el inventario real de Nacional y resta las cantidades reservadas por sus pedidos pendientes y aprobados, guardadas en `portal_inventory_reservations`. Al rechazar, cancelar o eliminar un pedido, se libera su reserva. Para colores surtidos, la reserva se distribuye entre colores distintos de rojos. Las tablas de escaneos, ajustes y remisiones son solo de lectura para el portal. Los pedidos anteriores a esta función no generan reservas retroactivas, salvo que estuvieran pendientes y se aprueben después de la actualización. Si la misma venta se registra además como remisión, la disminución real y la reserva del portal se sumarán visualmente; para evitarlo de forma exacta sería necesario vincular el pedido con esa remisión.

En administración, **Inventario real y pedidos** muestra por color y grado los ramos del inventario de Nacional, los reservados por pedidos pendientes, los reservados por pedidos aprobados y los disponibles para nuevos pedidos. Cada casilla permite ver los clientes y números de pedido que ocupan la reserva. Si las reservas superan el inventario real, se indica el faltante; la aprobación de un pedido pendiente volverá a comprobar la cantidad disponible.

Cada pedido nuevo pide día y hora de recogida (hora completa, sin minutos). Las horas van desde las 6 a. m. hasta la 1 p. m., excepto los martes, cuando llegan hasta las 2 p. m. Ambos datos se guardan en el pedido, se muestran al cliente y al administrador y se incluyen en el aviso de WhatsApp. Antes de enviarlo, el cliente vuelve a consultar el inventario; el servidor también valida y reserva dentro de una transacción que serializa pedidos simultáneos. Si otro pedido agotó un color, el envío se bloquea y se pide ajustar las cantidades. Si hay disponibilidad, el pedido se registra **APROBADO** inmediatamente y se reservan sus ramos en la vista de ventas. El cliente ve la confirmación en pantalla y recibe una solicitud de confirmación por WhatsApp. El administrador consulta los pedidos agrupados por día de recogida.

## Un pedido por cliente y fecha de recogida

Cuando un cliente ya tiene un pedido **aprobado** para la fecha elegida, la pantalla muestra su número y la hora existente. La nueva selección se **agrega al mismo pedido**, conserva ese número y la hora de recogida, suma las cantidades y actualiza el total. El inventario se valida y reserva únicamente para los productos añadidos; si no hay existencias, la ampliación se rechaza y el pedido anterior queda intacto. El servidor bloquea las operaciones simultáneas al buscar el pedido, por lo que dos ampliaciones concurrentes no crean dos pedidos nuevos.

El precio de un producto que ya figuraba en el pedido se conserva al añadir más unidades; un producto nuevo toma el precio vigente. Cada ampliación queda registrada en `portal_order_amendments`, y el pedido muestra cuántas veces se actualizó. Los avisos de WhatsApp para ambos destinatarios vuelven a enviar el **detalle y total consolidados** con el mismo número y la indicación `actualización 2`, `actualización 3`, etc. Se reutilizan las plantillas aprobadas actuales y no cambia el número de variables. El administrador puede pulsar **Cerrar modificaciones** al empezar la preparación; desde ese momento no se aceptan más productos para esa fecha. Puede volver a permitirlas si es necesario.

Los pedidos anteriores que ya estaban duplicados para un mismo cliente y fecha se conservan como registros históricos independientes. Esta versión consolida las compras nuevas sobre el primer pedido aprobado existente; no borra ni fusiona automáticamente pedidos previos.

Cuando el portal tiene configurada la **WhatsApp Business Platform**, al registrar un pedido solicita automáticamente a Meta un aviso a **+57 300 254 3548** (o `WHATSAPP_ADMIN_PHONE`) y una confirmación al teléfono del cliente. El aviso al administrador incluye número de pedido, cliente, productos, total y enlace al portal. Los grados y colores aparecen completos, separados por `|` y `;` dentro de cada variable de productos: Meta rechaza saltos de línea dentro de una variable. Los saltos de línea fijos se pueden conservar en el texto de la plantilla. Para los pedidos nuevos usa la plantilla sin botones `WHATSAPP_TEMPLATE_NAME`, porque ya están aprobados. El envío se reintenta si Meta lo rechaza; la aceptación por Meta no garantiza entrega al teléfono.

Para activar los avisos automáticos, configure `PORTAL_PUBLIC_URL` (HTTPS), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_GRAPH_VERSION`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANGUAGE` y opcionalmente `WHATSAPP_ADMIN_PHONE` en el entorno del portal. El número remitente debe estar conectado a Meta Cloud API y la plantilla de utilidad aprobada debe tener cinco parámetros de cuerpo, en este orden: **número de pedido, nombre del cliente, recogida y productos agrupados por grado completo, total COP, enlace al pedido**. El nombre e idioma deben coincidir exactamente con los de la plantilla aprobada. Guarde el token solo en variables de entorno, nunca en Git.

Cada pedido nuevo queda en la cola `portal_whatsapp_notifications`. Si Meta rechaza el envío, el portal lo reintenta y muestra el estado en el panel. `SOLICITADO` significa que Meta aceptó la solicitud; no confirma entrega al teléfono. Si la integración no está configurada, el portal deshabilita los pedidos nuevos y muestra un aviso. El cliente no necesita abrir WhatsApp para enviar el pedido.

## Confirmación automática y pedidos anteriores

Configure `WHATSAPP_CUSTOMER_TEMPLATE_NAME` con el nombre exacto de la plantilla aprobada para el cliente. Debe tener **cinco** parámetros: nombre, número de pedido, fecha/hora de recogida, productos agrupados por grado completo y total COP. La plantilla anterior de cuatro variables ya no coincide con este envío; cree o apruebe una nueva antes de desplegar esta versión. Sin esta plantilla y las variables básicas de WhatsApp no se permiten pedidos nuevos, para evitar aprobarlos sin solicitar su confirmación. Los pedidos que ya estaban pendientes antes de esta actualización pueden seguir aprobándose o rechazándose desde administración o mediante los botones antiguos del webhook. Un pedido aprobado puede cancelarse desde administración para liberar su reserva del portal.

Los pedidos nuevos usan `WHATSAPP_TEMPLATE_NAME` para el aviso al administrador. Esa plantilla debe tener cinco variables de cuerpo y **no pedir aprobación ni rechazo**. Las siguientes variables solo se necesitan para procesar botones de avisos antiguos de pedidos que todavía estén pendientes:

- `WHATSAPP_APPROVAL_TEMPLATE_NAME`: plantilla antigua con un botón **Aprobar pedido**.
- `WHATSAPP_DECISION_TEMPLATE_NAME`: plantilla antigua con botones **Aprobar pedido** y **Rechazar pedido**.
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`: cadena secreta elegida por usted, idéntica a la que ingrese al configurar el webhook en Meta.
- `WHATSAPP_APP_SECRET`: clave secreta de la app en Meta Developers > Configuración de la app > Básica. No es el token de acceso de WhatsApp.

Texto sugerido para la plantilla **sin botones** del administrador para pedidos nuevos (cinco variables en el cuerpo):

```text
Nuevo pedido en Prestige Roses: #{{1}}

{{2}}

{{3}}

*Total estimado:* COP {{4}}
*Ver pedido:* {{5}}

Este pedido ya quedó aprobado automáticamente.
```

Texto sugerido para la plantilla al cliente (cuatro variables en el cuerpo):

```text
Hola {{1}}, tu pedido #{{2}} de Prestige Roses fue aprobado.

*Recogida:* {{3}}

*Productos solicitados:*
{{4}}

*Total a pagar:* COP {{5}}

Gracias por tu pedido.
```

El webhook de Meta solo hace falta para los botones de avisos pendientes antiguos. Los pedidos nuevos se aprueban al registrarse y no esperan respuesta por webhook. Guarde las claves solo en Railway, nunca en Git. Si la confirmación falla, `portal_customer_notifications` conserva el error y la reintenta hasta diez veces. La aceptación de Meta no garantiza entrega al teléfono.

## Páginas públicas para publicar la app de Meta

El portal sirve sin inicio de sesión `/privacidad.html`, `/condiciones.html` y `/eliminacion-datos.html`. Con el dominio público `https://ventasp.up.railway.app`, las direcciones completas son `https://ventasp.up.railway.app/privacidad.html`, `https://ventasp.up.railway.app/condiciones.html` y `https://ventasp.up.railway.app/eliminacion-datos.html`. El correo de contacto publicado en estas páginas es `prestigep535@gmail.com`. Revise que el texto refleje las prácticas reales del negocio antes de publicar la app y mantenga actualizadas estas páginas cuando cambien los procesos.

## Límites actuales

- Sin cuenta de WhatsApp Business Platform, número remitente, plantilla de aviso al administrador, plantilla de confirmación al cliente y dirección pública HTTPS, no se pueden registrar pedidos nuevos. Los botones y el webhook solo se usan con avisos pendientes anteriores.
- El pedido aprobado **no crea una remisión ni descuenta el inventario real**. Mantiene una reserva que reduce la disponibilidad visible en el portal. Al rechazar un pedido pendiente o cancelar uno aprobado, se elimina su reserva. El personal puede terminarlo mediante una remisión en el programa principal o mediante un despacho manual en el portal.
- En administrador, **Despachar sin remisión** cierra un pedido aprobado sin alterar el inventario principal. Úselo solo cuando el inventario real ya refleje la salida física: entonces ese pedido queda en el historial y deja de descontarse por segunda vez de la disponibilidad del portal. Solo los pedidos pendientes y aprobados reducen lo disponible y se consideran para la alerta de faltantes. **Revertir despacho** devuelve el pedido a aprobado y vuelve a reservar sus ramos.
- Bajas y Bajas granel son grados de inventario independientes. El portal valida cada grado por separado. Los grados granel muestran el precio por tabaco; los grados bonchados, por ramo. Eucalipto se cobra por tallo y no tiene inventario registrado.
- Las variedades que no estén en la tabla de colores proporcionada no se muestran. Los nombres alternativos `QUICKSAND`/`QUICK SAND`, `SOMMERSAND`/`SUMMERSAND` y `MOODY BLUE`/`MOODY BLUES` se agrupan en el mismo color.
