// T-A3-68 (b), (c), (e): confianza compuesta. Todo con datos SINTÉTICOS.
import { describe, it, expect } from 'vitest';
import type { Extraccion } from './campos';
import {
  CONFIANZA_TOPE_FALLO, aplicarConfianzaCompuesta, brutosEnTexto, lecturasPosibles, resolverAmbiguosPorCuadre, revisionHumanaDe,
  validadoresDeterministas, validarRotuloPeso,
} from './confianza_compuesta';
import { cv, extraccionAtlasOk, RFC } from './documentos_sinteticos.fixture';

/** Dos renglones sintéticos que suman 14 029 kg; el total lo ponemos nosotros. */
function embarque(totalValor: string, evidenciaTotal: string | null = null): Extraccion {
  const e = extraccionAtlasOk('llm', 0.99);
  const base = e.mercancias[0];
  e.mercancias = [{ ...base, peso_kg: cv('9000', 0.99) }, { ...base, peso_kg: cv('5029', 0.99) }];
  e.campos.peso_bruto_total = cv(totalValor, 0.99, 'llm', evidenciaTotal);
  return e;
}

describe('(b) lecturasPosibles: separadores de miles y decimales', () => {
  it('«1.234.567» y «1,234,567.89» tienen UNA sola lectura (no son ambiguos)', () => {
    expect(lecturasPosibles('1.234.567')).toEqual([1234567]);
    expect(lecturasPosibles('1,234,567.89')).toEqual([1234567.89]);
    expect(lecturasPosibles('1.234,56')).toEqual([1234.56]);
  });
  it('«14.029» y «6,578» tienen dos lecturas (México primero)', () => {
    expect(lecturasPosibles('14.029')).toEqual([14.029, 14029]);
    expect(lecturasPosibles('6,578')).toEqual([6578, 6.578]);
  });
  it('un texto que no es número no inventa nada', () => expect(lecturasPosibles('abc')).toEqual([]));
});

describe('(b) resolverAmbiguosPorCuadre: el total ambiguo se resuelve contra la suma de las mercancías', () => {
  it('«14.029» leído como 14.029 con renglones que suman 14029 → se corrige a 14029, con nota y sin subir de 0.9', () => {
    const r = resolverAmbiguosPorCuadre(embarque('14.029', 'Total: 14.029   127.325'));
    expect(r.extraccion.campos.peso_bruto_total.valor).toBe('14029');
    expect(r.extraccion.campos.peso_bruto_total.confianza).toBeLessThanOrEqual(0.9);
    expect(r.notas.join(' ')).toMatch(/cuadra con la suma/);
    expect(r.extraccion.campos.peso_bruto_total.notas?.join(' ')).toMatch(/era ambiguo/);
  });
  it('si ya cuadra no se toca', () => {
    const e = embarque('14029', 'Total: 14,029');
    expect(resolverAmbiguosPorCuadre(e).extraccion).toBe(e);
  });
  it('si NINGUNA lectura cuadra no se adivina: queda igual (el validador de sumas bloquea)', () => {
    const e = embarque('14.029', 'Total: 14.029');
    e.mercancias[1].peso_kg = cv('777', 0.99);
    const r = resolverAmbiguosPorCuadre(e);
    expect(r.extraccion.campos.peso_bruto_total.valor).toBe('14.029');
    expect(r.notas).toEqual([]);
  });
  it('sin suma contra qué comparar (un renglón sin peso) no se adivina', () => {
    const e = embarque('14.029', 'Total: 14.029');
    delete e.mercancias[0].peso_kg;
    expect(resolverAmbiguosPorCuadre(e).extraccion.campos.peso_bruto_total.valor).toBe('14.029');
  });
  it('un total derivado o dejado por una persona no se reescribe', () => {
    const e = embarque('14.029', 'Total: 14.029');
    e.campos.peso_bruto_total = { ...e.campos.peso_bruto_total, origen: 'humano' };
    expect(resolverAmbiguosPorCuadre(e).extraccion.campos.peso_bruto_total.valor).toBe('14.029');
  });
});

describe('(c) regla de peso: el bruto manda', () => {
  it('brutosEnTexto lee «Peso total bruto» y «Gross weight» en los dos formatos de miles', () => {
    expect(brutosEnTexto('Peso total bruto: 1,234.50 kg\nPeso por embalaje: 400')).toEqual([1234.5]);
    expect(brutosEnTexto('Gross weight 1.234,5 kg')).toEqual([1234.5]);
    expect(brutosEnTexto('Peso por embalaje: 400')).toEqual([]);
  });
  it('el texto trae un peso total bruto y la lectura tomó el peso por embalaje → falla con los dos valores', () => {
    const e = extraccionAtlasOk('llm', 0.99);
    e.mercancias[0].peso_kg = cv('400', 0.99, 'llm', 'Peso por embalaje: 400');
    delete e.campos.peso_bruto_total;
    const f = validarRotuloPeso(e, 'Peso por embalaje: 400\nPeso total bruto: 8400 kg');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ codigo: 'peso_no_es_bruto', campo: 'peso_kg', renglon: 0 });
    expect(f[0].valores).toEqual(expect.arrayContaining(['400', '8400']));
  });
  it('sin texto (visión): la evidencia que citó el modelo es un rótulo de peso neto/por embalaje → falla', () => {
    const e = extraccionAtlasOk('llm', 0.99);
    e.mercancias[0].peso_kg = cv('400', 0.99, 'llm', 'Peso por embalaje: 400');
    delete e.campos.peso_bruto_total;
    expect(validarRotuloPeso(e, null).map((x) => x.codigo)).toEqual(['peso_rotulo_no_bruto']);
  });
  it('si el rótulo de la evidencia es de bruto, o coincide con el bruto del texto, no falla', () => {
    const e = extraccionAtlasOk('llm', 0.99);
    e.mercancias[0].peso_kg = cv('8400', 0.99, 'llm', 'Peso total bruto: 8400');
    delete e.campos.peso_bruto_total;
    expect(validarRotuloPeso(e, null)).toEqual([]);
    expect(validarRotuloPeso(e, 'Peso total bruto: 8,400 kg')).toEqual([]);
  });
});

describe('(e) validadores deterministas y confianza compuesta', () => {
  it('una extracción buena no falla ningún validador', () => {
    expect(validadoresDeterministas(extraccionAtlasOk('llm', 0.99))).toEqual([]);
  });
  it('un RFC con forma imposible falla aunque el modelo diga 0.99, y su confianza baja a ≤ 0.5', () => {
    const e = extraccionAtlasOk('llm', 0.99);
    e.campos.origen_rfc = cv('XYZ', 0.99);
    const f = validadoresDeterministas(e);
    expect(f.map((x) => x.codigo)).toContain('rfc_forma');
    const c = aplicarConfianzaCompuesta(e, f);
    expect(c.campos.origen_rfc.confianza).toBeLessThanOrEqual(CONFIANZA_TOPE_FALLO);
    expect(c.campos.origen_rfc.notas?.join(' ')).toMatch(/Validador:/);
    expect(c.campos.origen_cp.confianza).toBe(0.99); // lo que no falló no se toca
  });
  it('CP que no corresponde al estado y clave de producto con forma imposible fallan', () => {
    const e = extraccionAtlasOk('llm', 0.99);
    e.campos.destino_cp = cv('99999', 0.99);
    e.mercancias[0].bienes_transp = cv('1234', 0.99);
    const cods = validadoresDeterministas(e).map((x) => x.codigo);
    expect(cods).toEqual(expect.arrayContaining(['cp_estado', 'clave_forma']));
  });
  it('fracción con forma imposible falla (la fracción escala aunque no sea crítica)', () => {
    const e = extraccionAtlasOk('llm', 0.99);
    e.mercancias[0].fraccion_arancelaria = cv('12345', 0.99);
    expect(validadoresDeterministas(e).map((x) => x.codigo)).toContain('fraccion_forma');
  });
  it('el total que no cuadra con la suma falla en el total Y en el peso de cada renglón', () => {
    const e = embarque('15029', 'Total: 15,029');
    const f = validadoresDeterministas(e);
    expect(f.map((x) => `${x.campo}#${x.renglon}`)).toEqual(expect.arrayContaining(['peso_bruto_total#null', 'peso_kg#0', 'peso_kg#1']));
  });
  it('lo que dejó una persona (origen humano) no se cuestiona', () => {
    const e = extraccionAtlasOk('llm', 0.99);
    e.campos.origen_rfc = cv('XYZ', 1, 'humano');
    expect(validadoresDeterministas(e).filter((x) => x.campo === 'origen_rfc')).toEqual([]);
  });
  it('la confianza baja o la ausencia NO cuentan como fallo de validador (ya las cubre la confianza declarada)', () => {
    const e = extraccionAtlasOk('llm', 0.6);
    delete e.campos.origen_cp;
    expect(validadoresDeterministas(e)).toEqual([]);
  });
});

describe('(e) revisión humana: los valores en conflicto de cada nivel', () => {
  it('junta lo que leyó cada nivel y lo que dice el validador, sin repetir', () => {
    const n1 = embarque('14.029'); const n2 = embarque('15029');
    const fallos = validadoresDeterministas(n2).filter((f) => f.campo === 'peso_bruto_total');
    const r = revisionHumanaDe(fallos, [n1, n2]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ campo: 'peso_bruto_total', renglon: null });
    expect(r[0].valores).toEqual(expect.arrayContaining(['14.029', '15029', '9000', '5029'])); // los dos niveles y los renglones del cuadre
  });
  it('un RFC malo en los dos niveles se muestra una sola vez', () => {
    const a = extraccionAtlasOk(); a.campos.destino_rfc = cv('ABC', 0.9);
    const r = revisionHumanaDe(validadoresDeterministas(a), [a, a]);
    expect(r.find((x) => x.campo === 'destino_rfc')?.valores).toEqual(['ABC']);
    expect(RFC.atlas).toBeTruthy();
  });
});
