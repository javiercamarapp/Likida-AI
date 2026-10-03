import { describe, it, expect } from 'vitest';
import { campoDoc, campoMercancia } from './campos';
import { codigoEstado, claveUnidadDeTexto, estadoDeCp } from './catalogos';
import { normalizarFecha, normalizarNumero, normalizarValor, limpiarTexto } from './normalizar';

const doc = (k: string) => campoDoc(k)!;
const merc = (k: string) => campoMercancia(k)!;

describe('normalizarNumero', () => {
  it.each([
    ['1,234.50', 1234.5, false],
    ['1.234,50', 1234.5, false],
    ['1 234,5', 1234.5, false],
    ['8,400', 8400, true], // «8,400»: ¿ocho mil cuatrocientos u ocho punto cuatro? se marca ambiguo
    ['1.500', 1.5, true],
    ['1,200,000', 1200000, false],
    ['12.345.678', 12345678, false],
    ['24000', 24000, false],
    ['30 ton', 30, false],
    ['$ 1,250.75', 1250.75, false],
    ['0.5', 0.5, false],
  ])('%s → %s (ambiguo %s)', (entrada, esperado, ambiguo) => {
    const r = normalizarNumero(entrada);
    expect(r.valor).toBe(esperado);
    expect(r.ambiguo).toBe(ambiguo);
  });
  it.each(['', 'abc', '12abc', '1,2,3,4', '--5', '1.2.3', 'NaN', '1e5'])('no es número: «%s»', (t) => {
    expect(normalizarNumero(t).valor).toBeNull();
  });
  it('acepta números nativos y rechaza no finitos', () => {
    expect(normalizarNumero(12.34567).valor).toBe(12.346);
    expect(normalizarNumero(Number.POSITIVE_INFINITY).valor).toBeNull();
  });
});

describe('normalizarFecha', () => {
  it.each([
    ['2026-10-15', '2026-10-15'],
    ['15/10/2026', '2026-10-15'],
    ['15-10-2026', '2026-10-15'],
    ['15.10.2026', '2026-10-15'],
    ['15/10/26', '2026-10-15'],
    ['15 de octubre de 2026', '2026-10-15'],
    ['15-oct-2026', '2026-10-15'],
    ['5 SEP 2026', '2026-09-05'],
    ['20261015', '2026-10-15'],
    ['2026-10-16 08:30', '2026-10-16T08:30:00'],
    ['16/10/2026 08:30:15', '2026-10-16T08:30:15'],
    ['2026-10-16T08:30:00', '2026-10-16T08:30:00'],
    ['46312', '2026-10-17'], // serial de Excel
    ['46312.25', '2026-10-17T06:00:00'],
  ])('%s → %s', (entrada, esperado) => {
    expect(normalizarFecha(entrada).valor).toBe(esperado);
  });
  it.each(['31/02/2026', '32/01/2026', '2026-13-01', '00/00/0000', 'mañana', '15/10/1999', '2026-10-15T25:00', ''])('no es fecha: «%s»', (t) => {
    expect(normalizarFecha(t).valor).toBeNull();
  });
  it('día/mes: el 03/04/2026 de México es 3 de abril y se avisa', () => {
    const r = normalizarFecha('03/04/2026');
    expect(r.valor).toBe('2026-04-03');
    expect(r.nota).toMatch(/día\/mes\/año/);
  });
});

describe('normalizarValor por tipo', () => {
  it('RFC: mayúsculas, sin espacios ni guiones', () => {
    const r = normalizarValor(doc('origen_rfc'), ' dat-150312 abc ');
    expect(r.valor).toBe('DAT150312ABC');
    expect(r.notas.length).toBe(1);
  });
  it('CP de 4 dígitos (cero perdido en Excel): se completa, se avisa y baja la confianza', () => {
    const r = normalizarValor(doc('origen_cp'), '6600');
    expect(r.valor).toBe('06600');
    expect(r.penalizacion).toBeGreaterThan(0);
    expect(r.notas[0]).toMatch(/Confírmalo/);
  });
  it('CP normal y con prefijo C.P.', () => {
    expect(normalizarValor(doc('origen_cp'), 'C.P. 44100').valor).toBe('44100');
  });
  it('estado: nombre, abreviatura y clave → clave SAT', () => {
    expect(normalizarValor(doc('origen_estado'), 'Nuevo León').valor).toBe('NLE');
    expect(normalizarValor(doc('origen_estado'), 'Jal.').valor).toBe('JAL');
    expect(normalizarValor(doc('origen_estado'), 'CDMX').valor).toBe('CMX');
    expect(normalizarValor(doc('origen_estado'), 'Narnia').valor).toBe('NAR'); // se corta al máximo del campo; el validador lo señala
  });
  it('clave de unidad: alias → clave; desconocida se conserva (cortada) para que se vea', () => {
    expect(normalizarValor(merc('clave_unidad'), 'Toneladas').valor).toBe('TNE');
    expect(normalizarValor(merc('clave_unidad'), 'kg').valor).toBe('KGM');
    expect(normalizarValor(merc('clave_unidad'), 'H87').valor).toBe('H87');
    expect(normalizarValor(merc('clave_unidad'), 'tarima').valor).toBe('TAR');
  });
  it('clave de producto: extrae los 8 dígitos de un texto más largo', () => {
    expect(normalizarValor(merc('bienes_transp'), 'Clave SAT: 30111500 (cemento)').valor).toBe('30111500');
    expect(normalizarValor(merc('bienes_transp'), '3011 1500').valor).toBe('30111500');
  });
  it('booleano', () => {
    expect(normalizarValor(merc('material_peligroso'), 'Sí').valor).toBe('true');
    expect(normalizarValor(merc('material_peligroso'), 'NO').valor).toBe('false');
    expect(normalizarValor(merc('material_peligroso'), 'quizá').valor).toBeNull();
  });
  it('moneda: peso/dólar → ISO', () => {
    expect(normalizarValor(merc('moneda'), 'pesos').valor).toBe('MXN');
    expect(normalizarValor(merc('moneda'), 'Dólares').valor).toBe('USD');
  });
  it('placas: sin guiones ni espacios', () => {
    expect(normalizarValor(doc('unidad_placas'), 'abc-123 4').valor).toBe('ABC1234');
  });
  it('un número ambiguo baja la confianza y lo dice', () => {
    const r = normalizarValor(merc('peso_kg'), '1.500');
    expect(r.valor).toBe('1.5');
    expect(r.penalizacion).toBeGreaterThan(0);
  });
  it('lo que no se reconoce se conserva tal cual con una nota (no se descarta ni se arregla)', () => {
    const r = normalizarValor(merc('peso_kg'), 'pendiente');
    expect(r.valor).toBe('pendiente');
    expect(r.notas[0]).toMatch(/No se reconoció/);
  });
});

describe('limpiarTexto (entrada hostil)', () => {
  it('quita controles, marcas bidireccionales y colapsa espacios', () => {
    expect(limpiarTexto('  Hola\u0000\u202e   mundo\n\n x ')).toBe('Hola mundo x');
  });
  it('trata los marcadores de vacío como null', () => {
    for (const v of ['', '  ', 'N/A', 'null', '-', 'sin dato', undefined, null]) expect(limpiarTexto(v)).toBeNull();
  });
  it('corta al tope', () => {
    expect(limpiarTexto('x'.repeat(1000), 50)?.length).toBe(50);
  });
});

describe('catálogos', () => {
  it('estadoDeCp por prefijo', () => {
    expect(estadoDeCp('44100')).toBe('JAL');
    expect(estadoDeCp('64000')).toBe('NLE');
    expect(estadoDeCp('06600')).toBe('CMX');
    expect(estadoDeCp('91700')).toBe('VER');
    expect(estadoDeCp('00100')).toBeNull();
    expect(estadoDeCp('17000')).toBeNull();
    expect(estadoDeCp('abc')).toBeNull();
  });
  it('codigoEstado reconoce las 32 entidades por su nombre', () => {
    for (const n of ['Aguascalientes', 'Baja California', 'Chiapas', 'Yucatán', 'Zacatecas', 'Estado de México', 'Ciudad de México']) {
      expect(codigoEstado(n)).not.toBeNull();
    }
    expect(codigoEstado('Atlantis')).toBeNull();
  });
  it('claveUnidadDeTexto solo traduce lo inequívoco', () => {
    expect(claveUnidadDeTexto('PZA')).toBe('H87');
    expect(claveUnidadDeTexto('Bulto')).toBeNull();
    expect(claveUnidadDeTexto('tarima')).toBeNull();
  });
});
