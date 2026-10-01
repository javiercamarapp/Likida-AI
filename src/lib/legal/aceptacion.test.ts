import { beforeEach, describe, expect, it, vi } from 'vitest';

const d = vi.hoisted(() => ({ rpc: vi.fn(), filas: [] as unknown[], errorLectura: null as null | { message: string } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => {
  const cadena: Record<string, unknown> = {
    select: () => cadena, eq: () => cadena, order: () => cadena,
    limit: async () => ({ data: d.filas, error: d.errorLectura }),
  };
  return { rpc: d.rpc, from: () => cadena };
} }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  registrarAceptacion, revocarMandato, mandatoFlotaVigente, aceptacionesDeFlota,
  pendientesDeUsuario, mandatoDe, type AceptacionFila,
} from './aceptacion';
import { MANDATO_AUTOFACTURACION } from './documentos';

beforeEach(() => { vi.clearAllMocks(); d.filas = []; d.errorLectura = null; delete process.env.VERCEL_GIT_COMMIT_SHA; });

describe('registrarAceptacion', () => {
  it('manda la versión VIGENTE y, para el mandato, la huella del texto y el commit desplegado', async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = 'abc1234';
    d.rpc.mockResolvedValue({ data: { ok: true, registrada: true, id: 'x' }, error: null });
    const r = await registrarAceptacion('t-1', 'u-1', 'mandato_autofacturacion');
    expect(r).toEqual({ ok: true, registrada: true });
    expect(d.rpc).toHaveBeenCalledWith('registrar_aceptacion_legal', {
      p_tenant: 't-1', p_user: 'u-1', p_documento: 'mandato_autofacturacion',
      p_version: MANDATO_AUTOFACTURACION.version, p_hash: MANDATO_AUTOFACTURACION.hashSha256, p_commit: 'abc1234',
    });
  });
  it('Términos y Aviso no llevan huella', async () => {
    d.rpc.mockResolvedValue({ data: { ok: true, registrada: false, motivo: 'ya estaba aceptada' }, error: null });
    const r = await registrarAceptacion('t-1', 'u-1', 'terminos');
    expect(r).toEqual({ ok: true, registrada: false });
    expect(d.rpc.mock.calls[0][1]).toMatchObject({ p_documento: 'terminos', p_hash: null, p_commit: null });
  });
  it('un rechazo de la base se propaga con su motivo; un error de red, con mensaje genérico', async () => {
    d.rpc.mockResolvedValue({ data: { ok: false, motivo: 'solo el dueño de la flota (flota_admin) puede otorgar el mandato' }, error: null });
    expect(await registrarAceptacion('t-1', 'u-2', 'mandato_autofacturacion')).toEqual({ ok: false, motivo: 'solo el dueño de la flota (flota_admin) puede otorgar el mandato' });
    d.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const r = await registrarAceptacion('t-1', 'u-1', 'terminos');
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/Intenta de nuevo/);
  });
});

describe('mandatoFlotaVigente — el candado de emisión FALLA CERRADO', () => {
  it('true solo con data === true, y pregunta por la versión vigente', async () => {
    d.rpc.mockResolvedValue({ data: true, error: null });
    expect(await mandatoFlotaVigente('t-1')).toBe(true);
    expect(d.rpc).toHaveBeenCalledWith('mandato_autofacturacion_vigente', { p_tenant: 't-1', p_version: MANDATO_AUTOFACTURACION.version });
  });
  it.each([[false], [null], ['true'], [1], [undefined]])('data=%s no es mandato', async (v) => {
    d.rpc.mockResolvedValue({ data: v, error: null });
    expect(await mandatoFlotaVigente('t-1')).toBe(false);
  });
  it('base caída o excepción: false, no un permiso', async () => {
    d.rpc.mockResolvedValue({ data: true, error: { message: 'caída' } });
    expect(await mandatoFlotaVigente('t-1')).toBe(false);
    d.rpc.mockRejectedValue(new Error('red'));
    expect(await mandatoFlotaVigente('t-1')).toBe(false);
  });
});

describe('revocarMandato', () => {
  it('ok y rechazo', async () => {
    d.rpc.mockResolvedValue({ data: { ok: true, revocadas: 1 }, error: null });
    expect(await revocarMandato('t-1', 'u-1')).toEqual({ ok: true });
    d.rpc.mockResolvedValue({ data: { ok: false, motivo: 'solo el dueño de la flota puede retirar el mandato' }, error: null });
    expect((await revocarMandato('t-1', 'u-2')).ok).toBe(false);
  });
});

describe('lectura y derivados (puros)', () => {
  const fila = (o: Partial<AceptacionFila>): AceptacionFila => ({
    documento: 'terminos', version: '2026-10-01', aceptadoEn: '2026-10-02T00:00:00Z', userId: 'u-1', revocadoEn: null, ...o,
  });
  it('aceptacionesDeFlota traduce filas y LANZA si la lectura falla (no devuelve vacío)', async () => {
    d.filas = [{ documento: 'terminos', version: '2026-10-01', aceptado_en: '2026-10-02T00:00:00Z', user_id: null, revocado_en: null }];
    expect((await aceptacionesDeFlota('t-1'))[0]).toMatchObject({ documento: 'terminos', userId: null });
    d.errorLectura = { message: 'caída' };
    await expect(aceptacionesDeFlota('t-1')).rejects.toThrow();
  });
  it('pendientesDeUsuario: faltan los dos si no hay nada; una versión vieja o revocada no cuenta', () => {
    expect(pendientesDeUsuario([], 'u-1')).toEqual(['terminos', 'aviso_privacidad']);
    const ok = [fila({}), fila({ documento: 'aviso_privacidad' })];
    expect(pendientesDeUsuario(ok, 'u-1')).toEqual([]);
    expect(pendientesDeUsuario(ok, 'u-2')).toEqual(['terminos', 'aviso_privacidad']);
    expect(pendientesDeUsuario([fila({ version: '2020-01-01' }), fila({ documento: 'aviso_privacidad', revocadoEn: 'x' })], 'u-1')).toEqual(['terminos', 'aviso_privacidad']);
  });
  it('mandatoDe: solo la versión vigente y no revocada', () => {
    const m = fila({ documento: 'mandato_autofacturacion', version: MANDATO_AUTOFACTURACION.version });
    expect(mandatoDe([m])).toBe(m);
    expect(mandatoDe([{ ...m, revocadoEn: 'x' }])).toBeNull();
    expect(mandatoDe([{ ...m, version: 'm-2020-01-01' }])).toBeNull();
    expect(mandatoDe([])).toBeNull();
  });
});
