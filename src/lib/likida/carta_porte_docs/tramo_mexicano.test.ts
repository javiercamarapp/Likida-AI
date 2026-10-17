import { describe, expect, it } from 'vitest';
import { aplicarTramoMexicano, catalogoVacio, type CatalogoCliente, type SitioCat } from './catalogo_cliente';
import { leerReglaTramo } from './perfiles';
import { validarExtraccion } from './validacion';
import { cv } from './documentos_sinteticos.fixture';
import type { Extraccion } from './campos';

const T = 'tttttttt-tttt-4ttt-8ttt-tttttttttttt';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTRO_C = 'cccccccc-cccc-4ccc-8ccc-oooooooooooo';
const ctx = { tenantId: T, clienteId: C };

const sitio = (tipo: SitioCat['tipo'], alias: string, over: Partial<SitioCat> = {}): SitioCat => ({
  tenantId: T, clienteId: C, tipo, alias, razonSocial: null, rfc: null, idFiscalExtranjero: null, calle: 'Calle Sintetica', numExt: '1', numInt: null,
  coloniaClave: null, colonia: null, cp: '66600', localidadClave: null, localidad: null, municipioClave: null, municipio: null, estado: 'NLE', pais: 'MEX',
  contacto: null, telefono: null, correo: null, ...over,
});
const cat = (sitios: SitioCat[]): CatalogoCliente => ({ ...catalogoVacio(), sitios });

/** Exportación sintética: el BOL sintético trae como destino al consignatario final, en EE. UU. */
function expo(): Extraccion {
  return {
    campos: {
      regimen_aduanero: cv('EXD'), origen_nombre: cv('Planta Sintetica'), origen_cp: cv('66600'), origen_pais: cv('MEX'),
      destino_nombre: cv('Consignatario Final Sintetico'), destino_cp: cv('78041'), destino_pais: cv('USA'), destino_estado: cv('TX'), destino_calle: cv('Calle Falsa 123'),
    },
    mercancias: [{ descripcion: cv('Pieza'), cantidad: cv('1'), peso_kg: cv('10') }],
  };
}
function impo(): Extraccion {
  return {
    campos: {
      regimen_aduanero: cv('IMD'), origen_nombre: cv('Proveedor Extranjero Sintetico'), origen_cp: cv('78041'), origen_pais: cv('USA'),
      destino_nombre: cv('Bodega Sintetica'), destino_cp: cv('06600'), destino_pais: cv('MEX'),
    },
    mercancias: [{ descripcion: cv('Pieza'), cantidad: cv('1'), peso_kg: cv('10') }],
  };
}
const patio = sitio('patio_propio', 'Patio Sintetico Norte', { cp: '88000', estado: 'TAM', municipio: 'Nuevo Laredo Sintetico' });
const frontera = sitio('frontera', 'Cruce Sintetico', { cp: '88100', estado: 'TAM' });

describe('aplicarTramoMexicano · exportación', () => {
  it('destino = patio propio: ignora el destino del BOL, usa el catálogo y avisa con ambos domicilios', () => {
    const r = aplicarTramoMexicano(expo(), { destinoExportacion: 'patio_propio' }, cat([patio, frontera]), ctx);
    const c = r.extraccion.campos;
    expect(r.bloqueos).toEqual([]);
    expect(c.destino_nombre.valor).toBe('Patio Sintetico Norte');
    expect(c.destino_cp.valor).toBe('88000');
    expect(c.destino_pais.valor).toBe('MEX');
    expect(c.destino_nombre.origen).toBe('catalogo');
    expect(c.destino_calle.valor).toBe('Calle Sintetica'); // domicilio del sitio, no el del BOL
    expect(JSON.stringify(r.extraccion.campos.destino_cp)).not.toContain('78041');
    expect(c.destino_estado.valor).toBe('TAM');
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toContain('Consignatario Final Sintetico');
    expect(r.avisos[0]).toContain('78041');
    expect(r.avisos[0]).toContain('Patio Sintetico Norte');
    const v = validarExtraccion(r.extraccion, { reglaTramo: { destinoExportacion: 'patio_propio' } });
    const h = v.hallazgos.find((x) => x.codigo === 'destino_distinto_documento');
    expect(h?.severidad).toBe('aviso');
    expect(h?.mensaje).toContain('Consignatario Final Sintetico');
    expect(v.hallazgos.some((x) => x.codigo === 'tramo_sin_regla')).toBe(false);
  });

  it('destino = frontera usa el sitio de frontera', () => {
    const r = aplicarTramoMexicano(expo(), { destinoExportacion: 'frontera' }, cat([patio, frontera]), ctx);
    expect(r.extraccion.campos.destino_nombre.valor).toBe('Cruce Sintetico');
    expect(r.extraccion.campos.destino_cp.valor).toBe('88100');
  });

  it('destino = el del documento es regla explícita: no cambia nada y no avisa', () => {
    const e = expo();
    const r = aplicarTramoMexicano(e, { destinoExportacion: 'documento' }, cat([patio]), ctx);
    expect(r.extraccion).toEqual(e);
    expect(r.avisos).toEqual([]);
    expect(r.bloqueos).toEqual([]);
  });

  it.each([[undefined], [null], [{}], [{ origenImportacion: 'patio_propio' as const }]])('sin regla de destino (%j) ⇒ bloqueo «falta definir destino» y NO toma el destino del BOL', (regla) => {
    const e = expo();
    const r = aplicarTramoMexicano(e, regla as never, cat([patio]), ctx);
    expect(r.bloqueos).toHaveLength(1);
    expect(r.bloqueos[0].codigo).toBe('tramo_sin_regla');
    expect(r.bloqueos[0].mensaje).toMatch(/Falta definir destino/);
    expect(r.extraccion).toEqual(e); // no se adivina ni se sustituye
    if (regla === undefined) return; // `undefined` en la validación = «no se evalúa» (ver la prueba siguiente)
    const v = validarExtraccion(e, { reglaTramo: regla as never });
    const b = v.hallazgos.find((x) => x.codigo === 'tramo_sin_regla');
    expect(b?.severidad).toBe('bloqueo');
    expect(b?.mensaje).toMatch(/Falta definir destino/);
    expect(v.listoParaAprobar).toBe(false);
  });

  it('sin evaluar la regla (opción ausente) la validación se comporta como siempre', () => {
    const v = validarExtraccion(expo());
    expect(v.hallazgos.some((x) => x.codigo === 'tramo_sin_regla')).toBe(false);
  });

  it('el sitio no está en el catálogo, o hay dos del mismo tipo ⇒ bloqueo, nunca se elige uno', () => {
    const falta = aplicarTramoMexicano(expo(), { destinoExportacion: 'patio_propio' }, cat([frontera]), ctx);
    expect(falta.bloqueos[0].codigo).toBe('tramo_sitio_faltante');
    expect(falta.extraccion.campos.destino_cp.valor).toBe('78041');
    const dos = aplicarTramoMexicano(expo(), { destinoExportacion: 'patio_propio' }, cat([patio, sitio('patio_propio', 'Otro Patio Sintetico')]), ctx);
    expect(dos.bloqueos[0].codigo).toBe('tramo_sitio_ambiguo');
    expect(dos.extraccion.campos.destino_cp.valor).toBe('78041');
  });

  it('solo cuentan los sitios del mismo tenant y cliente', () => {
    const r = aplicarTramoMexicano(expo(), { destinoExportacion: 'patio_propio' }, cat([{ ...patio, clienteId: OTRO_C }, { ...patio, tenantId: 'otro' }]), ctx);
    expect(r.bloqueos[0].codigo).toBe('tramo_sitio_faltante');
  });

  it('lo escrito por una persona no se pisa, y si el sitio no trae un dato no se queda el del documento', () => {
    const e = expo();
    e.campos.destino_nombre = { ...cv('Nombre Capturado'), origen: 'humano' };
    const r = aplicarTramoMexicano(e, { destinoExportacion: 'patio_propio' }, cat([{ ...patio, calle: null }]), ctx);
    expect(r.extraccion.campos.destino_nombre.valor).toBe('Nombre Capturado');
    expect(r.extraccion.campos.destino_calle).toBeUndefined();
    expect(r.extraccion.campos.destino_estado.valor).toBe('TAM');
  });

  it('no modifica la extracción de entrada', () => {
    const e = expo();
    const copia = structuredClone(e);
    aplicarTramoMexicano(e, { destinoExportacion: 'patio_propio' }, cat([patio]), ctx);
    expect(e).toEqual(copia);
  });
});

describe('aplicarTramoMexicano · importación', () => {
  it('origen = patio propio reemplaza al origen del documento y avisa', () => {
    const r = aplicarTramoMexicano(impo(), { origenImportacion: 'patio_propio' }, cat([patio]), ctx);
    expect(r.extraccion.campos.origen_nombre.valor).toBe('Patio Sintetico Norte');
    expect(r.extraccion.campos.origen_pais.valor).toBe('MEX');
    expect(r.extraccion.campos.destino_nombre.valor).toBe('Bodega Sintetica'); // el otro extremo no se toca
    const v = validarExtraccion(r.extraccion, { reglaTramo: { origenImportacion: 'patio_propio' } });
    expect(v.hallazgos.find((x) => x.codigo === 'origen_distinto_documento')?.severidad).toBe('aviso');
  });

  it('sin regla de origen ⇒ bloqueo «falta definir origen»', () => {
    const r = aplicarTramoMexicano(impo(), { destinoExportacion: 'patio_propio' }, cat([patio]), ctx);
    expect(r.bloqueos[0].mensaje).toMatch(/Falta definir origen/);
  });

  it('origen = el del documento no cambia nada', () => {
    const e = impo();
    expect(aplicarTramoMexicano(e, { origenImportacion: 'documento' }, cat([patio]), ctx).extraccion).toEqual(e);
  });
});

describe('aplicarTramoMexicano · otras operaciones', () => {
  it('sin régimen o nacional no exige regla ni cambia nada', () => {
    const e = expo(); delete e.campos.regimen_aduanero;
    const r = aplicarTramoMexicano(e, null, cat([patio]), ctx);
    expect(r.bloqueos).toEqual([]);
    expect(r.extraccion).toEqual(e);
  });
});

describe('leerReglaTramo', () => {
  it('solo acepta los valores declarados', () => {
    expect(leerReglaTramo({ destinoExportacion: 'frontera', origenImportacion: 'patio_propio' })).toEqual({ destinoExportacion: 'frontera', origenImportacion: 'patio_propio' });
    expect(leerReglaTramo({ destinoExportacion: 'cualquiera', origenImportacion: 7 })).toEqual({});
    expect(leerReglaTramo(null)).toEqual({});
    expect(leerReglaTramo('x')).toEqual({});
  });
});
