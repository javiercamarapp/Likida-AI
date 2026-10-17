/* eslint-disable security/detect-non-literal-fs-filename -- solo pruebas: leen fixtures del propio directorio por URL relativa a este archivo, nunca por entrada de usuario. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Http } from '../tipos';
import { AVISO_SOLO_EVENTOS, evaluarContinuidad, latenciaAgregada, latenciaSegundos, percentil95, resumirTablaCombinada } from './calidad';
import { probarTablaPropia } from './conector';
import { leerConfigTablaPropia } from './config';
import { leerPosicionesCsv } from './csv';
import { registrosAPosiciones } from './filas';

// T-A5-15: tabla GPS «combinada» (posición + punto de interés + fecha de recibido). Todo SINTÉTICO.
const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
// 2026-10-20 08:00 hora de CDMX (sin horario de verano en esa fecha) = 14:00Z
const AHORA = Date.parse('2026-10-20T14:00:00.000Z');
const CONTINUA = fx('combinada_sintetica.csv');

/** 5 unidades que reportan UN evento por hora (en minutos distintos), una hora antes y la de ahora. */
const SOLO_EVENTOS = ['unidad,lat,lon,fecha_hora,fecha_recibida,punto_interes']
  .concat(['UN-1', 'UN-2', 'UN-3', 'UN-4', 'UN-5'].flatMap((u, i) => [
    `${u},25.5${i},-100.9,2026-10-20 06:${10 + i * 5},2026-10-20 06:${10 + i * 5}:40,SITIO-X`,
    `${u},25.5${i},-100.8,2026-10-20 07:${10 + i * 5},2026-10-20 07:${10 + i * 5}:40,SITIO-Y`,
  ]).map((l) => l.replace(/(\d{2}:\d{2}),/, '$1:00,')))
  .join('\n');

describe('lectura del mapeo combinado', () => {
  const r = leerPosicionesCsv(CONTINUA);
  it('entiende fecha_recibida y punto_interes sin rechazar nada', () => {
    expect(r.rechazadas).toEqual([]);
    expect(r.filas).toHaveLength(180);
    expect(r.filas[0]).toMatchObject({ unidad: 'UN-101', fechaRecibidaLocal: '2026-10-20 07:00:29', puntoInteres: 'SITIO-SINTETICO-A' });
    expect(r.filas[1]).not.toHaveProperty('puntoInteres');
  });
  it('sin esas columnas todo funciona como antes (llaves ausentes)', () => {
    const sin = leerPosicionesCsv(fx('posiciones.csv'));
    expect(sin.filas.length).toBeGreaterThan(0);
    expect(sin.filas.every((f) => !('fechaRecibidaLocal' in f) && !('puntoInteres' in f))).toBe(true);
  });
  it('un «recibido» ilegible NO rechaza la posición: la fila entra sin él', () => {
    const t = 'unidad,lat,lon,fecha_hora,fecha_recibida\nUN-1,25.78,-100.19,2026-10-20 07:00:00,ayer\n';
    const x = leerPosicionesCsv(t);
    expect(x.rechazadas).toEqual([]);
    expect(x.filas[0]).not.toHaveProperty('fechaRecibidaLocal');
  });
  it('el mapeo de endpoint y de columnas SQL aceptan las dos claves nuevas (y siguen siendo estrictos)', () => {
    const campos = { unidad: 'a', lat: 'b', lon: 'c', fecha_hora: 'd', fecha_recibida: 'e', punto_interes: 'f' };
    const ep = leerConfigTablaPropia({ modo: 'endpoint', base_url: 'https://x.ejemplo.com/p', mapeo_posiciones: JSON.stringify({ campos }) });
    expect(ep.ok).toBe(true);
    const mal = leerConfigTablaPropia({ modo: 'endpoint', base_url: 'https://x.ejemplo.com/p', mapeo_posiciones: JSON.stringify({ campos: { ...campos, otro: 'g' } }) });
    expect(mal.ok).toBe(false);
    const sql = leerConfigTablaPropia({
      modo: 'sql_solo_lectura', sql_host: 'replica.ejemplo.com', sql_base: 'flota', sql_usuario: 'lectura', sql_clave: 'x', vista: 'v_pos',
      columnas: JSON.stringify({ unidad: 'u', lat: 'la', lon: 'lo', fecha_hora: 'f', fecha_recibida: 'fr', punto_interes: 'pi' }),
    });
    expect(sql.ok).toBe(true);
  });
  it('desde un registro (SQL / endpoint) también se leen', () => {
    const x = registrosAPosiciones([{ unidad: 'UN-1', lat: '25.7', lon: '-100.3', fecha_hora: '2026-10-20 07:00:00', fecha_recibida: '2026-10-20 07:01:00', punto_interes: '  Sitio  ' }]);
    expect(x.filas[0]).toMatchObject({ fechaRecibidaLocal: '2026-10-20 07:01:00', puntoInteres: 'Sitio' });
  });
});

describe('latencia de la fuente', () => {
  it('p95 por rango más cercano', () => {
    expect(percentil95([])).toBeNull();
    expect(percentil95([5])).toBe(5);
    expect(percentil95(Array.from({ length: 20 }, (_, i) => i + 1))).toBe(19);
  });
  it('la tabla continua da latencias de 20 a 39 s, agregadas por día y sin columna por fila', () => {
    const l = latenciaAgregada(leerPosicionesCsv(CONTINUA).filas, 'America/Mexico_City');
    expect(l.muestras).toBe(180);
    expect(l.p95Segundos).toBeGreaterThanOrEqual(20);
    expect(l.p95Segundos).toBeLessThanOrEqual(39);
    expect(Object.keys(l.p95PorDia)).toEqual(['2026-10-20']);
    expect(l.p95PorDia['2026-10-20'].muestras).toBe(180);
    expect(l.recibidoAntesDeMedido).toBe(0);
  });
  it('un «recibido» anterior a la medida no entra al p95 y se cuenta aparte', () => {
    const l = latenciaAgregada([
      { unidad: 'U', lat: 1, lon: 1, fechaHoraLocal: '2026-10-20 07:00:00', velocidadKmh: null, ignicion: null, fechaRecibidaLocal: '2026-10-20 06:59:00' },
      { unidad: 'U', lat: 1, lon: 1, fechaHoraLocal: '2026-10-20 07:00:00', velocidadKmh: null, ignicion: null, fechaRecibidaLocal: '2026-10-20 07:00:10' },
    ], 'America/Mexico_City');
    expect(l).toMatchObject({ muestras: 1, p95Segundos: 10, recibidoAntesDeMedido: 1 });
  });
  it('zona America/Matamoros con la fecha a un día del cambio de hora (1-nov-2026) resta con el desfase REAL', () => {
    // El 1-nov-2026 a las 02:00 CDT los relojes vuelven a la 01:00 CST. Medido 00:50 CDT (05:50Z), recibido 02:10 CST (08:10Z):
    // 2 h 20 min reales (8,400 s); restar las horas de pared daría 80 min (4,800 s).
    const f = { fechaHoraLocal: '2026-11-01 00:50:00', fechaRecibidaLocal: '2026-11-01 02:10:00' };
    expect(latenciaSegundos(f, 'America/Matamoros')).toBe(8_400);
    // La víspera, sin cambio de por medio, la hora de pared y la real coinciden.
    expect(latenciaSegundos({ fechaHoraLocal: '2026-10-31 23:30:00', fechaRecibidaLocal: '2026-10-31 23:55:00' }, 'America/Matamoros')).toBe(1_500);
    // Y leído de un CSV, el cambio de hora no tumba la fila.
    const t = 'unidad,lat,lon,fecha_hora,fecha_recibida\nUN-1,25.87,-97.50,2026-11-01 00:50:00,2026-11-01 02:10:00\n';
    const x = leerPosicionesCsv(t, { zona: 'America/Matamoros' });
    expect(x.rechazadas).toEqual([]);
    expect(latenciaAgregada(x.filas, 'America/Matamoros').p95Segundos).toBe(8_400);
  });
});

describe('chequeo de continuidad (posiciones vs solo eventos)', () => {
  it('1 punto por minuto → OK, sin aviso', () => {
    const c = evaluarContinuidad(leerPosicionesCsv(CONTINUA).filas, 'America/Mexico_City', AHORA);
    expect(c).toMatchObject({ suficiente: true, unidadesEnTransito: 3, conPosicionesSuficientes: 3, porcentaje: 100, aviso: null });
  });
  it('1 evento por hora → emite el aviso de «solo eventos» con el texto exacto', () => {
    const filas = leerPosicionesCsv(SOLO_EVENTOS).filas;
    expect(filas).toHaveLength(10);
    const c = evaluarContinuidad(filas, 'America/Mexico_City', AHORA);
    expect(c).toMatchObject({ suficiente: true, unidadesEnTransito: 5, conPosicionesSuficientes: 0, porcentaje: 0 });
    expect(c.aviso).toBe('La tabla parece traer solo eventos, no posiciones continuas: la detección por geocerca y la señal de vida no son confiables.');
    expect(c.aviso).toBe(AVISO_SOLO_EVENTOS);
  });
  it('el umbral es configurable y con pocas unidades no se opina', () => {
    const filas = leerPosicionesCsv(SOLO_EVENTOS).filas;
    expect(evaluarContinuidad(filas, 'America/Mexico_City', AHORA, { umbrales: { porcentajeMinimo: 0 } }).aviso).toBeNull();
    const pocas = leerPosicionesCsv(SOLO_EVENTOS).filas.filter((f) => ['UN-1', 'UN-2'].includes(f.unidad));
    expect(evaluarContinuidad(pocas, 'America/Mexico_City', AHORA)).toMatchObject({ suficiente: false, porcentaje: null, aviso: null });
  });
  it('una unidad en tránsito SIN posiciones cuenta como falla (lista dada por quien llama)', () => {
    const filas = leerPosicionesCsv(CONTINUA).filas;
    const c = evaluarContinuidad(filas, 'America/Mexico_City', AHORA, { unidadesEnTransito: ['UN-101', 'UN-102', 'UN-103', 'UN-104', 'UN-105'] });
    expect(c).toMatchObject({ unidadesEnTransito: 5, conPosicionesSuficientes: 3, porcentaje: 60 });
    expect(c.aviso).toBe(AVISO_SOLO_EVENTOS);
  });
  it('resumen: cuenta los puntos de interés y junta las frases', () => {
    const r = resumirTablaCombinada(leerPosicionesCsv(CONTINUA).filas, 'America/Mexico_City', AHORA);
    expect(r.conPuntoInteres).toBe(2);
    expect(r.frases[0]).toBe('2 posiciones con punto de interés.');
    expect(r.frases.join(' ')).toMatch(/Latencia de la fuente \(p95\): \d+ s\./);
    expect(r.frases).not.toContain(AVISO_SOLO_EVENTOS);
    expect(resumirTablaCombinada(leerPosicionesCsv(SOLO_EVENTOS).filas, 'America/Mexico_City', AHORA).frases).toContain(AVISO_SOLO_EVENTOS);
  });
});

describe('el aviso llega al estado del conector (la prueba de la pantalla de conexiones)', () => {
  const CFG = { modo: 'csv_sftp', base_url: 'https://datos.ejemplo.com/combinada.csv' };
  const httpCon = (cuerpo: string): Http => async () => ({ estado: 200, cuerpo, encabezados: {} });
  it('tabla de solo eventos: el detalle trae el aviso y el conteo', async () => {
    const r = await probarTablaPropia(CFG, httpCon(SOLO_EVENTOS), undefined, undefined, () => AHORA);
    expect(r.ok).toBe(true);
    expect(r.detalle).toContain(AVISO_SOLO_EVENTOS);
    expect(r.detalle).toContain('5 posición(es) válida(s)');
    expect(r.detalle).toContain('5 posiciones con punto de interés.');
  });
  it('tabla continua: sin aviso, con la latencia', async () => {
    const r = await probarTablaPropia(CFG, httpCon(CONTINUA), undefined, undefined, () => AHORA);
    expect(r.ok).toBe(true);
    expect(r.detalle).not.toContain('solo eventos');
    expect(r.detalle).toMatch(/Latencia de la fuente \(p95\)/);
  });
});
