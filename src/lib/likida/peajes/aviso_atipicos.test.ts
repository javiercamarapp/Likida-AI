import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.ejemplo.test' }));

const A = await import('./aviso_atipicos');
const D = await import('./datos');

const T = 'tenant-1';
const OTRO = 'tenant-2';
const DES = '00000000-0000-4000-8000-0000000000aa';
const TEL = '5215500000000';

type Resultado = { ok: boolean; motivo?: string; codigo?: number };
const avisarOk = vi.fn(async (..._a: unknown[]): Promise<Resultado> => ({ ok: true }));
const deps = () => ({ almacen: A.almacenAvisoAtipicos, avisar: avisarOk as unknown as typeof import('@/lib/meta/aviso_oficina').avisarOficina });

const hallazgo = (id: string, regla: string, unidad: string, extra: Record<string, unknown> = {}) => ({
  id, tenant_id: T, desglose_id: DES, estado: 'nuevo', avisado_en: null, regla, unidad_archivo: unidad, detalle: {}, creado_en: id, ...extra,
});
const config = (aviso?: Record<string, unknown>) => ({ tenant_id: T, activo: true, umbrales: aviso ? { aviso } : {} });

function base(over: Record<string, unknown[]> = {}) {
  db = crearDbFalsa({
    desglose_peaje: [{ id: DES, tenant_id: T, anulado_en: null }],
    peaje_atipico: [hallazgo('h1', 'repeticion_caseta', 'TC9001'), hallazgo('h2', 'repeticion_caseta', 'TC9002'), hallazgo('h3', 'secuencia_imposible', 'TC9001')],
    peaje_atipico_config: [config({ telefono: TEL })],
    ...over,
  } as never);
}
beforeEach(() => { avisarOk.mockReset(); avisarOk.mockResolvedValue({ ok: true }); base(); });

describe('textoAvisoAtipicos (puro)', () => {
  it('singular: un caso en una unidad', () => {
    const t = A.textoAvisoAtipicos([{ regla: 'repeticion_caseta', unidad: 'TC9001' }])!;
    expect(t).toContain('1 caso inusual en 1 unidad (TC9001)');
    expect(t).toContain('1 caso con muchas pasadas por la misma caseta');
    expect(t).toContain('https://app.ejemplo.test/dashboard/agentes/peajes');
  });
  it('plural: varios casos en varias unidades, agrupados por regla', () => {
    const t = A.textoAvisoAtipicos([
      { regla: 'repeticion_caseta', unidad: 'TC9002' }, { regla: 'repeticion_caseta', unidad: 'TC9001' }, { regla: 'secuencia_imposible', unidad: 'TC9001' },
    ])!;
    expect(t).toContain('3 casos inusuales en 2 unidades (TC9001, TC9002)');
    expect(t).toContain('2 casos con muchas pasadas por la misma caseta; 1 caso con cruces seguidos que el tiempo no permite');
  });
  it('0 casos = null (no avisa)', () => { expect(A.textoAvisoAtipicos([])).toBeNull(); });
  it('con muchas unidades recorta la lista', () => {
    const hs = Array.from({ length: 8 }, (_, i) => ({ regla: 'repeticion_caseta' as const, unidad: `TC90${i}` }));
    expect(A.textoAvisoAtipicos(hs)).toContain('y 3 más');
  });
  it('no lleva montos ni acusa', () => {
    const t = A.textoAvisoAtipicos([{ regla: 'repeticion_caseta', unidad: 'TC9001' }])!;
    expect(t).not.toMatch(/[$]|MXN|fraude|robo|culpa/i);
    expect(t).toContain('no afirma que algo sea indebido');
  });
});

describe('avisarAtipicosDesglose', () => {
  it('manda UN resumen por desglose (no uno por hallazgo) y los marca avisados', async () => {
    expect(await A.avisarAtipicosDesglose(T, DES, deps())).toBe('enviado');
    expect(avisarOk).toHaveBeenCalledTimes(1);
    const [tel, texto, op] = avisarOk.mock.calls[0] as [string, string, { parametros: string[]; contexto: Record<string, unknown> }];
    expect(tel).toBe(TEL);
    expect(texto).toContain('3 casos inusuales en 2 unidades');
    expect(op.parametros).toHaveLength(3);
    expect(op.contexto).toMatchObject({ tenantId: T, agente: 'peajes', desglose: DES });
    expect(db.tablas.peaje_atipico!.every((f) => f.estado === 'avisado' && f.avisado_en)).toBe(true);
  });

  it('segunda corrida: ya no hay nada nuevo, no manda otro', async () => {
    await A.avisarAtipicosDesglose(T, DES, deps());
    expect(await A.avisarAtipicosDesglose(T, DES, deps())).toBe('no_requerido');
    expect(avisarOk).toHaveBeenCalledTimes(1);
  });

  it('dos procesos simultáneos mandan 1 aviso', async () => {
    const r = await Promise.all([A.avisarAtipicosDesglose(T, DES, deps()), A.avisarAtipicosDesglose(T, DES, deps())]);
    expect(avisarOk).toHaveBeenCalledTimes(1);
    expect([...r].sort()).toEqual(['enviado', 'ocupado']);
  });

  it('sin hallazgos nuevos no avisa (0 casos)', async () => {
    base({ peaje_atipico: [] });
    expect(await A.avisarAtipicosDesglose(T, DES, deps())).toBe('no_requerido');
    expect(avisarOk).not.toHaveBeenCalled();
  });

  it('sin destinatario: no envía, lo registra en el detalle y los deja pendientes', async () => {
    base({ peaje_atipico_config: [config()] });
    expect(await A.avisarAtipicosDesglose(T, DES, deps())).toBe('sin_destinatario');
    expect(avisarOk).not.toHaveBeenCalled();
    for (const f of db.tablas.peaje_atipico!) {
      expect(f.estado).toBe('nuevo');
      expect(f.avisado_en).toBeNull();
      expect((f.detalle as { aviso: { estado: string } }).aviso.estado).toBe('sin_destinatario');
    }
  });

  it('sin fila de configuración tampoco envía', async () => {
    base({ peaje_atipico_config: [] });
    expect(await A.avisarAtipicosDesglose(T, DES, deps())).toBe('sin_destinatario');
    expect(avisarOk).not.toHaveBeenCalled();
  });

  it('al configurar el destinatario, el siguiente intento sí avisa', async () => {
    base({ peaje_atipico_config: [config()] });
    await A.avisarAtipicosDesglose(T, DES, deps());
    expect((await A.guardarDestinatarioAtipicos(T, '+52 55 0000 0000')).ok).toBe(true); // grep-limpio:ok
    expect(await A.avisarAtipicosDesglose(T, DES, deps())).toBe('enviado');
    expect(avisarOk).toHaveBeenCalledTimes(1);
    expect((avisarOk.mock.calls[0] as unknown[])[0]).toBe('525500000000'); // grep-limpio:ok
  });

  it('desglose anulado jamás avisa', async () => {
    base({ desglose_peaje: [{ id: DES, tenant_id: T, anulado_en: '2026-09-01T00:00:00Z' }] });
    expect(await A.avisarAtipicosDesglose(T, DES, deps())).toBe('anulado');
    expect(avisarOk).not.toHaveBeenCalled();
    expect(db.tablas.peaje_atipico!.every((f) => f.estado === 'nuevo')).toBe(true);
  });

  it('desglose de otra flota o inexistente: no_existe', async () => {
    expect(await A.avisarAtipicosDesglose(OTRO, DES, deps())).toBe('no_existe');
    expect(avisarOk).not.toHaveBeenCalled();
  });

  it('un fallo de envío devuelve la reserva y cuenta un intento; reintenta hasta el máximo', async () => {
    avisarOk.mockResolvedValue({ ok: false, motivo: 'plantilla sin aprobar', codigo: 132001 });
    for (let i = 1; i <= A.MAX_INTENTOS_AVISO_ATIPICOS; i++) {
      expect(await A.avisarAtipicosDesglose(T, DES, deps())).toBe('rechazado');
      expect(avisarOk).toHaveBeenCalledTimes(i);
      const f = db.tablas.peaje_atipico![0]!;
      expect(f.estado).toBe('nuevo');
      expect(f.avisado_en).toBeNull();
      expect((f.detalle as { aviso: { intentos: number } }).aviso.intentos).toBe(i);
    }
    expect(await A.avisarAtipicosDesglose(T, DES, deps())).toBe('agotado');
    expect(avisarOk).toHaveBeenCalledTimes(A.MAX_INTENTOS_AVISO_ATIPICOS);
  });

  it('tras un fallo, si el envío luego funciona avisa una sola vez', async () => {
    avisarOk.mockResolvedValueOnce({ ok: false, motivo: 'caída' });
    expect(await A.avisarAtipicosDesglose(T, DES, deps())).toBe('rechazado');
    expect(await A.avisarAtipicosDesglose(T, DES, deps())).toBe('enviado');
    expect(await A.avisarAtipicosDesglose(T, DES, deps())).toBe('no_requerido');
    expect(avisarOk).toHaveBeenCalledTimes(2);
  });

  it('nunca lanza: una base caída da rechazado', async () => {
    db.fallar('desglose_peaje.select', 'base caída');
    expect(await A.avisarAtipicosDesglose(T, DES, deps())).toBe('rechazado');
  });

  it('un hallazgo ya revisado o ya avisado no entra al resumen', async () => {
    base({ peaje_atipico: [hallazgo('h1', 'repeticion_caseta', 'TC9001'), hallazgo('h2', 'repeticion_caseta', 'TC9002', { estado: 'revisado', avisado_en: '2026-09-01T00:00:00Z' })] });
    await A.avisarAtipicosDesglose(T, DES, deps());
    expect((avisarOk.mock.calls[0] as unknown[])[1] as string).toContain('1 caso inusual en 1 unidad (TC9001)');
  });
});

describe('reintentarAvisosAtipicos (barrido del cron)', () => {
  it('avisa cada desglose con casos nuevos y cuenta lo enviado', async () => {
    const r = await A.reintentarAvisosAtipicos(5, deps());
    expect(r).toEqual({ revisados: 1, enviados: 1, pendientes: 0 });
  });
  it('sin destinatario no cuenta como pendiente-fallo (es configuración)', async () => {
    base({ peaje_atipico_config: [config()] });
    expect(await A.reintentarAvisosAtipicos(5, deps())).toEqual({ revisados: 1, enviados: 0, pendientes: 0 });
  });
  it('un envío rechazado queda como pendiente', async () => {
    avisarOk.mockResolvedValue({ ok: false, motivo: 'x' });
    expect(await A.reintentarAvisosAtipicos(5, deps())).toEqual({ revisados: 1, enviados: 0, pendientes: 1 });
  });
  it('los hallazgos agotados salen del barrido', async () => {
    base({ peaje_atipico: [hallazgo('h1', 'repeticion_caseta', 'TC9001', { detalle: { aviso: { intentos: A.MAX_INTENTOS_AVISO_ATIPICOS } } })] });
    expect(await A.reintentarAvisosAtipicos(5, deps())).toEqual({ revisados: 0, enviados: 0, pendientes: 0 });
  });
  it('nunca lanza si la lectura falla', async () => {
    db.fallar('peaje_atipico.select', 'base caída');
    expect(await A.reintentarAvisosAtipicos(5, deps())).toEqual({ revisados: 0, enviados: 0, pendientes: 0 });
  });
});

describe('destinatario configurable', () => {
  it('rechaza un teléfono que no lo parece y no toca nada', async () => {
    base({ peaje_atipico_config: [] });
    const r = await A.guardarDestinatarioAtipicos(T, 'hola');
    expect(r).toEqual({ ok: false, motivo: expect.stringContaining('10 y 15') });
    expect(db.tablas.peaje_atipico_config).toHaveLength(0);
  });
  it('borrar (null) lo quita y conserva los umbrales', async () => {
    base({ peaje_atipico_config: [{ tenant_id: T, activo: true, umbrales: { repeticion_caseta: { minCruces: 5 }, aviso: { telefono: TEL } } }] });
    expect((await A.guardarDestinatarioAtipicos(T, null)).ok).toBe(true);
    expect(db.tablas.peaje_atipico_config![0]!.umbrales).toEqual({ repeticion_caseta: { minCruces: 5 } });
  });
  it('guardar los umbrales NO borra el destinatario', async () => {
    expect((await D.guardarConfigAtipicos(T, { activo: true, umbrales: { repeticion_caseta: { minCruces: 6 } } })).ok).toBe(true);
    const u = db.tablas.peaje_atipico_config![0]!.umbrales as { aviso?: { telefono: string } };
    expect(u.aviso?.telefono).toBe(TEL);
    expect((await D.leerConfigAtipicos(T)).umbrales.repeticion_caseta.minCruces).toBe(6);
  });
  it('un teléfono guardado en una flota no sirve a otra', async () => {
    base({ peaje_atipico_config: [config({ telefono: TEL }), { tenant_id: OTRO, activo: true, umbrales: {} }] });
    expect(await A.almacenAvisoAtipicos.destinatario(OTRO)).toBeNull();
    expect(await A.almacenAvisoAtipicos.destinatario(T)).toBe(TEL);
  });
});
