import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  actualizarMovimiento, borrarDia, borrarMovimiento, crearMovimiento, dashboard, guardarDia,
  guardarSemana, listarMovimientos, lunesDe, listarSemanas, obtenerSemana, todosLosDias,
} from './db.js';

const PUERTO = Number(process.env.PORT ?? 3000);
const publico = join(dirname(fileURLToPath(import.meta.url)), 'public');
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

function json(res, estado, cuerpo) {
  res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(cuerpo));
}

async function leerCuerpo(req) {
  let texto = '';
  for await (const parte of req) texto += parte;
  return texto ? JSON.parse(texto) : {};
}

function csv(dias) {
  const filas = [['Fecha', 'Ingresos del día', 'Ingresos QR', 'Gastos del día', 'Efectivo', 'Total del día', 'Notas']];
  for (const d of dias) filas.push([d.fecha, d.ingresos, d.qr, d.gastos, d.efectivo, d.total, d.notas]);
  return '﻿' + filas.map((f) => f.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n');
}

async function api(req, res, ruta, query) {
  const [, , recurso, param] = ruta.split('/'); // /api/<recurso>/<param>
  const anio = /^\d{4}$/.test(query.get('anio') ?? '') ? query.get('anio') : String(new Date().getFullYear());

  if (recurso === 'semana' && req.method === 'GET') {
    const fecha = param && FECHA.test(param) ? param : new Date().toISOString().slice(0, 10);
    return json(res, 200, obtenerSemana(fecha));
  }

  if (recurso === 'semana' && req.method === 'PUT' && FECHA.test(param ?? '')) {
    guardarSemana(lunesDe(param), await leerCuerpo(req));
    return json(res, 200, obtenerSemana(param));
  }

  if (recurso === 'dia' && FECHA.test(param ?? '')) {
    if (req.method === 'PUT') {
      guardarDia(param, await leerCuerpo(req));
      return json(res, 200, obtenerSemana(param));
    }
    if (req.method === 'DELETE') {
      borrarDia(param);
      return json(res, 200, obtenerSemana(param));
    }
  }

  if (recurso === 'semanas' && req.method === 'GET') return json(res, 200, listarSemanas());

  if (recurso === 'dashboard' && req.method === 'GET') return json(res, 200, dashboard(anio));

  if (recurso === 'movimientos') {
    try {
      if (req.method === 'GET' && !param) return json(res, 200, listarMovimientos(anio));
      if (req.method === 'POST' && !param) {
        return json(res, 201, { id: Number(crearMovimiento(await leerCuerpo(req))) });
      }
      const id = Number(param);
      if (Number.isInteger(id) && req.method === 'PUT') {
        actualizarMovimiento(id, await leerCuerpo(req));
        return json(res, 200, { id });
      }
      if (Number.isInteger(id) && req.method === 'DELETE') {
        borrarMovimiento(id);
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
    });
    return res.end(csv(todosLosDias()));
  }

  json(res, 404, { error: 'No encontrado' });
}

async function estatico(res, ruta) {
  const archivo = normalize(join(publico, ruta === '/' ? 'index.html' : ruta));
  if (!archivo.startsWith(publico)) return json(res, 403, { error: 'Prohibido' });
  try {
    const contenido = await readFile(archivo);
    res.writeHead(200, { 'Content-Type': TIPOS[extname(archivo)] ?? 'application/octet-stream' });
    res.end(contenido);
  } catch {
    json(res, 404, { error: 'No encontrado' });
  }
}

createServer(async (req, res) => {
  const { pathname: ruta, searchParams } = new URL(req.url, 'http://localhost');
  try {
    if (ruta.startsWith('/api/')) await api(req, res, ruta, searchParams);
    else await estatico(res, ruta);
  } catch (err) {
    console.error(err);
    json(res, 500, { error: 'Error del servidor' });
  }
}).listen(PUERTO, () => {
  console.log(`Bugalucho · contabilidad lista en http://localhost:${PUERTO}`);
});
