import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL CANDADO ANTI-CARRERA DE `decidirFacturaProveedor` (auditoría 28, PRU-M6).
//
// El código YA está bien: `.eq('estado', 'pendiente')` es lo que impide que
// la segunda decisión pise `estado`/`decidido_por`/`decidido_en` de la
// primera — cifras que salen tal cual en el export contable (SAP B1/CONTPAQi).
// `proveedores.test.ts` solo cubre los layouts puros y el parseo de XML: esta
// función nunca se llamó desde una prueba. Sin una que la llame y mire la
// consulta armada, un refactor de buena fe puede borrar el `.eq('estado', …)`
// sin que la suite se entere.
// ═══════════════════════════════════════════════════════════════════════════

type Resp = { data: unknown; error: { message: string; code?: string } | null };
const respuestas = new Map<string, Resp>();

interface Llamada {
  tabla: string;
  op: 'update' | 'select';
  fila: Record<string, unknown> | null;
  eq: Array<[string, unknown]>;
}
const llamadas: Llamada[] = [];

function crearBuilder(tabla: string) {
  const l: Llamada = { tabla, op: 'update', fila: null, eq: [] };
  llamadas.push(l);
  const resp = (): Resp => respuestas.get(`${tabla}#update`) ?? { data: [{ id: 'fp-1' }], error: null };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => { if (l.fila === null) l.op = 'select'; return b; },
    maybeSingle: () => Promise.resolve(respuestas.get(`${tabla}#select`) ?? { data: { cfdi_uuid: 'u', emisor_rfc: 'AAA010101AAA', receptor_rfc: 'BBB010101BBB', total: 100, estado: 'pendiente', estado_sat: 'vigente', receptor_es_flota: true }, error: null }),
    update: (fila: Record<string, unknown>) => { l.fila = fila; l.op = 'update'; return b; },
    eq: (c: string, v: unknown) => { l.eq.push([c, v]); return b; },
    then: (res: (x: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve().then(() => resp()).then(res, rej),
  });
  return b;
}

vi.mock('./presupuesto', () => ({ acotada: <T,>(q: T) => q }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => crearBuilder(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const consultar = vi.fn(async (_q: unknown) => ({ estado: 'vigente' as string, efos: null }));
vi.mock('./intake/sat', () => ({ consultarCFDI: (q: unknown) => consultar(q) }));

const { decidirFacturaProveedor } = await import('./proveedores');

const TENANT = 'tenant-1';

beforeEach(() => { llamadas.length = 0; respuestas.clear(); consultar.mockClear(); });

const previa = (o: Record<string, unknown>) => ({ data: { cfdi_uuid: 'u', emisor_rfc: 'AAA010101AAA', receptor_rfc: 'BBB010101BBB', total: 100, estado: 'pendiente', estado_sat: 'vigente', receptor_es_flota: true, ...o }, error: null });

describe('decidirFacturaProveedor — el candado eq(estado, pendiente)', () => {
  it('ancla eq(id), eq(tenant_id) y eq(estado, pendiente) EN LA CONSULTA', async () => {
    const r = await decidirFacturaProveedor(TENANT, 'fp-1', 'aprobada', 'u1');
    expect(r).toEqual({});
    const l = llamadas.filter((x) => x.op === 'update')[0];
    expect(l.tabla).toBe('factura_proveedor');
    expect(l.fila).toMatchObject({ estado: 'aprobada', decidido_por: 'u1' });
    expect(l.eq).toContainEqual(['id', 'fp-1']);
    expect(l.eq).toContainEqual(['tenant_id', TENANT]);
    // EL CANDADO: sin este filtro, la segunda decisión pisa la primera en
    // vez de enterarse de que ya no está pendiente.
    expect(l.eq).toContainEqual(['estado', 'pendiente']);
  });

  it('data: [] — alguien más ya la decidió, y NO se afirma que se guardó', async () => {
    respuestas.set('factura_proveedor#update', { data: [], error: null });
    const r = await decidirFacturaProveedor(TENANT, 'fp-1', 'rechazada', 'u1');
    expect(r).toEqual({ error: 'Esa factura ya no está pendiente — alguien más la decidió. Recarga la página.' });
  });

  it('error de la base: mensaje genérico y logger.error, no el mensaje crudo de Postgres', async () => {
    respuestas.set('factura_proveedor#update', { data: null, error: { message: 'connection reset' } });
    const r = await decidirFacturaProveedor(TENANT, 'fp-1', 'aprobada', 'u1');
    expect(r).toEqual({ error: 'No se pudo guardar la decisión. Inténtalo de nuevo.' });
  });
});

describe('A37-S55-03 — aprobar comprueba CFDI cancelado y receptor ajeno en el servidor', () => {
  const actualizaciones = () => llamadas.filter((x) => x.op === 'update' && x.fila?.estado);

  it('estado_sat cancelado: no se aprueba, ni confirmando', async () => {
    respuestas.set('factura_proveedor#select', previa({ estado_sat: 'cancelado' }));
    const r = await decidirFacturaProveedor(TENANT, 'fp-1', 'aprobada', 'u1', { confirmarAdvertencias: true });
    expect(r.error).toMatch(/CANCELADO/);
    expect(actualizaciones()).toHaveLength(0);
  });

  it('un CFDI que se canceló DESPUÉS de la ingesta se detecta reconsultando al SAT', async () => {
    respuestas.set('factura_proveedor#select', previa({ estado_sat: 'pendiente' }));
    consultar.mockResolvedValueOnce({ estado: 'cancelado', efos: null });
    const r = await decidirFacturaProveedor(TENANT, 'fp-1', 'aprobada', 'u1');
    expect(consultar).toHaveBeenCalledTimes(1);
    expect(r.error).toMatch(/CANCELADO/);
    expect(actualizaciones()).toHaveLength(0);
  });

  it('receptor que no es la flota: pide confirmación; confirmada, aprueba', async () => {
    respuestas.set('factura_proveedor#select', previa({ receptor_es_flota: false }));
    const sin = await decidirFacturaProveedor(TENANT, 'fp-1', 'aprobada', 'u1');
    expect(sin.requiereConfirmacion).toBe(true);
    expect(actualizaciones()).toHaveLength(0);
    const con = await decidirFacturaProveedor(TENANT, 'fp-1', 'aprobada', 'u1', { confirmarAdvertencias: true });
    expect(con).toEqual({});
    expect(actualizaciones()).toHaveLength(1);
  });

  it('no_encontrado exige confirmación; rechazar nunca se condiciona', async () => {
    respuestas.set('factura_proveedor#select', previa({ estado_sat: 'no_encontrado' }));
    expect((await decidirFacturaProveedor(TENANT, 'fp-1', 'aprobada', 'u1')).requiereConfirmacion).toBe(true);
    expect(await decidirFacturaProveedor(TENANT, 'fp-1', 'rechazada', 'u1')).toEqual({});
  });

  it('si no se puede leer la factura, NO aprueba (fail-closed)', async () => {
    respuestas.set('factura_proveedor#select', { data: null, error: { message: 'timeout' } });
    const r = await decidirFacturaProveedor(TENANT, 'fp-1', 'aprobada', 'u1');
    expect(r.error).toMatch(/No se pudo comprobar/);
    expect(actualizaciones()).toHaveLength(0);
  });
});
