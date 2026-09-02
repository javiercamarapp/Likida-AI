import { describe, it, expect } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, TC-N6 (BAJO, reincidente) — los invariantes del rubro estaban
// enumerados A MANO (`TOOLS_DINERO` en tools_invariantes.test.ts) y podían ir
// tools atrás del registro real sin que nada enrojeciera. Aquí la lista sale
// del REGISTRO (`AGENT_REGISTRY.liquidacion.tools`), que es lo que el agente
// de verdad recibe: una tool nueva entra a estas reglas el día que se registra.
// ═══════════════════════════════════════════════════════════════════════════

await import('./tools');
const { toolSchemas } = await import('@/lib/llm/tool-executor');
const { AGENT_REGISTRY } = await import('@/lib/agents/registry');

const TOOLS = AGENT_REGISTRY.liquidacion.tools;

function funciones() {
  const todas = toolSchemas([...TOOLS]);
  const fns = todas.filter((s) => s.type === 'function');
  expect(fns).toHaveLength(todas.length);
  return fns;
}

describe('tools del agente de liquidación — invariantes sobre el REGISTRO, no sobre una lista a mano', () => {
  it('cada tool del registro está registrada (ninguna se queda sin handler)', () => {
    expect(TOOLS.length).toBeGreaterThanOrEqual(4);
    expect(toolSchemas([...TOOLS]).map((s) => (s.type === 'function' ? s.function.name : '?'))).toEqual([...TOOLS]);
  });

  it('NINGUNA declara parámetros y todas cierran additionalProperties', () => {
    for (const s of funciones()) {
      const p = s.function.parameters as { properties?: Record<string, unknown>; additionalProperties?: boolean } | undefined;
      expect(p?.properties, s.function.name).toEqual({});
      expect(p?.additionalProperties, s.function.name).toBe(false);
    }
  });
});
