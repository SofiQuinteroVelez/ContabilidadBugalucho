// Carga la semana del 5 al 10 de octubre de 2026 tal como estaba en el Excel.
import { guardarDia, guardarSemana, obtenerSemana } from './db.js';

const dias = [
  ['2026-10-05', 689000, 199000, 355300, 340000],
  ['2026-10-06', 846500, 306000, 726350, 141000],
  ['2026-10-07', 724500, 197000, 532600, 195000],
  ['2026-10-08', 989500, 240500, 352800, 632000],
  ['2026-10-09', 789000, 411500, 343650, 368000],
  ['2026-10-10', 449500, 108000, 111250, 337500],
];

for (const [fecha, ingresos, qr, gastos, efectivo] of dias) {
  await guardarDia(fecha, { ingresos, qr, gastos, efectivo });
}
// La nómina no aparece en el Excel; se deduce de 3.475.500 + 90.000 − 2.323.500.
await guardarSemana('2026-10-05', { gasto_semanal: 0, maza: 90000, nomina: 1242000 });

const { totales } = await obtenerSemana('2026-10-05');
console.log('Semana cargada. Total semana:', totales.totalSemana, '· Después nómina:', totales.despuesNomina);
