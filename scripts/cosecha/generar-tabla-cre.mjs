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
const SALIDA = join(AQUI, '../../src/lib/likida/facturacion/permisos_cre.json');

const { estaciones } = JSON.parse(readFileSync(ENTRADA, 'utf8'));

// Las grafías vienen sucias: "Pemex", "PEMEX", "Gasolinera Pemex" son la misma.
// Sin normalizar, el conteo miente y la marca que se le enseña al operador sale
// en tres formas distintas.
// Al cosechar las 13,625 estaciones salieron 4,860 "marcas", y eso era falso:
// `Pemex`, `Gasolinera Pemex`, `PEMEX` y `PeMex` son la misma y se contaban por
// separado. También entró `Ciudad/Municipio` como marca —una etiqueta del propio
// sitio que el extractor tomó por valor—. Sin normalizar de verdad, la tabla le
// enseña al operador la marca en cuatro formas distintas y el conteo miente.
const GENERICOS = new Set([
  'GASOLINERA', 'GASOLINERIA', 'GASOLINERÍA', 'ESTACION', 'ESTACIÓN', 'GAS', '',
  'CIUDAD/MUNICIPIO', 'ESTADO', 'DIRECCION', 'DIRECCIÓN', 'COMPAÑIA', 'COMPAÑÍA',
  'CODIGO POSTAL', 'COORDENADAS', 'ID DE R', 'PRECIO', 'SERVICIOS', 'HISTORICO',
  'ESTACION DE SERVICIO', 'ESTACIÓN DE SERVICIO', 'GASOLINERAS', 'SERVICIO',
]);

/** Sinónimos que no se resuelven quitando prefijos: hay que decirlos. */
const CANONICO = [
  [/\bPEMEX\b/, 'PEMEX'],
  [/\bOXXO\s*GAS\b/, 'OXXO GAS'],
  [/\bPETRO\s*7\b|\bPETRO\s*SEVEN\b/, 'PETRO SEVEN'],
  [/\bG\s*500\b/, 'G500'],
  [/\bREPSOL\b/, 'REPSOL'],
  [/\bSHELL\b/, 'SHELL'],
  [/^BP$|\bBP\s+GASOLINER|\bGASOLINERA\s+BP\b/, 'BP'],
  [/\bCHEVRON\b/, 'CHEVRON'],
  [/\bMOBIL\b/, 'MOBIL'],
  [/\bGULF\b/, 'GULF'],
  [/\bARCO\b/, 'ARCO'],
  [/\bTOTAL(GAS)?\b/, 'TOTAL'],
  [/\bNEXUM\b/, 'NEXUM'],
  [/\bHIDROSINA\b/, 'HIDROSINA'],
  [/\bLA\s*GAS\b/, 'LA GAS'],
  [/\bMEGASUR\b/, 'MEGASUR'],
  [/\bRENDICHICAS\b/, 'RENDICHICAS'],
  [/\bORSAN\b/, 'ORSAN'],
];

const norm = (c) => {
  let s = (c ?? '').toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')          // sin acentos
    .replace(/^(GASOLINERA|GASOLINERIA|ESTACION DE SERVICIO|ESTACION|ESTACIONES DE SERVICIO)\s+/g, '')
    .replace(/[,.]?\s*S\.?\s?A\.?(\s*DE\s*C\.?\s?V\.?)?\.?$/g, '')
    .replace(/[,.]?\s*S\.?\s?DE\s?R\.?\s?L\.?(\s*DE\s*C\.?\s?V\.?)?\.?$/g, '')
    .replace(/\s+/g, ' ').trim();
  if (GENERICOS.has(s)) return null;
  // CAMPO CORRIDO. Cuando la ficha del sitio deja "Compañía" vacía, el
  // extractor toma el SIGUIENTE campo y la "marca" sale siendo
  // `Ciudad/Municipio Tixkokob` o `Codigo Postal 97470`. Se detectó con el
  // ticket real de G500 Megasur, cuya marca salía como el municipio.
  //
  // No se puede adivinar cuál era la marca, así que se descarta: un `null` deja
  // el permiso fuera de la tabla y el producto responde 'desconocido', que es la
  // verdad. Inventarla pondría un municipio donde va una marca.
  if (/^(CIUDAD\/MUNICIPIO|ESTADO|DIRECCION|CODIGO POSTAL|COORDENADAS|ID DE)\b/.test(s)) return null;
  for (const [re, canon] of CANONICO) if (re.test(s)) return canon;
  return s || null;
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
