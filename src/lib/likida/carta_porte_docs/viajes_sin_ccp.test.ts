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
