import { describe, expect, it } from 'vitest';
import { COLUMNAS_CSV_CONSTANCIA, armarConstancia, csvConstancia, type ViajeConstancia } from './constancia';
import { hitoVacio } from './memoria.fixture';
import type { HitoFila } from './tipos';

const T1 = 't1';
const PERIODO = { desde: '2026-10-01T06:00:00.000Z', hasta: '2026-10-08T06:00:00.000Z' };
const viaje = (id: string, op: string, p: Partial<ViajeConstancia> = {}): ViajeConstancia => ({
  id, folio: `F-${id}`, operadorId: op, operadorNombre: `Operador ${op}`, estatus: 'liquidado', creadoEn: '2026-10-03T12:00:00.000Z', ...p,
});
const hito = (viajeId: string, tipo: HitoFila['tipo'], p: Partial<HitoFila> = {}): HitoFila =>
  hitoVacio({ id: `${viajeId}-${tipo}`, viajeId, tipo, tenantId: T1, ...p });
const reportado = (viajeId: string, tipo: HitoFila['tipo'], fuente: NonNullable<HitoFila['fuente']>, en = '2026-10-03T15:30:00.000Z', p: Partial<HitoFila> = {}) =>
  hito(viajeId, tipo, { estado: 'recibido', fuente, mensajeEn: en, recibidoEn: en, ...p });
const cinco = (viajeId: string, hechos: Partial<Record<HitoFila['tipo'], NonNullable<HitoFila['fuente']>>>) =>
  (['llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso'] as const).map((t) => (hechos[t] ? reportado(viajeId, t, hechos[t]!) : hito(viajeId, t)));

describe('constancia de reportes por operador (T-A5-67)', () => {
  it('operador con todos los hitos reportados -> completo, sin faltantes', () => {
    const c = armarConstancia({
      tenantId: T1, periodo: PERIODO, viajes: [viaje('1', 'a')],
      hitos: cinco('1', { llegada_carga: 'boton', salida_carga: 'boton', llegada_descarga: 'ubicacion', salida_descarga: 'boton', regreso: 'boton' }),
    });
    expect(c.vacio).toBe(false);
    expect(c.operadores).toHaveLength(1);
    const o = c.operadores[0];
    expect(o).toMatchObject({ operadorId: 'a', esperados: 5, reportados: 5, faltantes: 0, pendientes: 0, estado: 'completo' });
    expect(o.faltantesLista).toEqual([]);
    expect(o.reportes).toHaveLength(5);
  });

  it('con faltantes -> la lista dice cuáles hitos de qué viaje no se reportaron', () => {
    const c = armarConstancia({
      tenantId: T1, periodo: PERIODO, viajes: [viaje('1', 'a')],
      hitos: cinco('1', { llegada_carga: 'boton', salida_carga: 'boton' }),
    });
    const o = c.operadores[0];
    expect(o).toMatchObject({ esperados: 5, reportados: 2, faltantes: 3, estado: 'con_faltantes' });
    expect(o.faltantesLista.map((f) => f.tipo)).toEqual(['llegada_descarga', 'salida_descarga', 'regreso']);
    expect(o.faltantesLista[0]).toMatchObject({ folio: 'F-1', viajeId: '1' });
  });

  it('el origen se rotula: botón, GPS (ubicación del chofer o geocerca validada por GPS), texto, foto', () => {
    const c = armarConstancia({
      tenantId: T1, periodo: PERIODO, viajes: [viaje('1', 'a')],
      hitos: [
        reportado('1', 'llegada_carga', 'boton'),
        reportado('1', 'salida_carga', 'ubicacion'),
        reportado('1', 'llegada_descarga', 'sistema', undefined, { validadoPor: 'gps', estado: 'validado', validadoEn: '2026-10-03T15:31:00.000Z' }),
        reportado('1', 'salida_descarga', 'texto'),
        reportado('1', 'regreso', 'foto'),
      ],
    });
    expect(c.operadores[0].reportes.map((r) => r.origen)).toEqual(['botón', 'GPS', 'GPS', 'texto', 'foto']);
  });

  it('hito de un viaje que sigue abierto y aún no se reporta -> pendiente, NO faltante', () => {
    const c = armarConstancia({
      tenantId: T1, periodo: PERIODO, viajes: [viaje('1', 'a', { estatus: 'abierto' })],
      hitos: cinco('1', { llegada_carga: 'boton' }),
    });
    const o = c.operadores[0];
    expect(o).toMatchObject({ reportados: 1, pendientes: 4, faltantes: 0, estado: 'en_curso' });
  });

  it('los hitos omitidos (perfil, inferidos) no son esperados ni faltantes; se cuentan aparte', () => {
    const c = armarConstancia({
      tenantId: T1, periodo: PERIODO, viajes: [viaje('1', 'a')],
      hitos: [
        reportado('1', 'salida_carga', 'boton'),
        hito('1', 'llegada_carga', { estado: 'omitido', omitidoMotivo: 'fuera_de_perfil' }),
        hito('1', 'regreso', { estado: 'omitido', omitidoMotivo: 'inferido_por_salida_carga' }),
      ],
    });
    expect(c.operadores[0]).toMatchObject({ esperados: 1, reportados: 1, faltantes: 0, omitidos: 2, estado: 'completo' });
  });

  it('un viaje cuyos hitos están todos omitidos no inventa un «completo»: sin dato', () => {
    const c = armarConstancia({
      tenantId: T1, periodo: PERIODO, viajes: [viaje('1', 'a')],
      hitos: [hito('1', 'llegada_carga', { estado: 'omitido', omitidoMotivo: 'fuera_de_perfil' })],
    });
    expect(c.operadores[0]).toMatchObject({ esperados: 0, estado: 'sin_dato' });
  });

  it('periodo vacío -> estado vacío honesto (sin operadores, vacio=true, CSV solo con encabezado)', () => {
    const c = armarConstancia({ tenantId: T1, periodo: PERIODO, viajes: [], hitos: [] });
    expect(c.vacio).toBe(true);
    expect(c.operadores).toEqual([]);
    const csv = csvConstancia(c);
    expect(csv).toBe(`﻿${COLUMNAS_CSV_CONSTANCIA.join(',')}\n`);
  });

  it('viajes fuera del periodo no cuentan', () => {
    const c = armarConstancia({
      tenantId: T1, periodo: PERIODO,
      viajes: [viaje('1', 'a', { creadoEn: '2026-09-20T12:00:00.000Z' }), viaje('2', 'a', { creadoEn: '2026-10-08T06:00:00.000Z' })],
      hitos: [...cinco('1', { salida_carga: 'boton' }), ...cinco('2', { salida_carga: 'boton' })],
    });
    expect(c.vacio).toBe(true);
  });

  it('otro tenant -> 0 filas: sus hitos no entran aunque el viaje coincida', () => {
    const c = armarConstancia({
      tenantId: T1, periodo: PERIODO, viajes: [viaje('1', 'a')],
      hitos: cinco('1', { llegada_carga: 'boton', salida_carga: 'boton' }).map((h) => ({ ...h, tenantId: 't2' })),
    });
    expect(c.vacio).toBe(true);
    expect(c.operadores).toEqual([]);
  });

  it('agrupa por operador y suma sus viajes; ordena por nombre', () => {
    const c = armarConstancia({
      tenantId: T1, periodo: PERIODO,
      viajes: [viaje('1', 'b', { operadorNombre: 'Zeta' }), viaje('2', 'a', { operadorNombre: 'Alfa' }), viaje('3', 'a', { operadorNombre: 'Alfa' })],
      hitos: [...cinco('1', { salida_carga: 'boton' }), ...cinco('2', { salida_carga: 'boton' }), ...cinco('3', { salida_carga: 'boton' })],
    });
    expect(c.operadores.map((o) => [o.operadorNombre, o.viajes])).toEqual([['Alfa', 2], ['Zeta', 1]]);
    expect(c.operadores[0].esperados).toBe(10);
  });

  it('no calcula ni interpreta el bono: la constancia no trae ninguna cifra de dinero ni veredicto', () => {
    const c = armarConstancia({ tenantId: T1, periodo: PERIODO, viajes: [viaje('1', 'a')], hitos: cinco('1', { salida_carga: 'boton' }) });
    const texto = JSON.stringify(c) + csvConstancia(c);
    expect(texto).not.toMatch(/bono|monto|pierde|gana|\$/i);
  });

  it('CSV: una fila por hito esperado (reportado, faltante o pendiente), hora del Centro de México, sin teléfono y con fórmulas neutralizadas', () => {
    const c = armarConstancia({
      tenantId: T1, periodo: PERIODO,
      viajes: [viaje('1', 'a', { operadorNombre: '=CMD()', estatus: 'liquidado' }), viaje('2', 'a', { operadorNombre: '=CMD()', estatus: 'abierto' })],
      hitos: [
        reportado('1', 'llegada_carga', 'boton', '2026-10-03T15:30:00.000Z'),
        hito('1', 'salida_carga'),
        hito('2', 'llegada_carga'),
      ],
    });
    const lineas = csvConstancia(c).replace(/^﻿/, '').trimEnd().split('\n');
    expect(lineas[0]).toBe(COLUMNAS_CSV_CONSTANCIA.join(','));
    expect(lineas).toHaveLength(4);
    expect(lineas[1]).toContain("'=CMD()");
    expect(lineas[1]).toContain('F-1');
    expect(lineas[1]).toContain('reportado');
    expect(lineas[1]).toContain('2026-10-03 09:30:00');
    expect(lineas[1]).toContain('botón');
    expect(lineas[2]).toContain('faltante');
    expect(lineas[3]).toContain('pendiente');
    expect(COLUMNAS_CSV_CONSTANCIA.join(',')).not.toMatch(/telefono|tel\b/i);
  });
});

describe('A37-S35-10: «completo» solo si lo reportó el operador; lo cubierto por oficina o sistema se cuenta aparte', () => {
  const geocerca = (v: string, t: HitoFila['tipo']) => reportado(v, t, 'sistema', undefined, { validadoPor: 'gps', estado: 'validado', validadoEn: '2026-10-03T15:31:00.000Z' });

  it('un operador que no escribió nada y cuyos 5 hitos cubrieron la geocerca y la oficina NO sale «completo»', () => {
    const c = armarConstancia({
      tenantId: T1, periodo: PERIODO, viajes: [viaje('1', 'a')],
      hitos: [
        geocerca('1', 'llegada_carga'), geocerca('1', 'salida_carga'), geocerca('1', 'llegada_descarga'),
        reportado('1', 'salida_descarga', 'oficina'), reportado('1', 'regreso', 'oficina'),
      ],
    });
    expect(c.operadores[0]).toMatchObject({
      esperados: 5, reportados: 5, faltantes: 0, pendientes: 0, reportadosPorOperador: 0, cubiertosPorOficinaOSistema: 5, estado: 'completo_con_apoyo',
    });
  });

  it('el operador que reportó todo (botón, texto, foto, ubicación compartida) sigue «completo»', () => {
    const c = armarConstancia({
      tenantId: T1, periodo: PERIODO, viajes: [viaje('1', 'a')],
      hitos: cinco('1', { llegada_carga: 'boton', salida_carga: 'texto', llegada_descarga: 'foto', salida_descarga: 'ubicacion', regreso: 'boton' }),
    });
    expect(c.operadores[0]).toMatchObject({ reportadosPorOperador: 5, cubiertosPorOficinaOSistema: 0, estado: 'completo' });
  });

  it('con faltantes manda «con_faltantes» aunque también haya apoyo de oficina', () => {
    const c = armarConstancia({
      tenantId: T1, periodo: PERIODO, viajes: [viaje('1', 'a')],
      hitos: cinco('1', { llegada_carga: 'oficina', salida_carga: 'boton' }),
    });
    expect(c.operadores[0]).toMatchObject({ reportadosPorOperador: 1, cubiertosPorOficinaOSistema: 1, estado: 'con_faltantes' });
  });

  it('el CSV dice quién reportó cada hito (operador u oficina/sistema)', () => {
    const c = armarConstancia({
      tenantId: T1, periodo: PERIODO, viajes: [viaje('1', 'a')],
      hitos: cinco('1', { llegada_carga: 'boton', salida_carga: 'oficina' }),
    });
    expect(COLUMNAS_CSV_CONSTANCIA).toContain('quien_reporto');
    const filas = csvConstancia(c).trim().split('\n').slice(1).map((l) => l.split(','));
    const col = COLUMNAS_CSV_CONSTANCIA.indexOf('quien_reporto');
    expect(filas.filter((f) => f[3] === 'reportado').map((f) => f[col])).toEqual(['operador', 'oficina_o_sistema']);
    expect(filas.filter((f) => f[3] === 'faltante').every((f) => f[col] === '')).toBe(true);
  });
});
