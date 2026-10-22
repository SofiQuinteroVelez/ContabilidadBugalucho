import {
  $, aviso, formatoFecha, hoyISO, leerMonto, miles, pedir, pesos, ponerMonto, rangoSemana, sumarDias,
} from './util.js';
import { cargarDashboard } from './dashboard.js';

const CAMPOS = [
  ['ingresos', 'Ingresos del día'],
  ['qr', 'Ingresos QR'],
  ['gastos', 'Gastos del día'],
  ['efectivo', 'Efectivo'],
];

let semana = null;
let fechaActual = hoyISO();

function inputMonto(valor, atributos) {
  const input = document.createElement('input');
  input.className = 'monto';
  input.inputMode = 'numeric';
  input.placeholder = '0';
  input.value = valor ? miles.format(valor) : '';
  Object.assign(input.dataset, atributos);
  return input;
}

// ---------- Vista semana ----------

async function cargarSemana(fecha) {
  fechaActual = fecha;
  try {
    semana = await pedir(`/api/semana/${fecha}`);
    pintarSemana();
  } catch (err) {
    aviso(`No se pudo cargar: ${err.message}`, true);
  }
}

function pintarSemana() {
  const { lunes, domingo, dias } = semana;
  $('#rango-semana').textContent = rangoSemana(lunes, domingo);
  $('#ir-a-fecha').value = fechaActual;

  const porFecha = Object.fromEntries(dias.map((d) => [d.fecha, d]));
  const hoy = hoyISO();
  const tbody = $('#filas');
  tbody.replaceChildren();

  for (let i = 0; i < 7; i++) {
    const fecha = sumarDias(lunes, i);
    const dia = porFecha[fecha];
    const tr = document.createElement('tr');
    tr.dataset.fecha = fecha;
    tr.classList.toggle('hoy', fecha === hoy);
    tr.classList.toggle('vacio', !dia);

    const th = document.createElement('th');
    th.innerHTML = `${formatoFecha(fecha, { day: 'numeric', month: 'short' })}<span class="dia-nombre">${formatoFecha(fecha, { weekday: 'long' })}</span>`;
    tr.append(th);

    for (const [campo, etiqueta] of CAMPOS) {
      const td = document.createElement('td');
      td.dataset.etiqueta = etiqueta;
      td.append(inputMonto(dia?.[campo], { campo }));
      tr.append(td);
    }

    const total = document.createElement('td');
    total.className = 'col-total';
    total.dataset.etiqueta = 'Total del día (efectivo + QR)';
    tr.append(total);
    tbody.append(tr);
  }

  for (const input of document.querySelectorAll('[data-semana]')) {
    const v = semana.semana[input.dataset.semana];
    input.value = v ? miles.format(v) : '';
  }

  pintarTotales();
}

// Actualiza solo números calculados, sin tocar lo que el usuario está escribiendo.
function pintarTotales() {
  const porFecha = Object.fromEntries(semana.dias.map((d) => [d.fecha, d]));
  for (const tr of $('#filas').children) {
    const dia = porFecha[tr.dataset.fecha];
    tr.classList.toggle('vacio', !dia);
    const celda = tr.querySelector('.col-total');
    if (dia) ponerMonto(celda, dia.total);
    else celda.textContent = '—';
  }
  const t = semana.totales;
  ponerMonto($('#suma-ingresos'), t.ingresos);
  ponerMonto($('#suma-qr'), t.qr);
  ponerMonto($('#suma-gastos'), t.gastos);
  ponerMonto($('#suma-efectivo'), t.efectivo);
  ponerMonto($('#suma-total'), t.totalSemana);
  ponerMonto($('#total-semana'), t.totalSemana);
  ponerMonto($('#despues-nomina'), t.despuesNomina);
}

async function guardarFila(tr) {
  const fecha = tr.dataset.fecha;
  const datos = {};
  for (const input of tr.querySelectorAll('[data-campo]')) datos[input.dataset.campo] = leerMonto(input.value);
  const existe = semana.dias.some((d) => d.fecha === fecha);
  const vacia = Object.values(datos).every((v) => v === 0);
  if (vacia && !existe) return;

  semana = vacia
    ? await pedir(`/api/dia/${fecha}`, { method: 'DELETE' })
    : await pedir(`/api/dia/${fecha}`, { method: 'PUT', body: datos });
  pintarTotales();
  aviso(vacia ? 'Día borrado' : 'Guardado');
}

async function guardarResumen() {
  const datos = {};
  for (const input of document.querySelectorAll('[data-semana]')) datos[input.dataset.semana] = leerMonto(input.value);
  semana = await pedir(`/api/semana/${semana.lunes}`, { method: 'PUT', body: datos });
  pintarTotales();
  aviso('Guardado');
}

document.addEventListener('focusin', (e) => {
  if (!e.target.classList.contains('monto')) return;
  e.target.dataset.antes = e.target.value;
  e.target.select();
});

document.addEventListener('change', async (e) => {
  const input = e.target;
  if (!input.classList.contains('monto') || !input.closest('#vista-semana')) return;
  const valor = leerMonto(input.value);
  input.value = valor ? miles.format(valor) : '';
  input.classList.add('guardando');
  try {
    if (input.dataset.campo) await guardarFila(input.closest('tr'));
    else await guardarResumen();
  } catch (err) {
    aviso(`No se guardó: ${err.message}`, true);
  } finally {
    input.classList.remove('guardando');
  }
});

// Enter pasa al siguiente campo, como en Excel.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.matches('#vista-semana .monto')) return;
  e.preventDefault();
  const montos = [...document.querySelectorAll('#vista-semana .monto')];
  const siguiente = montos[montos.indexOf(e.target) + 1];
  if (siguiente) siguiente.focus();
  else e.target.blur();
});

$('#anterior').addEventListener('click', () => cargarSemana(sumarDias(semana.lunes, -7)));
$('#siguiente').addEventListener('click', () => cargarSemana(sumarDias(semana.lunes, 7)));
$('#hoy').addEventListener('click', () => cargarSemana(hoyISO()));
$('#ir-a-fecha').addEventListener('change', (e) => e.target.value && cargarSemana(e.target.value));

// ---------- Vista historial ----------

const ETIQUETAS_HISTORIAL = ['Semana', 'Días', 'Ingresos', 'QR', 'Gastos', 'Total semana', 'Maza', 'Nómina', 'Después nómina'];

async function cargarHistorial() {
  const semanas = await pedir('/api/semanas');
  const tbody = $('#filas-historial');
  tbody.replaceChildren();
  if (!semanas.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--suave)">Todavía no hay datos.</td></tr>';
    return;
  }
  for (const s of semanas) {
    const tr = document.createElement('tr');
    tr.dataset.lunes = s.lunes;
    const celdas = [
      rangoSemana(s.lunes, s.domingo),
      s.diasRegistrados,
      ...[s.ingresos, s.qr, s.gastos, s.totalSemana, s.maza, s.nomina, s.despuesNomina].map((v) => pesos.format(v)),
    ];
    celdas.forEach((texto, i) => {
      const td = document.createElement('td');
      td.textContent = texto;
      td.dataset.etiqueta = ETIQUETAS_HISTORIAL[i];
      if (i === celdas.length - 1) td.className = 'col-total';
      tr.append(td);
    });
    tbody.append(tr);
  }
}

$('#filas-historial').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-lunes]');
  if (!tr) return;
  mostrarVista('semana');
  cargarSemana(tr.dataset.lunes);
});

const VISTAS = ['semana', 'dashboard', 'historial'];

function mostrarVista(vista) {
  history.replaceState(null, '', vista === 'semana' ? location.pathname : `#${vista}`);
  for (const b of document.querySelectorAll('.pestana')) b.classList.toggle('activa', b.dataset.vista === vista);
  $('#vista-semana').hidden = vista !== 'semana';
  $('#vista-historial').hidden = vista !== 'historial';
  $('#vista-dashboard').hidden = vista !== 'dashboard';
  if (vista === 'dashboard') cargarDashboard();
  if (vista === 'historial') cargarHistorial().catch((err) => aviso(err.message, true));
}

for (const b of document.querySelectorAll('.pestana')) b.addEventListener('click', () => mostrarVista(b.dataset.vista));

cargarSemana(fechaActual);
const vistaInicial = location.hash.slice(1);
if (VISTAS.includes(vistaInicial)) mostrarVista(vistaInicial);
