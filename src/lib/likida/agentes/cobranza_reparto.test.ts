import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA PROD — el reparto del reloj de la cobranza global.
//
//  · ESC-4 / RES-6 (ALTO) — el orden de flotas salía de un Set sobre una
//    consulta por `id`: DETERMINISTA. Con el corte a los 90 s, las mismas
//    flotas iban siempre primero y las del final del alfabeto no se cobraban
//    NUNCA — sin un error, sin un log, sin nada que mirar. Contrato: el orden
//    rota por hora y ninguna flota puede llevarse el reloj entero.
//
//  · RES-1 (CRÍTICO) — si WhatsApp rechaza en masa, el problema no es de una
//    flota: es del número que atiende a todas. La corrida global se detiene.
// ═══════════════════════════════════════════════════════════════════════════

const { avisarCorridasPorFlota, registrarCorrida } = vi.hoisted(() => ({
  avisarCorridasPorFlota: vi.fn(), registrarCorrida: vi.fn(),
}));
vi.mock('./notificaciones', () => ({ avisarCorridasPorFlota }));
vi.mock('./corridas', () => ({ registrarCorrida }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: vi.fn() }));
vi.mock('@/lib/meta/client', () => ({
  sendText: vi.fn(), sendTemplate: vi.fn(), enviarTexto: vi.fn(),
  esReintentableMeta: () => false, motivoDeFalloWhatsApp: (e: string) => e,
}));

const TENANTS = ['t-alfa', 't-beta', 't-gama', 't-delta'];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const b: Record<string, unknown> = {};
      const chain = () => b;
      Object.assign(b, {
        select: chain, in: chain, not: chain, limit: chain, order: chain, is: chain, lt: chain,
        delete: chain, eq: chain, insert: chain, update: chain,
        maybeSingle: async () => ({ data: null, error: null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res),
        range: (d: number, h: number) => Promise.resolve({
          data: (tabla === 'viaje' ? TENANTS.map((t) => ({ tenant_id: t })) : []).slice(d, h + 1),
          error: null,
        }),
      });
      return b;
    },
  }),
}));

const cobranza = await import('./cobranza');
const { rotarPorHora, ejecutarCobranzaGlobal, TOPE_POR_FLOTA_MS } = cobranza;

beforeEach(() => vi.clearAllMocks());

describe('rotarPorHora (ESC-4 / RES-6)', () => {
  it('a las 00:00 arranca por la primera; a las 02:00, por la tercera', () => {
    const l = ['a', 'b', 'c', 'd'];
    expect(rotarPorHora(l, new Date('2026-08-22T00:30:00Z'))).toEqual(['a', 'b', 'c', 'd']);
    expect(rotarPorHora(l, new Date('2026-08-22T02:30:00Z'))).toEqual(['c', 'd', 'a', 'b']);
  });

  it('en un día TODAS encabezan la lista — que es lo que la inanición impedía', () => {
    const l = ['a', 'b', 'c', 'd'];
    const primeras = new Set(
      Array.from({ length: 24 }, (_, h) => rotarPorHora(l, new Date(Date.UTC(2026, 7, 22, h)))[0]),
    );
    expect(primeras).toEqual(new Set(l));
  });

  it('lista vacía y lista de uno no rompen la aritmética del módulo', () => {
    expect(rotarPorHora([], new Date())).toEqual([]);
    expect(rotarPorHora(['solo'], new Date('2026-08-22T07:00:00Z'))).toEqual(['solo']);
  });
});

describe('ejecutarCobranzaGlobal — nadie se queda sin turno', () => {
  it('corre las flotas ROTADAS por hora, no siempre en el mismo orden', async () => {
    const espia = vi.spyOn(cobranza, 'ejecutarCobranza');
    // A las 02:00 UTC la rotación empieza en la tercera de la lista ordenada
    // (t-alfa, t-beta, t-delta, t-gama) → t-delta.
    await ejecutarCobranzaGlobal(new Date('2026-08-22T02:00:00Z'));
    expect(registrarCorrida.mock.calls[0][0]).toBe('t-delta');
    espia.mockRestore();
  });

  it('el presupuesto por flota tiene techo: una flota no se lleva el reloj entero', async () => {
    // El techo es explícito y chico contra los 90 s de la corrida: cuatro
    // flotas caben aunque la primera tuviera trabajo para todo el minuto.
    expect(TOPE_POR_FLOTA_MS).toBeLessThanOrEqual(cobranza.PLAZO_COBRANZA_GLOBAL_MS / 2);
    const r = await ejecutarCobranzaGlobal(new Date('2026-08-22T00:00:00Z'));
    expect(r.tenants).toBe(4);
    expect(registrarCorrida).toHaveBeenCalledTimes(4);
  });

  it('honra el venceEn que le pasa el cron (lo que sobró de la escalación, ESC-3)', async () => {
    const r = await ejecutarCobranzaGlobal(new Date('2026-08-22T00:00:00Z'), { venceEn: Date.now() - 1 });
    // Reloj ya vencido: ni una flota corre, y las cuatro se dicen.
    expect(registrarCorrida).not.toHaveBeenCalled();
    expect(r.contactados).toBe(0);
  });
});
