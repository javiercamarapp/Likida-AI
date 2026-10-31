import { describe, it, expect, vi, beforeEach } from 'vitest';

// A39-ola9 (residuo de A37-S48-03): si la captura de la oficina ya se insertó y retirar la conformidad falló, el reintento recibe
// «unique violation» (ya estaba) y antes NO volvía a retirar la conformidad: quedaba viva sobre datos que la oficina cambió.

let insertError: { code?: string; message: string } | null = null;
let conformidadViva = true;
let fallaRetiro = false;
const retiros: number[] = [];

function builder(tabla: string) {
  let op: 'select' | 'update' | 'insert' = 'select';
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    insert: () => { op = 'insert'; return b; },
    update: () => { op = 'update'; return b; },
    select: () => b,
    eq: () => b, is: () => b, not: () => b,
    maybeSingle: () => b,
    then: (res: (x: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve().then(() => {
      if (tabla === 'jornada_asiento' && op === 'insert') {
        return insertError ? { data: null, error: insertError } : { data: { id: 'as-1' }, error: null };
      }
      if (tabla === 'jornada_dia' && op === 'select') {
        return { data: conformidadViva ? { conforme_operador_en: '2026-10-01T10:00:00Z', conforme_wa_message_id: 'w1' } : { conforme_operador_en: null, conforme_wa_message_id: null }, error: null };
      }
      if (tabla === 'jornada_dia' && op === 'update') {
        retiros.push(1);
        if (fallaRetiro) return { data: null, error: { message: 'caída' } };
        conformidadViva = false;
        return { data: [{ id: 'jd-1' }], error: null };
      }
      return { data: null, error: null };
    }).then(res, rej),
  });
  return b;
}

vi.mock('../presupuesto', () => ({ acotada: <T,>(q: T) => q }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t), rpc: async () => ({ data: null, error: null }) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { asentarMarca } = await import('./repo');

const marca = {
  jornadaId: 'jd-1', tenantId: 't-1', tipo: 'inicio_jornada' as const, momento: new Date('2026-10-01T08:00:00Z'),
  procedencia: 'capturado_contralor' as const, registradoPorEmail: 'o@flota.mx',
};

beforeEach(() => { insertError = null; conformidadViva = true; fallaRetiro = false; retiros.length = 0; });

describe('asentarMarca — la conformidad se retira aunque la captura ya estuviera insertada', () => {
  it('primer intento: inserta y el retiro falla -> fallo; reintento (unique violation) retira la conformidad y NO queda viva', async () => {
    fallaRetiro = true;
    expect(await asentarMarca(marca)).toBe('fallo');
    expect(conformidadViva).toBe(true);

    fallaRetiro = false;
    insertError = { code: '23505', message: 'duplicate key' };
    expect(await asentarMarca(marca)).toBe('ya_estaba');
    expect(conformidadViva).toBe(false);
  });

  it('unique violation y el retiro vuelve a fallar -> fallo (reintentable), no «ya estaba»', async () => {
    insertError = { code: '23505', message: 'duplicate key' };
    fallaRetiro = true;
    expect(await asentarMarca(marca)).toBe('fallo');
  });

  it('una marca que no es de la oficina con unique violation no toca la conformidad', async () => {
    insertError = { code: '23505', message: 'duplicate key' };
    expect(await asentarMarca({ ...marca, procedencia: 'declarado_operador' as const })).toBe('ya_estaba');
    expect(retiros).toHaveLength(0);
    expect(conformidadViva).toBe(true);
  });
});
