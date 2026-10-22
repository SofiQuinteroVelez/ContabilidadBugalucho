export const pesos = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
export const miles = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
export const $ = (sel) => document.querySelector(sel);

export function hoyISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function sumarDias(fecha, n) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function formatoFecha(fecha, opciones) {
  return new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-CO', { timeZone: 'UTC', ...opciones });
}

// Acepta "689000", "689.000", "689,000.00" o "$ 689.000"; los montos son pesos enteros.
export function leerMonto(texto) {
  const limpio = texto.replace(/[,.]00$/, '').replace(/\D/g, '');
  return limpio ? Number(limpio) : 0;
}

export function aviso(texto, error = false) {
  const el = $('#aviso');
  el.textContent = texto;
  el.classList.toggle('error', error);
  el.classList.add('visible');
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => el.classList.remove('visible'), error ? 4000 : 1200);
}

export async function pedir(url, opciones = {}) {
  const res = await fetch(url, {
    ...opciones,
    headers: { 'Content-Type': 'application/json' },
    body: opciones.body && JSON.stringify(opciones.body),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
  return res.json();
}

export function ponerMonto(celda, valor) {
  celda.textContent = pesos.format(valor);
  celda.classList.toggle('negativo', valor < 0);
}

// "19 – 25 oct 2026", o "28 sep – 4 oct 2026" si la semana cambia de mes.
export function rangoSemana(lunes, domingo) {
  const dia = (f) => Number(f.slice(8, 10));
  const mes = (f) => formatoFecha(f, { month: 'short' }).replace('.', '');
  const inicio = mes(lunes) === mes(domingo) ? dia(lunes) : `${dia(lunes)} ${mes(lunes)}`;
  return `${inicio} – ${dia(domingo)} ${mes(domingo)} ${domingo.slice(0, 4)}`;
}
