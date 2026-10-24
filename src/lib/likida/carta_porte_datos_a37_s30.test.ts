import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: vi.fn() }));
vi.mock('./repo', () => ({ getPerfilCrudo: vi.fn(async () => ({})) }));
const consultas: Array<{ filtros: string[]; orden: string[] }> = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const c = { filtros: [] as string[], orden: [] as string[] };
      consultas.push(c);
      const b: Record<string, unknown> = {};
      const reg = (k: string) => (...a: unknown[]) => { c.filtros.push(`${k}:${a.map(String).join(',')}`); return b; };
      Object.assign(b, {
        select: () => b, eq: reg('eq'), in: reg('in'), gte: reg('gte'), or: reg('or'),
        order: (col: string, o?: { ascending?: boolean }) => { c.orden.push(`${col}:${o?.ascending === false ? 'desc' : 'asc'}`); return b; },
        limit: reg('limit'),
        then: (res: (x: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(res),
      });
      return b;
    },
  }),
}));

const { filaAViajeCcp, getEstadoCartaPorte } = await import('./carta_porte_datos');

const viaje = (mercancias: unknown[]) => ({
  id: 'v1', folio: 'V-1', origen: 'A', destino: 'B', estatus: 'abierto', fecha_inicio: '2026-10-25', km_recorridos: 10,
  ccp_pisa_federal: false, ccp_radio_federal_km: null, unidad: { config_vehicular: 'C2', numero_economico: '1' },
  operador: null, cliente: null, mercancias,
});

describe('A37-S30-07 — un renglón peligroso vuelve obligatorio el complemento', () => {
  it('sin peligro declarado y traslado local: no necesita', () => {
    const v = filaAViajeCcp(viaje([{ id: 'm1', descripcion: 'Agua', cantidad: 1, material_peligroso: false }]), false);
    expect(v.decision.necesita).not.toBe('si');
  });
  it('con un renglón material_peligroso=true (perfil sin declarar): obligatorio', () => {
    const v = filaAViajeCcp(viaje([{ id: 'm1', descripcion: 'Solvente', cantidad: 1, material_peligroso: true }]), false);
    expect(v.decision.necesita).toBe('si');
  });
});

describe('A37-S30-08 — el semáforo prioriza los viajes próximos a salir', () => {
  it('pide primero hoy-en-adelante ascendente y después los anteriores/sin fecha, ambos con desempate por id', async () => {
    consultas.length = 0;
    await getEstadoCartaPorte('t-1');
    expect(consultas).toHaveLength(2);
    expect(consultas[0].filtros.some((f) => f.startsWith('gte:fecha_inicio,'))).toBe(true);
    expect(consultas[0].orden).toEqual(['fecha_inicio:asc', 'id:asc']);
    expect(consultas[1].filtros.some((f) => f.startsWith('or:fecha_inicio.lt.') && f.includes('fecha_inicio.is.null'))).toBe(true);
    expect(consultas[1].orden).toEqual(['fecha_inicio:desc', 'id:asc']);
  });
});
