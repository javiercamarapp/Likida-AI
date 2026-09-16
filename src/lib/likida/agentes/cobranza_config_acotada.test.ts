import { describe, it, expect, vi, afterEach } from 'vitest';
import { TECHO_PASO_CONSULTA_MS } from '../presupuesto';

// ═══════════════════════════════════════════════════════════════════════════
// REN-31-C1, PARTE RESTANTE (auditoría 31, continuación) — LA OCTAVA CONSULTA.
//
// `leerConfigCobranza` no es solo del agente de cobranza: el cron de
// emergencias la llama DENTRO de su unidad atómica. `escalarUna`
// (`asistencia_escalamiento.ts:278`) la consulta en el camino ámbar ANTES del
// claim, para saber si la incidencia cae dentro de la ventana de la flota.
//
// Era la única consulta de esa cadena sin techo. Sin `acotada()`, una consulta
// que no contesta hereda el default de undici —300 s— dentro de una ruta cuyo
// `maxDuration` es 120: la función muere por el hachazo de Vercel, y el margen
// de reloj que decide cuánto trabajo admitir está calculado sobre un supuesto
// que no se cumple. Es el mismo modo de falla que REN-A4/REN-A5 de la 28.
//
// La prueba mide la PROPIEDAD, no el texto del fuente: una consulta que nunca
// contesta tiene que rendirse en el techo. Sin `acotada()` se queda colgada
// para siempre y esta prueba se pone roja.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../repo', () => ({ getPerfilCrudo: async () => null }));
vi.mock('../perfil/preguntas', () => ({ ventanaCobranzaDeclarada: () => null }));

/** Un constructor de PostgREST cuya consulta NUNCA contesta. */
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    const b: Record<string, unknown> = {};
    const chain = () => b;
    Object.assign(b, {
      from: chain, select: chain, eq: chain,
      // El thenable que `acotada` recibe: no resuelve jamás.
      maybeSingle: () => ({ then: () => {} }),
    });
    return b;
  },
}));

import { leerConfigCobranza } from './cobranza';

afterEach(() => { vi.useRealTimers(); });

describe('leerConfigCobranza — el techo de la octava consulta del cron de emergencias', () => {
  it('una consulta que no contesta se rinde en el techo, no se cuelga los 300 s de undici', async () => {
    vi.useFakeTimers();

    const carrera = Promise.race([
      leerConfigCobranza('tenant-1').then(() => 'resolvió', (e: unknown) => `lanzó: ${(e as Error).message}`),
      new Promise((r) => setTimeout(() => r('SIGUE COLGADA'), TECHO_PASO_CONSULTA_MS + 1)),
    ]);
    // Un milisegundo más que el techo: con `acotada()` gana el tope; sin él,
    // gana el centinela y la consulta seguiría esperando hasta los 300 s.
    await vi.advanceTimersByTimeAsync(TECHO_PASO_CONSULTA_MS + 2);

    expect(
      await carrera,
      'sin techo, esta consulta se come entera la ventana de 120 s del cron de emergencias',
    ).toContain('tope de consulta');
  });
});
