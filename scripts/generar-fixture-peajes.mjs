#!/usr/bin/env node
// Escribe a disco un libro SINTÉTICO con la forma del estado de cuenta decenal del proveedor de peajes
// (ver src/lib/likida/peajes/fixtures/generar_desglose_iave.ts). Sirve para probar el importador a mano.
//   node scripts/generar-fixture-peajes.mjs salida.xlsx [filas=9000] [inicio=2026-03-01]
// No contiene ningún dato real: casetas, TAGs y unidades son inventados.
import { writeFileSync } from 'node:fs';
import { generarLibroIave } from '../src/lib/likida/peajes/fixtures/generar_desglose_iave.ts';

const [salida, filas = '9000', inicio = '2026-03-01'] = process.argv.slice(2);
if (!salida) {
  console.error('Uso: node scripts/generar-fixture-peajes.mjs salida.xlsx [filas] [inicio AAAA-MM-DD]');
  process.exit(1);
}
const { buffer, esperado } = generarLibroIave({ filas: Number(filas), inicio });
// eslint-disable-next-line security/detect-non-literal-fs-filename -- la ruta de salida la elige quien corre el script a mano; el contenido es sintético.
writeFileSync(salida, buffer);
console.log(`Escrito ${salida} (${buffer.length} bytes). Verdad del generador:`, JSON.stringify(esperado));
