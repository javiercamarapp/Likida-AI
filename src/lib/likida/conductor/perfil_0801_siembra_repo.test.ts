import { beforeEach, describe, expect, it, vi } from 'vitest';

// T-A5-08: `asegurarHitos` (el camino del chofer que escribe antes de que corra la siembra) crea los hitos según el perfil.
const estado: { filas: Array<Record<string, unknown>>; perfil: { perfil_seguimiento?: string } | null; errorPerfil: boolean } = { filas: [], perfil: null, errorPerfil: false };
const upserts: Array<Array<Record<string, unknown>>> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => ({
      select: () => {
        const q = {
          eq: () => q,
          maybeSingle: async () => (estado.errorPerfil ? { data: null, error: { message: 'column perfil_seguimiento does not exist' } } : { data: estado.perfil, error: null }),
          then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: tabla === 'viaje_hito' ? estado.filas : [], error: null }).then(ok),
        };
        return q;
      },
      upsert: (filas: Array<Record<string, unknown>>) => { upserts.push(filas); return Promise.resolve({ error: null }); },
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { asegurarHitos } from './repo';

beforeEach(() => { estado.filas = []; estado.perfil = null; estado.errorPerfil = false; upserts.length = 0; });

describe('asegurarHitos respeta el perfil de la flota', () => {
  it('esenciales: salida_carga nace esperado (sin estado explícito) y los otros cuatro omitidos/fuera_de_perfil', async () => {
    estado.perfil = { perfil_seguimiento: 'esenciales' };
    await asegurarHitos('t1', 'v1');
    expect(upserts).toHaveLength(1);
    const porTipo = Object.fromEntries(upserts[0].map((f) => [f.tipo as string, f]));
    expect(Object.keys(porTipo).sort()).toEqual(['llegada_carga', 'llegada_descarga', 'regreso', 'salida_carga', 'salida_descarga']);
    expect(porTipo.salida_carga).toEqual({ tenant_id: 't1', viaje_id: 'v1', tipo: 'salida_carga' });
    for (const t of ['llegada_carga', 'llegada_descarga', 'salida_descarga', 'regreso']) {
      expect(porTipo[t]).toMatchObject({ estado: 'omitido', omitido_motivo: 'fuera_de_perfil' });
    }
  });

  it('completo: las filas son exactamente las de siempre (sin estado ni motivo)', async () => {
    estado.perfil = { perfil_seguimiento: 'completo' };
    await asegurarHitos('t1', 'v1');
    for (const f of upserts[0]) expect(f).toEqual({ tenant_id: 't1', viaje_id: 'v1', tipo: f.tipo });
  });

  it('sin fila de configuración, o base sin la 0801 (la columna no existe): se comporta como completo', async () => {
    estado.perfil = null;
    await asegurarHitos('t1', 'v1');
    estado.errorPerfil = true;
    await asegurarHitos('t1', 'v2');
    for (const lote of upserts) for (const f of lote) expect(f).not.toHaveProperty('estado');
  });

  it('con los 5 hitos ya creados no escribe nada ni lee el perfil', async () => {
    estado.filas = ['llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso'].map((tipo) => ({ id: tipo, tipo, estado: 'esperado' }));
    estado.perfil = { perfil_seguimiento: 'esenciales' };
    await asegurarHitos('t1', 'v1');
    expect(upserts).toHaveLength(0);
  });
});
