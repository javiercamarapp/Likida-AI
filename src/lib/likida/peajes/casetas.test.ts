import { describe, it, expect } from 'vitest';
import { parsearCasetasMatriz, resolverCaseta, coordenadaDeCelda, validarCoordenadasMexico, type CasetaCatalogo } from './casetas';
import { matrizDeCsvTexto } from './csv';

// Casetas y coordenadas SINTÉTICAS (no son plazas reales; el catálogo real se carga por CSV).
const csv = (t: string) => matrizDeCsvTexto(t);

describe('coordenadaDeCelda / validarCoordenadasMexico', () => {
  it('acepta coma decimal y números', () => {
    expect(coordenadaDeCelda('19,4326')).toBe(19.4326);
    expect(coordenadaDeCelda(' -99.1332 ')).toBe(-99.1332);
    expect(coordenadaDeCelda(19.4)).toBe(19.4);
    expect(coordenadaDeCelda('19.4°')).toBeNull();
    expect(coordenadaDeCelda('')).toBeNull();
    expect(coordenadaDeCelda('abc')).toBeNull();
  });
  it('detecta lat/lng invertidas y puntos fuera de México', () => {
    expect(validarCoordenadasMexico(19.4, -99.1)).toBeNull();
    expect(validarCoordenadasMexico(-99.1, 19.4)).toMatch(/invertidas/);
    expect(validarCoordenadasMexico(40.7, -74)).toMatch(/fuera de México/);
    expect(validarCoordenadasMexico(0, 0)).toMatch(/fuera de México/);
  });
});

describe('parsearCasetasMatriz', () => {
  it('lee un CSV bueno con alias y radio', () => {
    const r = parsearCasetasMatriz(csv('nombre;lat;lng;radio_m;alias;fuente\nCaseta Ejemplo Norte;19,5;-99,2;350;Ej Norte|Norte Ej;captura propia\nCaseta Ejemplo Sur;19.0;-99.0;;;\n'));
    expect(r.error).toBeUndefined();
    expect(r.rechazadas).toEqual([]);
    expect(r.casetas[0]).toMatchObject({ nombre: 'Caseta Ejemplo Norte', nombreNorm: 'caseta ejemplo norte', lat: 19.5, lng: -99.2, radioM: 350, alias: ['Ej Norte', 'Norte Ej'], fuente: 'captura propia' });
    expect(r.casetas[1]).toMatchObject({ radioM: 300, alias: [], fuente: null });
  });
  it('sin columnas obligatorias dice cuáles y qué leyó', () => {
    const r = parsearCasetasMatriz(csv('caseta,latitud\nX,19.4\n'));
    expect(r.error).toMatch(/Faltan columnas: lng/);
    expect(r.error).toMatch(/«caseta», «latitud»/);
  });
  it('rechaza por fila, con su número y motivo, sin tumbar las buenas', () => {
    const r = parsearCasetasMatriz(csv([
      'nombre,lat,lng,radio_m',
      'Buena,19.5,-99.2,300', // fila 2
      ',19.5,-99.2,300', // fila 3: sin nombre
      'Invertida,-99.2,19.5,300', // fila 4
      'Gringa,40.7,-74.0,300', // fila 5
      'Ilegible,abc,-99,300', // fila 6
      'Radio chico,19.5,-99.2,10', // fila 7
      'Radio enorme,19.5,-99.2,99999', // fila 8
      'BUENA,19.6,-99.3,300', // fila 9: repetida (misma normalización)
      '"  Con   espacios ",19.5,-99.2,', // fila 10
    ].join('\n')));
    expect(r.casetas.map((c) => c.nombre)).toEqual(['Buena', 'Con espacios']);
    const por = Object.fromEntries(r.rechazadas.map((x) => [x.fila, x.motivo]));
    expect(por[3]).toMatch(/sin nombre/);
    expect(por[4]).toMatch(/invertidas/);
    expect(por[5]).toMatch(/fuera de México/);
    expect(por[6]).toMatch(/ilegible/);
    expect(por[7]).toMatch(/radio/);
    expect(por[8]).toMatch(/radio/);
    expect(por[9]).toMatch(/repetido.*fila 2/);
  });
  it('nombres de 121 caracteres y de puros signos se rechazan', () => {
    const r = parsearCasetasMatriz(csv(`nombre,lat,lng\n${'x'.repeat(121)},19.5,-99.2\n!!!,19.5,-99.2\n`));
    expect(r.casetas).toEqual([]);
    expect(r.rechazadas).toHaveLength(2);
  });
  it('archivo vacío y exceso de filas', () => {
    expect(parsearCasetasMatriz([]).error).toMatch(/vacío/);
    const filas = [['nombre', 'lat', 'lng'], ...Array.from({ length: 5001 }, (_, i) => [`C${i}`, '19.5', '-99.2'])];
    expect(parsearCasetasMatriz(filas).error).toMatch(/más de 5000/);
  });
  it('alias igual al nombre se descarta; máximo 10', () => {
    const alias = Array.from({ length: 15 }, (_, i) => `a${i}`).join('|');
    const r = parsearCasetasMatriz(csv(`nombre,lat,lng,alias\nCaseta X,19.5,-99.2,caseta x|${alias}\n`));
    expect(r.casetas[0].alias).toHaveLength(10);
    expect(r.casetas[0].alias).not.toContain('caseta x');
  });
});

const cat = (id: string, nombre: string, alias: string[] = []): CasetaCatalogo => ({
  id, nombre, nombreNorm: nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(),
  alias, lat: 19.5, lng: -99.2, radioM: 300,
});

describe('resolverCaseta — nunca adivina entre dos', () => {
  const catalogo = [cat('a', 'Caseta Ejemplo Norte', ['Ej Norte']), cat('b', 'Caseta Ejemplo Sur'), cat('c', 'Tlalpan'), cat('d', 'Tlalpan Norte')];
  it('exacta, sin importar acentos ni mayúsculas', () => {
    expect(resolverCaseta('CASETA EJEMPLO NORTE', catalogo)).toMatchObject({ tipo: 'unica', por: 'nombre', caseta: { id: 'a' } });
  });
  it('por alias', () => {
    expect(resolverCaseta('ej norte', catalogo)).toMatchObject({ tipo: 'unica', por: 'alias', caseta: { id: 'a' } });
  });
  it('el texto de la línea CONTIENE el nombre como palabras completas', () => {
    expect(resolverCaseta('Autopista 57D - Caseta Ejemplo Sur (Carril 3)', catalogo)).toMatchObject({ tipo: 'unica', por: 'contiene', caseta: { id: 'b' } });
  });
  it('si contiene dos y una es prefijo de la otra, gana la más específica', () => {
    expect(resolverCaseta('Plaza Tlalpan Norte carril 2', catalogo)).toMatchObject({ tipo: 'unica', caseta: { id: 'd' } });
  });
  it('dos casetas distintas en el mismo nivel = ambigua', () => {
    const r = resolverCaseta('Caseta Ejemplo Norte y Caseta Ejemplo Sur', catalogo);
    expect(r.tipo).toBe('ambigua');
  });
  it('un nombre exacto duplicado en catálogo = ambigua', () => {
    expect(resolverCaseta('Tlalpan', [cat('1', 'Tlalpan'), cat('2', 'Tlalpan')]).tipo).toBe('ambigua');
  });
  it('subcadena SIN límite de palabra no cuenta («norte» dentro de «nortena»)', () => {
    expect(resolverCaseta('Casetanortena', [cat('a', 'Norte')]).tipo).toBe('ninguna');
  });
  it('nombres de menos de 4 letras no se buscan por «contiene» (evita falsos positivos)', () => {
    expect(resolverCaseta('Caseta 57D Norte', [cat('a', '57D')]).tipo).toBe('ninguna');
    expect(resolverCaseta('57D', [cat('a', '57D')]).tipo).toBe('unica'); // exacta sí
  });
  it('vacío, null y catálogo vacío → ninguna', () => {
    expect(resolverCaseta(null, catalogo).tipo).toBe('ninguna');
    expect(resolverCaseta('  ', catalogo).tipo).toBe('ninguna');
    expect(resolverCaseta('Tlalpan', []).tipo).toBe('ninguna');
  });
});
