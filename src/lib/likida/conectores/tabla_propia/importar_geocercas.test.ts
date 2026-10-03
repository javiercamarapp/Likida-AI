/* eslint-disable security/detect-non-literal-fs-filename -- solo pruebas: leen fixtures del propio directorio por URL relativa a este archivo, nunca por entrada de usuario. */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// El repositorio real habla con la base; aquí entra por el puerto `importar`.
vi.mock('../../conductor/repo_validacion', () => ({ importarSitios: vi.fn() }));
vi.mock('../credenciales', () => ({ leerCredencial: vi.fn() }));

import { parsearCsvSitios } from '../../conductor/sitios';
import type { Http } from '../tipos';
import { crearLectorTablaPropia } from './lector';
import { geocercasASitios, importarGeocercasConLector, importarGeocercasDeTablaPropia } from './importar_geocercas';
import { leerGeocercasCsv } from './csv';
import { haversineM } from './validar';
import { dentroDeGeocerca } from '../../conductor/geo';

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const csv = (t: string): Http => async () => ({ estado: 200, cuerpo: t });
const CRED = { modo: 'csv_sftp', base_url: 'https://datos.ejemplo.com/p.csv', geocercas_url: 'https://datos.ejemplo.com/g.csv' };

describe('geocercas → sitios del Conductor', () => {
  const { filas: geo } = leerGeocercasCsv(fx('geocercas.csv'));
  const r = geocercasASitios(geo);
  it('círculo tal cual; tipo patio/planta/punto de interés por su nombre y su cliente', () => {
    expect(r.rechazadas).toEqual([]);
    expect(r.filas.map((s) => [s.codigo, s.tipo, s.lat, s.lng, s.radio_m, s.cliente])).toEqual([
      ['PATIO-A', 'patio', 25.78, -100.19, 600, null],
      ['PL-01', 'planta', 20.515, -103.185, 550, 'Cliente Ficticio Uno'],
      ['PL-02', 'punto_interes', expect.any(Number), expect.any(Number), expect.any(Number), null],
      ['PATIO-L', 'patio', expect.any(Number), expect.any(Number), expect.any(Number), null],
    ]);
  });
  it('el polígono se guarda NATIVO (sus vértices) y su círculo de respaldo lo contiene SIN inflarse 5 %', () => {
    expect(r.aproximadas).toEqual([]);
    expect(r.poligonos).toBe(2);
    for (const k of [2, 3]) {
      const s = r.filas[k];
      expect(s.poligono).toHaveLength(4);
      expect(s.aproximada).toBe(false);
      const maxVertice = Math.max(...s.poligono!.map((v) => haversineM({ lat: s.lat, lon: s.lng }, { lat: v.lat, lon: v.lng })));
      expect(s.radio_m).toBe(Math.ceil(maxVertice)); // el vértice más lejano, ni un metro de más
      for (const v of geo[k].poligono!) expect(haversineM({ lat: s.lat, lon: s.lng }, v)).toBeLessThanOrEqual(s.radio_m);
    }
    // un círculo no lleva polígono
    expect(r.filas[0].poligono).toBeNull();
  });
  it('el patio alargado de la carretera: el punto de la carretera cae en el círculo de respaldo pero NO en el polígono', () => {
    const patio = r.filas[3];
    const carretera = { lat: patio.lat + 90 / 111_195, lng: patio.lng }; // ≈ 68 m al norte del borde
    const g = { lat: patio.lat, lng: patio.lng, radioM: patio.radio_m, poligono: patio.poligono };
    expect(dentroDeGeocerca(carretera, { lat: patio.lat, lng: patio.lng, radioM: patio.radio_m }).dentro).toBe(true);
    expect(dentroDeGeocerca(carretera, g).dentro).toBe(false);
    expect(dentroDeGeocerca({ lat: patio.lat, lng: patio.lng + 100 / 104_150 }, g).dentro).toBe(true);
  });
  it('un polígono sin área (tres puntos en línea) no se puede guardar: entra como círculo y se REPORTA como aproximado', () => {
    const recta = { codigo: 'R', nombre: 'Recta', tipo: 'poligono' as const, centro: null, radioM: null, cliente: null, poligono: [{ lat: 20, lon: -103 }, { lat: 20, lon: -103.002 }, { lat: 20, lon: -103.004 }] };
    const s = geocercasASitios([recta]);
    expect(s.filas[0]).toMatchObject({ aproximada: true, poligono: null });
    expect(s.aproximadas).toEqual([{ codigo: 'R', radioM: s.filas[0].radio_m }]);
    expect(s.poligonos).toBe(0);
  });
  it('lo que produce es lo que el importador de sitios del Conductor acepta (mismo contrato que el CSV del panel)', () => {
    const texto = `codigo,nombre,tipo,lat,lng,radio_m,cliente\n${r.filas.map((s) => [s.codigo, s.nombre, s.tipo, s.lat, s.lng, s.radio_m, s.cliente ?? ''].join(',')).join('\n')}\n`;
    expect(parsearCsvSitios(texto).errores).toEqual([]);
  });
  it('un polígono de más de 100 km no se puede representar: se rechaza, no se recorta', () => {
    const gigante = { codigo: 'G', nombre: 'Gigante', tipo: 'poligono' as const, centro: null, radioM: null, cliente: null, poligono: [{ lat: 20, lon: -103 }, { lat: 20, lon: -100 }, { lat: 23, lon: -101 }] };
    expect(geocercasASitios([gigante]).rechazadas[0].motivo).toContain('demasiado grande');
  });
});

describe('importar (todo-o-nada, con puertos)', () => {
  const lector = (t: string) => { const c = crearLectorTablaPropia(CRED, { http: csv(t) }); if (!c.ok) throw new Error(c.motivo); return c.lector; };
  it('lee, traduce e importa; reporta creados, actualizados y polígonos nativos', async () => {
    const importar = vi.fn(async () => ({ ok: true as const, creados: 2, actualizados: 1 }));
    const r = await importarGeocercasConLector('t-1', { lector: lector(fx('geocercas.csv')), importar });
    expect(r).toMatchObject({ ok: true, sinCambios: false, creados: 2, actualizados: 1, leidas: 4, poligonos: 2 });
    expect(r.ok && r.aproximadas).toHaveLength(0);
    expect(r.ok && r.huella).toMatch(/^[0-9a-f]{64}$/);
    expect(importar).toHaveBeenCalledWith('t-1', expect.arrayContaining([expect.objectContaining({ codigo: 'PATIO-A', radio_m: 600 })]));
  });
  it('re-importación idempotente: con la misma huella NO se escribe nada; si la tabla cambió (aunque sea un vértice) sí', async () => {
    const importar = vi.fn(async () => ({ ok: true as const, creados: 0, actualizados: 4 }));
    const primera = await importarGeocercasConLector('t-1', { lector: lector(fx('geocercas.csv')), importar });
    if (!primera.ok) throw new Error('la primera importación debía salir bien');
    importar.mockClear();
    const igual = await importarGeocercasConLector('t-1', { lector: lector(fx('geocercas.csv')), importar, huellaPrevia: primera.huella });
    expect(igual).toMatchObject({ ok: true, sinCambios: true, creados: 0, actualizados: 0, leidas: 4, huella: primera.huella });
    expect(importar).not.toHaveBeenCalled();
    // el orden de las filas no cambia la huella
    const lineas = fx('geocercas.csv').trim().split('\n');
    const barajado = [lineas[0], ...lineas.slice(1).reverse()].join('\n');
    const barajada = await importarGeocercasConLector('t-1', { lector: lector(barajado), importar, huellaPrevia: primera.huella });
    expect(barajada).toMatchObject({ ok: true, sinCambios: true });
    // un vértice movido SÍ cambia la huella y se importa
    const movido = fx('geocercas.csv').replace('-103.30288 20.499798, -103.29712 20.499798', '-103.30288 20.499798, -103.29700 20.499798');
    const cambiada = await importarGeocercasConLector('t-1', { lector: lector(movido), importar, huellaPrevia: primera.huella });
    expect(cambiada).toMatchObject({ ok: true, sinCambios: false });
    expect(importar).toHaveBeenCalledTimes(1);
    expect(cambiada.ok && cambiada.huella).not.toBe(primera.huella);
  });
  it('una fila mala NO deja un catálogo a medias: no se importa ninguna y se dice cuál', async () => {
    const importar = vi.fn();
    const r = await importarGeocercasConLector('t-1', { lector: lector('codigo,nombre,lat_centro,lon_centro,radio_m\nA,Uno,25.78,-100.19,100\nB,Dos,25.78,-100.19,\n'), importar });
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? [] : r.detalles?.join()).toContain('Fila 3');
    expect(importar).not.toHaveBeenCalled();
  });
  it('la base rechaza (cliente inexistente) → no se guarda nada y el mensaje dice la línea', async () => {
    const importar = vi.fn(async () => ({ ok: false as const, errores: [{ linea: 3, mensaje: 'El cliente «X» no existe en tu catálogo de clientes.' }] }));
    const r = await importarGeocercasConLector('t-1', { lector: lector(fx('geocercas.csv')), importar });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('No se importó nada') });
    expect(r.ok ? '' : r.detalles?.[0]).toContain('Línea 3');
  });
  it('un lector que falla (archivo ilegible) o una excepción de la base devuelven frases nuestras', async () => {
    const mal = await importarGeocercasConLector('t-1', { lector: lector('x,y\n1,2\n'), importar: vi.fn() });
    expect(mal).toMatchObject({ ok: false, error: expect.stringContaining('Faltan columnas') });
    const boom = await importarGeocercasConLector('t-1', { lector: lector(fx('geocercas.csv')), importar: async () => { throw new Error('relation "geocerca" password=abc'); } });
    expect(boom).toMatchObject({ ok: false });
    expect(JSON.stringify(boom)).not.toContain('password');
  });
});

describe('la acción del panel', () => {
  it('solo dueño o jefe de tráfico; sin conexión guardada lo dice; el tenant sale de la sesión', async () => {
    const importar = vi.fn(async () => ({ ok: true as const, creados: 3, actualizados: 0 }));
    const leerCredencial = vi.fn(async () => CRED as never);
    expect(await importarGeocercasDeTablaPropia({ tenantId: 't-1', rol: 'contador' }, { leerCredencial, http: csv(fx('geocercas.csv')), importar })).toMatchObject({ ok: false, error: expect.stringContaining('Solo el dueño') });
    expect(await importarGeocercasDeTablaPropia({ tenantId: 't-1', rol: 'flota_admin' }, { leerCredencial: async () => null, http: csv(''), importar })).toMatchObject({ ok: false, error: expect.stringContaining('Conexiones') });
    const ok = await importarGeocercasDeTablaPropia({ tenantId: 't-1', rol: 'flota_admin' }, { leerCredencial, http: csv(fx('geocercas.csv')), importar });
    expect(ok).toMatchObject({ ok: true, creados: 3 });
    expect(leerCredencial).toHaveBeenCalledWith('t-1', 'tabla_propia');
  });
  it('conexión guardada pero inválida → motivo; credencial ilegible → frase nuestra', async () => {
    const importar = vi.fn();
    expect(await importarGeocercasDeTablaPropia({ tenantId: 't-1', rol: 'flota_admin' }, { leerCredencial: async () => ({ modo: 'x' }) as never, http: csv(''), importar })).toMatchObject({ ok: false, error: expect.stringContaining('no es válida') });
    expect(await importarGeocercasDeTablaPropia({ tenantId: 't-1', rol: 'flota_admin' }, { leerCredencial: async () => { throw new Error('llave cambió'); }, http: csv(''), importar })).toMatchObject({ ok: false, error: expect.stringContaining('Vuelve a capturarla') });
  });
});
