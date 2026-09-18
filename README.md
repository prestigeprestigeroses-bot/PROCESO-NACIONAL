# Flora · Inventario y remisiones

Aplicación web para controlar salidas nacionales de flor. Consulta existencias por variedad, genera remisiones imprimibles y descuenta ramos y tallos del inventario en una sola transacción.

## Funciones incluidas

- Inventario en tiempo real alimentado desde `public.scans`.
- Agrupación por fecha, variedad, grado y cantidad de tallos por ramo.
- Filtro exclusivo para los grados `BAJAS`, `NACIONAL` y `NACIONAL GRANEL`.
- Número de ramos calculado con `COUNT(*)` y total de tallos con `SUM(tallos)`.
- Selectores de fecha y grado sincronizados entre Resumen e Inventario.
- Flujo compartido en tres pasos: pedido, asignación de variedades/grados y precios/finalización.
- Creación de remisiones con cliente, NIT/documento, responsable de entrega y observaciones.
- Estados pendientes visibles para continuar la misma remisión desde otros equipos.
- Validación de existencias y descuento transaccional al confirmar las variedades en el paso 2.
- Bloqueo automático de la flor recibida el mismo día, con desbloqueo manual y advertencia para casos excepcionales.
- Cálculo inicial de 25 tallos por ramo, editable para pedidos especiales.
- Anulación con motivo obligatorio, conservación del historial y devolución automática de la flor al inventario.
- Documento A4 listo para imprimir o guardar como PDF, con firma y sello de recibido.
- Historial de remisiones y reimpresión.
- Acceso protegido por usuario y contraseña.
- Diseño adaptable para computador, tableta y celular.

## Uso local

Requiere Node.js 20 o superior.

```bash
npm install
copy .env.example .env
npm start
```

Abra `http://localhost:3000`. Sin PostgreSQL, el modo local guarda la información en `.data/flor-data.json`. Las credenciales de desarrollo predeterminadas son `administrador` / `admin123`.

## Despliegue en Railway

1. Cree un proyecto en Railway desde este repositorio.
2. Agregue un servicio **PostgreSQL** al proyecto. Railway inyectará `DATABASE_URL`.
3. En las variables del servicio web, configure obligatoriamente:

   - `APP_USER`: usuario de acceso.
   - `APP_PASSWORD`: contraseña fuerte.
   - `SESSION_SECRET`: cadena aleatoria larga.
   - `COMPANY_NAME`: nombre que aparecerá en la remisión.

4. Opcionalmente configure `COMPANY_NIT`, `COMPANY_PHONE` y `COMPANY_ADDRESS`.
5. Despliegue y genere el dominio público desde **Settings → Networking**.

La aplicación crea sus tablas de remisiones automáticamente al iniciar y utiliza transacciones/bloqueos para evitar que dos remisiones descuenten el mismo grupo de inventario al mismo tiempo. Los registros originales de `scans` se conservan: la disponibilidad se calcula como entradas escaneadas menos ramos incluidos en remisiones.
En producción inicia sin variedades de ejemplo. Use `SEED_DEMO_DATA=true` únicamente si desea cargar los datos demostrativos.

## Variables

Use [.env.example](./.env.example) como referencia. No suba el archivo `.env` al repositorio.

## Origen de los datos

El sistema consulta la tabla PostgreSQL `public.scans` y utiliza:

- `ts`: fecha del inventario.
- `variedad_nombre`: nombre de la variedad.
- `grado_cm`: clasificación; solo se aceptan BAJAS, NACIONAL y NACIONAL GRANEL.
- `tallos`: cantidad de tallos del ramo.

Cada fila válida de `scans` se interpreta como un ramo. Los datos se agrupan sin modificar ni eliminar los escaneos originales.
