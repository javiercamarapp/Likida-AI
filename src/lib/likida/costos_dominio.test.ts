// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 25 · DATOS-A1 — EL TIPO DE TS Y EL CHECK DE LA BASE, CRUZADOS.
//
// `FaseCosto` (costos.ts) y `llm_costo_fase_dominio` describen la MISMA lista.
// Cuando divergen no falla nada visible: `registrarCosto` es best-effort, el
// INSERT rebota con 23514, se escribe una línea `costo.no_registrado` y la
// liquidación cierra normal. El costo simplemente deja de existir, y el costo
// unitario —la cifra con la que se fija el precio del producto— sale bajo.
//
// Eso fue exactamente lo que pasó con `'transcripcion'`: entró en TS el
// 29-ago-2026 con la nota de voz y el CHECK de 0025 no se tocó. Nadie se
// enteró en cinco días porque el modo de falla es el silencio.
//
// Esta prueba es el arnés que faltaba. NO consulta Postgres —aquí no hay base—:
// lee el SQL de las migraciones, se queda con la ÚLTIMA que define el
// constraint (que es la que gobierna, porque el idioma del repo es soltar y
// recrear) y compara conjunto contra conjunto. Si alguien agrega una fase a
// `FaseCosto` sin migración, o una migración sin tocar el tipo, esto sale rojo
// con la diferencia escrita.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRACIONES = join(process.cwd(), 'supabase', 'migrations');

/** Las fases que el CHECK vivo acepta, según la ÚLTIMA migración que lo define. */
function fasesDelDominio(): { fases: string[]; migracion: string } {
  const archivos = readdirSync(MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
  let ultima: { fases: string[]; migracion: string } | null = null;

  for (const archivo of archivos) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta derivada de readdirSync sobre un directorio fijo del repo
    const sql = readFileSync(join(MIGRACIONES, archivo), 'utf8');
    if (!sql.includes('llm_costo_fase_dominio')) continue;

    // `fase in ('a','b',…)` — el mismo texto en los dos idiomas que usa el repo
    // para declarar el dominio: el `$c$…$c$` de 0025 y el `check (…)` de 0304.
    for (const m of sql.matchAll(/fase\s+in\s*\(([^)]*)\)/gi)) {
      const fases = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
      if (fases.length > 0) ultima = { fases, migracion: archivo };
    }
  }

  if (!ultima) throw new Error('ninguna migración define llm_costo_fase_dominio');
  return ultima;
}

/** Las fases que el tipo de TS declara. Se lee del fuente a propósito: un
 *  `type` no existe en tiempo de ejecución, y enumerarlo a mano aquí sería una
 *  TERCERA copia de la misma lista — justo lo que esta prueba vigila. */
function fasesDelTipo(): string[] {
  const src = readFileSync(join(process.cwd(), 'src', 'lib', 'likida', 'costos.ts'), 'utf8');
  const m = src.match(/export type FaseCosto\s*=\s*([^;]+);/);
  if (!m) throw new Error('no se encontró `export type FaseCosto` en costos.ts');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe('DATOS-A1 · FaseCosto y llm_costo_fase_dominio dicen lo mismo', () => {
  it('el CHECK acepta TODAS las fases que el tipo puede producir', () => {
    const { fases, migracion } = fasesDelDominio();
    const enTs = fasesDelTipo();
    const rechazadas = enTs.filter((f) => !fases.includes(f));
    expect(
      rechazadas,
      `el CHECK de ${migracion} rechaza ${rechazadas.join(', ')}: ` +
        'registrarCosto rebota con 23514 y el costo se pierde EN SILENCIO ' +
        '(es best-effort a propósito). Agrega una migración que recree el ' +
        'constraint con la lista completa.',
    ).toEqual([]);
  });

  it('el CHECK no acepta fases que el tipo ya no tiene', () => {
    // La otra dirección importa menos (una fase de más no pierde datos) pero
    // señala una lista que se quedó atrás, que es como empezó esta.
    const { fases, migracion } = fasesDelDominio();
    const enTs = fasesDelTipo();
    const sobrantes = fases.filter((f) => !enTs.includes(f));
    expect(sobrantes, `${migracion} acepta fases que FaseCosto ya no declara: ${sobrantes.join(', ')}`).toEqual([]);
  });

  it('`transcripcion` está en las dos listas (la fase que motivó el hallazgo)', () => {
    expect(fasesDelTipo()).toContain('transcripcion');
    expect(fasesDelDominio().fases).toContain('transcripcion');
  });
});
