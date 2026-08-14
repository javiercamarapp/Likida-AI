import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 3, REND-C2 (CRÍTICO): a 750 camiones los envíos seriales no
// caben en maxDuration y el proceso moría a la mitad — con claims ya
// insertados y tiers consumidos sin que ningún chofer recibiera nada.
// Contrato que estas pruebas fijan: el reloj corta ANTES del claim (lo no
// intentado queda intacto y SE DICE en cortadosPorReloj), y con reloj
// holgado todo sale normal.
// ═══════════════════════════════════════════════════════════════════════════

const VIAJES = [
  { id: 'v1', folio: 'V-1', fecha_inicio: '2026-07-20', avisado_en: '2026-07-20T15:00:00Z', recordatorio_comprobacion_en: null, operador: { nombre: 'Juan', telefono: '5215511111111' } },
  { id: 'v2', folio: 'V-2', fecha_inicio: '2026-07-22', avisado_en: '2026-07-22T15:00:00Z', recordatorio_comprobacion_en: null, operador: { nombre: 'María', telefono: '5215522222222' } },
];

const claims: unknown[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const b: Record<string, unknown> = {};
      const chain = () => b;
      Object.assign(b, {
        select: chain, eq: chain, in: chain, not: chain, limit: chain, order: chain,
        delete: chain, update: chain, is: chain, lt: chain,
        insert: (fila: unknown) => { claims.push(fila); return b; },
        maybeSingle: async () => ({ data: null, error: null }),
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: tabla === 'viaje' ? VIAJES : [], error: null }).then(res),
      });
      return b;
    },
  }),
}));
const sendText = vi.fn(async (..._a: unknown[]) => 'wamid.OK');
vi.mock('@/lib/meta/client', () => ({ sendText: (...a: unknown[]) => sendText(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { ejecutarCobranza } = await import('./cobranza');
const AHORA = new Date('2026-08-14T17:00:00Z');

describe('ejecutarCobranza — el reloj corta ANTES del claim (REND-C2)', () => {
  beforeEach(() => { claims.length = 0; sendText.mockClear(); });

  it('reloj vencido: cero claims, cero envíos, y lo no intentado SE DICE', async () => {
    const r = await ejecutarCobranza('t1', AHORA, { ignorarVentana: true, venceEn: Date.now() - 1 });
    expect(r.cortadosPorReloj).toBe(2);
    expect(r.contactados).toBe(0);
    expect(sendText).not.toHaveBeenCalled();
    expect(claims).toHaveLength(0); // los tiers NO se consumieron
  });

  it('reloj holgado: los dos salen y cortadosPorReloj es 0', async () => {
    const r = await ejecutarCobranza('t1', AHORA, { ignorarVentana: true, venceEn: Date.now() + 60_000 });
    expect(r.contactados).toBe(2);
    expect(r.cortadosPorReloj).toBe(0);
    expect(sendText).toHaveBeenCalledTimes(2);
    expect(claims).toHaveLength(2);
  });

  it('sin venceEn (el botón Ejecutar ahora) se porta como siempre', async () => {
    const r = await ejecutarCobranza('t1', AHORA, { ignorarVentana: true });
    expect(r.contactados).toBe(2);
    expect(r.cortadosPorReloj).toBe(0);
  });
});
