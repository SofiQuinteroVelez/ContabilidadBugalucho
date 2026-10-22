# Contabilidad Bugalucho

Registro diario y semanal del restaurante. No necesita instalar nada: solo Node.js 22.13 o superior.

```bash
npm start          # abre http://localhost:3000
npm run seed       # (opcional) carga la semana del 5–10 oct 2026 del Excel
```

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

Los datos se guardan en `data/bugalucho.db` (SQLite). **Haz copia de ese archivo** de vez en cuando.
En "Historial" puedes descargar todo en CSV para abrirlo en Excel.
