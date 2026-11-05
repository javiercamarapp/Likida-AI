import { describe, it, expect, vi, beforeEach } from 'vitest';

// CT-IA-01 (F5, migración 0990): alertas de tope de IA al 80 % y al 100 %, deduplicadas en la BASE (no por instancia).

const rpc = vi.hoisted(() => vi.fn());
const alertar = vi.hoisted(() => vi.fn(async () => true));
const warn = vi.hoisted(() => vi.fn());
const borrados = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const borrarError = vi.hoisted(() => ({ msg: null as string | null }));
const desde = vi.hoisted(() => (tabla: string) => ({
  delete: () => {
    const filtro: Record<string, unknown> = { tabla };
    const q = { eq: (c: string, v: unknown) => { filtro[c] = v; if (Object.keys(filtro).length === 4) { borrados.push(filtro); return Promise.resolve({ data: null, error: borrarError.msg ? { message: borrarError.msg } : null }); } return q; } };
    return q;
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc, from: desde }) }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn, error: vi.fn() } }));
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: alertar }));
vi.mock('@/lib/formato', () => ({ hoyMx: () => '2026-11-04' }));

import { nivelesCruzados, registrarAlertaTope, avisarTopePersistido, revisarTopesIa } from './alerta_tope';

const A = '99000000-0000-4000-8000-0000000000a1';
const B = '99000000-0000-4000-8000-0000000000b1';

beforeEach(() => { rpc.mockReset(); alertar.mockClear(); warn.mockClear(); borrados.length = 0; borrarError.msg = null; });

describe('nivelesCruzados (pura)', () => {
  it('bajo el 80 % no hay nada; 80 % exacto da [80]; 100 % exacto da [80, 100]', () => {
    expect(nivelesCruzados(3.99, 5)).toEqual([]);
    expect(nivelesCruzados(4, 5)).toEqual([80]);
    expect(nivelesCruzados(4.99, 5)).toEqual([80]);
    expect(nivelesCruzados(5, 5)).toEqual([80, 100]);
    expect(nivelesCruzados(7.5, 5)).toEqual([80, 100]);
  });
  it('entradas inválidas (tope 0, negativo, NaN, uso negativo) no avisan nada', () => {
    expect(nivelesCruzados(1, 0)).toEqual([]);
    expect(nivelesCruzados(1, -5)).toEqual([]);
    expect(nivelesCruzados(Number.NaN, 5)).toEqual([]);
    expect(nivelesCruzados(5, Number.NaN)).toEqual([]);
    expect(nivelesCruzados(-1, 5)).toEqual([]);
  });
});

describe('registrarAlertaTope / avisarTopePersistido', () => {
  it('la primera instancia avisa (la base dice true); la segunda calla (false)', async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
    expect(await avisarTopePersistido({ tenantId: A, nivel: 80, usoUsd: 4.2, topeUsd: 5, origen: 'piso' })).toBe(true);
    expect(await avisarTopePersistido({ tenantId: A, nivel: 80, usoUsd: 4.3, topeUsd: 5, origen: 'piso' })).toBe(false);
    expect(alertar).toHaveBeenCalledTimes(1);
    expect(alertar).toHaveBeenCalledWith('presupuesto_ia.tope_80', expect.objectContaining({ tenantId: A, nivel: '80 %', topeUsd: 5, origenTope: 'piso' }));
    expect(rpc).toHaveBeenCalledWith('registrar_alerta_tope_llm', expect.objectContaining({ p_tenant_id: A, p_dia: '2026-11-04', p_nivel: 80 }));
  });

  it('el nivel 100 usa el evento histórico presupuesto_ia.tope_tenant', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await avisarTopePersistido({ tenantId: A, nivel: 100, usoUsd: 5, topeUsd: 5, origen: 'plan', proposito: 'interactivo', pedidoUsd: 0.05 });
    expect(alertar).toHaveBeenCalledWith('presupuesto_ia.tope_tenant', expect.objectContaining({ proposito: 'interactivo', pedidoUsd: 0.05, origenTope: 'plan' }));
  });

  it('si la base falla o responde fuera de contrato, SE AVISA (mejor repetido que callado) y se deja en el log', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'timeout' } });
    expect(await avisarTopePersistido({ tenantId: A, nivel: 80, usoUsd: 4, topeUsd: 5, origen: 'piso' })).toBe(true);
    expect(alertar).toHaveBeenCalledWith('presupuesto_ia.tope_80', expect.objectContaining({ dedupBase: expect.stringContaining('no verificada') }));
    expect(warn).toHaveBeenCalledWith('presupuesto_llm.alerta_tope_no_registrada', expect.objectContaining({ err: 'timeout' }));

    rpc.mockResolvedValueOnce({ data: 'ok', error: null });
    expect(await registrarAlertaTope(A, '2026-11-04', 80, 4, 5, 'piso')).toBeNull();

    rpc.mockRejectedValueOnce(new Error('red caída'));
    expect(await registrarAlertaTope(A, '2026-11-04', 80, 4, 5, 'piso')).toBeNull();
  });

  it('un aviso que revienta NO lanza (no puede tapar el error de presupuesto) y libera la marca para reintentar', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    alertar.mockRejectedValueOnce(new Error('correo caído'));
    await expect(avisarTopePersistido({ tenantId: A, nivel: 100, usoUsd: 5, topeUsd: 5, origen: 'piso' })).resolves.toBe(false);
    expect(borrados).toEqual([{ tabla: 'llm_alerta_tope', tenant_id: A, dia: '2026-11-04', nivel: 100 }]);
  });

  it('si el aviso NO salió (alertarOperador false: sin ALERTA_EMAIL o correo caído) devuelve false y libera la marca; el siguiente intento avisa', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    alertar.mockResolvedValueOnce(false);
    expect(await avisarTopePersistido({ tenantId: A, nivel: 80, usoUsd: 4.2, topeUsd: 5, origen: 'piso' })).toBe(false);
    expect(borrados).toEqual([{ tabla: 'llm_alerta_tope', tenant_id: A, dia: '2026-11-04', nivel: 80 }]);
    expect(await avisarTopePersistido({ tenantId: A, nivel: 80, usoUsd: 4.3, topeUsd: 5, origen: 'piso' })).toBe(true);
    expect(alertar).toHaveBeenCalledTimes(2);
    expect(borrados).toHaveLength(1);
  });

  it('un aviso que salió NO libera la marca', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await avisarTopePersistido({ tenantId: A, nivel: 80, usoUsd: 4.2, topeUsd: 5, origen: 'piso' });
    expect(borrados).toEqual([]);
  });

  it('con la base muda (null) y aviso fallido no hay marca propia que soltar', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'timeout' } });
    alertar.mockResolvedValueOnce(false);
    expect(await avisarTopePersistido({ tenantId: A, nivel: 80, usoUsd: 4, topeUsd: 5, origen: 'piso' })).toBe(false);
    expect(borrados).toEqual([]);
  });

  it('si liberar la marca falla, no lanza y lo deja en el log', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    alertar.mockResolvedValueOnce(false);
    borrarError.msg = 'sin permiso';
    await expect(avisarTopePersistido({ tenantId: A, nivel: 100, usoUsd: 5, topeUsd: 5, origen: 'piso' })).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith('presupuesto_llm.alerta_tope_no_liberada', expect.objectContaining({ err: 'sin permiso' }));
  });
});

describe('revisarTopesIa (el barrido)', () => {
  const topes: Record<string, { topeUsd: number; origen: 'piso' | 'tenant' }> = { [A]: { topeUsd: 5, origen: 'piso' }, [B]: { topeUsd: 100, origen: 'tenant' } };
  const topeDe = async (id: string) => topes[id];

  it('avisa 80 y 100 donde corresponde, y nada en la flota que va holgada', async () => {
    rpc.mockImplementation(async (nombre: string, args: Record<string, unknown>) => {
      if (nombre === 'uso_llm_dia_por_flota') return { data: [{ tenant_id: A, usado_usd: '5.2' }, { tenant_id: B, usado_usd: '10' }], error: null };
      expect(nombre).toBe('registrar_alerta_tope_llm');
      expect(args.p_tenant_id).toBe(A);
      return { data: true, error: null };
    });
    const r = await revisarTopesIa(topeDe);
    expect(r.flotas).toBe(2);
    expect(r.avisos).toEqual([{ tenantId: A, nivel: 80 }, { tenantId: A, nivel: 100 }]);
    expect(alertar).toHaveBeenCalledTimes(2);
  });

  it('dos barridos seguidos (dos instancias): el segundo no vuelve a avisar porque la base ya lo tiene', async () => {
    const yaAvisado = new Set<string>();
    rpc.mockImplementation(async (nombre: string, args: Record<string, unknown>) => {
      if (nombre === 'uso_llm_dia_por_flota') return { data: [{ tenant_id: A, usado_usd: 4.5 }], error: null };
      const k = `${args.p_tenant_id}|${args.p_dia}|${args.p_nivel}`;
      if (yaAvisado.has(k)) return { data: false, error: null };
      yaAvisado.add(k);
      return { data: true, error: null };
    });
    const [r1, r2] = await Promise.all([revisarTopesIa(topeDe), revisarTopesIa(topeDe)]);
    expect(r1.avisos.length + r2.avisos.length).toBe(1);
    expect(alertar).toHaveBeenCalledTimes(1);
  });

  it('si la lectura del uso falla, devuelve el error sin lanzar ni avisar', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'sin migración 0990' } });
    const r = await revisarTopesIa(topeDe);
    expect(r.error).toBe('sin migración 0990');
    expect(alertar).not.toHaveBeenCalled();
  });
});
