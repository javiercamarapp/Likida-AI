import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { guardarPreferencia, guardarSilencio, leerLeidas, leerPreferencias, leerSilencio, marcarLeidas } from './estado';
import { resolverBandeja } from './bandeja';
import { SILENCIO_POR_OMISION, type Aviso } from './modelo';

/** Un doble encadenable de supabase-js: cada `await` del final devuelve `resultado`. */
function doble(resultado: { data?: unknown; error?: { message: string } | null }) {
  const llamadas: Array<[string, unknown[]]> = [];
  const cadena: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'limit', 'upsert', 'maybeSingle']) {
    cadena[m] = (...a: unknown[]) => { llamadas.push([m, a]); return cadena; };
  }
  cadena.then = (res: (v: unknown) => unknown) => res({ data: resultado.data ?? null, error: resultado.error ?? null });
  const db = {
    from: (t: string) => { llamadas.push(['from', [t]]); return cadena; },
    rpc: (f: string, a: unknown) => { llamadas.push(['rpc', [f, a]]); return Promise.resolve({ data: resultado.data ?? null, error: resultado.error ?? null }); },
  } as unknown as SupabaseClient;
  return { db, llamadas };
}
const ADMIN = { tipo: 'admin' } as const;
const FLOTA = { tipo: 'flota', tenantId: '10020000-0000-4000-8000-0000000000a1' } as const;

describe('leídas', () => {
  it('lee las claves de ESTA persona y ámbito', async () => {
    const { db, llamadas } = doble({ data: [{ clave: 'a|1' }, { clave: 'b|2' }] });
    const r = await leerLeidas(db, FLOTA, 'u1');
    expect(r).toEqual({ ok: true, leidas: new Set(['a|1', 'b|2']) });
    expect(llamadas).toContainEqual(['eq', ['usuario_id', 'u1']]);
    expect(llamadas).toContainEqual(['eq', ['ambito', FLOTA.tenantId]]);
  });
  it('una base caída no es «no hay leídas»: se reporta', async () => {
    expect(await leerLeidas(doble({ error: { message: 'boom' } }).db, ADMIN, 'u1')).toEqual({ ok: false, error: 'boom' });
  });
  it('marcar y desmarcar van por la función atómica y no llaman con lista vacía', async () => {
    const { db, llamadas } = doble({ data: 2 });
    expect(await marcarLeidas(db, ADMIN, ['a', 'b'], true)).toEqual({ ok: true, cambiadas: 2 });
    expect(llamadas).toContainEqual(['rpc', ['aviso_marcar', { p_ambito: 'admin', p_claves: ['a', 'b'], p_leido: true }]]);
    const vacio = doble({});
    expect(await marcarLeidas(vacio.db, ADMIN, [], true)).toEqual({ ok: true, cambiadas: 0 });
    expect(vacio.llamadas).toEqual([]);
    expect(await marcarLeidas(doble({ error: { message: 'rls' } }).db, ADMIN, ['a'], false)).toEqual({ ok: false, error: 'rls' });
  });
});

describe('preferencias y horario', () => {
  it('ignora filas fuera del catálogo del ámbito', async () => {
    const { db } = doble({ data: [
      { categoria: 'costos', canal: 'app', activo: false },
      { categoria: 'dinero', canal: 'app', activo: false }, // categoría de flota en el ámbito admin
      { categoria: 'costos', canal: 'sms', activo: true },
    ] });
    expect(await leerPreferencias(db, ADMIN, 'u1')).toEqual({ ok: true, prefs: [{ categoria: 'costos', canal: 'app', activo: false }] });
  });
  it('guardar valida el catálogo antes de tocar la base', async () => {
    const { db, llamadas } = doble({});
    expect(await guardarPreferencia(db, ADMIN, 'u1', 'dinero', 'app', true)).toEqual({ ok: false, error: 'fuera_catalogo' });
    expect(await guardarPreferencia(db, ADMIN, 'u1', 'costos', 'sms' as never, true)).toEqual({ ok: false, error: 'fuera_catalogo' });
    expect(llamadas).toEqual([]);
    expect(await guardarPreferencia(db, ADMIN, 'u1', 'costos', 'correo', false)).toEqual({ ok: true });
    const up = llamadas.find(([m]) => m === 'upsert')!;
    expect(up[1][0]).toMatchObject({ usuario_id: 'u1', ambito: 'admin', categoria: 'costos', canal: 'correo', activo: false });
    expect(up[1][1]).toEqual({ onConflict: 'usuario_id,ambito,categoria,canal' });
  });
  it('sin fila el horario es el de omisión (apagado); con fila, recorta HH:MM:SS', async () => {
    expect(await leerSilencio(doble({ data: null }).db, ADMIN, 'u1')).toEqual({ ok: true, silencio: SILENCIO_POR_OMISION, guardado: false });
    const r = await leerSilencio(doble({ data: { activo: true, desde: '21:30:00', hasta: '06:00:00', permite_criticos: false } }).db, ADMIN, 'u1');
    expect(r).toEqual({ ok: true, silencio: { activo: true, desde: '21:30', hasta: '06:00', permiteCriticos: false }, guardado: true });
  });
  it('una fila de horario con forma inválida se reporta, no se tapa con la omisión', async () => {
    expect((await leerSilencio(doble({ data: { activo: true, desde: '08:00:00', hasta: '08:00:00', permite_criticos: true } }).db, ADMIN, 'u1')).ok).toBe(false);
  });
  it('guardar horario rechaza lo inválido y guarda lo válido', async () => {
    const { db, llamadas } = doble({});
    expect(await guardarSilencio(db, ADMIN, 'u1', { activo: true, desde: '08:00', hasta: '08:00', permiteCriticos: true })).toEqual({ ok: false, error: 'horario_invalido' });
    expect(llamadas).toEqual([]);
    const r = await guardarSilencio(db, FLOTA, 'u1', { activo: true, desde: '22:00', hasta: '07:00', permiteCriticos: true });
    expect(r.ok).toBe(true);
    expect(llamadas.find(([m]) => m === 'upsert')![1][0]).toMatchObject({ ambito: FLOTA.tenantId, desde: '22:00', hasta: '07:00', permite_criticos: true });
  });
});

describe('la bandeja: una sola función para el pie y la pantalla', () => {
  const av = (clave: string, extra: Partial<Aviso> = {}): Aviso => ({ clave, fuente: 'x', categoria: 'costos', severidad: 'atencion', titulo: clave, detalle: null, href: null, desde: null, silenciable: true, ...extra });
  const fuente = { avisos: [av('a'), av('b'), av('c', { categoria: 'soporte' })], generadoEn: '2026-11-11T12:00:00.000Z' };
  const lect = (leidas: string[] | Error, prefs: Array<{ categoria: 'costos'; canal: 'app'; activo: boolean }> | Error) => ({
    leidas: vi.fn(async () => (leidas instanceof Error ? { ok: false as const, error: leidas.message } : { ok: true as const, leidas: new Set(leidas) })),
    prefs: vi.fn(async () => (prefs instanceof Error ? { ok: false as const, error: prefs.message } : { ok: true as const, prefs })),
  });

  it('el número del pie = no leídos de la lista', async () => {
    const b = await resolverBandeja({} as SupabaseClient, ADMIN, 'u1', fuente, lect(['a'], []));
    expect(b.noLeidos).toBe(2);
    expect(b.avisos.filter((a) => !b.leidas.has(a.clave))).toHaveLength(b.noLeidos!);
  });
  it('apagar un tipo en la app lo saca de la lista Y de la cuenta', async () => {
    const b = await resolverBandeja({} as SupabaseClient, ADMIN, 'u1', fuente, lect([], [{ categoria: 'costos', canal: 'app', activo: false }]));
    expect(b.avisos.map((a) => a.clave)).toEqual(['c']);
    expect(b.noLeidos).toBe(1);
  });
  it('si no se pudo leer qué ya se leyó, el número es «sin dato» (null), no 0 ni el total', async () => {
    const b = await resolverBandeja({} as SupabaseClient, ADMIN, 'u1', fuente, lect(new Error('caída'), []));
    expect(b.noLeidos).toBeNull();
    expect(b.errorLeidas).toBe('caída');
    expect(b.avisos).toHaveLength(3);
  });
  it('si fallan las preferencias se muestran todos los tipos y se dice', async () => {
    const b = await resolverBandeja({} as SupabaseClient, ADMIN, 'u1', fuente, lect([], new Error('prefs')));
    expect(b.avisos).toHaveLength(3);
    expect(b.errorPrefs).toBe('prefs');
  });
});
