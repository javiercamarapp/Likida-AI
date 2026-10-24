import { beforeEach, describe, expect, it, vi } from 'vitest';

// A36-R01-01: `resolverSolicitudArco` no tenía guardas de estado ni de filas.
// Una segunda respuesta sobrescribía `resolucion`/`resuelta_en` (se perdía la
// fecha real del art. 31) y reenviaba el WhatsApp; un POST directo con el id de
// una cancelación la cerraba con prosa sin borrar nada.

const d = vi.hoisted(() => ({
  enviar: vi.fn(),
  solicitud: null as Record<string, unknown> | null,
  filasTocadas: [{ id: 's-1' }] as unknown[],
  updates: [] as Array<{ valores: unknown; filtros: Array<[string, ...unknown[]]> }>,
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => {
  const actual = { valores: undefined as unknown, filtros: [] as Array<[string, ...unknown[]]>, esUpdate: false };
  const cadena: Record<string, unknown> = {
    select: () => cadena,
    eq: (...a: unknown[]) => { actual.filtros.push(['eq', ...a]); return cadena; },
    in: (...a: unknown[]) => { actual.filtros.push(['in', ...a]); return cadena; },
    is: (...a: unknown[]) => { actual.filtros.push(['is', ...a]); return cadena; },
    update: (v: unknown) => { actual.esUpdate = true; actual.valores = v; d.updates.push(actual); return cadena; },
    maybeSingle: async () => ({ data: d.solicitud, error: null }),
    then: (res: (v: unknown) => unknown) => res({ data: actual.esUpdate ? d.filasTocadas : null, error: null }),
  };
  return { from: () => cadena };
} }));
vi.mock('@/lib/meta/client', async (importar) => ({ ...await importar<typeof import('@/lib/meta/client')>(), enviarRespuestaArco: d.enviar }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { resolverSolicitudArco } from './repo';

beforeEach(() => {
  vi.clearAllMocks();
  d.updates.length = 0;
  d.filasTocadas = [{ id: 's-1' }];
  d.solicitud = { titular_ref: '529999900001', operador_id: null, tipo: 'acceso', estado: 'recibida', resuelta_en: null };
  d.enviar.mockResolvedValue({ ok: true });
});

describe('resolverSolicitudArco — guardas (A36-R01-01)', () => {
  it('camino sano: resuelve, filtra por estado abierto y manda el WhatsApp una vez', async () => {
    const r = await resolverSolicitudArco('t-1', 's-1', 'Entregamos tus datos');
    expect(r.enviada).toBe(true);
    expect(d.updates).toHaveLength(1);
    const f = d.updates[0].filtros;
    expect(f).toContainEqual(['in', 'estado', ['recibida', 'en_proceso']]);
    expect(f).toContainEqual(['is', 'resuelta_en', null]);
    expect(d.enviar).toHaveBeenCalledTimes(1);
  });

  it('una solicitud ya resuelta NO se sobrescribe ni se reenvía el WhatsApp', async () => {
    d.solicitud = { titular_ref: '5299', operador_id: null, tipo: 'acceso', estado: 'resuelta', resuelta_en: '2026-10-01T00:00:00Z' };
    await expect(resolverSolicitudArco('t-1', 's-1', 'otra respuesta')).rejects.toThrow(/ya fue (resuelta|cerrada)|no está abierta/i);
    expect(d.updates).toHaveLength(0);
    expect(d.enviar).not.toHaveBeenCalled();
  });

  it('carrera: si el UPDATE no tocó ninguna fila (otro administrador ganó) falla y NO manda WhatsApp', async () => {
    d.filasTocadas = [];
    await expect(resolverSolicitudArco('t-1', 's-1', 'respuesta')).rejects.toThrow(/ya fue (resuelta|cerrada)|no está abierta/i);
    expect(d.enviar).not.toHaveBeenCalled();
  });

  it('una cancelación NO se cierra con prosa: se rechaza y se manda a «Ejecutar cancelación»', async () => {
    d.solicitud = { titular_ref: '5299', operador_id: 'op-1', tipo: 'cancelacion', estado: 'recibida', resuelta_en: null };
    await expect(resolverSolicitudArco('t-1', 's-1', 'listo')).rejects.toThrow(/cancelaci[oó]n/i);
    expect(d.updates).toHaveLength(0);
    expect(d.enviar).not.toHaveBeenCalled();
  });
});
