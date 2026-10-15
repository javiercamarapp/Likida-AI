import { describe, it, expect } from 'vitest';
import {
  contarTextosSinSitio, csvTextosSinSitio, normalizarTextoEquivalencia, parsearCsvEquivalencias, planificarEquivalencias,
  MAX_FILAS_EQUIVALENCIAS, TOP_TEXTOS_SIN_SITIO, type EquivalenciaGuardada, type ViajeParaTextos,
} from './sitios';
import { normalizarNombre } from './sitio_derivado';

// Todo inventado: la FORMA de los textos reales (STOP … FINAL …, VACIO <cliente>, SALIR A RUTA …), ningún nombre real.
const SITIOS = new Map([['pl-demo', 'id-planta-demo'], ['pdo', 'id-patio-demo']]);
const CSV_6 = [
  'texto,geocerca_codigo,tipo,lado',
  'STOP Planta Demo FINAL ACERO,PL-DEMO,sitio,destino', // 1 buena
  'VACIO Cliente Demo,,ignorar,origen', // 2 buena
  'SALIR A RUTA ANTES DE LAS 7 PM,,instruccion,ambos', // 3 buena (alias de sin_sitio)
  'Patio Oriente,PDO,,', // 4 buena (tipo vacío con código = sitio; lado vacío = ambos)
  'Texto con tipo raro,PL-DEMO,quizas,destino', // 5 mala: tipo
  'STOP Otra Planta FINAL HIERRO,PL-FANTASMA,sitio,destino', // 6 mala (parsea bien; la rechaza el catálogo)
].join('\n');

describe('parsearCsvEquivalencias', () => {
  it('lee las filas buenas, normaliza el texto y traduce los alias', () => {
    const r = parsearCsvEquivalencias(CSV_6);
    expect(r.filas.map((f) => [f.linea, f.textoNormalizado, f.tipo, f.lado, f.geocercaCodigo])).toEqual([
      [2, 'stop planta demo final acero', 'sitio', 'destino', 'PL-DEMO'],
      [3, 'vacio cliente demo', 'ignorar', 'origen', null],
      [4, 'salir a ruta antes de las 7 pm', 'sin_sitio', 'ambos', null],
      [5, 'patio oriente', 'sitio', 'ambos', 'PDO'],
      [7, 'stop otra planta final hierro', 'sitio', 'destino', 'PL-FANTASMA'],
    ]);
    expect(r.errores).toEqual([{ linea: 6, mensaje: 'El tipo «quizas» no es válido. Usa: sitio, sin_sitio (o instruccion), ignorar.' }]);
  });

  it('acepta punto y coma, comillas, BOM, acentos y sinónimos de cabecera', () => {
    const r = parsearCsvEquivalencias('﻿Consignatario;Código Sitio;Tipo;Lado\n"Planta, Demo";PL-DEMO;Sitio;Descarga\n');
    expect(r.errores).toEqual([]);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]).toMatchObject({ texto: 'Planta, Demo', textoNormalizado: 'planta demo', lado: 'destino', tipo: 'sitio', geocercaCodigo: 'PL-DEMO' });
  });

  it('cada motivo de rechazo dice qué corregir', () => {
    const r = parsearCsvEquivalencias([
      'texto,geocerca_codigo,tipo,lado',
      ',PL-DEMO,sitio,',
      '!!! ,PL-DEMO,sitio,',
      'Sin código,,sitio,',
      'VACIO X,PL-DEMO,ignorar,',
      'Lado raro,PL-DEMO,sitio,arriba',
      'Repetido,PL-DEMO,sitio,destino',
      'repetido,PDO,sitio,destino',
      'repetido,PDO,sitio,origen',
    ].join('\n'));
    expect(r.errores.map((e) => [e.linea, e.mensaje])).toEqual([
      [2, 'El texto es obligatorio.'],
      [3, 'El texto no tiene letras ni números: no hay nada que comparar.'],
      [4, 'Con tipo «sitio» hay que indicar el código del sitio en «geocerca_codigo».'],
      [5, 'Un texto marcado «ignorar» no es un lugar y no lleva sitio: quita «geocerca_codigo» o cambia el tipo a «sitio».'],
      [6, 'El lado «arriba» no es válido. Usa: origen, destino o ambos.'],
      [8, 'El texto ya aparece en la línea 7 con el mismo lado.'],
    ]);
    // el mismo texto en OTRO lado no es duplicado
    expect(r.filas.map((f) => f.linea)).toEqual([7, 9]);
  });

  it('las filas de la plantilla sin completar se omiten sin ser error', () => {
    const r = parsearCsvEquivalencias('texto,geocerca_codigo,tipo,lado,frecuencia\nSTOP A FINAL B,,,destino,12\nSTOP C FINAL D,PL-DEMO,,destino,3\n');
    expect(r.sinCompletar).toBe(1);
    expect(r.errores).toEqual([]);
    expect(r.filas.map((f) => f.textoNormalizado)).toEqual(['stop c final d']);
  });

  it('errores de archivo: vacío, sin cabecera útil, sin filas, demasiadas filas', () => {
    expect(parsearCsvEquivalencias('  ').errores[0].mensaje).toBe('El archivo está vacío.');
    expect(parsearCsvEquivalencias('a,b\n1,2').errores[0].mensaje).toBe('Falta la columna «texto» en la cabecera.');
    expect(parsearCsvEquivalencias('texto,lado\nx,origen').errores[0].mensaje).toContain('geocerca_codigo');
    expect(parsearCsvEquivalencias('texto,tipo\n').errores[0].mensaje).toBe('El archivo no trae filas debajo de la cabecera.');
    const grande = 'texto,tipo\n' + Array.from({ length: MAX_FILAS_EQUIVALENCIAS + 1 }, (_, i) => `t${i},ignorar`).join('\n');
    expect(parsearCsvEquivalencias(grande).errores[0].mensaje).toContain('el máximo por importación');
  });
});

describe('planificarEquivalencias', () => {
  const filas = parsearCsvEquivalencias(CSV_6).filas;

  it('6 filas con 2 inválidas → 4 se guardan y 2 se rechazan, la de la geocerca inexistente con el mensaje exacto', () => {
    const lectura = parsearCsvEquivalencias(CSV_6);
    const plan = planificarEquivalencias(lectura.filas, SITIOS, []);
    expect(plan.nuevas).toHaveLength(4);
    expect(plan.cambios).toEqual([]);
    expect(plan.rechazadas).toEqual([{ linea: 7, mensaje: 'El sitio "PL-FANTASMA" no existe en tu catálogo. Impórtalo primero en Sitios.' }]);
    expect(lectura.errores).toHaveLength(1); // + la de la línea 6 = 2 rechazadas en total
    expect(plan.nuevas.map((n) => [n.textoNormalizado, n.lado, n.tipo, n.geocercaId])).toEqual([
      ['stop planta demo final acero', 'destino', 'sitio', 'id-planta-demo'],
      ['vacio cliente demo', 'origen', 'ignorar', null],
      ['salir a ruta antes de las 7 pm', 'ambos', 'sin_sitio', null],
      ['patio oriente', 'ambos', 'sitio', 'id-patio-demo'],
    ]);
  });

  it('reimportar el mismo archivo = 0 cambios', () => {
    const buenas = filas.filter((f) => f.geocercaCodigo !== 'PL-FANTASMA');
    const primera = planificarEquivalencias(buenas, SITIOS, []);
    const guardadas: EquivalenciaGuardada[] = primera.nuevas.map((n, i) => ({ id: `e${i}`, textoNormalizado: n.textoNormalizado, lado: n.lado, tipo: n.tipo, geocercaId: n.geocercaId, clienteId: null }));
    const segunda = planificarEquivalencias(buenas, SITIOS, guardadas);
    expect(segunda).toEqual({ nuevas: [], cambios: [], sinCambios: 4, rechazadas: [] });
  });

  it('cambiar el sitio de un texto ya guardado es un cambio, no un duplicado; y una equivalencia de un cliente no se toca', () => {
    const [una] = filas;
    const guardadas: EquivalenciaGuardada[] = [
      { id: 'e1', textoNormalizado: una.textoNormalizado, lado: una.lado, tipo: 'sitio', geocercaId: 'id-otro', clienteId: null },
      { id: 'e2', textoNormalizado: una.textoNormalizado, lado: una.lado, tipo: 'ignorar', geocercaId: null, clienteId: 'cli-1' },
    ];
    const plan = planificarEquivalencias([una], SITIOS, guardadas);
    expect(plan.cambios).toEqual([{ id: 'e1', tipo: 'sitio', geocercaId: 'id-planta-demo' }]);
    expect(plan.nuevas).toEqual([]);
  });

  it('el código se busca sin distinguir mayúsculas', () => {
    const f = parsearCsvEquivalencias('texto,geocerca_codigo,tipo\nX Y,pl-DEMO,sitio').filas;
    expect(planificarEquivalencias(f, SITIOS, []).nuevas[0].geocercaId).toBe('id-planta-demo');
  });
});

describe('contarTextosSinSitio', () => {
  const V = (o: Partial<ViajeParaTextos> = {}): ViajeParaTextos => ({ origen: null, destino: null, origenSitioId: null, destinoSitioId: null, ...o });
  const viajes: ViajeParaTextos[] = [
    ...Array.from({ length: 40 }, () => V({ origen: 'Patio Demo Oriente', origenSitioId: 's1', destino: 'STOP Planta Demo FINAL ACERO' })),
    ...Array.from({ length: 25 }, () => V({ origen: 'Patio Demo Oriente', origenSitioId: 's1', destino: 'VACIO Cliente Demo' })),
    ...Array.from({ length: 5 }, () => V({ origen: 'vacio  cliente demo', destino: 'Patio Demo Oriente', destinoSitioId: 's1' })),
    ...Array.from({ length: 15 }, () => V({ origen: 'Patio Demo Oriente', origenSitioId: 's1', destino: 'SALIR A RUTA ANTES DE LAS 7 PM' })),
    ...Array.from({ length: 10 }, () => V({ origen: 'Patio Demo Oriente', origenSitioId: 's1', destino: 'Planta Demo', destinoSitioId: 's2' })),
    ...Array.from({ length: 5 }, () => V({ origen: 'Patio Demo Oriente', origenSitioId: 's1', destino: 'REGRESA SIN CARGA' })),
  ];

  it('fixture de 100 viajes: cuenta cada texto sin sitio, junta variantes y lados, y no cuenta lo que ya tiene sitio', () => {
    expect(viajes).toHaveLength(100);
    const r = contarTextosSinSitio(viajes, [{ textoNormalizado: 'regresa sin carga', lado: 'destino' }]);
    expect(r.map((x) => [x.texto, x.lado, x.frecuencia])).toEqual([
      ['STOP Planta Demo FINAL ACERO', 'destino', 40],
      ['VACIO Cliente Demo', 'ambos', 30], // 25 de destino + 5 de origen (escrito «vacio  cliente demo»)
      ['SALIR A RUTA ANTES DE LAS 7 PM', 'destino', 15],
    ]);
  });

  it('una equivalencia de OTRO lado no cubre; la de «ambos» sí', () => {
    const solo = [V({ destino: 'Texto X' })];
    expect(contarTextosSinSitio(solo, [{ textoNormalizado: 'texto x', lado: 'origen' }])).toHaveLength(1);
    expect(contarTextosSinSitio(solo, [{ textoNormalizado: 'texto x', lado: 'ambos' }])).toHaveLength(0);
  });

  it('top 50: devuelve solo los 50 más frecuentes, estable en los empates', () => {
    const muchos = Array.from({ length: 80 }, (_, i) => Array.from({ length: 80 - i }, () => V({ destino: `Texto ${String(i).padStart(2, '0')}` }))).flat();
    const r = contarTextosSinSitio(muchos, []);
    expect(r).toHaveLength(TOP_TEXTOS_SIN_SITIO);
    expect(r[0]).toMatchObject({ texto: 'Texto 00', frecuencia: 80 });
    expect(r[49]).toMatchObject({ texto: 'Texto 49', frecuencia: 31 });
    const empate = contarTextosSinSitio([V({ destino: 'B uno' }), V({ destino: 'A uno' })], []);
    expect(empate.map((x) => x.texto)).toEqual(['A uno', 'B uno']);
  });

  it('textos vacíos o solo puntuación se ignoran; la variante más escrita es la que se muestra', () => {
    const r = contarTextosSinSitio([V({ destino: '   ' }), V({ destino: '---' }), V({ destino: 'Zeta' }), V({ destino: 'ZETA' }), V({ destino: 'ZETA' })], []);
    expect(r).toEqual([{ texto: 'ZETA', textoNormalizado: 'zeta', lado: 'destino', frecuencia: 3 }]);
  });
});

describe('csvTextosSinSitio', () => {
  it('trae solo texto, lado y frecuencia; vuelve a entrar al importador tal cual y neutraliza fórmulas', () => {
    const csv = csvTextosSinSitio([
      { texto: 'STOP Planta, Demo "X"', textoNormalizado: 'stop planta demo x', lado: 'destino', frecuencia: 7 },
      { texto: '=CMD()', textoNormalizado: 'cmd', lado: 'ambos', frecuencia: 2 },
    ]);
    expect(csv.split('\n')[0]).toBe('texto,geocerca_codigo,tipo,lado,frecuencia');
    expect(csv).toContain('"STOP Planta, Demo ""X""",,,destino,7');
    expect(csv).toContain("'=CMD(),,,ambos,2");
    const r = parsearCsvEquivalencias(csv);
    expect(r.filas).toEqual([]);
    expect(r.errores).toEqual([]);
    expect(r.sinCompletar).toBe(2);
    // ya completado por el cliente: entra
    const completo = csv.replace('"STOP Planta, Demo ""X""",,,destino,7', '"STOP Planta, Demo ""X""",PL-DEMO,sitio,destino,7');
    expect(parsearCsvEquivalencias(completo).filas.map((f) => f.textoNormalizado)).toEqual(['stop planta demo x']);
  });
});

describe('la normalización no se separa de la de derivarSitio', () => {
  it.each(['STOP Planta Demo FINAL ACERO', '  Vacío,  Cliente-Demo (2) ', 'SALIR A RUTA ANTES DE LAS 7 PM', 'ñandú ÁÉÍÓÚ', ''])('«%s»', (t) => {
    expect(normalizarTextoEquivalencia(t)).toBe(normalizarNombre(t));
  });
});
