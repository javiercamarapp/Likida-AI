#!/usr/bin/env node
// Deriva la tabla compacta `permiso CRE → marca` que consume el producto, desde
// el consolidado de la cosecha. Se vuelve a correr cuando la cosecha avanza; la
// tabla crece y el código no cambia.
//
//   node scripts/cosecha/generar-tabla-cre.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
const AQUI = dirname(new URL(import.meta.url).pathname);
const ENTRADA = join(AQUI, '../../docs/investigacion/cosecha/consolidado-estaciones.json');
const SALIDA = join(AQUI, '../../src/lib/cuadra/facturacion/permisos_cre.json');

const { estaciones } = JSON.parse(readFileSync(ENTRADA, 'utf8'));

// Las grafías vienen sucias: "Pemex", "PEMEX", "Gasolinera Pemex" son la misma.
// Sin normalizar, el conteo miente y la marca que se le enseña al operador sale
// en tres formas distintas.
const GENERICOS = new Set(['GASOLINERA', 'GASOLINERIA', 'GASOLINERÍA', 'ESTACION', 'ESTACIÓN', 'GAS', '']);
const norm = (c) => {
  const s = (c ?? '').toUpperCase()
    .replace(/^(GASOLINERA|GASOLINERIA|ESTACION DE SERVICIO|ESTACIÓN DE SERVICIO|ESTACION|ESTACIÓN)\s+/g, '')
    .replace(/\s+(S\.?A\.?|S\.? DE R\.?L\.?)(\.? DE C\.?V\.?)?\.?$/g, '')
    .replace(/\s+/g, ' ').trim();
  return GENERICOS.has(s) ? null : s;
};

const tabla = {};
let sinMarca = 0;
for (const [permiso, e] of Object.entries(estaciones)) {
  const m = norm(e.compania);
  if (!m) { sinMarca++; continue; }
  tabla[permiso] = m;
}

const marcas = new Set(Object.values(tabla));
writeFileSync(SALIDA, JSON.stringify(tabla));
console.log(`${Object.keys(tabla).length.toLocaleString()} permisos → ${marcas.size} marcas`);
console.log(`${sinMarca} descartados por marca genérica o vacía`);
