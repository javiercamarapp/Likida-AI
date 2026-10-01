import { describe, expect, it } from 'vitest';
import { MAX_FILAS_SITIOS, parsearCsvSitios, PLANTILLA_CSV_SITIOS } from './sitios';

const CAB = 'codigo,nombre,tipo,lat,lng,radio_m,direccion,cliente,padre';

describe('parsearCsvSitios', () => {
  it('importa filas válidas (cliente, planta y andén con padre)', () => {
    const r = parsearCsvSitios([
      CAB,
      'CL-1,CEDIS Monterrey,cliente,25.6866,-100.3161,400,Av. Industrial 5,Cliente A,',
      'CL-1-A1,CEDIS Monterrey andén 1,andén,25.6867,-100.3162,60,,,CL-1',
    ].join('\n'));
    expect(r.errores).toEqual([]);
    expect(r.filas).toHaveLength(2);
    expect(r.filas[0]).toMatchObject({ codigo: 'CL-1', tipo: 'cliente', lat: 25.6866, lng: -100.3161, radio_m: 400, cliente: 'Cliente A', padre: null });
    expect(r.filas[1]).toMatchObject({ tipo: 'anden', padre: 'CL-1', linea: 3 });
  });

  it('NO inventa coordenadas: sin lat/lng la fila es error, aunque traiga dirección', () => {
    const r = parsearCsvSitios(`${CAB}\nP1,Planta,planta,,,300,Calle 1 Zapopan,,`);
    expect(r.filas).toEqual([]);
    expect(r.errores[0]).toMatchObject({ linea: 2 });
    expect(r.errores[0].mensaje).toMatch(/No se calculan a partir de la dirección/);
  });

  it('la plantilla descargable NO se puede importar tal cual (trae las coordenadas en blanco a propósito)', () => {
    const r = parsearCsvSitios(PLANTILLA_CSV_SITIOS);
    expect(r.filas).toEqual([]);
    expect(r.errores.length).toBe(2);
  });

  it('rechaza (no corrige) lat/lng intercambiadas y la longitud sin signo', () => {
    const a = parsearCsvSitios(`${CAB}\nP1,Planta,planta,-103.39,20.72,300,,,`);
    expect(a.errores[0].mensaje).toMatch(/intercambiadas/);
    const b = parsearCsvSitios(`${CAB}\nP1,Planta,planta,20.72,103.39,300,,,`);
    expect(b.errores[0].mensaje).toMatch(/signo de la longitud/);
    expect(a.filas).toEqual([]);
    expect(b.filas).toEqual([]);
  });

  it('rechaza coordenadas fuera de rango y de México', () => {
    expect(parsearCsvSitios(`${CAB}\nP1,Planta,planta,95,-103,300,,,`).errores[0].mensaje).toMatch(/fuera del rango/);
    expect(parsearCsvSitios(`${CAB}\nP1,Planta,planta,40.4,-3.7,300,,,`).errores[0].mensaje).toMatch(/fuera de México/);
  });

  it('el radio se exige: del archivo o declarado por quien importa', () => {
    const sin = `codigo,nombre,tipo,lat,lng\nP1,Planta,planta,20.72,-103.39`;
    expect(parsearCsvSitios(sin).errores[0].mensaje).toMatch(/radio_m/);
    const con = parsearCsvSitios(sin, { radioPorDefectoM: 200 });
    expect(con.errores).toEqual([]);
    expect(con.filas[0].radio_m).toBe(200);
  });

  it('el radio del archivo manda sobre el declarado, y se valida el rango (25 a 100,000 m)', () => {
    const r = parsearCsvSitios(`${CAB}\nP1,Planta,planta,20.72,-103.39,10,,,\nP2,Otra,planta,20.73,-103.39,150000,,,\nP3,Buena,planta,20.74,-103.39,80,,,`, { radioPorDefectoM: 200 });
    expect(r.errores.map((e) => e.linea)).toEqual([2, 3]);
    expect(r.filas.map((f) => f.radio_m)).toEqual([80]);
  });

  it('radio no entero o no numérico es error', () => {
    expect(parsearCsvSitios(`${CAB}\nP1,Planta,planta,20.72,-103.39,12.5,,,`).errores).toHaveLength(1);
    expect(parsearCsvSitios(`${CAB}\nP1,Planta,planta,20.72,-103.39,mucho,,,`).errores).toHaveLength(1);
  });

  it('acepta punto y coma con decimal en coma (CSV de Excel en español)', () => {
    const r = parsearCsvSitios('codigo;nombre;tipo;lat;lng;radio_m\nP1;Planta Norte;planta;25,6866;-100,3161;300');
    expect(r.errores).toEqual([]);
    expect(r.filas[0]).toMatchObject({ lat: 25.6866, lng: -100.3161 });
  });

  it('con coma como separador, el decimal en coma NO se adivina (es error, no un número distinto)', () => {
    const r = parsearCsvSitios(`${CAB}\nP1,Planta,planta,"25,6866","-100,3161",300,,,`);
    expect(r.filas).toEqual([]);
    expect(r.errores).toHaveLength(1);
  });

  it('acepta tabulador, BOM y saltos \\r\\n', () => {
    const r = parsearCsvSitios('﻿codigo\tnombre\ttipo\tlat\tlng\tradio_m\r\nP1\tPlanta\tplanta\t20.72\t-103.39\t300\r\n');
    expect(r.errores).toEqual([]);
    expect(r.filas).toHaveLength(1);
  });

  it('respeta campos entre comillas con comas y comillas escapadas', () => {
    const r = parsearCsvSitios(`${CAB}\nP1,"Planta ""Norte"", S.A.",planta,20.72,-103.39,300,"Calle 1, Col. Centro",,`);
    expect(r.errores).toEqual([]);
    expect(r.filas[0].nombre).toBe('Planta "Norte", S.A.');
    expect(r.filas[0].direccion).toBe('Calle 1, Col. Centro');
  });

  it('las cabeceras se reconocen sin acentos ni mayúsculas y con alias', () => {
    const r = parsearCsvSitios('Código,Nombre,Tipo,Latitud,Longitud,Radio\nP1,Planta,PLANTA,20.72,-103.39,300');
    expect(r.errores).toEqual([]);
    expect(r.filas).toHaveLength(1);
  });

  it('falta de columnas obligatorias: error de cabecera, sin procesar filas', () => {
    const r = parsearCsvSitios('nombre,tipo\nPlanta,planta');
    expect(r.filas).toEqual([]);
    expect(r.errores.map((e) => e.linea)).toEqual([1, 1, 1, 1]);
  });

  it('duplicados dentro del archivo: código y nombre, apuntando a la línea previa', () => {
    const r = parsearCsvSitios([CAB,
      'P1,Planta A,planta,20.72,-103.39,300,,,',
      'p1,Planta B,planta,20.73,-103.39,300,,,',
      'P3,planta a,planta,20.74,-103.39,300,,,'].join('\n'));
    expect(r.filas).toHaveLength(1);
    expect(r.errores[0].mensaje).toMatch(/línea 2/);
    expect(r.errores[1].mensaje).toMatch(/línea 2/);
  });

  it('tipo inválido, código/nombre vacío o demasiado largo', () => {
    const r = parsearCsvSitios([CAB,
      'P1,Planta,bodega,20.72,-103.39,300,,,',
      ',Sin código,planta,20.72,-103.39,300,,,',
      `P3,${'x'.repeat(121)},planta,20.72,-103.39,300,,,`].join('\n'));
    expect(r.filas).toEqual([]);
    expect(r.errores.map((e) => e.linea)).toEqual([2, 3, 4]);
  });

  it('un sitio no es su propio padre, y los ciclos de padres se rechazan', () => {
    const solo = parsearCsvSitios(`${CAB}\nP1,Planta,planta,20.72,-103.39,300,,,P1`);
    expect(solo.errores[0].mensaje).toMatch(/propio padre/);
    const ciclo = parsearCsvSitios([CAB,
      'A,Sitio A,planta,20.72,-103.39,300,,,B',
      'B,Sitio B,anden,20.73,-103.39,300,,,A'].join('\n'));
    expect(ciclo.errores.some((e) => /ciclo/.test(e.mensaje))).toBe(true);
  });

  it('archivo vacío, sin filas o demasiado grande', () => {
    expect(parsearCsvSitios('   ').errores[0].mensaje).toMatch(/vacío/);
    expect(parsearCsvSitios(CAB).errores[0].mensaje).toMatch(/no trae filas/);
    const filas = Array.from({ length: MAX_FILAS_SITIOS + 1 }, (_, i) => `P${i},Planta ${i},planta,20.7,-103.4,300,,,`);
    expect(parsearCsvSitios([CAB, ...filas].join('\n')).errores[0].mensaje).toMatch(/máximo/);
    expect(parsearCsvSitios(`${CAB}\n${'x'.repeat(1_000_001)}`).errores[0].mensaje).toMatch(/1 MB/);
  });

  it('hostil: fórmulas de hoja de cálculo y HTML se conservan como texto inerte (no se ejecutan ni se interpretan)', () => {
    const r = parsearCsvSitios(`${CAB}\nP1,"=HYPERLINK(""http://x"")<script>alert(1)</script>",planta,20.72,-103.39,300,,,`);
    expect(r.errores).toEqual([]);
    expect(r.filas[0].nombre).toContain('<script>');
  });

  it('las filas en blanco intercaladas se ignoran y la numeración de línea es la del archivo', () => {
    const r = parsearCsvSitios(`${CAB}\n\nP1,Planta,planta,20.72,-103.39,300,,,\n,,,,,,,,\nP2,Otra,planta,bad,-103.39,300,,,`);
    expect(r.filas.map((f) => f.linea)).toEqual([3]);
    expect(r.errores.map((e) => e.linea)).toEqual([5]);
  });
});
