import { $, aviso, formatoFecha, hoyISO, leerMonto, miles, pedir, pesos, ponerMonto } from './util.js';

const CATEGORIAS = {
  gasto: ['Arriendo', 'Servicios', 'Nómina', 'Proveedores', 'Impuestos', 'Mantenimiento', 'Otros'],
  entrada: ['Saldo inicial', 'Ventas QR', 'Ventas en efectivo', 'Maza', 'Otros ingresos'],
};
const ETIQUETA_CUENTA = { gasto: 'Se descuenta de', entrada: 'Entra a', traslado: 'Sale de' };
const NOMBRE_CUENTA = { banco: 'Banco (QR)', efectivo: 'Efectivo' };
const OTRA = { banco: 'efectivo', efectivo: 'banco' };
const SERIES = [
  { clave: 'banco', nombre: 'Banco (QR)', color: 'var(--banco)' },
  { clave: 'efectivo', nombre: 'Efectivo', color: 'var(--efectivo)' },
];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const compacto = new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 });
const SVG = 'http://www.w3.org/2000/svg';

let anio = new Date().getFullYear();
let datos = null;
let editando = null;

export async function cargarDashboard() {
  $('#anio-titulo').textContent = anio;
  try {
    const [dash, movimientos] = await Promise.all([
      pedir(`/api/dashboard?anio=${anio}`),
      pedir(`/api/movimientos?anio=${anio}`),
    ]);
    datos = dash;
    pintarTarjetas();
    pintarGraficaSaldos();
    pintarGastos();
    pintarMovimientos(movimientos);
  } catch (err) {
    aviso(`No se pudo cargar: ${err.message}`, true);
  }
}

// ---------- Tarjetas ----------

function pintarTarjetas() {
  for (const c of ['banco', 'efectivo']) {
    const cuenta = datos.cuentas[c];
    ponerMonto($(`#saldo-${c}`), cuenta.saldo);
    $(`#detalle-${c}`).textContent = `Entró ${pesos.format(cuenta.entradas)} · Gastos ${pesos.format(cuenta.gastos)}`;
  }
  ponerMonto($('#saldo-total'), datos.total);
}

// ---------- Gráfica de saldos mensuales ----------

function mesesVisibles() {
  const hoy = new Date();
  return anio === hoy.getFullYear() ? hoy.getMonth() + 1 : 12;
}

function pasoBonito(rango) {
  const bruto = rango / 4;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  return [1, 2, 2.5, 5, 10].map((m) => m * potencia).find((p) => p >= bruto);
}

function el(nombre, atributos = {}, padre) {
  const nodo = document.createElementNS(SVG, nombre);
  for (const [k, v] of Object.entries(atributos)) nodo.setAttribute(k, v);
  padre?.append(nodo);
  return nodo;
}

function pintarGraficaSaldos() {
  const contenedor = $('#grafica-saldos');
  contenedor.replaceChildren();
  if (!datos.movimientos) {
    contenedor.innerHTML = '<p class="vacio-texto">Registra movimientos para ver cómo cambian los saldos.</p>';
    return;
  }

  const meses = datos.meses.slice(0, mesesVisibles());
  const ancho = Math.max(contenedor.clientWidth, 280);
  const alto = 240;
  const m = { izq: 52, der: 16, arr: 12, aba: 28 };

  const valores = meses.flatMap((mes) => [mes.banco, mes.efectivo]);
  let min = Math.min(0, ...valores);
  let max = Math.max(0, ...valores);
  if (min === max) max = 1;
  const paso = pasoBonito(max - min);
  min = Math.floor(min / paso) * paso;
  max = Math.ceil(max / paso) * paso;

  const x = (i) => m.izq + (meses.length === 1 ? (ancho - m.izq - m.der) / 2 : (i * (ancho - m.izq - m.der)) / (meses.length - 1));
  const y = (v) => m.arr + ((max - v) / (max - min)) * (alto - m.arr - m.aba);

  const svg = el('svg', { viewBox: `0 0 ${ancho} ${alto}`, width: ancho, height: alto, tabindex: 0, role: 'img',
    'aria-label': 'Saldo de banco y efectivo al cierre de cada mes' }, contenedor);

  for (let v = min; v <= max + paso / 2; v += paso) {
    el('line', { x1: m.izq, x2: ancho - m.der, y1: y(v), y2: y(v), class: v === 0 ? 'eje-cero' : 'rejilla' }, svg);
    el('text', { x: m.izq - 8, y: y(v) + 4, class: 'eje-texto', 'text-anchor': 'end' }, svg).textContent = compacto.format(v);
  }
  const cadaCuanto = ancho < 480 ? 2 : 1;
  meses.forEach((mes, i) => {
    if (i % cadaCuanto && i !== meses.length - 1) return;
    el('text', { x: x(i), y: alto - 8, class: 'eje-texto', 'text-anchor': 'middle' }, svg).textContent = MESES[mes.mes - 1];
  });

  const cruz = el('line', { y1: m.arr, y2: alto - m.aba, class: 'cruz', visibility: 'hidden' }, svg);
  const puntos = {};
  for (const s of SERIES) {
    const d = meses.map((mes, i) => `${i ? 'L' : 'M'}${x(i)},${y(mes[s.clave])}`).join('');
    el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg);
    puntos[s.clave] = meses.map((mes, i) =>
      el('circle', { cx: x(i), cy: y(mes[s.clave]), r: 4, fill: s.color, class: 'punto' }, svg));
  }

  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.hidden = true;
  contenedor.append(tooltip);

  let activo = null;
  const mostrar = (i) => {
    activo = i;
    const mes = meses[i];
    cruz.setAttribute('x1', x(i));
    cruz.setAttribute('x2', x(i));
    cruz.setAttribute('visibility', 'visible');
    for (const s of SERIES) puntos[s.clave].forEach((p, j) => p.setAttribute('r', j === i ? 6 : 4));
    tooltip.replaceChildren(filaTooltip(`${MESES[mes.mes - 1]} ${anio}`));
    for (const s of SERIES) tooltip.append(filaTooltip(s.nombre, mes[s.clave], s.color));
    tooltip.hidden = false;
    const izquierda = x(i) + 12 + tooltip.offsetWidth > ancho ? x(i) - 12 - tooltip.offsetWidth : x(i) + 12;
    tooltip.style.left = `${izquierda}px`;
    tooltip.style.top = `${m.arr}px`;
  };
  const ocultar = () => {
    activo = null;
    cruz.setAttribute('visibility', 'hidden');
    for (const s of SERIES) puntos[s.clave].forEach((p) => p.setAttribute('r', 4));
    tooltip.hidden = true;
  };

  const seguir = (e) => {
    const caja = svg.getBoundingClientRect();
    const px = ((e.clientX - caja.left) / caja.width) * ancho;
    let cerca = 0;
    meses.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(cerca) - px)) cerca = i; });
    mostrar(cerca);
  };
  svg.addEventListener('pointermove', seguir);
  svg.addEventListener('pointerdown', seguir);
  // En el celular el dedo "sale" al levantarlo; el detalle queda hasta tocar fuera de la gráfica.
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') ocultar(); });
  document.addEventListener('pointerdown', (e) => { if (!svg.contains(e.target)) ocultar(); });
  svg.addEventListener('focus', () => mostrar(meses.length - 1));
  svg.addEventListener('blur', ocultar);
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' && activo > 0) mostrar(activo - 1);
    if (e.key === 'ArrowRight' && activo < meses.length - 1) mostrar(activo + 1);
  });
}

function filaTooltip(etiqueta, valor, color) {
  const fila = document.createElement('div');
  if (valor === undefined) {
    fila.className = 'tooltip-titulo';
    fila.textContent = etiqueta;
    return fila;
  }
  fila.className = 'tooltip-fila';
  const clave = document.createElement('i');
  clave.className = 'linea-clave';
  clave.style.background = color;
  const fuerte = document.createElement('strong');
  fuerte.textContent = pesos.format(valor);
  fila.append(clave, fuerte, ` ${etiqueta}`);
  return fila;
}

// ---------- Gastos por categoría (barras apiladas banco + efectivo) ----------

function pintarGastos() {
  const contenedor = $('#grafica-gastos');
  contenedor.replaceChildren();
  if (!datos.categorias.length) {
    contenedor.innerHTML = '<p class="vacio-texto">Todavía no hay gastos este año.</p>';
    return;
  }
  const mayor = Math.max(...datos.categorias.map((c) => c.banco + c.efectivo));
  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.hidden = true;

  for (const c of datos.categorias) {
    const fila = document.createElement('div');
    fila.className = 'barra-fila';
    const nombre = document.createElement('span');
    nombre.className = 'barra-nombre';
    nombre.textContent = c.categoria;
    const pista = document.createElement('div');
    pista.className = 'barra-pista';
    for (const s of SERIES) {
      if (!c[s.clave]) continue;
      const seg = document.createElement('div');
      seg.className = 'barra-seg';
      seg.style.width = `${(c[s.clave] / mayor) * 100}%`;
      seg.style.background = s.color;
      seg.tabIndex = 0;
      const mostrar = () => {
        tooltip.replaceChildren(filaTooltip(c.categoria), filaTooltip(s.nombre, c[s.clave], s.color));
        tooltip.hidden = false;
        tooltip.style.left = `${seg.offsetLeft + pista.offsetLeft}px`;
        tooltip.style.top = `${fila.offsetTop + fila.offsetHeight + 4}px`;
      };
      seg.addEventListener('pointerenter', mostrar);
      seg.addEventListener('focus', mostrar);
      seg.addEventListener('pointerleave', () => { tooltip.hidden = true; });
      seg.addEventListener('blur', () => { tooltip.hidden = true; });
      pista.append(seg);
    }
    const valor = document.createElement('span');
    valor.className = 'barra-valor';
    valor.textContent = pesos.format(c.banco + c.efectivo);
    fila.append(nombre, pista, valor);
    contenedor.append(fila);
  }
  contenedor.append(tooltip);
}

// ---------- Formulario de movimientos ----------

const form = $('#form-movimiento');

function fechaPorDefecto() {
  const hoy = hoyISO();
  return hoy.startsWith(String(anio)) ? hoy : `${anio}-12-31`;
}

function tipoActual() {
  return form.elements.tipo.value;
}

function ajustarFormulario() {
  const tipo = tipoActual();
  const cuenta = form.elements.cuenta.value;
  $('#etiqueta-cuenta').textContent = ETIQUETA_CUENTA[tipo];
  for (const opcion of form.elements.cuenta.options) {
    opcion.textContent = tipo === 'traslado'
      ? `${NOMBRE_CUENTA[opcion.value]} → ${NOMBRE_CUENTA[OTRA[opcion.value]]}`
      : NOMBRE_CUENTA[opcion.value];
  }
  $('#campo-categoria').hidden = tipo === 'traslado';
  $('#lista-categorias').replaceChildren(...(CATEGORIAS[tipo] ?? []).map((c) => new Option(c)));
  form.elements.cuenta.value = cuenta;
}

function llenarFormulario(m) {
  form.elements.tipo.value = m.tipo;
  form.elements.cuenta.value = m.cuenta;
  form.elements.fecha.value = m.fecha;
  form.elements.categoria.value = m.categoria ?? '';
  form.elements.descripcion.value = m.descripcion ?? '';
  form.elements.monto.value = m.monto ? miles.format(m.monto) : '';
  ajustarFormulario();
}

function terminarEdicion() {
  editando = null;
  $('#titulo-form').textContent = 'Registrar movimiento';
  $('#boton-guardar').textContent = 'Guardar';
  $('#boton-cancelar').hidden = true;
  llenarFormulario({ tipo: tipoActual(), cuenta: form.elements.cuenta.value, fecha: fechaPorDefecto() });
}

function editar(m) {
  editando = m.id;
  llenarFormulario(m);
  $('#titulo-form').textContent = 'Editar movimiento';
  $('#boton-guardar').textContent = 'Guardar cambios';
  $('#boton-cancelar').hidden = false;
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

form.addEventListener('change', (e) => {
  if (e.target.name === 'tipo') {
    form.elements.categoria.value = '';
    ajustarFormulario();
  }
  if (e.target.name === 'monto') {
    const v = leerMonto(e.target.value);
    e.target.value = v ? miles.format(v) : '';
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const cuerpo = {
    tipo: tipoActual(),
    cuenta: form.elements.cuenta.value,
    fecha: form.elements.fecha.value,
    categoria: form.elements.categoria.value || (tipoActual() === 'gasto' ? 'Otros' : ''),
    descripcion: form.elements.descripcion.value,
    monto: leerMonto(form.elements.monto.value),
  };
  if (!cuerpo.monto) return aviso('Escribe un monto', true);
  try {
    if (editando) await pedir(`/api/movimientos/${editando}`, { method: 'PUT', body: cuerpo });
    else await pedir('/api/movimientos', { method: 'POST', body: cuerpo });
    aviso(editando ? 'Movimiento actualizado' : 'Movimiento guardado');
    const anioMovimiento = Number(cuerpo.fecha.slice(0, 4));
    if (anioMovimiento !== anio) anio = anioMovimiento;
    terminarEdicion();
    await cargarDashboard();
  } catch (err) {
    aviso(`No se guardó: ${err.message}`, true);
  }
});

$('#boton-cancelar').addEventListener('click', terminarEdicion);

// ---------- Lista de movimientos ----------

function pintarMovimientos(movimientos) {
  const tbody = $('#filas-movimientos');
  tbody.replaceChildren();
  if (!movimientos.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="vacio-texto">No hay movimientos en este año.</td></tr>';
    return;
  }
  for (const m of movimientos) {
    const tr = document.createElement('tr');
    const signo = { entrada: '+', gasto: '−', traslado: '' }[m.tipo];
    const celdas = [
      formatoFecha(m.fecha, { day: 'numeric', month: 'short' }),
      m.tipo[0].toUpperCase() + m.tipo.slice(1),
      m.tipo === 'traslado' ? `${NOMBRE_CUENTA[m.cuenta]} → ${NOMBRE_CUENTA[OTRA[m.cuenta]]}` : NOMBRE_CUENTA[m.cuenta],
      m.categoria,
      m.descripcion,
      `${signo}${pesos.format(m.monto)}`,
    ];
    for (const texto of celdas) {
      const td = document.createElement('td');
      td.textContent = texto;
      tr.append(td);
    }
    tr.children[1].className = `etiqueta-tipo tipo-${m.tipo}`;
    tr.children[5].classList.toggle('negativo', m.tipo === 'gasto');

    const acciones = document.createElement('td');
    acciones.className = 'acciones-fila';
    const botonEditar = document.createElement('button');
    botonEditar.className = 'boton-texto';
    botonEditar.textContent = 'Editar';
    botonEditar.addEventListener('click', () => editar(m));
    const botonBorrar = document.createElement('button');
    botonBorrar.className = 'boton-texto peligro';
    botonBorrar.textContent = 'Borrar';
    botonBorrar.addEventListener('click', async () => {
      if (!confirm(`¿Borrar ${m.categoria || m.tipo} de ${pesos.format(m.monto)}?`)) return;
      try {
        await pedir(`/api/movimientos/${m.id}`, { method: 'DELETE' });
        if (editando === m.id) terminarEdicion();
        aviso('Movimiento borrado');
        await cargarDashboard();
      } catch (err) {
        aviso(`No se borró: ${err.message}`, true);
      }
    });
    acciones.append(botonEditar, botonBorrar);
    tr.append(acciones);
    tbody.append(tr);
  }
}

// ---------- Navegación ----------

$('#anio-anterior').addEventListener('click', () => { anio -= 1; terminarEdicion(); cargarDashboard(); });
$('#anio-siguiente').addEventListener('click', () => { anio += 1; terminarEdicion(); cargarDashboard(); });

let espera;
window.addEventListener('resize', () => {
  clearTimeout(espera);
  espera = setTimeout(() => { if (datos && !$('#vista-dashboard').hidden) pintarGraficaSaldos(); }, 150);
});

llenarFormulario({ tipo: 'gasto', cuenta: 'efectivo', fecha: fechaPorDefecto() });
