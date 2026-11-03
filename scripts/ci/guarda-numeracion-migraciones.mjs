#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// GUARDA DE NUMERACIÓN DE MIGRACIONES — CT-BAS-10.
//
// Regla: toda migración nueva lleva un número MAYOR a la base (0949) y TODO
// hueco en la numeración que no esté declarado en
// `supabase/migrations/NUMERACION-SALTADA.md` está prohibido. Un agente que
// rellene un hueco aplicaría su SQL en producción DESPUÉS de la última
// migración ya aplicada (fuera de su hueco numérico).
//
// El .md es la fuente: tabla «Huecos declarados» (primera celda `NNNN` o
// `NNNN`-`NNNN`) y tabla «Rangos reservados por fase». Dentro de un rango
// reservado se toleran huecos sobre la base (la fase aún no cierra); fuera de
// uno, un hueco por encima de la base es error. Un número declarado como
// saltado que SÍ tiene archivo también es error (el .md quedó desactualizado
// o alguien rellenó un hueco).
//
// Complementa a `prefijosMigraciones` de compuerta-deploy.mjs, que ya rechaza
// dos archivos con el mismo prefijo. Se ejecuta en CI por
// `scripts/ci/guarda_numeracion_migraciones.test.ts`.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { prefijosMigraciones } from './compuerta-deploy.mjs';

export const BASE_APLICADA = 949;

const FILA = /^\|\s*`(\d{4})`(?:\s*(?:-|–|a)\s*`(\d{4})`)?\s*\|/;

/** PURA. Extrae `{declarados:[[a,b]], reservados:[[a,b]]}` del texto del .md. */
export function parsearNumeracion(md) {
  const salida = { declarados: [], reservados: [] };
  let seccion = null;
  for (const linea of md.split('\n')) {
    if (/^##\s+Huecos declarados/i.test(linea)) { seccion = 'declarados'; continue; }
    if (/^##\s+Rangos reservados/i.test(linea)) { seccion = 'reservados'; continue; }
    if (/^##\s/.test(linea)) { seccion = null; continue; }
    if (!seccion) continue;
    const m = FILA.exec(linea);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    if (b < a) throw new Error(`rango invertido en NUMERACION-SALTADA.md: ${linea.slice(0, 60)}`);
    salida[seccion].push([a, b]);
  }
  return salida;
}

const enRangos = (n, rangos) => rangos.some(([a, b]) => n >= a && n <= b);

/**
 * PURA. `prefijos`: prefijos de cuatro dígitos de los archivos del repo.
 * Devuelve `{ok, errores}`.
 */
export function verificarNumeracion({ prefijos, declarados, reservados, base = BASE_APLICADA }) {
  const errores = [];
  const nums = prefijos.map(Number).sort((x, y) => x - y);
  const existentes = new Set(nums);
  if (nums.length === 0) return { ok: false, errores: ['sin migraciones'] };
  const max = nums[nums.length - 1];

  for (let n = nums[0]; n <= max; n++) {
    if (existentes.has(n)) continue;
    if (enRangos(n, declarados)) continue;
    if (n > base && enRangos(n, reservados)) continue;
    errores.push(`hueco no declarado: ${String(n).padStart(4, '0')} (declaralo en NUMERACION-SALTADA.md con su motivo; no se rellena con un archivo)`);
  }
  for (const [a, b] of declarados) {
    for (let n = a; n <= b; n++) {
      if (existentes.has(n)) {
        errores.push(`${String(n).padStart(4, '0')} está declarado como saltado pero existe un archivo con ese número: un hueco histórico no se rellena (numeración nueva > ${String(base).padStart(4, '0')})`);
      }
    }
  }
  return { ok: errores.length === 0, errores };
}

export function verificarRepo({ dirMigraciones = 'supabase/migrations', ruta = 'supabase/migrations/NUMERACION-SALTADA.md' } = {}) {
  const { declarados, reservados } = parsearNumeracion(readFileSync(ruta, 'utf8'));
  return verificarNumeracion({ prefijos: prefijosMigraciones(dirMigraciones), declarados, reservados });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = verificarRepo();
  if (!r.ok) {
    for (const e of r.errores) console.log(`::error::${e}`);
    console.log(`guarda de numeración de migraciones: ${r.errores.length} problema(s).`);
    process.exit(1);
  }
  console.log('guarda de numeración de migraciones: OK');
}
