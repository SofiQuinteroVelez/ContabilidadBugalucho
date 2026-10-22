// Rutas de la API. Las usa server.js en el computador y api/index.js en Vercel.
import {
  authActiva, contrasenaCorrecta, cookieSalir, cookieSesion, sesionValida,
} from './auth.js';
import {
  actualizarMovimiento, borrarDia, borrarMovimiento, crearMovimiento, dashboard, guardarDia,
  guardarSemana, listarMovimientos, lunesDe, listarSemanas, obtenerSemana, todosLosDias,
} from './db.js';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function json(res, estado, cuerpo, cabeceras = {}) {
  res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cabeceras });
  res.end(JSON.stringify(cuerpo));
}

async function leerCuerpo(req) {
  // Vercel ya trae el cuerpo leído en req.body; en el computador hay que leerlo del stream.
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {};
  let texto = '';
  for await (const parte of req) texto += parte;
  return texto ? JSON.parse(texto) : {};
}

function csv(dias) {
  const filas = [['Fecha', 'Ingresos del día', 'Ingresos QR', 'Gastos del día', 'Efectivo', 'Total del día', 'Notas']];
  for (const d of dias) filas.push([d.fecha, d.ingresos, d.qr, d.gastos, d.efectivo, d.total, d.notas]);
  return '﻿' + filas.map((f) => f.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n');
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function rutas(req, res, recurso, param, query) {
  const anio = /^\d{4}$/.test(query.get('anio') ?? '') ? query.get('anio') : String(new Date().getFullYear());

  if (recurso === 'login' && req.method === 'POST') {
    if (!process.env.APP_PASSWORD) {
      return json(res, 500, { error: 'Falta configurar APP_PASSWORD en Vercel' });
    }
    const { contrasena } = await leerCuerpo(req);
    if (!contrasenaCorrecta(contrasena)) {
      await espera(800); // frena a quien intente adivinar
      return json(res, 401, { error: 'Contraseña incorrecta' });
    }
    return json(res, 200, { ok: true }, { 'Set-Cookie': cookieSesion(req) });
  }

  if (recurso === 'salir' && req.method === 'POST') {
    return json(res, 200, { ok: true }, { 'Set-Cookie': cookieSalir(req) });
  }

  if (recurso === 'sesion' && req.method === 'GET') {
    return json(res, 200, { activa: sesionValida(req), requiere: authActiva() });
  }

  if (!sesionValida(req)) return json(res, 401, { error: 'Inicia sesión' });

  if (recurso === 'semana' && req.method === 'GET') {
    const fecha = param && FECHA.test(param) ? param : new Date().toISOString().slice(0, 10);
    return json(res, 200, await obtenerSemana(fecha));
  }

  if (recurso === 'semana' && req.method === 'PUT' && FECHA.test(param ?? '')) {
    await guardarSemana(lunesDe(param), await leerCuerpo(req));
    return json(res, 200, await obtenerSemana(param));
  }

  if (recurso === 'dia' && FECHA.test(param ?? '')) {
    if (req.method === 'PUT') {
      await guardarDia(param, await leerCuerpo(req));
      return json(res, 200, await obtenerSemana(param));
    }
    if (req.method === 'DELETE') {
      await borrarDia(param);
      return json(res, 200, await obtenerSemana(param));
    }
  }

  if (recurso === 'semanas' && req.method === 'GET') return json(res, 200, await listarSemanas());

  if (recurso === 'dashboard' && req.method === 'GET') return json(res, 200, await dashboard(anio));

  if (recurso === 'movimientos') {
    if (req.method === 'GET' && !param) return json(res, 200, await listarMovimientos(anio));
    try {
      if (req.method === 'POST' && !param) {
        return json(res, 201, { id: await crearMovimiento(await leerCuerpo(req)) });
      }
      const id = Number(param);
      if (Number.isInteger(id) && req.method === 'PUT') {
        await actualizarMovimiento(id, await leerCuerpo(req));
        return json(res, 200, { id });
      }
      if (Number.isInteger(id) && req.method === 'DELETE') {
        await borrarMovimiento(id);
        return json(res, 200, { id });
      }
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (recurso === 'exportar' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="bugalucho-contabilidad.csv"',
      'Cache-Control': 'no-store',
    });
    return res.end(csv(await todosLosDias()));
  }

  json(res, 404, { error: 'No encontrado' });
}

export async function manejarApi(req, res) {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');
  // /api/<recurso>/<param>; en Vercel puede llegar como /api?ruta=<recurso>/<param> (vercel.json).
  const ruta = pathname === '/api' && searchParams.has('ruta') ? `/api/${searchParams.get('ruta')}` : pathname;
  const [, , recurso, param] = ruta.split('/');
  try {
    await rutas(req, res, recurso, param, searchParams);
  } catch (err) {
    console.error(err);
    const configuracion = /TURSO|APP_PASSWORD/.test(err.message);
    json(res, 500, { error: configuracion ? err.message : 'Error del servidor' });
  }
}
