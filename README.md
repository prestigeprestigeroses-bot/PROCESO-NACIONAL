# Flora · Inventario y remisiones

Aplicación web para controlar salidas nacionales de flor. Consulta existencias por variedad, genera remisiones imprimibles y descuenta ramos y tallos del inventario en una sola transacción.

## Funciones incluidas

- Inventario en tiempo real por variedad, color, ramos y tallos.
- Precios independientes por ramo y por tallo.
- Creación de remisiones con cliente, destino y observaciones.
- Validación de existencias y descuento transaccional al confirmar.
- Documento A4 listo para imprimir o guardar como PDF.
- Historial de remisiones y reimpresión.
- Ingreso y ajustes manuales de inventario.
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

La aplicación crea las tablas automáticamente al iniciar y utiliza transacciones/bloqueo de filas para evitar que dos remisiones descuenten el mismo inventario al mismo tiempo.
En producción inicia sin variedades de ejemplo. Use `SEED_DEMO_DATA=true` únicamente si desea cargar los datos demostrativos.

## Variables

Use [.env.example](./.env.example) como referencia. No suba el archivo `.env` al repositorio.

## Nota para conectar otra base existente

El sistema está preparado para PostgreSQL. Si el inventario ya vive en otra base o tiene nombres de columnas diferentes, adapte las consultas de `src/store.js` o prepare una vista compatible con los campos: variedad, color, ramos, tallos, tallos por ramo y precios.
