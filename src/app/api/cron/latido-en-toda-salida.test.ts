import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// LATIDO EN TODO CAMINO DE SALIDA — la prueba que cierra la CLASE.
//
// Auditoría adversarial tandas 21-24, hallazgo 4: `portales-vivos` era el
// ÚNICO cron con dos caminos de salida mudos — interruptor ilegible → 500 sin
// `registrarLatido('fallo')`, y global apagado → 200 sin
// `registrarLatido('saltado')`. La ironía documentada: el PR que predicó
// «latido en todo camino de salida» (#206) y ese cron (#202) entraron en
// tandas consecutivas y nadie los cruzó.
//
// El costo del silencio no es cosmético: dos lunes seguidos con el global
// apagado envejecen el latido más de 7 días y /api/health declara MUERTO al
// cron sin poder distinguirlo de «saltado a propósito» — que es exactamente
// la ceguera que el estado `saltado` existe para evitar.
//
// Esta prueba no corre rutas ni mockea nada: LEE el fuente de cada
// `src/app/api/cron/*/route.ts` y exige el patrón. Es un grep con dientes —
// el cron número doce que copie el `if (global === 'apagado')` sin su latido
// se pone en rojo el día de su PR, no dos tandas después.
//
// Las dos reglas, calibradas contra los 11 crons de hoy:
//
//  1. Una ruta que maneja `interruptor_ilegible` tiene que registrar ese
//     fallo en el latido ANTES de contestar 500 — sin él, el tablero dice
//     «No late» sin la causa (patrón de `purgar`, auditoría 18 A17).
//  2. Una ruta que contesta con `saltado:` en el cuerpo (apagado deliberado)
//     tiene que registrar `registrarLatido(..., 'saltado', ...)` — apagado a
//     propósito NO es un cron muerto, y solo el latido lo sabe distinguir.
//
// `runner` no aparece en ninguna de las dos: su interruptor global se decide
// dentro de la vuelta (`apagadoGlobal` en el resultado) y SIEMPRE registra
// latido al final — las reglas aplican a quien tiene el camino, no por lista.
// ═══════════════════════════════════════════════════════════════════════════

const DIR = 'src/app/api/cron';

const rutas = readdirSync(DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => ({ cron: d.name, archivo: join(DIR, d.name, 'route.ts') }));

describe('todo camino de salida de un cron deja latido (hallazgo 4, tandas 21-24)', () => {
  it('hay crons que revisar (si esto falla, se movió el directorio, no se arregló nada)', () => {
    expect(rutas.length).toBeGreaterThanOrEqual(11);
  });

  for (const { cron, archivo } of rutas) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- recorre las rutas de cron del propio repo en tiempo de prueba; la ruta sale de readdirSync sobre una constante, no de ninguna entrada de usuario.
    const fuente = readFileSync(archivo, 'utf8');

    it(`${cron}: interruptor ilegible → registrarLatido('fallo', interruptor_ilegible) antes del 500`, () => {
      if (!fuente.includes("'interruptor_ilegible'")) return; // no tiene el camino
      expect(
        /registrarLatido\([^)]*'fallo',\s*\{[^}]*interruptor_ilegible/.test(fuente),
        `${archivo} contesta 'interruptor_ilegible' sin registrarLatido('…', 'fallo', { codigo: 'interruptor_ilegible' }). ` +
        'Sin ese latido el tablero dice «No late» sin la causa — espejo de purgar/route.ts.',
      ).toBe(true);
    });

    it(`${cron}: salida con saltado: → registrarLatido('saltado')`, () => {
      if (!/saltado:/.test(fuente)) return; // no tiene el camino
      expect(
        /registrarLatido\([^)]*'saltado'/.test(fuente),
        `${archivo} contesta un cuerpo con 'saltado:' sin registrarLatido('…', 'saltado', …). ` +
        'Sin ese latido, un apagado deliberado de más de 7 días se declara cron MUERTO en /api/health.',
      ).toBe(true);
    });
  }
});
