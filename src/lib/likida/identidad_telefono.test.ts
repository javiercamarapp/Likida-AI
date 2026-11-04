// F1 lote B, L1H (CT-SEG-07 / X-01): el teléfono es la llave de identidad de WhatsApp. `resolveOperador` y
// `resolverCuentaOficina` miran cada uno su tabla; un número que es operador en la flota A y cuenta de oficina en la
// flota B resolvía en silencio a la flota A. `exigirIdentidadUnica` pregunta a la base (0952) por las TRES tablas y,
// ante ambigüedad entre flotas, FALLA CERRADO. Con la base sin migrar (función ausente) sigue el camino de siempre.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let respuesta: { data: unknown; error: { code?: string; message: string } | null } = { data: [], error: null };
const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => respuesta);
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { exigirIdentidadUnica, identidadDeTelefono } = await import('./identidad_telefono');
const { OperadorAmbiguo } = await import('./conv');
const { logger } = await import('@/lib/logger');

const fila = (p: Record<string, unknown>) => ({ resultado: 'ninguna', tipo: null, tenant_id: null, ref_id: null, filas: 0, flotas: 0, ...p });
beforeEach(() => { rpc.mockClear(); (logger.error as ReturnType<typeof vi.fn>).mockClear(); respuesta = { data: [fila({})], error: null }; });

describe('identidadDeTelefono', () => {
  it('llama al resolutor 0952 con el teléfono tal como llegó y devuelve el veredicto', async () => {
    respuesta = { data: [fila({ resultado: 'unica', tipo: 'operador', tenant_id: 'T-1', ref_id: 'O-1', filas: 1, flotas: 1 })], error: null };
    const r = await identidadDeTelefono('5219991234567');
    expect(rpc).toHaveBeenCalledWith('resolver_identidad_telefono', { p_telefono: '5219991234567' });
    expect(r).toEqual({ resultado: 'unica', tipo: 'operador', tenantId: 'T-1', refId: 'O-1', filas: 1, flotas: 1 });
  });

  it('base SIN migrar (42883 o PGRST202): "sin_migrar", no un error', async () => {
    for (const code of ['42883', 'PGRST202']) {
      respuesta = { data: null, error: { code, message: 'function public.resolver_identidad_telefono does not exist' } };
      expect(await identidadDeTelefono('529991234567')).toMatchObject({ resultado: 'sin_migrar' });
    }
  });

  it('cualquier otro error de la base: "no_consultada" y queda en el log sin el número completo', async () => {
    respuesta = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
    expect(await identidadDeTelefono('529991234567')).toMatchObject({ resultado: 'no_consultada' });
    const volcado = JSON.stringify((logger.error as ReturnType<typeof vi.fn>).mock.calls);
    expect(volcado).toContain('identidad_telefono.no_consultada');
    expect(volcado).not.toContain('529991234567');
  });

  it('una respuesta con forma rara no se interpreta como "ninguna": es no_consultada', async () => {
    respuesta = { data: [{ resultado: 'quien-sabe' }], error: null };
    expect(await identidadDeTelefono('529991234567')).toMatchObject({ resultado: 'no_consultada' });
    respuesta = { data: [], error: null };
    expect(await identidadDeTelefono('529991234567')).toMatchObject({ resultado: 'no_consultada' });
  });
});

describe('exigirIdentidadUnica: un blip no abre la compuerta', () => {
  it('un error transitorio de lectura se reintenta una vez y, si la segunda lectura dice ambigua, falla cerrado', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '57014', message: 'statement timeout' } });
    rpc.mockResolvedValueOnce({ data: [fila({ resultado: 'ambigua', filas: 2, flotas: 2 })], error: null });
    await expect(exigirIdentidadUnica('5219991234567')).rejects.toBeInstanceOf(OperadorAmbiguo);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe('exigirIdentidadUnica', () => {
  it('ambigua entre flotas: lanza OperadorAmbiguo (el mismo camino que ya dice "tu número aparece más de una vez") y registra con el número enmascarado', async () => {
    respuesta = { data: [fila({ resultado: 'ambigua', filas: 2, flotas: 2 })], error: null };
    await expect(exigirIdentidadUnica('5219991234567')).rejects.toBeInstanceOf(OperadorAmbiguo);
    await expect(exigirIdentidadUnica('5219991234567')).rejects.not.toThrow(/5219991234567/);
    const volcado = JSON.stringify((logger.error as ReturnType<typeof vi.fn>).mock.calls);
    expect(volcado).toContain('identidad_telefono.ambigua');
    expect(volcado).not.toContain('5219991234567');
    expect(volcado).toContain('4567');
  });

  it('ninguna, única, misma flota, sin migrar y no consultada NO lanzan (el camino de siempre decide)', async () => {
    for (const resultado of ['ninguna', 'unica', 'misma_flota']) {
      respuesta = { data: [fila({ resultado, filas: 1, flotas: 1 })], error: null };
      await expect(exigirIdentidadUnica('529991234567')).resolves.toMatchObject({ resultado });
    }
    respuesta = { data: null, error: { code: '42883', message: 'no existe' } };
    await expect(exigirIdentidadUnica('529991234567')).resolves.toMatchObject({ resultado: 'sin_migrar' });
    respuesta = { data: null, error: { code: '57014', message: 'timeout' } };
    await expect(exigirIdentidadUnica('529991234567')).resolves.toMatchObject({ resultado: 'no_consultada' });
  });
});
