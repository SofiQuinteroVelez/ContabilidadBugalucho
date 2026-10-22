# Contabilidad Bugalucho

Registro diario y semanal del restaurante. Necesita Node.js 20 o superior.

```bash
npm install        # la primera vez
npm start          # abre http://localhost:3000
npm run seed       # (opcional) carga la semana del 5–10 oct 2026 del Excel
```

En el computador los datos quedan en `data/bugalucho.db`. Si defines `APP_PASSWORD`, también pide
contraseña localmente.

## Cómo se calcula

| Campo | Fórmula |
|---|---|
| Total del día | Efectivo + Ingresos QR |
| Total semana | Suma de los "Total del día" (lunes a domingo) |
| Después nómina | Total semana + Maza − Gasto semanal − Nómina |

## Dashboard del dueño

En la pestaña **Dashboard** (o directo en `http://localhost:3000/#dashboard`) se ve cuánto hay en
**Banco (QR)** y en **Efectivo** durante el año. Esos saldos salen solo de los movimientos que se
registran a mano ahí mismo:

- **Entrada**: suma a la cuenta escogida (saldo inicial, ventas QR, ventas en efectivo, Maza…).
- **Gasto**: resta de la cuenta escogida (arriendo, servicios, nómina, proveedores…).
- **Traslado**: pasa plata de una cuenta a la otra (por ejemplo, consignar efectivo en el banco).

## Publicar en Vercel

Vercel no guarda archivos, así que en internet los datos viven en [Turso](https://turso.tech)
(base de datos SQLite en la nube, plan gratis).

1. **Turso**: crea una cuenta, luego una base de datos (*Create Database*). En ella copia la
   **URL** (`libsql://...`) y crea un **token** (*Create Token*, con permiso de lectura y escritura).
2. **Vercel → tu proyecto → Settings → Environment Variables**, agrega:

   | Nombre | Valor |
   |---|---|
   | `TURSO_DATABASE_URL` | la URL `libsql://...` |
   | `TURSO_AUTH_TOKEN` | el token de Turso |
   | `APP_PASSWORD` | la contraseña para entrar a la web (usa una larga) |

3. **Deployments → ⋯ → Redeploy** para que tome las variables.
4. Pasar los datos del computador a Turso (una sola vez):

   ```bash
   TURSO_DATABASE_URL='libsql://...' TURSO_AUTH_TOKEN='...' npm run migrar
   ```

Cambiar `APP_PASSWORD` en Vercel cierra la sesión en todos los celulares.

Los datos locales se guardan en `data/bugalucho.db` (SQLite). **Haz copia de ese archivo** de vez en cuando.
En "Historial" puedes descargar todo en CSV para abrirlo en Excel.
