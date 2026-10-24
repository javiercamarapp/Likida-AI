import { describe, expect, it } from 'vitest';
import { aBooleano, aFechaLocal, aNumero, aplicarMapeo, leerRuta, parsearRuta, validarMapeo, MAX_FILAS, type MapeoTms } from './mapeo';
import { RECURSOS_TMS } from './tipos';

// Todo inventado: folios, nombres de operador y montos son sintéticos. La forma imita la descrita para liquidaciones
// (nodos de percepciones y deducciones); el resto de recursos usan suposiciones rotuladas hasta tener documentación.
const base = (extra: Partial<MapeoTms> = {}): MapeoTms => ({
  recurso: 'liquidaciones', ruta: '/api/liquidaciones', metodo: 'GET',
  params: { desde: 'fecha_ini', hasta: 'fecha_fin', pagina: 'page', tam: 'size' },
  raiz: 'data.items',
  campos: { folio: 'id', operador: 'operador.nombre', neto: { fuente: 'neto', transformar: 'numero' } },
  clave_externa: ['folio'], obligatorios: ['operador'],
  ...extra,
});

describe('rutas puntuadas', () => {
  it('lee anidado y arreglos', () => {
    const o = { a: { b: [{ c: 7 }, { c: 8 }] } };
    expect(leerRuta(o, 'a.b[1].c')).toBe(8);
    expect(leerRuta(o, 'a.b[5].c')).toBeUndefined();
    expect(leerRuta(o, 'a.x.c')).toBeUndefined();
  });
  it('rechaza nombres peligrosos y no alcanza el prototipo', () => {
    expect(typeof parsearRuta('a.__proto__.x')).toBe('string');
    expect(typeof parsearRuta('constructor.prototype')).toBe('string');
    expect(leerRuta({}, 'toString')).toBeUndefined();
    expect(leerRuta({ a: 1 }, 'a.toString')).toBeUndefined();
  });
  it('aplica topes de profundidad y largo', () => {
    expect(typeof parsearRuta('a.b.c.d.e.f.g.h.i')).toBe('string');
    expect(typeof parsearRuta('x'.repeat(200))).toBe('string');
    expect(typeof parsearRuta('')).toBe('string');
    expect(typeof parsearRuta('a..b')).toBe('string');
  });
});

describe('transformaciones', () => {
  it('numero con coma decimal y miles', () => {
    expect(aNumero('189,50')).toEqual({ ok: 189.5 });
    expect(aNumero('1,234.50')).toEqual({ ok: 1234.5 });
    expect(aNumero('1.234,50')).toEqual({ ok: 1234.5 });
    expect(aNumero('1,234')).toEqual({ ok: 1234 });
    expect(aNumero('$ 2,000.00')).toEqual({ ok: 2000 });
    expect(aNumero('-45,5')).toEqual({ ok: -45.5 });
    expect(aNumero(12)).toEqual({ ok: 12 });
  });
  it('A37-TRANSVERSAL-10: «1.234» sin formato declarado es ambiguo y se rechaza; declarado se lee exacto', () => {
    expect('error' in aNumero('1.234')).toBe(true);
    expect('error' in aNumero('1.500')).toBe(true);
    expect(aNumero('1.234', '.')).toEqual({ ok: 1.234 });
    expect(aNumero('1.234', ',')).toEqual({ ok: 1234 });
    expect(aNumero('1.234,50', ',')).toEqual({ ok: 1234.5 });
    expect(aNumero('1,234.50', '.')).toEqual({ ok: 1234.5 });
    expect(aNumero('1,234', '.')).toEqual({ ok: 1234 });
    expect(aNumero('189,50', ',')).toEqual({ ok: 189.5 });
    // no ambiguos siguen igual
    expect(aNumero('12.5')).toEqual({ ok: 12.5 });
    expect(aNumero('0.123')).toEqual({ ok: 0.123 });
  });
  it('A37-TRANSVERSAL-10: «decimal» solo en numero y con valor «.» o «,»', () => {
    const ok = base({ campos: { folio: 'id', operador: 'operador.nombre', neto: { fuente: 'neto', transformar: 'numero', decimal: ',' } } });
    expect(validarMapeo(ok)).toEqual([]);
    expect(validarMapeo(base({ campos: { folio: { fuente: 'id', decimal: ',' } } })).join(' ')).toMatch(/decimal/);
    expect(validarMapeo(base({ campos: { folio: 'id', neto: { fuente: 'neto', transformar: 'numero', decimal: ';' as ',' } } })).join(' ')).toMatch(/decimal/);
  });
  it('numero rechaza basura', () => {
    for (const v of ['abc', '', '1e5', '1,2,3', '12..5', null, {}]) expect('error' in aNumero(v)).toBe(true);
  });
  it('fecha_local dd/MM/yyyy H:mm en America/Mexico_City → UTC (sin horario de verano en 2026-10-06: UTC-6)', () => {
    expect(aFechaLocal('06/10/2026 7:00', 'dd/MM/yyyy H:mm', 'America/Mexico_City')).toEqual({ ok: '2026-10-06T13:00:00.000Z' });
  });
  it('fecha_local respeta la zona dada y la sin-zona ISO', () => {
    expect(aFechaLocal('2026-10-06 07:00', undefined, 'UTC')).toEqual({ ok: '2026-10-06T07:00:00.000Z' });
    expect(aFechaLocal('2026-10-06T07:00:30', undefined, 'America/Mexico_City')).toEqual({ ok: '2026-10-06T13:00:30.000Z' });
    expect(aFechaLocal('2026-10-06T07:00:00-05:00', undefined, 'UTC')).toEqual({ ok: '2026-10-06T12:00:00.000Z' });
  });
  it('fecha_local rechaza fechas imposibles y formato distinto (no voltea MM/dd)', () => {
    expect('error' in aFechaLocal('31/02/2026 07:00', 'dd/MM/yyyy HH:mm', 'UTC')).toBe(true);
    expect('error' in aFechaLocal('06-10-2026 07:00', 'dd/MM/yyyy HH:mm', 'UTC')).toBe(true);
    expect('error' in aFechaLocal('06/10/2026 25:00', 'dd/MM/yyyy HH:mm', 'UTC')).toBe(true);
    expect('error' in aFechaLocal(20261006, undefined, 'UTC')).toBe(true);
  });
  it('booleano', () => {
    expect(aBooleano('Sí')).toEqual({ ok: true });
    expect(aBooleano('0')).toEqual({ ok: false });
    expect(aBooleano(true)).toEqual({ ok: true });
    expect('error' in aBooleano('quizá')).toBe(true);
  });
});

describe('validarMapeo', () => {
  it('acepta un mapeo bueno', () => expect(validarMapeo(base())).toEqual([]));
  it('rechaza mapeo sin clave_externa', () => {
    expect(validarMapeo(base({ clave_externa: [] })).join(' ')).toMatch(/clave_externa/);
  });
  it('rechaza __proto__ en destino o fuente', () => {
    expect(validarMapeo(base({ campos: { folio: 'a.__proto__.b' } })).join(' ')).toMatch(/no permitido/);
    // JSON.parse crea `__proto__` como propiedad PROPIA (sin tocar el prototipo): justo el caso hostil.
    const campos = JSON.parse('{"folio":"id","__proto__":"x"}');
    expect(validarMapeo(base({ campos })).join(' ')).toMatch(/no permitido/);
  });
  it('rechaza ruta http insegura, método y transformación desconocidos, zona mala', () => {
    expect(validarMapeo(base({ ruta: 'https://otro.example/x' })).length).toBeGreaterThan(0);
    expect(validarMapeo(base({ ruta: '/a/../b' })).length).toBeGreaterThan(0);
    expect(validarMapeo(base({ metodo: 'DELETE' as 'GET' })).length).toBeGreaterThan(0);
    expect(validarMapeo(base({ campos: { folio: { fuente: 'id', transformar: 'eval' as 'texto' } } })).join(' ')).toMatch(/transformación desconocida/);
    expect(validarMapeo(base({ campos: { folio: { fuente: 'id', transformar: 'fecha_local', zona: 'Marte/Olimpo' } } })).join(' ')).toMatch(/zona/);
  });
  it('rechaza clave u obligatorio que no es campo, y página+cursor a la vez', () => {
    expect(validarMapeo(base({ clave_externa: ['nada'] })).join(' ')).toMatch(/no es un campo/);
    expect(validarMapeo(base({ obligatorios: ['nada'] })).join(' ')).toMatch(/no es un campo/);
    expect(validarMapeo(base({ params: { desde: 'a', hasta: 'b', pagina: 'p', cursor: 'c' } })).join(' ')).toMatch(/no ambas/);
  });
  it('no es un objeto', () => expect(validarMapeo(null)).toEqual(['el mapeo debe ser un objeto']));
});

describe('aplicarMapeo', () => {
  const resp = { data: { items: [
    { id: 'L-001', operador: { nombre: 'Operador Uno' }, neto: '1,234.50' },
    { id: 'L-002', operador: { nombre: 'Operador Dos' }, neto: '189,50' },
    { id: 'L-003', operador: { nombre: 'Operador Tres' }, neto: 10 },
  ] } };

  it('mapea 3 filas con ruta anidada y número', () => {
    const r = aplicarMapeo(base(), resp);
    expect(r.error).toBeUndefined();
    expect(r.rechazadas).toEqual([]);
    expect(r.filas.map((f) => f.fila)).toEqual([
      { folio: 'L-001', operador: 'Operador Uno', neto: 1234.5 },
      { folio: 'L-002', operador: 'Operador Dos', neto: 189.5 },
      { folio: 'L-003', operador: 'Operador Tres', neto: 10 },
    ]);
    expect(r.filas[0].clave).toBe('["L-001"]');
  });
  it('campo obligatorio ausente → fila rechazada con motivo, sin nulo silencioso', () => {
    const r = aplicarMapeo(base(), { data: { items: [{ id: 'L-1', neto: 5 }, { id: 'L-2', operador: { nombre: 'X' }, neto: 5 }] } });
    expect(r.filas).toHaveLength(1);
    expect(r.rechazadas).toEqual([{ indice: 0, motivo: expect.stringContaining('operador.nombre') }]);
  });
  it('obligatorio vacío o nulo también se rechaza; opcional ausente se omite', () => {
    const r = aplicarMapeo(base(), { data: { items: [{ id: 'L-1', operador: { nombre: '  ' } }, { id: 'L-2', operador: { nombre: 'Y' } }] } });
    expect(r.rechazadas).toHaveLength(1);
    expect(r.filas[0].fila).toEqual({ folio: 'L-2', operador: 'Y' });
  });
  it('la clave externa es obligatoria aunque no se declare', () => {
    const r = aplicarMapeo(base({ obligatorios: [] }), { data: { items: [{ operador: { nombre: 'Z' } }] } });
    expect(r.filas).toHaveLength(0);
    expect(r.rechazadas[0].motivo).toMatch(/id/);
  });
  it('valor mal formado → rechazada (no se adivina)', () => {
    const r = aplicarMapeo(base(), { data: { items: [{ id: 'L-1', operador: { nombre: 'A' }, neto: 'mucho' }] } });
    expect(r.rechazadas[0].motivo).toMatch(/neto/);
  });
  it('clave repetida en la misma respuesta → la segunda se rechaza', () => {
    const it1 = { id: 'L-1', operador: { nombre: 'A' } };
    const r = aplicarMapeo(base(), { data: { items: [it1, it1] } });
    expect(r.filas).toHaveLength(1);
    expect(r.rechazadas[0]).toEqual({ indice: 1, motivo: expect.stringContaining('repetida') });
  });
  it('destino anidado y arreglo en destino', () => {
    const m = base({ campos: { folio: 'id', 'persona.nombre': 'operador.nombre', 'conceptos[0]': 'concepto' }, obligatorios: [] });
    const r = aplicarMapeo(m, { data: { items: [{ id: '1', operador: { nombre: 'A' }, concepto: 'Casetas' }] } });
    expect(r.filas[0].fila).toEqual({ folio: '1', persona: { nombre: 'A' }, conceptos: ['Casetas'] });
  });
  it('un __proto__ en los datos no contamina ni se copia', () => {
    const datos = JSON.parse('{"data":{"items":[{"id":"1","operador":{"nombre":"A"},"__proto__":{"polluted":true}}]}}');
    aplicarMapeo(base(), datos);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('raíz vacía: la respuesta es la lista; raíz ausente o no-lista → error global', () => {
    expect(aplicarMapeo(base({ raiz: '' }), [{ id: 'A', operador: { nombre: 'B' } }]).filas).toHaveLength(1);
    expect(aplicarMapeo(base(), { otra: 1 }).error).toMatch(/data\.items/);
    expect(aplicarMapeo(base(), { data: { items: 'x' } }).error).toMatch(/no es una lista/);
  });
  it('filas que no son objeto se rechazan; tope de filas', () => {
    expect(aplicarMapeo(base(), { data: { items: [5, null, ['x']] } }).rechazadas).toHaveLength(3);
    const muchas = { data: { items: new Array(MAX_FILAS + 1).fill({}) } };
    expect(aplicarMapeo(base(), muchas).error).toMatch(/máximo/);
  });
  it('mapeo inválido → error global sin leer nada', () => {
    const r = aplicarMapeo(base({ clave_externa: [] }), resp);
    expect(r.error).toMatch(/inválido/);
    expect(r.filas).toEqual([]);
  });
  it('fecha_local con formato y zona dentro de un mapeo, y booleano', () => {
    const m = base({ campos: { folio: 'id', salida: { fuente: 'f', transformar: 'fecha_local', formato: 'dd/MM/yyyy H:mm', zona: 'America/Mexico_City' }, enviado: { fuente: 'e', transformar: 'booleano' } }, obligatorios: ['salida'] });
    const r = aplicarMapeo(m, { data: { items: [{ id: '1', f: '06/10/2026 7:00', e: 'no' }] } });
    expect(r.filas[0].fila).toEqual({ folio: '1', salida: '2026-10-06T13:00:00.000Z', enviado: false });
  });
  it('el mapeo es serializable (JSON ida y vuelta)', () => {
    const m = JSON.parse(JSON.stringify(base()));
    expect(validarMapeo(m)).toEqual([]);
  });
});

// Fixture sintético de 3 filas por recurso. Formas de viajes/hitos/posiciones/ccp_reque son SUPOSICIONES ROTULADAS
// (no hay documentación del origen todavía): solo prueban que el DSL cubre cada recurso, no que la forma sea la real.
const FIXTURES: Record<(typeof RECURSOS_TMS)[number], { mapeo: Partial<MapeoTms>; items: unknown[] }> = {
  liquidaciones: { mapeo: { campos: { folio: 'id', 'percepciones[0]': 'percepciones[0].monto', 'deducciones[0]': 'deducciones[0].monto' } },
    items: [1, 2, 3].map((n) => ({ id: `L-${n}`, percepciones: [{ monto: 100 * n }], deducciones: [{ monto: 10 * n }] })) },
  peajes: { mapeo: { campos: { folio: 'id', importe: { fuente: 'importe', transformar: 'numero' } } },
    items: [1, 2, 3].map((n) => ({ id: `P-${n}`, importe: `${n},50` })) },
  viajes: { mapeo: { campos: { folio: 'viaje', salida: { fuente: 'salida', transformar: 'fecha_local', formato: 'dd/MM/yyyy H:mm', zona: 'America/Mexico_City' } } },
    items: [1, 2, 3].map((n) => ({ viaje: `V-${n}`, salida: `0${n}/10/2026 7:00` })) },
  hitos: { mapeo: { campos: { folio: 'id', tipo: 'tipo' } }, items: ['salida', 'llegada', 'descarga'].map((t, i) => ({ id: `H-${i}`, tipo: t })) },
  posiciones: { mapeo: { campos: { folio: 'id', lat: { fuente: 'lat', transformar: 'numero' }, lon: { fuente: 'lon', transformar: 'numero' } } },
    items: [1, 2, 3].map((n) => ({ id: `G-${n}`, lat: 19 + n / 100, lon: -99 - n / 100 })) },
  ccp_reque: { mapeo: { campos: { folio: 'id', estado: 'estado' } }, items: [1, 2, 3].map((n) => ({ id: `C-${n}`, estado: 'pendiente' })) },
};

describe('fixture sintético por recurso', () => {
  for (const recurso of RECURSOS_TMS) {
    it(`${recurso}: 3 filas mapeadas sin rechazos`, () => {
      const f = FIXTURES[recurso];
      const m = base({ recurso, raiz: 'items', obligatorios: [], ...f.mapeo });
      expect(validarMapeo(m)).toEqual([]);
      const r = aplicarMapeo(m, { items: f.items });
      expect(r.rechazadas).toEqual([]);
      expect(r.filas).toHaveLength(3);
    });
  }
});
