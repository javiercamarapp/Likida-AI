import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// La palanca del Agente de Peajes, con el módulo `interruptores` REAL: se
// prueba la cadena completa — la fila apagada Y la lectura reventada (que por
// el contrato fail-closed vale lo mismo) detienen la conciliación.
// ═══════════════════════════════════════════════════════════════════════════

let interruptor: { data: { apagado: boolean } | null; error: { message: string } | null };

const logs = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger: logs }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      if (tabla !== 'interruptor') throw new Error(`tabla inesperada: ${tabla}`);
      return { select: () => ({ eq: () => ({ maybeSingle: async () => interruptor }) }) };
    },
  }),
}));

const { avisoAgentePeajesApagado } = await import('./apagado');

beforeEach(async () => {
  // RES-19: `leerInterruptor` cachea 5 s por instancia y este archivo usa el
  // módulo REAL con una respuesta distinta por prueba — sin tirar la caché, la
  // lectura de una contestaría por la siguiente.
  (await import('@/lib/likida/interruptores')).olvidarInterruptores();
  interruptor = { data: null, error: null }; // sin fila = ENCENDIDO
  logs.error.mockClear();
});

describe('el kill switch de agente:peajes (0110)', () => {
  it('sin fila (el default del catálogo): el agente puede trabajar', async () => {
    expect(await avisoAgentePeajesApagado()).toBeNull();
  });

  it('APAGADO: el aviso dice que está apagado y que lo guardado no se pierde', async () => {
    interruptor = { data: { apagado: true }, error: null };
    const aviso = await avisoAgentePeajesApagado();
    expect(aviso).toMatch(/apagado/);
    expect(aviso).toMatch(/no se pierde/);
  });

  it('FAIL-CLOSED: la lectura del interruptor que FALLA también detiene, con grito en el log', async () => {
    interruptor = { data: null, error: { message: 'fetch failed' } };
    expect(await avisoAgentePeajesApagado()).toMatch(/apagado/);
    expect(logs.error).toHaveBeenCalledWith('interruptores.lectura_fallo',
      expect.objectContaining({ interruptor: 'agente:peajes' }));
  });
});
