import { createClient } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// En Vercel los datos viven en Turso (TURSO_DATABASE_URL); en el computador, en data/bugalucho.db.
function conectar() {
  if (process.env.TURSO_DATABASE_URL) {
    return createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  if (process.env.VERCEL) throw new Error('Falta configurar TURSO_DATABASE_URL en Vercel');
  const raiz = dirname(fileURLToPath(import.meta.url));
  const ruta = process.env.BUGALUCHO_DB ?? join(raiz, 'data', 'bugalucho.db');
  mkdirSync(dirname(ruta), { recursive: true });
  return createClient({ url: pathToFileURL(ruta).href });
}

let cliente;
function db() {
  cliente ??= conectar();
  return cliente;
}

const ESQUEMA = `
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
`;

let listo;
// Crea las tablas una sola vez por proceso (o por arranque de la función en Vercel).
function preparar() {
  listo ??= db().executeMultiple(ESQUEMA).catch((err) => { listo = undefined; throw err; });
  return listo;
}

async function consultar(sql, args = []) {
  await preparar();
  const rs = await db().execute({ sql, args });
  return rs.rows.map((fila) => Object.fromEntries(rs.columns.map((c, i) => [c, fila[i]])));
}

async function ejecutar(sql, args = []) {
  await preparar();
  return db().execute({ sql, args });
}

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

export async function guardarDia(fecha, datos) {
  const valores = CAMPOS_DIA.map((c) => entero(datos[c]));
  await ejecutar(`
    INSERT INTO dias (fecha, ingresos, qr, gastos, efectivo, notas) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(fecha) DO UPDATE SET
      ingresos = excluded.ingresos, qr = excluded.qr, gastos = excluded.gastos,
      efectivo = excluded.efectivo, notas = excluded.notas
  `, [fecha, ...valores, String(datos.notas ?? '')]);
}

export async function borrarDia(fecha) {
  await ejecutar('DELETE FROM dias WHERE fecha = ?', [fecha]);
}

export async function guardarSemana(lunes, datos) {
  const valores = CAMPOS_SEMANA.map((c) => entero(datos[c]));
  await ejecutar(`
    INSERT INTO semanas (lunes, gasto_semanal, maza, nomina, notas) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(lunes) DO UPDATE SET
      gasto_semanal = excluded.gasto_semanal, maza = excluded.maza,
      nomina = excluded.nomina, notas = excluded.notas
  `, [lunes, ...valores, String(datos.notas ?? '')]);
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

function semanaVacia(lunes) {
  return { lunes, gasto_semanal: 0, maza: 0, nomina: 0, notas: '' };
}

function armarSemana(lunes, dias, semana) {
  return { lunes, domingo: sumarDias(lunes, 6), dias, semana, totales: calcularTotales(dias, semana) };
}

export async function obtenerSemana(fecha) {
  const lunes = lunesDe(fecha);
  const [dias, [semana]] = await Promise.all([
    consultar('SELECT * FROM dias WHERE fecha BETWEEN ? AND ? ORDER BY fecha', [lunes, sumarDias(lunes, 6)]),
    consultar('SELECT * FROM semanas WHERE lunes = ?', [lunes]),
  ]);
  return armarSemana(lunes, dias.map(conTotal), semana ?? semanaVacia(lunes));
}

// Dos consultas en total, agrupando en memoria: con la base en internet cada consulta cuenta.
export async function listarSemanas() {
  const [dias, semanas] = await Promise.all([
    todosLosDias(),
    consultar('SELECT * FROM semanas'),
  ]);
  const porLunes = new Map(semanas.map((s) => [s.lunes, { semana: s, dias: [] }]));
  for (const d of dias) {
    const lunes = lunesDe(d.fecha);
    if (!porLunes.has(lunes)) porLunes.set(lunes, { semana: semanaVacia(lunes), dias: [] });
    porLunes.get(lunes).dias.push(d);
  }
  return [...porLunes.keys()]
    .sort()
    .reverse()
    .map((lunes) => {
      const { semana, dias: diasSemana } = porLunes.get(lunes);
      const { domingo, totales } = armarSemana(lunes, diasSemana, semana);
      return { lunes, domingo, diasRegistrados: diasSemana.length, maza: semana.maza, nomina: semana.nomina, gastoSemanal: semana.gasto_semanal, ...totales };
    });
}

export async function todosLosDias() {
  return (await consultar('SELECT * FROM dias ORDER BY fecha')).map(conTotal);
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

function valoresMovimiento(m) {
  return [m.fecha, m.tipo, m.cuenta, m.categoria, m.descripcion, m.monto];
}

export async function crearMovimiento(datos) {
  const rs = await ejecutar(`
    INSERT INTO movimientos (fecha, tipo, cuenta, categoria, descripcion, monto) VALUES (?, ?, ?, ?, ?, ?)
  `, valoresMovimiento(validarMovimiento(datos)));
  return Number(rs.lastInsertRowid);
}

export async function actualizarMovimiento(id, datos) {
  await ejecutar(`
    UPDATE movimientos SET fecha = ?, tipo = ?, cuenta = ?, categoria = ?, descripcion = ?, monto = ?
    WHERE id = ?
  `, [...valoresMovimiento(validarMovimiento(datos)), id]);
}

export async function borrarMovimiento(id) {
  await ejecutar('DELETE FROM movimientos WHERE id = ?', [id]);
}

export async function listarMovimientos(anio) {
  return consultar(
    'SELECT * FROM movimientos WHERE fecha BETWEEN ? AND ? ORDER BY fecha DESC, id DESC',
    [`${anio}-01-01`, `${anio}-12-31`],
  );
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

export async function dashboard(anio) {
  const movimientos = (await listarMovimientos(anio)).reverse(); // en orden cronológico
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
