/* eslint-disable security/detect-non-literal-fs-filename -- lee su propio fuente del repo para cotejarlo contra la descripción declarada */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/** A49-TC-01 — La ventana que el copiloto le DECLARA al modelo tiene que ser la
 *  que la consulta de verdad usa.
 *
 *  `PARAM_MODO` (chat-tools.ts) es el único parámetro de `serie_gasto`,
 *  `serie_liquidado` y `top_rutas`, y su `description` es lo único que el modelo
 *  tiene para saber qué ventana pidió. Las tres cuelgan de `SEMANAS_POR_MODO`
 *  (analytics.ts), que vale 5 / 13 / 52 semanas. La descripción decía «últimos 7
 *  días, últimos 30, o todo el histórico»: 35 días narrados como 7 (×5) y 91
 *  narrados como 30 (×3), con el prompt ORDENÁNDOLE al modelo pronunciar la
 *  ventana. El contralor oía «el último mes» por un trimestre, con la cifra
 *  correcta al lado — la regla del repo que se rompe es «un rótulo tiene que ser
 *  verdad», en el canal donde el contralor pregunta.
 *
 *  La prueba lee las DOS fuentes y las cruza, en vez de fijar un literal: si
 *  mañana `SEMANAS_POR_MODO` cambia a 4 / 12 / 26 y nadie toca la descripción,
 *  esto se pone rojo. Leer el fuente para cotejarlo contra su declaración es el
 *  patrón que el repo ya usa para los rótulos migrados a i18n. */

const fuente = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), 'utf8');

function semanasPorModo(): Record<string, number> {
  const src = fuente('../likida/analytics.ts');
  const m = /const SEMANAS_POR_MODO = \{([^}]*)\}/.exec(src);
  if (!m) throw new Error('no se encontró SEMANAS_POR_MODO en analytics.ts');
  const out: Record<string, number> = {};
  for (const [, k, v] of m[1].matchAll(/(\w+)\s*:\s*(\d+)/g)) out[k] = Number(v);
  return out;
}

function descripcionDeModo(): string {
  const src = fuente('./chat-tools.ts');
  const bloque = /const PARAM_MODO = \{[\s\S]*?\n\} as const;/.exec(src);
  if (!bloque) throw new Error('no se encontró PARAM_MODO en chat-tools.ts');
  const d = /description:\s*'([^']*)'/.exec(bloque[0]);
  if (!d) throw new Error('PARAM_MODO sin description');
  return d[1];
}

describe('A49-TC-01 · la ventana declarada al modelo es la que se consulta', () => {
  it('las tres ventanas de SEMANAS_POR_MODO se leen tal cual en la descripción', () => {
    const semanas = semanasPorModo();
    const desc = descripcionDeModo();

    // El mapeo real, para que el fallo diga qué se consulta de verdad.
    expect(semanas).toEqual({ semanal: 5, mensual: 13, historico: 52 });

    for (const [modo, n] of Object.entries(semanas)) {
      expect(desc, `la descripción no nombra las ${n} semanas de "${modo}"`).toContain(String(n));
    }
  });

  it('no promete días que no son: ni «7 días» ni «30» para ventanas de 35 y 91 días', () => {
    const desc = descripcionDeModo();
    expect(desc).not.toMatch(/7\s*d[ií]as/i);
    expect(desc).not.toMatch(/[úu]ltimos\s*30\b/i);
  });

  it('declara que en top_rutas el modo histórico va SIN cota, no a 52 semanas', () => {
    // `getTopRutasPorGastoSeries` no manda ventana para `historico` (analytics.ts),
    // así que la misma palabra significa dos cosas según la herramienta: la
    // descripción compartida tiene que decirlo.
    const src = fuente('../likida/analytics.ts');
    expect(src).toMatch(/m === 'historico'\s*\?\s*getTopRutasPorGasto\(tenantId, top\)/);
    expect(descripcionDeModo()).toMatch(/top_rutas/);
  });
});
