import { beforeEach, describe, expect, it, vi } from 'vitest';

const sesion = vi.hoisted(() => ({ valor: null as null | { userId: string; tenantId: string | null; rol: string } }));
const guardado = vi.hoisted(() => ({ llamadas: [] as unknown[][], resultado: { ok: true, estado: {}, version: 2 } as unknown }));
const eventos = vi.hoisted(() => ({ filas: [] as unknown[] }));

vi.mock('@/lib/auth/session', () => ({ getSessionTenant: async () => sesion.valor }));
vi.mock('@/lib/auth/perfil_tenant', () => ({ perfilDeTenant: async () => 'cinco_agentes' }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ marca: 'admin' }) }));
vi.mock('../asistente/senales', () => ({ leerSenalesAsistente: async () => ({ tms: { activa: true, probadaEn: '2026-11-01', ultimoError: null }, archivosRecibidos: 1, correoPlataforma: true, correoDesglose: null, operadores: null, unidadesActivas: null, patios: null, coordinadores: 2, supervisores: null, revisorCartaPorte: null }) }));
vi.mock('./repo', () => ({
  leerEstado: async (_db: unknown, u: string, t: string) => ({ ok: true, estado: { u, t }, version: 1 }),
  guardarEstado: async (...a: unknown[]) => { guardado.llamadas.push(a); return guardado.resultado; },
  insertarEventos: async (_db: unknown, ctx: unknown, lote: unknown[]) => { eventos.filas.push({ ctx, lote }); return lote.length; },
}));

import { guardarEstadoGuia, leerEstadoGuia, leerSenalesDeLaGuia, registrarEventosGuia } from './acciones';

beforeEach(() => { sesion.valor = { userId: 'u1', tenantId: 't1', rol: 'flota_admin' }; guardado.llamadas.length = 0; eventos.filas.length = 0; });

describe('leerEstadoGuia', () => {
  it('sin sesión o sin flota no lee nada', async () => {
    sesion.valor = null;
    expect(await leerEstadoGuia()).toEqual({ ok: false, motivo: 'sin_sesion' });
    sesion.valor = { userId: 'u1', tenantId: null, rol: 'flota_admin' };
    expect(await leerEstadoGuia()).toEqual({ ok: false, motivo: 'sin_sesion' });
  });
  it('lee con la identidad de la SESIÓN, nunca la que diga el cliente', async () => {
    expect(await leerEstadoGuia()).toMatchObject({ ok: true, estado: { u: 'u1', t: 't1' } });
  });
});

describe('guardarEstadoGuia', () => {
  it('escribe con usuario y flota de la sesión y la versión esperada', async () => {
    expect(await guardarEstadoGuia({ modo: 'corto' }, 3)).toMatchObject({ ok: true });
    expect(guardado.llamadas[0].slice(1)).toEqual(['u1', 't1', { modo: 'corto' }, 3]);
  });
  it('«ver como» (superadmin) no escribe: se omite sin error', async () => {
    sesion.valor = { userId: 'u1', tenantId: 't1', rol: 'superadmin' };
    expect(await guardarEstadoGuia({ modo: 'corto' }, 1)).toEqual({ ok: true, omitido: 'solo_lectura' });
    expect(guardado.llamadas).toHaveLength(0);
  });
  it('rechaza una versión que no es un entero no negativo y no toca la base', async () => {
    for (const v of [-1, 1.5, Number.NaN]) expect(await guardarEstadoGuia({}, v)).toEqual({ ok: false, motivo: 'version' });
    expect(guardado.llamadas).toHaveLength(0);
  });
  it('sin sesión no escribe', async () => {
    sesion.valor = null;
    expect(await guardarEstadoGuia({}, 0)).toEqual({ ok: false, motivo: 'sin_sesion' });
  });
});

describe('leerSenalesDeLaGuia', () => {
  it('lee las del asistente para la pista de la sesión', async () => {
    const r = await leerSenalesDeLaGuia(['coordinadores', 'tms_probada']);
    expect(r.coordinadores).toEqual({ estado: 'si', n: 2 });
    expect(r.tms_probada).toEqual({ estado: 'si' });
  });
  it('un rol sin pista, sin sesión o con una entrada que no es lista no devuelve nada', async () => {
    sesion.valor = { userId: 'u1', tenantId: 't1', rol: 'rol_raro' };
    expect(await leerSenalesDeLaGuia(['coordinadores'])).toEqual({});
    sesion.valor = null;
    expect(await leerSenalesDeLaGuia(['coordinadores'])).toEqual({});
    sesion.valor = { userId: 'u1', tenantId: 't1', rol: 'flota_admin' };
    expect(await leerSenalesDeLaGuia('coordinadores' as never)).toEqual({});
  });
  it('ignora elementos que no son texto', async () => {
    const r = await leerSenalesDeLaGuia([5 as never, 'coordinadores']);
    expect(Object.keys(r)).toEqual(['coordinadores']);
  });
});

describe('registrarEventosGuia', () => {
  it('con el interruptor de código apagado (D-OB-8) no guarda nada, aunque todo lo demás sea válido', async () => {
    process.env.LIKIDA_FLOTA_COOKIE_LLAVE = 'secreto-de-prueba';
    expect(await registrarEventosGuia([{ tipo: 'guia_inicio', canal: 'movil' }])).toEqual({ ok: false, guardados: 0 });
    expect(eventos.filas).toHaveLength(0);
  });
  it('un lote que no es lista tampoco entra', async () => {
    expect(await registrarEventosGuia('x' as never)).toEqual({ ok: false, guardados: 0 });
  });
});
