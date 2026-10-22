import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = dirname(fileURLToPath(import.meta.url));
const rutaDb = process.env.BUGALUCHO_DB ?? join(raiz, 'data', 'bugalucho.db');
mkdirSync(dirname(rutaDb), { recursive: true });

export const db = new DatabaseSync(rutaDb);

db.exec(`
  CREATE TABLE IF NOT EXISTS dias (
    fecha     TEXT PRIMARY KEY,          -- YYYY-MM-DD
    ingresos  INTEGER NOT NULL DEFAULT 0, -- Ingresos del día
    qr        INTEGER NOT NULL DEFAULT 0, -- Ingresos QR
    gastos    INTEGER NOT NULL DEFAULT 0, -- Gastos del día
    efectivo  INTEGER NOT NULL DEFAULT 0, -- Efectivo que quedó después de gastos
    notas     TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS semanas (
    lunes          TEXT PRIMARY KEY,           -- YYYY-MM-DD del lunes de la semana
    gasto_semanal  INTEGER NOT NULL DEFAULT 0,
    maza           INTEGER NOT NULL DEFAULT 0, -- Almuerzos Maza (ingreso en efectivo semanal)
    nomina         INTEGER NOT NULL DEFAULT 0,
    notas          TEXT NOT NULL DEFAULT ''
  );

  -- Movimientos manuales de las cuentas del dueño.
  -- entrada: suma a "cuenta"; gasto: resta de "cuenta"; traslado: pasa de "cuenta" a la otra.
  CREATE TABLE IF NOT EXISTS movimientos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha        TEXT NOT NULL,
    tipo         TEXT NOT NULL CHECK (tipo IN ('entrada', 'gasto', 'traslado')),
    cuenta       TEXT NOT NULL CHECK (cuenta IN ('banco', 'efectivo')),
    categoria    TEXT NOT NULL DEFAULT '',
    descripcion  TEXT NOT NULL DEFAULT '',
    monto        INTEGER NOT NULL CHECK (monto >= 0)
  );
  CREATE INDEX IF NOT EXISTS movimientos_fecha ON movimientos (fecha);
`);

// Fechas como texto YYYY-MM-DD, calculadas en UTC para evitar saltos por zona horaria.
export function lunesDe(fecha) {
  const d = new Date(`${fecha}T00:00:00Z`);
  const dia = (d.getUTCDay() + 6) % 7; // 0 = lunes
  d.setUTCDate(d.getUTCDate() - dia);
  return d.toISOString().slice(0, 10);
}

export function sumarDias(fecha, n) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const CAMPOS_DIA = ['ingresos', 'qr', 'gastos', 'efectivo'];
const CAMPOS_SEMANA = ['gasto_semanal', 'maza', 'nomina'];

function entero(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : 0;
}

export function guardarDia(fecha, datos) {
  const fila = Object.fromEntries(CAMPOS_DIA.map((c) => [c, entero(datos[c])]));
  db.prepare(`
    INSERT INTO dias (fecha, ingresos, qr, gastos, efectivo, notas)
    VALUES (:fecha, :ingresos, :qr, :gastos, :efectivo, :notas)
    ON CONFLICT(fecha) DO UPDATE SET
      ingresos = excluded.ingresos, qr = excluded.qr, gastos = excluded.gastos,
      efectivo = excluded.efectivo, notas = excluded.notas
  `).run({ fecha, ...fila, notas: String(datos.notas ?? '') });
}

export function borrarDia(fecha) {
  db.prepare('DELETE FROM dias WHERE fecha = ?').run(fecha);
}

export function guardarSemana(lunes, datos) {
  const fila = Object.fromEntries(CAMPOS_SEMANA.map((c) => [c, entero(datos[c])]));
  db.prepare(`
    INSERT INTO semanas (lunes, gasto_semanal, maza, nomina, notas)
    VALUES (:lunes, :gasto_semanal, :maza, :nomina, :notas)
    ON CONFLICT(lunes) DO UPDATE SET
      gasto_semanal = excluded.gasto_semanal, maza = excluded.maza,
      nomina = excluded.nomina, notas = excluded.notas
  `).run({ lunes, ...fila, notas: String(datos.notas ?? '') });
}

function calcularTotales(dias, semana) {
  const suma = (c) => dias.reduce((t, d) => t + d[c], 0);
  const totalSemana = suma('total');
  return {
    ingresos: suma('ingresos'),
    qr: suma('qr'),
    gastos: suma('gastos'),
    efectivo: suma('efectivo'),
    totalSemana,
    despuesNomina: totalSemana + semana.maza - semana.gasto_semanal - semana.nomina,
  };
}

function conTotal(d) {
  return { ...d, total: d.efectivo + d.qr }; // Total del día = efectivo + QR
}

export function obtenerSemana(fecha) {
  const lunes = lunesDe(fecha);
  const domingo = sumarDias(lunes, 6);
  const dias = db
    .prepare('SELECT * FROM dias WHERE fecha BETWEEN ? AND ? ORDER BY fecha')
    .all(lunes, domingo)
    .map(conTotal);
  const semana = db.prepare('SELECT * FROM semanas WHERE lunes = ?').get(lunes) ?? {
    lunes, gasto_semanal: 0, maza: 0, nomina: 0, notas: '',
  };
  return { lunes, domingo, dias, semana, totales: calcularTotales(dias, semana) };
}

export function listarSemanas() {
  const lunesSet = new Set(db.prepare('SELECT lunes FROM semanas').all().map((r) => r.lunes));
  for (const { fecha } of db.prepare('SELECT fecha FROM dias').all()) lunesSet.add(lunesDe(fecha));
  return [...lunesSet]
    .sort()
    .reverse()
    .map((lunes) => {
      const { domingo, dias, semana, totales } = obtenerSemana(lunes);
      return { lunes, domingo, diasRegistrados: dias.length, maza: semana.maza, nomina: semana.nomina, gastoSemanal: semana.gasto_semanal, ...totales };
    });
}

export function todosLosDias() {
  return db.prepare('SELECT * FROM dias ORDER BY fecha').all().map(conTotal);
}

// ---------- Movimientos y dashboard del dueño ----------

const TIPOS = ['entrada', 'gasto', 'traslado'];
const CUENTAS = ['banco', 'efectivo'];
const OTRA = { banco: 'efectivo', efectivo: 'banco' };

export function validarMovimiento(datos) {
  const m = {
    fecha: String(datos.fecha ?? ''),
    tipo: String(datos.tipo ?? ''),
    cuenta: String(datos.cuenta ?? ''),
    categoria: String(datos.categoria ?? '').trim(),
    descripcion: String(datos.descripcion ?? '').trim(),
    monto: entero(datos.monto),
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.fecha)) throw new Error('Fecha inválida');
  if (!TIPOS.includes(m.tipo)) throw new Error('Tipo inválido');
  if (!CUENTAS.includes(m.cuenta)) throw new Error('Cuenta inválida');
  if (m.monto <= 0) throw new Error('El monto debe ser mayor que cero');
  if (m.tipo === 'traslado') m.categoria = 'Traslado';
  return m;
}

export function crearMovimiento(datos) {
  const m = validarMovimiento(datos);
  return db.prepare(`
    INSERT INTO movimientos (fecha, tipo, cuenta, categoria, descripcion, monto)
    VALUES (:fecha, :tipo, :cuenta, :categoria, :descripcion, :monto)
  `).run(m).lastInsertRowid;
}

export function actualizarMovimiento(id, datos) {
  const m = validarMovimiento(datos);
  db.prepare(`
    UPDATE movimientos SET fecha = :fecha, tipo = :tipo, cuenta = :cuenta,
      categoria = :categoria, descripcion = :descripcion, monto = :monto
    WHERE id = :id
  `).run({ ...m, id });
}

export function borrarMovimiento(id) {
  db.prepare('DELETE FROM movimientos WHERE id = ?').run(id);
}

export function listarMovimientos(anio) {
  return db
    .prepare("SELECT * FROM movimientos WHERE fecha BETWEEN ? AND ? ORDER BY fecha DESC, id DESC")
    .all(`${anio}-01-01`, `${anio}-12-31`);
}

// Cuánto cambia cada cuenta con un movimiento.
function efecto(m) {
  const e = { banco: 0, efectivo: 0 };
  if (m.tipo === 'entrada') e[m.cuenta] += m.monto;
  if (m.tipo === 'gasto') e[m.cuenta] -= m.monto;
  if (m.tipo === 'traslado') {
    e[m.cuenta] -= m.monto;
    e[OTRA[m.cuenta]] += m.monto;
  }
  return e;
}

export function dashboard(anio) {
  const movimientos = listarMovimientos(anio).reverse(); // en orden cronológico
  const cuentas = Object.fromEntries(CUENTAS.map((c) => [c, { saldo: 0, entradas: 0, gastos: 0 }]));
  const meses = Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, banco: 0, efectivo: 0 }));
  const categorias = {};

  for (const m of movimientos) {
    const e = efecto(m);
    for (const c of CUENTAS) cuentas[c].saldo += e[c];
    if (m.tipo === 'entrada') cuentas[m.cuenta].entradas += m.monto;
    if (m.tipo === 'gasto') {
      cuentas[m.cuenta].gastos += m.monto;
      const nombre = m.categoria || 'Otros';
      categorias[nombre] ??= { categoria: nombre, banco: 0, efectivo: 0 };
      categorias[nombre][m.cuenta] += m.monto;
    }
    const mes = meses[Number(m.fecha.slice(5, 7)) - 1];
    mes.banco += e.banco;
    mes.efectivo += e.efectivo;
  }

  // Saldo acumulado al cierre de cada mes.
  let banco = 0;
  let efectivo = 0;
  for (const mes of meses) {
    mes.movBanco = mes.banco;
    mes.movEfectivo = mes.efectivo;
    banco += mes.banco;
    efectivo += mes.efectivo;
    mes.banco = banco;
    mes.efectivo = efectivo;
  }

  return {
    anio,
    cuentas,
    total: cuentas.banco.saldo + cuentas.efectivo.saldo,
    meses,
    categorias: Object.values(categorias).sort((a, b) => b.banco + b.efectivo - (a.banco + a.efectivo)),
    movimientos: movimientos.length,
  };
}
