import { describe, it, expect } from 'vitest';
import type { Extraccion } from './campos';
import { extraccionAtlasOk, cv } from './documentos_sinteticos.fixture';
import {
  CAT_CP, CAT_FRACCION, CAT_PRODUCTO, clavesDeFraccion, clavesParaConsultar, normalizarFraccion, precargarCatalogosSat,
  resolvedorEnMemoria, type CargarCatalogoSat, type DatosSat,
} from './catalogos_sat';
import { validarExtraccion } from './validacion';
import type { SalidaTms } from './tms_puerto';

const AHORA = new Date('2026-10-01T12:00:00Z');
const codigos = (e: Extraccion, catalogosSat?: ReturnType<typeof resolvedorEnMemoria>) =>
  validarExtraccion(e, { ahora: AHORA, catalogosSat }).hallazgos.map((h) => `${h.severidad}:${h.codigo}:${h.campo}${h.renglon === null ? '' : '#' + h.renglon}`);

/** Catálogos sintéticos: solo lo que el documento de prueba usa. */
const SAT = () => resolvedorEnMemoria({
  [CAT_PRODUCTO]: ['24131500', '11111111'],
  [CAT_FRACCION]: ['85176217', '8517621799', '70109099'], // grep-limpio:ok
  c_TipoEmbalaje: ['4G', '5H1'],
  c_ClaveUnidad: ['XYZ'],
  c_MaterialPeligroso: ['1203'],
  [CAT_CP]: { 44100: { c_Estado: 'JAL', c_Municipio: '039', c_Localidad: '01' }, 64000: { c_Estado: 'NLE', c_Municipio: '039', c_Localidad: '01' } },
});

describe('clave de producto contra el catálogo cargado', () => {
  it('inexistente → bloqueo con el mensaje llano', () => {
    const e = extraccionAtlasOk(); e.mercancias[0].bienes_transp = cv('24999999');
    const r = validarExtraccion(e, { ahora: AHORA, catalogosSat: SAT() });
    expect(r.hallazgos.map((h) => `${h.severidad}:${h.codigo}`)).toContain('bloqueo:clave_no_catalogo');
    expect(r.hallazgos.find((h) => h.codigo === 'clave_no_catalogo')!.mensaje).toContain('La clave 24999999 no existe en el catálogo del SAT');
    expect(r.listoParaAprobar).toBe(false);
  });
  it('existente → ningún hallazgo (ni el aviso de «el PAC lo valida»)', () => {
    const e = extraccionAtlasOk();
    const c = codigos(e, SAT());
    expect(c.filter((x) => x.includes('clave'))).toEqual([]);
    expect(c.filter((x) => !x.startsWith('aviso'))).toEqual([]);
  });
  it('catálogo no cargado (null) → un aviso por catálogo y NUNCA bloquea', () => {
    const e = extraccionAtlasOk(); e.mercancias[0].bienes_transp = cv('24999999');
    const r = validarExtraccion(e, { ahora: AHORA, catalogosSat: resolvedorEnMemoria({}) });
    expect(r.bloqueos).toBe(0);
    const avisos = r.hallazgos.filter((h) => h.codigo === 'catalogo_no_cargado');
    expect(avisos.length).toBeGreaterThan(0);
    expect(avisos.every((h) => h.severidad === 'aviso')).toBe(true);
    expect(new Set(avisos.map((h) => h.mensaje)).size).toBe(avisos.length); // uno por catálogo, no uno por campo
    expect(r.listoParaAprobar).toBe(true);
  });
  it('sin resolvedor se comporta como antes (aviso local, sin avisos de catálogo)', () => {
    const e = extraccionAtlasOk();
    const c = codigos(e);
    expect(c).toContain('aviso:clave_sin_catalogo:bienes_transp#0');
    expect(c.some((x) => x.includes('catalogo_no_cargado'))).toBe(false);
  });
});

describe('fracción arancelaria', () => {
  it('con puntos se normaliza antes de consultar y no falla por forma', () => {
    expect(normalizarFraccion('8517.62.17.99')).toBe('8517621799'); // grep-limpio:ok
    expect(clavesDeFraccion('8517.62.17.99')).toEqual(['8517621799', '85176217']); // grep-limpio:ok
    const e = extraccionAtlasOk(); e.mercancias[0].fraccion_arancelaria = cv('8517.62.17.99');
    const c = codigos(e, SAT());
    expect(c.some((x) => x.includes('fraccion'))).toBe(false);
    expect(clavesParaConsultar(e).get(CAT_FRACCION)).toEqual(new Set(['8517621799', '85176217'])); // grep-limpio:ok
  });
  it('inexistente → bloqueo; la forma imposible sigue bloqueando', () => {
    const e = extraccionAtlasOk(); e.mercancias[0].fraccion_arancelaria = cv('99999999');
    expect(codigos(e, SAT())).toContain('bloqueo:fraccion_no_catalogo:fraccion_arancelaria#0');
    e.mercancias[0].fraccion_arancelaria = cv('123');
    expect(codigos(e, SAT())).toContain('bloqueo:fraccion_forma:fraccion_arancelaria#0');
  });
  it('con NICO inexistente pero su base de 8 dígitos existe → pasa', () => {
    const e = extraccionAtlasOk(); e.mercancias[0].fraccion_arancelaria = cv('7010909900'); // grep-limpio:ok
    expect(codigos(e, SAT()).some((x) => x.includes('fraccion_no_catalogo'))).toBe(false);
  });
});

describe('material peligroso', () => {
  it('«sí» sin clave → bloqueo (aun sin catálogos)', () => {
    const e = extraccionAtlasOk(); e.mercancias[0].material_peligroso = cv('true');
    expect(codigos(e)).toContain('bloqueo:peligroso_sin_clave:clave_material_peligroso#0');
    e.mercancias[0].clave_material_peligroso = cv('N/A');
    expect(codigos(e)).toContain('bloqueo:peligroso_sin_clave:clave_material_peligroso#0');
  });
  it('«sí» con clave existente → limpio; con clave inexistente → bloqueo', () => {
    const e = extraccionAtlasOk(); e.mercancias[0].material_peligroso = cv('true'); e.mercancias[0].clave_material_peligroso = cv('1203');
    expect(codigos(e, SAT()).filter((x) => x.includes('peligroso'))).toEqual([]);
    e.mercancias[0].clave_material_peligroso = cv('9999');
    expect(codigos(e, SAT())).toContain('bloqueo:peligroso_no_catalogo:clave_material_peligroso#0');
  });
  it('«no» sin clave no dice nada', () => {
    const e = extraccionAtlasOk(); e.mercancias[0].material_peligroso = cv('false');
    expect(codigos(e, SAT()).some((x) => x.includes('peligroso'))).toBe(false);
  });
});

describe('unidad y embalaje', () => {
  it('unidad fuera del subconjunto local: existe → sin aviso; no existe → bloqueo; subconjunto local no se consulta', () => {
    const e = extraccionAtlasOk(); e.mercancias[0].clave_unidad = cv('XYZ');
    expect(codigos(e, SAT()).some((x) => x.includes('unidad'))).toBe(false);
    e.mercancias[0].clave_unidad = cv('QQQ');
    expect(codigos(e, SAT())).toContain('bloqueo:unidad_no_catalogo:clave_unidad#0');
    expect(clavesParaConsultar(extraccionAtlasOk()).has('c_ClaveUnidad')).toBe(false);
  });
  it('embalaje inexistente → bloqueo', () => {
    const e = extraccionAtlasOk(); e.mercancias[0].embalaje = cv('ZZ');
    expect(codigos(e, SAT())).toContain('bloqueo:embalaje_no_catalogo:embalaje#0');
  });
  it('sacos en caja → solo confirmar; un humano lo resuelve; racks en saco → confirmar', () => {
    const e = extraccionAtlasOk();
    e.mercancias[0].descripcion = cv('Sacos de harina'); e.mercancias[0].embalaje = cv('4G');
    expect(codigos(e, SAT())).toContain('confirmar:embalaje_incoherente:embalaje#0');
    expect(validarExtraccion(e, { ahora: AHORA, catalogosSat: SAT() }).bloqueos).toBe(0);
    e.mercancias[0].embalaje = cv('4G', 1, 'humano');
    expect(codigos(e, SAT())).not.toContain('confirmar:embalaje_incoherente:embalaje#0');
    e.mercancias[0].descripcion = cv('Racks de bastidores'); e.mercancias[0].embalaje = cv('5H1');
    expect(codigos(e, SAT())).toContain('confirmar:embalaje_incoherente:embalaje#0');
  });
});

describe('código postal contra el catálogo', () => {
  it('inexistente → bloqueo; estado/municipio/localidad que no cuadran → confirmar', () => {
    const e = extraccionAtlasOk(); e.campos.origen_cp = cv('44999');
    expect(codigos(e, SAT())).toContain('bloqueo:cp_no_catalogo:origen_cp');
    const f = extraccionAtlasOk(); f.campos.destino_municipio_clave = cv('001'); f.campos.destino_localidad_clave = cv('09');
    const c = codigos(f, SAT());
    expect(c).toContain('confirmar:cp_municipio:destino_municipio_clave');
    expect(c).toContain('confirmar:cp_localidad:destino_localidad_clave');
  });
  it('datos que cuadran → nada', () => {
    const e = extraccionAtlasOk(); e.campos.origen_municipio_clave = cv('039');
    expect(codigos(e, SAT()).some((x) => x.includes('cp_'))).toBe(false);
  });
});

describe('precarga: una consulta por catálogo y degradación', () => {
  const sat: Record<string, Map<string, DatosSat>> = {
    [CAT_PRODUCTO]: new Map([['24131500', {}]]),
    [CAT_CP]: new Map([['44100', {}], ['64000', {}]]),
  };
  it('≤ 1 consulta por catálogo por documento, con TODAS las claves del documento', async () => {
    const e = extraccionAtlasOk();
    e.mercancias.push({ ...e.mercancias[0], bienes_transp: cv('11111111'), descripcion: cv('Tapas') });
    const llamadas: Array<{ catalogo: string; claves: string[] }> = [];
    const cargar: CargarCatalogoSat = async (catalogo, claves) => { llamadas.push({ catalogo, claves }); return sat[catalogo] ?? null; };
    const r = await precargarCatalogosSat(e, cargar);
    const por = llamadas.map((l) => l.catalogo);
    expect(new Set(por).size).toBe(por.length);
    expect(llamadas.find((l) => l.catalogo === CAT_PRODUCTO)!.claves.sort()).toEqual(['11111111', '24131500']);
    expect(r.existe(CAT_PRODUCTO, '24131500')).toBe(true);
    expect(r.existe(CAT_PRODUCTO, '11111111')).toBe(false); // el catálogo está cargado y no la trae
    expect(r.existe('c_TipoEmbalaje', '4G')).toBeNull(); // nunca se consultó
  });
  it('catálogo no cargado (null) o error de lectura → null, sin lanzar', async () => {
    const e = extraccionAtlasOk();
    const r = await precargarCatalogosSat(e, async (catalogo) => { if (catalogo === CAT_CP) throw new Error('caída'); return null; });
    expect(r.existe(CAT_PRODUCTO, '24131500')).toBeNull();
    expect(r.existe(CAT_CP, '44100')).toBeNull();
  });
  it('el TMS es segunda fuente SOLO si la local no está cargada; lo que el TMS no sabe queda null', async () => {
    const e = extraccionAtlasOk();
    const preguntas: string[] = [];
    const tms = {
      cargarPlantilla: async () => { throw new Error('no se usa'); },
      consultarCatalogo: async (cat: string, clave: string) => { preguntas.push(`${cat}:${clave}`); return cat === CAT_PRODUCTO ? clave === '24131500' : null; },
    } as unknown as SalidaTms;
    const r = await precargarCatalogosSat(e, async (catalogo) => (catalogo === CAT_CP ? new Map([['44100', {}], ['64000', {}]]) : null), { tms });
    expect(r.existe(CAT_PRODUCTO, '24131500')).toBe(true);
    expect(r.existe(CAT_CP, '44100')).toBe(true); // vino de la local
    expect(preguntas.some((p) => p.startsWith(CAT_CP))).toBe(false); // no se preguntó al TMS lo que la local ya contestó
  });
  it('un TMS que lanza no rompe la validación', async () => {
    const tms = { cargarPlantilla: async () => { throw new Error('x'); }, consultarCatalogo: async () => { throw new Error('caído'); } } as unknown as SalidaTms;
    const r = await precargarCatalogosSat(extraccionAtlasOk(), async () => null, { tms });
    expect(r.existe(CAT_PRODUCTO, '24131500')).toBeNull();
  });
});
