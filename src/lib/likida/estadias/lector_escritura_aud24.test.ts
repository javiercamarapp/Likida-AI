// ═══════════════════════════════════════════════════════════════════════════
// AUD24 · PRU-9 (MEDIO, REINCIDENTE N6) — `guardarPoliticaDetencion`
// (lector.ts:96-105) tiene 15.29% de líneas ejecutadas: el escritor de la
// política de detención (flota o por cliente) no tiene arnés. La mutación
// M23 (`q = clienteId === null ? q.is('cliente_id', null) : q.eq(...)` →
// siempre `q.eq('cliente_id', clienteId)`) haría que el pacto DE FLOTA
// (`clienteId === null`) intentara `.eq('cliente_id', null)` — que en
// PostgREST no encuentra la fila `IS NULL` — y el update-luego-insert cae en
// bucle de 23505 sin poder guardar el pacto de flota.
//
// Mismo patrón que `facturacion_escritura_cableado.test.ts`: doble que
// captura el método y los argumentos EXACTOS de la cadena.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

const llamadas: Array<[string, unknown[]]> = [];

function builder() {
  const b: Record<string, unknown> = {};
  const registrar = (nombre: string) => (...args: unknown[]) => { llamadas.push([nombre, args]); return b; };
  Object.assign(b, {
    update: registrar('update'),
    eq: registrar('eq'),
    is: registrar('is'),
    insert: registrar('insert'),
    select: (...args: unknown[]) => {
      llamadas.push(['select', args]);
      return Promise.resolve({ data: [{ id: 'pd-1' }], error: null });
    },
  });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => builder() }) }));
vi.mock('../presupuesto', () => ({ acotada: (q: unknown) => q }));

const { guardarPoliticaDetencion } = await import('./lector');

beforeEach(() => { llamadas.length = 0; });

describe('PRU-9 (N6): guardarPoliticaDetencion elige is()/eq() según clienteId, sin invertirlos', () => {
  it('pacto de FLOTA (clienteId=null) filtra con .is("cliente_id", null), NUNCA .eq("cliente_id", …)', async () => {
    await guardarPoliticaDetencion('t-1', null, { horasLibres: 4, tarifaHora: 300 }, 'actor@likida.ai');
    const isCliente = llamadas.filter(([n, a]) => n === 'is' && a[0] === 'cliente_id');
    const eqCliente = llamadas.filter(([n, a]) => n === 'eq' && a[0] === 'cliente_id');
    expect(isCliente).toEqual([['is', ['cliente_id', null]]]);
    expect(eqCliente).toEqual([]);
  });

  it('pacto POR CLIENTE filtra con .eq("cliente_id", id), NUNCA .is(…)', async () => {
    await guardarPoliticaDetencion('t-1', 'cliente-1', { horasLibres: 4, tarifaHora: 300 }, 'actor@likida.ai');
    const isCliente = llamadas.filter(([n, a]) => n === 'is' && a[0] === 'cliente_id');
    const eqCliente = llamadas.filter(([n, a]) => n === 'eq' && a[0] === 'cliente_id');
    expect(eqCliente).toEqual([['eq', ['cliente_id', 'cliente-1']]]);
    expect(isCliente).toEqual([]);
  });
});
