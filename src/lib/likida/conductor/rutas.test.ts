import { describe, it, expect } from 'vitest';
import {
  buscarRuta, fechaIsoValida, hoyDeLaFlota, motivoUrlInvalida, normalizarClaveRuta, parsearCsvRutas, planificarRutas, rutaVigente,
  type RutaAutorizada, type RutaExistente,
} from './rutas';

const OK = 'https://maps.app.goo.gl/EjemploSintetico1';
const OK2 = 'https://www.google.com/maps/dir/Origen+Demo/Destino+Demo';

describe('motivoUrlInvalida (https y dominio de mapas)', () => {
  it('acepta maps.app.goo.gl y google.com/maps (con o sin www, con ruta o consulta)', () => {
    for (const u of [OK, OK2, 'https://google.com/maps', 'https://google.com/maps?q=demo', 'https://www.google.com/maps/@20.1,-99.2,12z']) {
      expect(motivoUrlInvalida(u), u).toBeNull();
    }
  });
  it('rechaza http, otros esquemas y links sin esquema', () => {
    expect(motivoUrlInvalida('http://maps.app.goo.gl/abc')).toMatch(/https/);
    expect(motivoUrlInvalida('HTTP://maps.app.goo.gl/abc')).toMatch(/https/);
    expect(motivoUrlInvalida('ftp://maps.app.goo.gl/abc')).toMatch(/https/);
    expect(motivoUrlInvalida('javascript:alert(1)')).toMatch(/https/);
    expect(motivoUrlInvalida('maps.app.goo.gl/abc')).toMatch(/https/);
  });
  it('rechaza otro dominio, incluidos los que imitan al permitido', () => {
    for (const u of [
      'https://example.com/maps', 'https://www.waze.com/ul?q=demo', 'https://maps.app.goo.gl.example.com/abc',
      'https://google.com.example.com/maps', 'https://maps.app.goo.gl@example.com/abc', 'https://www.google.com@example.com/maps',
      'https://google.com/mapsx', 'https://google.com/search?q=maps', 'https://maps.app.goo.gl/', 'https://goo.gl/abc',
      'https://maps.app.goo.gl:8443/abc', 'https://evil.com/?u=https://maps.app.goo.gl/abc',
    ]) {
      expect(motivoUrlInvalida(u), u).toMatch(/Google Maps/);
    }
  });
  it('rechaza vacía, con espacios o demasiado larga', () => {
    expect(motivoUrlInvalida('')).toMatch(/Falta/);
    expect(motivoUrlInvalida('https://maps.app.goo.gl/a b')).toMatch(/espacios/);
    expect(motivoUrlInvalida(`https://maps.app.goo.gl/${'a'.repeat(2100)}`)).toMatch(/2048/);
  });
});

describe('fechas y vigencia (zona America/Mexico_City)', () => {
  it('fechaIsoValida pide una fecha real', () => {
    expect(fechaIsoValida('2026-12-31')).toBe(true);
    expect(fechaIsoValida('2026-02-30')).toBe(false);
    expect(fechaIsoValida('2026-13-01')).toBe(false);
    expect(fechaIsoValida('31/12/2026')).toBe(false);
    expect(fechaIsoValida('2026-1-5')).toBe(false);
  });
  it('hoyDeLaFlota usa el día de México, no el del servidor (02:00 UTC del 17 = 20:00 del 16 en CDMX)', () => {
    expect(hoyDeLaFlota(new Date('2026-10-17T02:00:00Z'))).toBe('2026-10-16');
    expect(hoyDeLaFlota(new Date('2026-10-17T07:00:00Z'))).toBe('2026-10-17');
  });
  it('vigente: sin vencimiento sí; vence hoy sí (inclusive); vencida ayer no', () => {
    expect(rutaVigente({ vigenteHasta: null }, '2026-10-16')).toBe(true);
    expect(rutaVigente({ vigenteHasta: '2026-10-16' }, '2026-10-16')).toBe(true);
    expect(rutaVigente({ vigenteHasta: '2026-10-15' }, '2026-10-16')).toBe(false);
  });
});

describe('parsearCsvRutas', () => {
  const CAB = 'corredor,sitio_origen,sitio_destino,url,vigente_hasta,revisada_en';
  it('lee filas válidas y normaliza corredor y sitios (minúsculas, sin acentos)', () => {
    const r = parsearCsvRutas(`${CAB}\nMonterrey Norte,PL-DEMO,,${OK},2027-01-31,2026-10-01\nNuevo Laredo,,,${OK2},,\n`);
    expect(r.errores).toEqual([]);
    expect(r.filas).toEqual([
      { linea: 2, corredor: 'monterrey norte', sitioOrigen: 'pl-demo', sitioDestino: null, url: OK, vigenteHasta: '2027-01-31', revisadaEn: '2026-10-01' },
      { linea: 3, corredor: 'nuevo laredo', sitioOrigen: null, sitioDestino: null, url: OK2, vigenteHasta: null, revisadaEn: null },
    ]);
  });
  it('acepta punto y coma, comillas y cabecera con alias y acentos', () => {
    const r = parsearCsvRutas(`Corredor;Origen;Destino;Enlace\n"Laredo; norte";PL-1;PL-2;${OK}\n`);
    expect(r.errores).toEqual([]);
    expect(r.filas[0]).toMatchObject({ corredor: 'laredo; norte', sitioOrigen: 'pl-1', sitioDestino: 'pl-2', vigenteHasta: undefined, revisadaEn: undefined });
  });
  it('URL inválida, otro dominio y esquema http se rechazan por fila y el resto pasa', () => {
    const r = parsearCsvRutas(`${CAB}\nA,,,not-a-url,,\nB,,,https://example.com/maps,,\nC,,,http://maps.app.goo.gl/x,,\nD,,,${OK},,\n`);
    expect(r.filas.map((f) => f.corredor)).toEqual(['d']);
    expect(r.errores.map((e) => e.linea)).toEqual([2, 3, 4]);
    expect(r.errores[1].mensaje).toMatch(/Google Maps/);
    expect(r.errores[2].mensaje).toMatch(/https/);
  });
  it('rechaza corredor vacío, fechas imposibles y combinaciones repetidas', () => {
    const r = parsearCsvRutas(`${CAB}\n,,,${OK},,\nA,,,${OK},2026-02-30,\nB,,,${OK},,2026-99-01\nC,,,${OK},,\nc ,,,${OK2},,\n`);
    expect(r.filas.map((f) => f.corredor)).toEqual(['c']);
    expect(r.errores.map((e) => e.linea)).toEqual([2, 3, 4, 6]);
    expect(r.errores[3].mensaje).toMatch(/línea 5/);
  });
  it('errores del archivo entero: vacío, sin columnas obligatorias, sin filas, demasiadas filas', () => {
    expect(parsearCsvRutas('').errores[0].mensaje).toMatch(/vacío/);
    expect(parsearCsvRutas('corredor,sitio_origen\nA,B\n').errores[0].mensaje).toMatch(/«url»/);
    expect(parsearCsvRutas('url,sitio_origen\nx,y\n').errores[0].mensaje).toMatch(/«corredor»/);
    expect(parsearCsvRutas(`${CAB}\n`).errores[0].mensaje).toMatch(/no trae filas/);
    const muchas = `${CAB}\n${Array.from({ length: 2001 }, (_, i) => `c${i},,,${OK},,`).join('\n')}`;
    expect(parsearCsvRutas(muchas).errores[0].mensaje).toMatch(/máximo/);
  });
});

describe('planificarRutas (idempotencia)', () => {
  const existente = (extra: Partial<RutaExistente> = {}): RutaExistente => ({
    id: 'r1', corredor: 'monterrey', sitioOrigen: 'pl-1', sitioDestino: null, url: OK, vigenteHasta: '2027-01-31', revisadaEn: '2026-10-01', ...extra,
  });
  const fila = (extra: Record<string, unknown> = {}) => ({
    linea: 2, corredor: 'monterrey', sitioOrigen: 'pl-1', sitioDestino: null, url: OK, vigenteHasta: '2027-01-31', revisadaEn: '2026-10-01', ...extra,
  }) as Parameters<typeof planificarRutas>[0][number];

  it('reimportar lo mismo = 0 nuevas y 0 cambios', () => {
    expect(planificarRutas([fila()], [existente()])).toEqual({ nuevas: [], cambios: [], sinCambios: 1 });
  });
  it('una fila nueva se inserta; una con otra URL o fecha actualiza la existente', () => {
    const p = planificarRutas([fila({ corredor: 'laredo' }), fila({ url: OK2 }), fila({ vigenteHasta: null })], [existente()]);
    expect(p.nuevas).toHaveLength(1);
    expect(p.nuevas[0]).toMatchObject({ corredor: 'laredo', vigenteHasta: '2027-01-31' });
    expect(p.cambios).toEqual([{ id: 'r1', url: OK2, vigenteHasta: '2027-01-31', revisadaEn: '2026-10-01' }, { id: 'r1', url: OK, vigenteHasta: null, revisadaEn: '2026-10-01' }]);
  });
  it('si el archivo no trae la columna de fechas, lo guardado no se toca; si la trae vacía, se borra', () => {
    expect(planificarRutas([fila({ vigenteHasta: undefined, revisadaEn: undefined })], [existente()])).toEqual({ nuevas: [], cambios: [], sinCambios: 1 });
    expect(planificarRutas([fila({ revisadaEn: null })], [existente()]).cambios).toEqual([{ id: 'r1', url: OK, vigenteHasta: '2027-01-31', revisadaEn: null }]);
  });
  it('la llave es corredor + origen + destino: mismo corredor con otro destino es otra ruta', () => {
    const p = planificarRutas([fila({ sitioDestino: 'pl-9' })], [existente()]);
    expect(p.nuevas).toHaveLength(1);
    expect(p.sinCambios).toBe(0);
  });
});

describe('buscarRuta', () => {
  const r = (extra: Partial<RutaAutorizada>): RutaAutorizada => ({
    corredor: 'monterrey', sitioOrigen: null, sitioDestino: null, url: OK, vigenteHasta: null, revisadaEn: null, ...extra,
  });
  const HOY = '2026-10-16';

  it('impo: gana la ruta del sitio de origen sobre la del corredor', () => {
    const rutas = [r({ url: 'https://maps.app.goo.gl/corredor' }), r({ sitioOrigen: 'pl-1', url: 'https://maps.app.goo.gl/origen' })];
    expect(buscarRuta(rutas, { corredor: 'Monterrey', sitioOrigen: 'PL-1' }, HOY)?.url).toBe('https://maps.app.goo.gl/origen');
  });
  it('expo: se busca la de origen y la de destino por separado', () => {
    const rutas = [r({ sitioOrigen: 'pl-1', url: 'https://maps.app.goo.gl/o' }), r({ sitioDestino: 'pl-2', url: 'https://maps.app.goo.gl/d' })];
    expect(buscarRuta(rutas, { corredor: 'monterrey', sitioOrigen: 'pl-1' }, HOY)?.url).toBe('https://maps.app.goo.gl/o');
    expect(buscarRuta(rutas, { corredor: 'monterrey', sitioDestino: 'pl-2' }, HOY)?.url).toBe('https://maps.app.goo.gl/d');
  });
  it('cae a la del corredor completo si no hay del sitio, y a null si no hay nada', () => {
    expect(buscarRuta([r({ url: 'https://maps.app.goo.gl/c' })], { corredor: 'monterrey', sitioOrigen: 'otro' }, HOY)?.url).toBe('https://maps.app.goo.gl/c');
    expect(buscarRuta([r({ sitioOrigen: 'pl-1' })], { corredor: 'monterrey', sitioOrigen: 'otro' }, HOY)).toBeNull();
    expect(buscarRuta([r({})], { corredor: 'laredo' }, HOY)).toBeNull();
    expect(buscarRuta([r({})], { corredor: '' }, HOY)).toBeNull();
    expect(buscarRuta([], { corredor: 'monterrey' }, HOY)).toBeNull();
  });
  it('una ruta vencida se trata como ausente (aunque sea la más específica), y la que vence hoy sirve', () => {
    const vencida = r({ sitioOrigen: 'pl-1', vigenteHasta: '2026-10-15', url: 'https://maps.app.goo.gl/vieja' });
    const corredor = r({ url: 'https://maps.app.goo.gl/c' });
    expect(buscarRuta([vencida, corredor], { corredor: 'monterrey', sitioOrigen: 'pl-1' }, HOY)?.url).toBe('https://maps.app.goo.gl/c');
    expect(buscarRuta([vencida], { corredor: 'monterrey', sitioOrigen: 'pl-1' }, HOY)).toBeNull();
    expect(buscarRuta([{ ...vencida, vigenteHasta: HOY }], { corredor: 'monterrey', sitioOrigen: 'pl-1' }, HOY)).not.toBeNull();
  });
  it('normalizarClaveRuta quita acentos y espacios de más', () => {
    expect(normalizarClaveRuta('  Querétaro   Norte ')).toBe('queretaro norte');
  });
});
