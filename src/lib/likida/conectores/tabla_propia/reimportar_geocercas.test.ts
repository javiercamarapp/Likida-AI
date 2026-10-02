/* eslint-disable security/detect-non-literal-fs-filename -- solo pruebas: leen fixtures del propio directorio por URL relativa a este archivo. */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const { logger } = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('../../conductor/repo_validacion', () => ({ importarSitios: vi.fn() }));
vi.mock('../credenciales', () => ({ leerCredencial: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));

import type { Http } from '../tipos';
import { importarGeocercasDeFlota } from './importar_geocercas';
import { reimportarGeocercasDeFlota, reimportarGeocercasTodas, type PuertosReimportacion } from './reimportar_geocercas';

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const http = (t: string): Http => async () => ({ estado: 200, cuerpo: t });
const CRED = { modo: 'csv_sftp', base_url: 'https://datos.ejemplo.com/p.csv', geocercas_url: 'https://datos.ejemplo.com/g.csv' };

/** Un «mundo» en memoria: el estado por flota (huella, claim) y el catálogo de sitios que escribiría la RPC. */
function mundo(csv: () => string, opts: { flotas?: string[]; sinMigracion?: boolean; cred?: Record<string, string> | null } = {}) {
  const estado = new Map<string, { huella: string | null; reclamada: boolean; ultimo?: string; error?: string | null }>();
  const catalogo = new Map<string, Map<string, Record<string, unknown>>>(); // flota → código → fila
  const importar = vi.fn(async (tenantId: string, filas: readonly { codigo: string; conservar_activa?: boolean; poligono?: unknown }[]) => {
    const sitios = catalogo.get(tenantId) ?? new Map();
    let creados = 0; let actualizados = 0;
    for (const f of filas) { if (sitios.has(f.codigo)) actualizados++; else creados++; sitios.set(f.codigo, { ...f }); }
    catalogo.set(tenantId, sitios);
    return { ok: true as const, creados, actualizados };
  });
  const p: PuertosReimportacion = {
    flotas: async () => (opts.sinMigracion ? null : opts.flotas ?? ['t-1']),
    reclamar: async (t) => { const e = estado.get(t) ?? { huella: null, reclamada: false }; if (e.reclamada) return false; estado.set(t, { ...e, reclamada: true }); return true; },
    huellaPrevia: async (t) => estado.get(t)?.huella ?? null,
    registrar: async (t, r) => { const e = estado.get(t) ?? { huella: null, reclamada: true }; estado.set(t, { ...e, reclamada: false, ultimo: r.resultado, error: r.error ?? null, huella: r.resultado === 'error' ? e.huella : r.huella ?? null }); },
    importar: (t, huellaPrevia) => importarGeocercasDeFlota(t, { leerCredencial: async () => (opts.cred === undefined ? CRED : opts.cred) as never, http: async (...a) => http(csv())(...a), importar: importar as never, huellaPrevia, conservarActiva: true }),
  };
  return { p, estado, catalogo, importar };
}

describe('re-importación diaria de geocercas', () => {
  it('primera pasada importa; la segunda con la tabla igual NO escribe nada (idempotente por huella)', async () => {
    const m = mundo(() => fx('geocercas.csv'));
    const a = await reimportarGeocercasDeFlota('t-1', m.p);
    expect(a).toMatchObject({ estado: 'importada', creados: 4, actualizados: 0, poligonos: 2, aproximadas: 0 });
    expect(m.catalogo.get('t-1')!.size).toBe(4);
    m.estado.set('t-1', { ...m.estado.get('t-1')!, reclamada: false }); // pasó la ventana
    m.importar.mockClear();
    const b = await reimportarGeocercasDeFlota('t-1', m.p);
    expect(b.estado).toBe('sin_cambios');
    expect(m.importar).not.toHaveBeenCalled();
    expect(m.catalogo.get('t-1')!.size).toBe(4); // sin duplicados
  });
  it('si la tabla del cliente cambia, la siguiente pasada actualiza por código (no duplica) y manda conservar_activa', async () => {
    let texto = fx('geocercas.csv');
    const m = mundo(() => texto);
    await reimportarGeocercasDeFlota('t-1', m.p);
    m.estado.set('t-1', { ...m.estado.get('t-1')!, reclamada: false });
    texto += 'PATIO-N,Patio Nuevo,circulo,25.9,-100.3,400,,\n';
    const r = await reimportarGeocercasDeFlota('t-1', m.p);
    expect(r).toMatchObject({ estado: 'importada', creados: 1, actualizados: 4 });
    expect(m.catalogo.get('t-1')!.size).toBe(5);
    const filas = m.importar.mock.calls.at(-1)![1];
    expect(filas.every((f) => f.conservar_activa === true)).toBe(true);
  });
  it('dos invocaciones solapadas: la segunda no ve la flota (claim) y no lee la tabla del cliente', async () => {
    const m = mundo(() => fx('geocercas.csv'));
    m.estado.set('t-1', { huella: null, reclamada: true }); // otra invocación la trae en vuelo
    expect((await reimportarGeocercasDeFlota('t-1', m.p)).estado).toBe('ocupada');
    expect(m.importar).not.toHaveBeenCalled();
  });
  it('un error se anota SIN gastar la huella buena y no lanza; la pasada siguiente recupera', async () => {
    let texto = fx('geocercas.csv');
    const m = mundo(() => texto);
    await reimportarGeocercasDeFlota('t-1', m.p);
    const huellaBuena = m.estado.get('t-1')!.huella;
    m.estado.set('t-1', { ...m.estado.get('t-1')!, reclamada: false });
    texto = 'x,y\n1,2\n'; // archivo ilegible
    const mal = await reimportarGeocercasDeFlota('t-1', m.p);
    expect(mal.estado).toBe('error');
    expect(mal.error).toMatch(/Faltan columnas/);
    expect(m.estado.get('t-1')).toMatchObject({ ultimo: 'error', huella: huellaBuena });
    m.estado.set('t-1', { ...m.estado.get('t-1')!, reclamada: false });
    texto = fx('geocercas.csv');
    expect((await reimportarGeocercasDeFlota('t-1', m.p)).estado).toBe('sin_cambios'); // la huella buena seguía ahí
  });
  it('una flota sin geocercas configuradas en su conexión NO es un error: se anota sin cambios', async () => {
    const m = mundo(() => '', { cred: { modo: 'csv_sftp', base_url: 'https://datos.ejemplo.com/p.csv' } });
    const r = await reimportarGeocercasDeFlota('t-1', m.p);
    expect(r.estado).toBe('sin_cambios');
    expect(m.estado.get('t-1')).toMatchObject({ ultimo: 'sin_cambios', error: null });
  });
  it('una flota sin conexión guardada tampoco es un error', async () => {
    const m = mundo(() => '', { cred: null });
    expect((await reimportarGeocercasDeFlota('t-1', m.p)).estado).toBe('sin_cambios');
  });
  it('una excepción de un puerto se contiene en el resultado de ESA flota', async () => {
    const m = mundo(() => fx('geocercas.csv'));
    const p = { ...m.p, huellaPrevia: async () => { throw new Error('base caída password=abc'); } };
    const r = await reimportarGeocercasDeFlota('t-1', p);
    expect(r).toMatchObject({ estado: 'error', error: 'falla interna al reimportar' });
    expect(JSON.stringify(r)).not.toContain('password');
  });
});

describe('la pasada del cron', () => {
  it('cada flota es independiente: el fallo de una no frena a las demás', async () => {
    const m = mundo(() => fx('geocercas.csv'), { flotas: ['t-1', 't-2', 't-3'] });
    const p = { ...m.p, importar: (t: string, h: string | null) => (t === 't-2' ? Promise.resolve({ ok: false as const, error: 'su tabla no contestó' }) : m.p.importar(t, h)) };
    const r = await reimportarGeocercasTodas({ puertos: p });
    expect(r).toMatchObject({ importadas: 2, conError: 1, sinTurno: 0, sinMigracion: false });
    expect(r.flotas.map((f) => f.estado)).toEqual(['importada', 'error', 'importada']);
  });
  it('el reloj corta ANTES de despachar una flota y lo que no alcanzó se dice (sinTurno) sin reclamarse', async () => {
    let ahora = 0; // el reloj avanza 6 por consulta; vence en 10: la 1.ª (t=0) y la 2.ª (t=6) corren, la 3.ª (t=12) ya no
    const m2 = mundo(() => fx('geocercas.csv'), { flotas: ['t-1', 't-2', 't-3'] });
    const r2 = await reimportarGeocercasTodas({ puertos: m2.p, venceEn: 10, ahora: () => ahora++ * 6 });
    expect(r2.flotas.map((f) => f.estado)).toEqual(['importada', 'importada', 'sin_turno']);
    expect(r2.sinTurno).toBe(1);
    expect(m2.estado.has('t-3')).toBe(false); // no se reclamó: queda para la corrida siguiente
  });
  it('sin la 0631 en la base: no corre nada y lo dice (sinMigracion)', async () => {
    const m = mundo(() => fx('geocercas.csv'), { sinMigracion: true });
    const r = await reimportarGeocercasTodas({ puertos: m.p });
    expect(r).toMatchObject({ sinMigracion: true, flotas: [], conError: 0 });
    expect(m.importar).not.toHaveBeenCalled();
  });
  it('si la lista de flotas falla, no lanza: devuelve un error contado', async () => {
    const m = mundo(() => '');
    const r = await reimportarGeocercasTodas({ puertos: { ...m.p, flotas: async () => { throw new Error('rpc caída'); } } });
    expect(r.conError).toBe(1);
    expect(logger.error).toHaveBeenCalled();
  });
});
