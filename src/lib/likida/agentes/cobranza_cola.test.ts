import { describe, it, expect, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 3, BE-C1 (CRÍTICO): el import del TMS crea viajes históricos SIN
// aviso de WhatsApp a propósito, y colaCobranza no filtraba por avisado_en —
// 200 viajes importados con operador amarrado = 200 "Llevas N días..." a los
// choferes del prospecto en la primera corrida del cron en ventana.
//
// Esta prueba alimenta al motor una fila CON forma de import (avisado_en
// null, 40 días, con teléfono) saltándose el filtro de la consulta — así
// ancla el CINTURÓN del bucle además del filtro: si alguien quita cualquiera
// de los dos, el bombardeo regresa y esto se pone rojo.
// ═══════════════════════════════════════════════════════════════════════════

const VIAJES = [
  { id: 'v-avisado', folio: 'V-1', fecha_inicio: '2026-07-20', avisado_en: '2026-07-20T15:00:00Z', recordatorio_comprobacion_en: null, operador: { nombre: 'Juan', telefono: '5215511111111' } },
  // La fila del import: nunca avisada, vieja, CON teléfono — el caso del bombardeo.
  { id: 'v-importado', folio: 'TMS-900', fecha_inicio: '2026-07-01', avisado_en: null, recordatorio_comprobacion_en: null, operador: { nombre: 'Pedro', telefono: '5215522222222' } },
];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const b: Record<string, unknown> = {};
      const chain = () => b;
      Object.assign(b, {
        select: chain, eq: chain, in: chain, not: chain, limit: chain, order: chain,
        maybeSingle: async () => ({ data: null, error: null }), // config → defaults
        then: (res: (v: unknown) => unknown) => {
          if (tabla === 'viaje') return Promise.resolve({ data: VIAJES, error: null }).then(res);
          if (tabla === 'cobranza_contacto') return Promise.resolve({ data: [], error: null }).then(res);
          return Promise.resolve({ data: null, error: null }).then(res);
        },
      });
      return b;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/meta/client', () => ({ sendText: vi.fn() }));

const { colaCobranza } = await import('./cobranza');

describe('colaCobranza — el viaje que Likida nunca avisó NO se cobra (BE-C1)', () => {
  it('la fila con forma de import (avisado_en null) no entra a NINGUNA cubeta', async () => {
    const cola = await colaCobranza('t1', new Date('2026-08-14T17:00:00Z'));
    expect(cola.paraContactar.map((f) => f.folio)).toEqual(['V-1']);
    expect(cola.paraContactar.some((f) => f.folio === 'TMS-900')).toBe(false);
    expect(cola.sinTelefono).toHaveLength(0);
  });
});
