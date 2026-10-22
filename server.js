// Servidor para usar la web en el computador (npm start). En Vercel se usa api/index.js.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { json, manejarApi } from './rutas.js';

const PUERTO = Number(process.env.PORT ?? 3000);
const publico = join(dirname(fileURLToPath(import.meta.url)), 'public');

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

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
  const ruta = new URL(req.url, 'http://localhost').pathname;
  if (ruta.startsWith('/api/')) await manejarApi(req, res);
  else await estatico(res, ruta);
}).listen(PUERTO, () => {
  console.log(`Bugalucho · contabilidad lista en http://localhost:${PUERTO}`);
});
