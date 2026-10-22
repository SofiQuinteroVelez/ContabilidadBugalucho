// Copia los datos del computador (data/bugalucho.db) a Turso. Uso:
//   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run migrar
import { createClient } from '@libsql/client';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: authToken } = process.env;
if (!url) {
  console.error('Falta TURSO_DATABASE_URL. Mira el README.');
  process.exit(1);
}

const raiz = dirname(fileURLToPath(import.meta.url));
const local = createClient({ url: pathToFileURL(join(raiz, 'data', 'bugalucho.db')).href });
const remoto = createClient({ url, authToken });

// Importar db.js con TURSO_DATABASE_URL crea las tablas en Turso al primer uso.
const { todosLosDias } = await import('./db.js');
await todosLosDias();

const TABLAS = {
  dias: ['fecha', 'ingresos', 'qr', 'gastos', 'efectivo', 'notas'],
  semanas: ['lunes', 'gasto_semanal', 'maza', 'nomina', 'notas'],
  movimientos: ['id', 'fecha', 'tipo', 'cuenta', 'categoria', 'descripcion', 'monto'],
};

for (const [tabla, columnas] of Object.entries(TABLAS)) {
  const { rows } = await local.execute(`SELECT ${columnas.join(', ')} FROM ${tabla}`);
  const marcas = columnas.map(() => '?').join(', ');
  await remoto.batch(
    rows.map((fila) => ({
      sql: `INSERT OR REPLACE INTO ${tabla} (${columnas.join(', ')}) VALUES (${marcas})`,
      args: columnas.map((_, i) => fila[i]),
    })),
    'write',
  );
  console.log(`${tabla}: ${rows.length} filas copiadas`);
}
console.log('Listo. Los datos ya están en Turso.');
