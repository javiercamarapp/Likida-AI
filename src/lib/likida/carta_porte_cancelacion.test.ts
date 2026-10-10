import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// CANCELACIÓN DEL TIMBRE DE CARTA PORTE (0541). Lo que fija:
//   1. CLAIM-THEN-ACT: la fila pasa a 'solicitada' ANTES de llamar al PAC; el perdedor
//      de la carrera NO llama al PAC.
//   2. 201 = en_proceso y el viaje NO se libera; 202 = confirmada y estado cancelado.
//   3. Un rechazo explícito → 'rechazada' (se puede volver a pedir); 'red' deja
//      'solicitada' y lo dice (pudo llegar).
//   4. Sin humano que verificó, no se confirma; confirmar libera solo desde en_proceso.
//   5. Validación local (motivo/folio), ambiente cruzado y otro tenant.
// El PAC es un doble: aquí no sale una petición de red.
// ═══════════════════════════════════════════════════════════════════════════

type Resp = { data?: unknown; error?: { message: string; code?: string } | null };
type Llamada = { tabla: string; op: string; payload: Record<string, unknown> | null; filtros: string[] };
let respuestas: Record<string, Resp[]>;
let llamadas: Llamada[];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      let payload: Record<string, unknown> | null = null;
      let op = 'select';
      const filtros: string[] = [];
      const b: Record<string, unknown> = {};
      const enc = (n: string) => (...a: unknown[]) => { filtros.push(`${n}:${a.map((x) => JSON.stringify(x)).join(',')}`); return b; };
      Object.assign(b, {
        select: () => b,
        update: (f: Record<string, unknown>) => { op = 'update'; payload = f; return b; },
        eq: enc('eq'), is: enc('is'), in: enc('in'), or: enc('or'),
        maybeSingle: () => b, single: () => b,
        then: (res: (r: Resp) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(() => {
          llamadas.push({ tabla, op, payload, filtros });
          const cola = respuestas[`${tabla}:${op}`] ?? respuestas[tabla];
          if (!cola || cola.length === 0) return { data: null, error: null };
          return cola.length > 1 ? cola.shift()! : cola[0];
        }).then(res, rej),
      });
      return b;
    },
  }),
}));
vi.mock('@/lib/likida/presupuesto', async (o) => ({ ...(await o() as object), acotada: (q: unknown) => q }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, redactarTexto: (s: string) => s }));
const anotarBitacora = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: (...a: unknown[]) => anotarBitacora(...a) }));
let estadoPac = { configurado: true, proveedor: 'sw', pareceSandbox: true as boolean | null };
vi.mock('./pac', () => ({ estadoPac: () => estadoPac, resolverPac: () => null }));

import type { ProveedorPac, ResultadoCancelacion } from './pac/tipos';
const { solicitarCancelacionTimbre, confirmarCancelacionTimbre } = await import('./carta_porte_cancelacion');

const T = 'tenant-1';
const V = 'viaje-1';
const UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
const SUST = 'bbbbbbbb-bbbb-4ccc-8ddd-000000000002';
const ACTOR = { id: 'u-1', email: 'conta@flota.mx' };

function sembrar(timbre: Record<string, unknown> | null, modo: 'sandbox' | 'produccion' = 'sandbox') {
  respuestas['viaje'] = [{ data: { id: V, ingreso_flete: 1, cliente_id: null, cliente: null }, error: null }];
  respuestas['flota_fiscal'] = [{ data: { rfc: 'EKU9003173C9', razon_social: 'K', regimen_fiscal: '601', lugar_expedicion: '42501', serie: 'CCP', modo }, error: null }];
  respuestas['ccp_timbre:select'] = [{ data: timbre, error: null }];
}
const vigente = (extra: Record<string, unknown> = {}) => ({ uuid_fiscal: UUID, fecha_timbrado: '2026-08-27T12:00:00', modo: 'sandbox', proveedor: 'sw', sello_sat: 's', estado: 'vigente', ...extra });

let cancelar: ReturnType<typeof vi.fn<(...a: unknown[]) => Promise<unknown>>>;
const pac = (): ProveedorPac => ({ nombre: 'sw', timbrar: vi.fn(), cancelar: (...a: unknown[]) => { llamadas.push({ tabla: '(PAC)', op: 'cancelar', payload: null, filtros: [] }); return cancelar(...a) as Promise<ResultadoCancelacion>; } });
const updates = () => llamadas.filter((l) => l.tabla === 'ccp_timbre' && l.op === 'update');

beforeEach(() => {
  vi.clearAllMocks();
  respuestas = {}; llamadas = [];
  estadoPac = { configurado: true, proveedor: 'sw', pareceSandbox: true };
  cancelar = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ ok: true, estado: 'en_proceso', codigoSat: '201', acuse: '<a/>', yaEstaba: false }));
});

describe('solicitarCancelacionTimbre', () => {
  it('201: reclama ANTES de llamar al PAC, deja en_proceso y NO cambia estado a cancelado', async () => {
    sembrar(vigente());
    respuestas['ccp_timbre:update'] = [{ data: [{ id: 'k1' }], error: null }];
    const r = await solicitarCancelacionTimbre(T, V, ACTOR, { motivo: '02' }, { pac: pac() });
    expect(r).toMatchObject({ ok: true, estado: 'en_proceso' });
    const orden = llamadas.map((l) => `${l.tabla}:${l.op}`);
    expect(orden.indexOf('ccp_timbre:update')).toBeLessThan(orden.indexOf('(PAC):cancelar'));
    expect(updates()[0].payload).toMatchObject({ cancelacion_estado: 'solicitada', cancelacion_motivo: '02', cancelacion_solicitada_por: 'u-1' });
    expect(updates()[1].payload).toMatchObject({ cancelacion_estado: 'en_proceso', cancelacion_codigo: '201' });
    expect(updates()[1].payload).not.toHaveProperty('estado');
    expect(cancelar).toHaveBeenCalledWith({ rfcEmisor: 'EKU9003173C9', uuid: UUID, motivo: '02' });
    expect(anotarBitacora).toHaveBeenCalledWith(expect.objectContaining({ accion: 'ccp.cancelacion_en_proceso' }), expect.anything());
  });

  it('el perdedor de la carrera (el claim no devuelve fila) NO llama al PAC', async () => {
    sembrar(vigente());
    respuestas['ccp_timbre:update'] = [{ data: [], error: null }];
    const r = await solicitarCancelacionTimbre(T, V, ACTOR, { motivo: '02' }, { pac: pac() });
    expect(r.ok).toBe(false);
    expect(cancelar).not.toHaveBeenCalled();
  });

  it('el claim está acotado por tenant, viaje y estado vigente', async () => {
    sembrar(vigente());
    respuestas['ccp_timbre:update'] = [{ data: [{ id: 'k1' }], error: null }];
    await solicitarCancelacionTimbre(T, V, ACTOR, { motivo: '02' }, { pac: pac() });
    const f = updates()[0].filtros.join('|');
    expect(f).toContain('eq:"tenant_id","tenant-1"');
    expect(f).toContain('eq:"viaje_id","viaje-1"');
    expect(f).toContain('eq:"estado","vigente"');
  });

  it('202 (el SAT ya lo tenía cancelado) confirma sola y libera el viaje', async () => {
    sembrar(vigente());
    respuestas['ccp_timbre:update'] = [{ data: [{ id: 'k1' }], error: null }];
    cancelar.mockResolvedValue({ ok: true, estado: 'cancelado', codigoSat: '202', acuse: '<a/>', yaEstaba: true });
    const r = await solicitarCancelacionTimbre(T, V, ACTOR, { motivo: '03' }, { pac: pac() });
    expect(r).toMatchObject({ ok: true, estado: 'confirmada' });
    expect(updates()[1].payload).toMatchObject({ cancelacion_estado: 'confirmada', estado: 'cancelado' });
  });

  it('rechazo explícito del PAC → rechazada (se puede volver a pedir), con el mensaje tal cual', async () => {
    sembrar(vigente());
    respuestas['ccp_timbre:update'] = [{ data: [{ id: 'k1' }], error: null }];
    cancelar.mockResolvedValue({ ok: false, clase: 'rechazado', codigo: 'CACFDI33', mensaje: 'CACFDI33 - Problemas con el xml. — CA305 - Certificado Inválido.' });
    const r = await solicitarCancelacionTimbre(T, V, ACTOR, { motivo: '02' }, { pac: pac() });
    expect(r).toEqual({ ok: false, motivo: expect.stringContaining('CA305 - Certificado Inválido.') });
    expect(updates()[1].payload).toMatchObject({ cancelacion_estado: 'rechazada', cancelacion_codigo: 'CACFDI33' });
  });

  it("sin respuesta del PAC ('red') deja la fila en solicitada: NO la marca rechazada", async () => {
    sembrar(vigente());
    respuestas['ccp_timbre:update'] = [{ data: [{ id: 'k1' }], error: null }];
    cancelar.mockResolvedValue({ ok: false, clase: 'red', codigo: null, mensaje: 'Sin respuesta del PAC… sigue vigente' });
    const r = await solicitarCancelacionTimbre(T, V, ACTOR, { motivo: '02' }, { pac: pac() });
    expect(r.ok).toBe(false);
    expect(updates()[1].payload).not.toHaveProperty('cancelacion_estado');
    expect(updates()[1].payload).toHaveProperty('cancelacion_error');
  });

  it('un cliente de PAC que LANZA se trata como red, no revienta', async () => {
    sembrar(vigente());
    respuestas['ccp_timbre:update'] = [{ data: [{ id: 'k1' }], error: null }];
    cancelar.mockRejectedValue(new Error('socket'));
    const r = await solicitarCancelacionTimbre(T, V, ACTOR, { motivo: '02' }, { pac: pac() });
    expect(r.ok).toBe(false);
  });

  it('validación local: 01 sin UUID de sustitución, folio con motivo≠01, motivo inválido: no toca la base ni el PAC', async () => {
    sembrar(vigente());
    expect((await solicitarCancelacionTimbre(T, V, ACTOR, { motivo: '01' }, { pac: pac() })).ok).toBe(false);
    expect((await solicitarCancelacionTimbre(T, V, ACTOR, { motivo: '01', folioSustitucion: 'no-uuid' }, { pac: pac() })).ok).toBe(false);
    expect((await solicitarCancelacionTimbre(T, V, ACTOR, { motivo: '02', folioSustitucion: SUST }, { pac: pac() })).ok).toBe(false);
    expect((await solicitarCancelacionTimbre(T, V, ACTOR, { motivo: '09' as never }, { pac: pac() })).ok).toBe(false);
    expect(cancelar).not.toHaveBeenCalled();
    expect(updates()).toHaveLength(0);
  });

  it('motivo 01 con sustituto válido lo manda al PAC', async () => {
    sembrar(vigente());
    respuestas['ccp_timbre:update'] = [{ data: [{ id: 'k1' }], error: null }];
    await solicitarCancelacionTimbre(T, V, ACTOR, { motivo: '01', folioSustitucion: SUST.toUpperCase() }, { pac: pac() });
    expect(cancelar).toHaveBeenCalledWith(expect.objectContaining({ motivo: '01', folioSustitucion: SUST }));
  });

  it('sin timbre vigente, o con la cancelación ya en proceso, no llama al PAC', async () => {
    sembrar(null);
    expect((await solicitarCancelacionTimbre(T, V, ACTOR, { motivo: '02' }, { pac: pac() })).ok).toBe(false);
    sembrar(vigente({ cancelacion_estado: 'en_proceso', cancelacion_motivo: '02' }));
    const r = await solicitarCancelacionTimbre(T, V, ACTOR, { motivo: '02' }, { pac: pac() });
    expect(r).toMatchObject({ ok: false });
    expect(cancelar).not.toHaveBeenCalled();
  });

  it('otro tenant: el viaje no existe para él', async () => {
    respuestas['viaje'] = [{ data: null, error: null }];
    const r = await solicitarCancelacionTimbre('otra-flota', V, ACTOR, { motivo: '02' }, { pac: pac() });
    expect(r).toEqual({ ok: false, motivo: 'Ese viaje no está en tu flota.' });
    expect(cancelar).not.toHaveBeenCalled();
  });

  it('sin PAC configurado no simula nada', async () => {
    sembrar(vigente());
    const r = await solicitarCancelacionTimbre(T, V, ACTOR, { motivo: '02' }, { pac: null });
    expect(r.ok).toBe(false);
  });
});

describe('confirmarCancelacionTimbre', () => {
  it('sin la declaración de haber visto el acuse, no hace nada', async () => {
    const r = await confirmarCancelacionTimbre(T, V, ACTOR, false);
    expect(r.ok).toBe(false);
    expect(updates()).toHaveLength(0);
  });

  it('solo desde en_proceso: la actualización lo exige EN LA BASE y libera el viaje', async () => {
    respuestas['ccp_timbre:update'] = [{ data: [{ id: 'k1' }], error: null }];
    const r = await confirmarCancelacionTimbre(T, V, ACTOR, true);
    expect(r).toMatchObject({ ok: true, estado: 'confirmada' });
    expect(updates()[0].filtros.join('|')).toContain('eq:"cancelacion_estado","en_proceso"');
    expect(updates()[0].payload).toMatchObject({ estado: 'cancelado', cancelacion_confirmada_por: 'u-1' });
    expect(anotarBitacora).toHaveBeenCalledWith(expect.objectContaining({ accion: 'ccp.cancelacion_confirmada' }), expect.anything());
  });

  it('si no había cancelación en proceso (otra pantalla ya la confirmó), lo dice', async () => {
    respuestas['ccp_timbre:update'] = [{ data: [], error: null }];
    expect(await confirmarCancelacionTimbre(T, V, ACTOR, true)).toMatchObject({ ok: false });
  });
});
