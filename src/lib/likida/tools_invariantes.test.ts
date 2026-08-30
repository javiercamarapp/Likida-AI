import { describe, it, expect } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANTE ESTRUCTURAL DE LAS 4 TOOLS DE DINERO (auditoría 21, MEDIO).
//
// `chat-tools.test.ts` tiene, desde antes, la prueba que compara el JSON
// Schema publicado de cada tool contra la regla estructural que sostiene la
// defensa de inyección de prompt ("el modelo decide CUÁNDO, nunca CON QUÉ
// DATOS", docs/auditoria-21/MAPA.md). Ese patrón nunca se retro-aplicó a este
// archivo, que es ANTERIOR a chat-tools.ts y contiene la única tool
// `isMutation` de todo el repo (`guardar_liquidacion`).
//
// Sin esta prueba, un desarrollador —o el propio agente de auto-mejora,
// `scripts/mejora-diaria/`— puede agregarle a `cuadrar_viaje` o a
// `guardar_liquidacion` un parámetro opcional (p.ej. `viaje_id` para "permitir
// corregir el viaje activo si el processor se equivocó de contexto", o
// `motivo_ajuste` que alguien lee de `args` después) y `tsc`/`eslint`/`vitest`
// pasan en verde: nada en el repo comparaba el schema contra
// `{ properties: {} }`.
//
// A diferencia de `chat-tools.ts` (que sí acepta enums cerrados),
// NINGUNA de las 4 tools de dinero toma parámetro alguno — ni siquiera un
// enum — porque tenantId/viajeId/operadorId salen SIEMPRE de `ToolContext`
// (ver "Lo que revisé y está bien" en tools-calling.md). El invariante aquí
// es más estricto: `properties` vacío, sin excepciones.
//
// Solo se importa `./tools` (registra al importarse) — no se ejecuta ningún
// handler, así que no hace falta mockear Supabase/config/etc.: esta prueba
// vive completamente a nivel de SCHEMA.
// ═══════════════════════════════════════════════════════════════════════════

await import('./tools');
const { toolSchemas } = await import('@/lib/llm/tool-executor');

const TOOLS_DINERO = ['consultar_politica', 'estado_viaje', 'cuadrar_viaje', 'guardar_liquidacion'] as const;

/** `ChatCompletionTool` es una unión (`function` | `custom`) — se estrecha
 *  aquí y de paso se AFIRMA que las 4 son del tipo `function`: una tool
 *  `custom` no lleva JSON Schema y las reglas de abajo pasarían de largo. */
function funciones() {
  const todas = toolSchemas([...TOOLS_DINERO]);
  const fns = todas.filter((s) => s.type === 'function');
  expect(fns).toHaveLength(todas.length);
  return fns;
}

describe('tools.ts — las 4 tools de dinero: invariante estructural (auditoría 21, MEDIO)', () => {
  it('las 4 siguen registradas', () => {
    expect(toolSchemas([...TOOLS_DINERO])).toHaveLength(TOOLS_DINERO.length);
  });

  it('NINGUNA declara parámetros: el modelo decide CUÁNDO, nunca CON QUÉ DATOS', () => {
    // tenantId/viajeId/operadorId/cierrePedidoPorTexto/cierreEnCerosConfirmado
    // salen SIEMPRE de ToolContext (inyectado por el processor), nunca de
    // `args` — los 4 handlers reciben `_args` y no lo tocan. Un `properties`
    // que deje de estar vacío es exactamente la puerta de inyección que este
    // archivo defiende.
    for (const s of funciones()) {
      const params = s.function.parameters as { properties?: Record<string, unknown> } | undefined;
      expect(params?.properties, s.function.name).toEqual({});
    }
  });

  it('ninguna acepta propiedades extra: additionalProperties permanece false', () => {
    // Sin `additionalProperties: false` el modelo puede inventar un parámetro
    // que algún handler futuro lea por accidente — la misma razón que
    // chat-tools.test.ts ya prueba para las tools del analista.
    for (const s of funciones()) {
      const p = s.function.parameters as { additionalProperties?: boolean } | undefined;
      expect(p?.additionalProperties, s.function.name).toBe(false);
    }
  });
});
