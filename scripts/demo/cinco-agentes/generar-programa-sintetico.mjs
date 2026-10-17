#!/usr/bin/env node
// Escribe el programa de despacho SINTÉTICO del demo del Vigía (A4) en
// scripts/demo/cinco-agentes/archivos-muestra/programa/programa_despacho_sintetico.csv.
//   node scripts/demo/cinco-agentes/generar-programa-sintetico.mjs
// No necesita base de datos ni red. Determinista: la prueba de muestras exige que el archivo sea idéntico a lo que
// escribe `construirProgramaDemo(1)`. Todo es inventado y va rotulado SIMULADO.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { createJiti } = createRequire(import.meta.url)('jiti');
const jiti = createJiti(import.meta.url, { alias: { '@': join(raiz, 'src') }, moduleCache: false });
const { construirProgramaDemo } = await jiti.import(join(raiz, 'src/lib/likida/demo_cinco_agentes/programa_demo.ts'));

const ruta = join(raiz, 'scripts/demo/cinco-agentes/archivos-muestra/programa/programa_despacho_sintetico.csv');
mkdirSync(dirname(ruta), { recursive: true });
const texto = construirProgramaDemo(1);
writeFileSync(ruta, texto);
console.log(`programa/programa_despacho_sintetico.csv  (${Buffer.byteLength(texto)} bytes)`);
