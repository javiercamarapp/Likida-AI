import { describe, expect, it, vi } from 'vitest';

// A39-S53-02: `reporteReclamacion` mandaba `linea_id = String(indice)` («3») al RPC `peaje_posiciones_ventana`, cuyo
// `jsonb_to_recordset` declara `linea_id uuid` (0376/0603): «3»::uuid lanza 22P02 justo cuando hay candidatas GPS.
const LINEA_ID = '5d0c8f1e-3a7b-4c2d-9e61-0a1b2c3d4e5f';
const DESGLOSE = '11111111-1111-4111-8111-111111111111';
const rpcs: Array<{ fn: string; args: { p_ventanas?: Array<{ linea_id: string }> } }> = [];

const LINEA = {
  id: LINEA_ID, indice: 3, fecha: '2026-10-01', hora: '10:00:00', cruce_en: '2026-10-01T16:00:00.000Z', caseta: 'X', monto: 100,
  tag: 'T1', estatus: 'sin_contraparte', diferencia: null, detalle: null, viaje_id: null,
  unidad_id: '22222222-2222-4222-8222-222222222222', caseta_id: null, gps_veredicto: 'no_coincide', gps_distancia_m: 900, gps_detalle: null,
};
const DESG = { id: DESGLOSE, proveedor: 'P', periodo_desde: '2026-10-01', periodo_hasta: '2026-10-31' };

function cadena(tabla: string, fn?: string, args?: unknown): unknown {
  let unico = false;
  const p: unknown = new Proxy(function () { /* encadenable */ }, {
    get: (_t, k) => {
      if (k === 'then') {
        return (ok: (v: unknown) => unknown) => {
          if (fn) { rpcs.push({ fn, args: args as never }); return Promise.resolve({ data: [], error: null, count: 0 }).then(ok); }
          const filas = tabla === 'desglose_peaje' ? [DESG] : tabla === 'desglose_peaje_linea' ? [LINEA] : [];
          return Promise.resolve({ data: unico ? (filas[0] ?? null) : filas, error: null, count: filas.length }).then(ok);
        };
      }
      if (k === 'maybeSingle' || k === 'single') return () => { unico = true; return p; };
      return () => p;
    },
    apply: () => p,
  });
  return p;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => cadena(t), rpc: (fn: string, args: unknown) => cadena('rpc', fn, args) }) }));

const { reporteReclamacion } = await import('./repo');

describe('reporteReclamacion', () => {
  it('A39-S53-02: la ventana de posiciones lleva el uuid real de la línea, no su índice', async () => {
    rpcs.length = 0;
    await reporteReclamacion('33333333-3333-4333-8333-333333333333', DESGLOSE);
    const vent = rpcs.filter((r) => r.fn === 'peaje_posiciones_ventana').flatMap((r) => r.args.p_ventanas ?? []);
    expect(vent.length).toBeGreaterThan(0);
    for (const v of vent) expect(v.linea_id).toBe(LINEA_ID);
  });
});
