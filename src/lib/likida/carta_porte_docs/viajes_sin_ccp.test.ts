import { describe, it, expect } from 'vitest';
import { listarViajesSinCcp, aCsvSinCcp, colorPorHoras, salidaEnZona, ENCABEZADOS_CSV_SIN_CCP, UMBRALES_POR_OMISION, SIN_CLIENTE, type ViajeSalido } from './viajes_sin_ccp';

const AHORA = new Date('2026-03-10T18:00:00Z');
const hace = (h: number) => new Date(AHORA.getTime() - h * 3_600_000).toISOString();
const v = (o: Partial<ViajeSalido> & { viajeId: string }): ViajeSalido => ({ folio: `F-${o.viajeId}`, clienteId: 'c1', clienteNombre: 'Cliente Ejemplo A', salidaEn: hace(5), ...o });

describe('viajes salidos sin Carta Porte (T-A3-66)', () => {
  it('un viaje salido sin complemento aparece con su antigüedad', () => {
    const r = listarViajesSinCcp([v({ viajeId: 'v1', salidaEn: hace(50) })], new Set(), AHORA);
    expect(r.vacio).toBe(false);
    expect(r.total).toBe(1);
    expect(r.grupos[0]!.viajes[0]).toMatchObject({ viajeId: 'v1', horas: 50, dias: 2, color: 'ambar' });
  });

  it('al ligarse el complemento el viaje desaparece', () => {
    const viajes = [v({ viajeId: 'v1' }), v({ viajeId: 'v2' })];
    expect(listarViajesSinCcp(viajes, new Set(), AHORA).total).toBe(2);
    const r = listarViajesSinCcp(viajes, new Set(['v1']), AHORA);
    expect(r.total).toBe(1);
    expect(r.grupos[0]!.viajes.map((x) => x.viajeId)).toEqual(['v2']);
  });

  it('agrupa por cliente y ordena primero al cliente con el viaje más viejo', () => {
    const r = listarViajesSinCcp([
      v({ viajeId: 'a1', clienteId: 'cA', clienteNombre: 'Cliente A', salidaEn: hace(10) }),
      v({ viajeId: 'b1', clienteId: 'cB', clienteNombre: 'Cliente B', salidaEn: hace(100) }),
      v({ viajeId: 'a2', clienteId: 'cA', clienteNombre: 'Cliente A', salidaEn: hace(30) }),
    ], new Set(), AHORA);
    expect(r.grupos.map((g) => g.clienteNombre)).toEqual(['Cliente B', 'Cliente A']);
    expect(r.grupos[1]!.viajes.map((x) => x.viajeId)).toEqual(['a2', 'a1']);
    expect(r.grupos[1]!.masAntiguoHoras).toBe(30);
  });

  it('umbrales de color: verde, ámbar y rojo, y configurables', () => {
    expect(colorPorHoras(23)).toBe('verde');
    expect(colorPorHoras(24)).toBe('ambar');
    expect(colorPorHoras(71)).toBe('ambar');
    expect(colorPorHoras(72)).toBe('rojo');
    expect(colorPorHoras(10, { ambarHoras: 5, rojoHoras: 8 })).toBe('rojo');
    const r = listarViajesSinCcp([v({ viajeId: 'x', salidaEn: hace(10) })], new Set(), AHORA, { ambarHoras: 5, rojoHoras: 8 });
    expect(r.grupos[0]!.colorMax).toBe('rojo');
    expect(UMBRALES_POR_OMISION.ambarHoras).toBeLessThan(UMBRALES_POR_OMISION.rojoHoras);
  });

  it('sin viajes (o todos con complemento) devuelve el estado vacío honesto', () => {
    expect(listarViajesSinCcp([], new Set(), AHORA)).toEqual({ vacio: true, total: 0, grupos: [] });
    expect(listarViajesSinCcp([v({ viajeId: 'v1' })], new Set(['v1']), AHORA).vacio).toBe(true);
  });

  it('no inventa antigüedad: sin salida, fecha ilegible, futura o viaje repetido no entran', () => {
    const r = listarViajesSinCcp([
      v({ viajeId: 'sin', salidaEn: null }),
      v({ viajeId: 'mala', salidaEn: 'no-es-fecha' }),
      v({ viajeId: 'futura', salidaEn: new Date(AHORA.getTime() + 3_600_000).toISOString() }),
      v({ viajeId: 'ok' }), v({ viajeId: 'ok' }),
    ], new Set(), AHORA);
    expect(r.total).toBe(1);
  });

  it('cliente sin nombre o sin id se rotula sin inventar nada; el local abierto se marca pero cuenta', () => {
    const r = listarViajesSinCcp([v({ viajeId: 'v1', clienteId: null, clienteNombre: null, localAbierto: true })], new Set(), AHORA);
    expect(r.grupos[0]!.clienteNombre).toBe(SIN_CLIENTE);
    expect(r.grupos[0]!.viajes[0]!.localAbierto).toBe(true);
  });

  it('la exportación CSV trae las columnas esperadas, hora de México y neutraliza fórmulas', () => {
    const r = listarViajesSinCcp([v({ viajeId: 'v1', clienteNombre: '=SUMA(A1)', folio: 'F,1', salidaEn: '2026-03-09T12:30:00Z' })], new Set(), AHORA);
    const csv = aCsvSinCcp(r);
    const [enc, fila] = csv.replace('﻿', '').split('\r\n');
    expect(enc!.split(',')).toEqual([...ENCABEZADOS_CSV_SIN_CCP]);
    expect(fila).toContain("'=SUMA(A1)");
    expect(fila).toContain('"F,1"');
    expect(fila).toContain('2026-03-09 06:30');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(aCsvSinCcp({ vacio: true, total: 0, grupos: [] }).trim().replace('﻿', '')).toBe(ENCABEZADOS_CSV_SIN_CCP.join(','));
    expect(salidaEnZona('2026-03-09T12:30:00Z')).toBe('2026-03-09 06:30');
  });
});

import { folioComparable, viajesLigadosPorFolio, evaluarDatosTms, HORAS_IMPORTACION_VIEJA } from './viajes_sin_ccp';
describe('viajesLigadosPorFolio (OLA1-A3 + A3-02: la llave es cliente + folio)', () => {
  const viaje = (viajeId: string, folio: string | null, clienteId: string | null) => ({ viajeId, folio, clienteId });
  it('liga por folio sin distinguir mayúsculas ni espacios, y un folio vacío no liga nada', () => {
    const v = [viaje('a', ' f-1 ', 'c1'), viaje('b', null, 'c1'), viaje('c', '', 'c1'), viaje('d', 'F-9', 'c1')];
    expect([...viajesLigadosPorFolio(v, [{ clienteId: 'c1', folio: 'F-1' }, { clienteId: 'c1', folio: '' }])]).toEqual(['a']);
  });
  it('A3-02: el folio de un documento del cliente A NO liga el viaje del cliente B', () => {
    const v = [viaje('vB', '1234', 'cB')];
    expect([...viajesLigadosPorFolio(v, [{ clienteId: 'cA', folio: '1234' }])]).toEqual([]);
    expect([...viajesLigadosPorFolio(v, [{ clienteId: 'cB', folio: '1234' }])]).toEqual(['vB']);
  });
  it('A3-14/A3-02: un documento SIN cliente no liga el viaje de un cliente (no se completa el de otro)', () => {
    expect([...viajesLigadosPorFolio([viaje('vB', '1234', 'cB')], [{ clienteId: null, folio: '1234' }])]).toEqual([]);
  });
  it('un viaje sin cliente liga solo si el folio es de un único cliente (si dos clientes lo usan, es ambiguo y no liga)', () => {
    const v = [viaje('v1', '77', null)];
    expect([...viajesLigadosPorFolio(v, [{ clienteId: 'cA', folio: '77' }])]).toEqual(['v1']);
    expect([...viajesLigadosPorFolio(v, [{ clienteId: 'cA', folio: '77' }, { clienteId: 'cB', folio: '77' }])]).toEqual([]);
  });
});

describe('A3-01: «sin datos del TMS» no es «cero pendientes»', () => {
  const AHORA2 = new Date('2026-03-10T18:00:00Z');
  const hace2 = (h: number) => new Date(AHORA2.getTime() - h * 3_600_000).toISOString();
  it('sin viajes leídos en la ventana: sin_viajes, aunque haya fecha del último importado', () => {
    expect(evaluarDatosTms({ viajesLeidos: 0, ultimoImportadoEn: null }, AHORA2)).toMatchObject({ motivo: 'sin_viajes', ultimoImportadoEn: null });
    expect(evaluarDatosTms({ viajesLeidos: 0, ultimoImportadoEn: hace2(500) }, AHORA2)).toMatchObject({ motivo: 'sin_viajes' });
  });
  it('con viajes y una importación reciente: hay datos (null)', () => {
    expect(evaluarDatosTms({ viajesLeidos: 3, ultimoImportadoEn: hace2(2) }, AHORA2)).toBeNull();
  });
  it('con viajes pero la última importación es vieja: importacion_vieja con las horas', () => {
    const r = evaluarDatosTms({ viajesLeidos: 3, ultimoImportadoEn: hace2(HORAS_IMPORTACION_VIEJA + 5) }, AHORA2);
    expect(r).toMatchObject({ motivo: 'importacion_vieja', horasDesdeImportacion: HORAS_IMPORTACION_VIEJA + 5 });
  });
  it('listarViajesSinCcp con sin_viajes marca el listado y el CSV dice «Sin datos del TMS» (nunca un CSV vacío que se lea como cero)', () => {
    const sinDatosTms = evaluarDatosTms({ viajesLeidos: 0, ultimoImportadoEn: null }, AHORA2)!;
    const l = listarViajesSinCcp([], new Set(), AHORA2, UMBRALES_POR_OMISION, { sinDatosTms });
    expect(l.sinDatosTms?.motivo).toBe('sin_viajes');
    expect(aCsvSinCcp(l)).toContain('Sin datos del TMS');
  });
});
