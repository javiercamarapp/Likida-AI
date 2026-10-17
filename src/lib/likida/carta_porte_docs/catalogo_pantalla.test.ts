import { describe, expect, it } from 'vitest';
import {
  columnasDeFila, filasDeCatalogo, filtrarFilas, proponerCatalogo, registrosDePropuesta, sugerirSku, validarRegistro, valoresDeFormulario,
  type PropuestaCatalogo,
} from './catalogo_pantalla';
import { catalogoVacio, enriquecer, type CatalogoCliente, type ParteCat, type ProductoCat } from './catalogo_cliente';
import type { CampoValor, Extraccion } from './campos';
import { cv, RFC as RFCS } from './documentos_sinteticos.fixture';
import type { Registro } from './catalogo_import';

const RFC = RFCS.atlas;
const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const humano = (valor: string): CampoValor => ({ valor, confianza: 1, evidencia: null, origen: 'humano', notas: ['Corregido por una persona.'] });
const llm = (valor: string): CampoValor => ({ valor, confianza: 0.97, evidencia: 'x', origen: 'llm' });

/** Un embarque sintético: SKU en la descripción; clave, unidad y embalaje tecleados por una persona. */
function conteoHumano(over: Partial<Extraccion['mercancias'][number]> = {}): Extraccion {
  return {
    campos: {
      origen_nombre: llm('Planta Norte Ejemplo'), origen_rfc: humano(RFC), origen_cp: llm('66600'), origen_estado: llm('NLE'),
      destino_nombre: llm('CEDIS Centro Ejemplo'), destino_rfc: llm(RFC), destino_cp: llm('06600'),
    },
    mercancias: [{
      descripcion: llm('LLANTA SKU-PX-205 55R16'), cantidad: llm('100'), peso_kg: llm('1000'),
      bienes_transp: humano('25172500'), clave_unidad: humano('H87'), embalaje: humano('1A'), ...over,
    }],
  };
}

const producto = (over: Partial<ProductoCat> = {}): ProductoCat => ({
  tenantId: T, clienteId: C, sku: 'SKU-PX-205', descripcionPatron: null, bienesTransp: '25172500', claveUnidad: 'H87', embalaje: '1A', fraccion: null,
  tipoMateria: null, materialPeligroso: false, claveMaterialPeligroso: null, ...over,
});
const parte = (over: Partial<ParteCat> = {}): ParteCat => ({
  tenantId: T, clienteId: C, rol: 'remitente', alias: 'Planta Norte Ejemplo', razonSocial: null, rfc: RFC, idFiscalExtranjero: null, calle: null, numExt: null,
  numInt: null, coloniaClave: null, colonia: null, cp: '66600', localidadClave: null, localidad: null, municipioClave: null, municipio: null, estado: null,
  pais: null, contacto: null, telefono: null, correo: null, ...over,
});

describe('filasDeCatalogo y valoresDeFormulario', () => {
  it('pasa el catálogo a las claves de la plantilla CSV y los booleanos a «si»/«no»', () => {
    const f = filasDeCatalogo({ ...catalogoVacio(), productos: [producto({ materialPeligroso: true, claveMaterialPeligroso: '1203' })], partes: [parte()],
      numero: { tenantId: T, clienteId: C, numeroInterno: '10001', numeroPagador: null, activo: true } });
    expect(f.productos[0]).toMatchObject({ sku: 'SKU-PX-205', bienes_transp: '25172500', material_peligroso: true });
    expect(f.partes[0]).toMatchObject({ rol: 'remitente', alias: 'Planta Norte Ejemplo', rfc: RFC });
    expect(f.numero).toEqual({ numero_interno: '10001', numero_pagador: null, activo: true });
    expect(valoresDeFormulario('producto', f.productos[0]).material_peligroso).toBe('si');
    expect(valoresDeFormulario('producto', null).sku).toBe('');
    expect(valoresDeFormulario('cliente_numero', null).activo).toBe('si');
    expect(Object.keys(valoresDeFormulario('parte', null))).toEqual(columnasDeFila('parte'));
  });
});

describe('validarRegistro: las mismas reglas que el CSV', () => {
  it('una fila buena devuelve el registro canónico con el cliente', () => {
    const v = validarRegistro('producto', C, { sku: 'SKU-1', bienes_transp: '25172500', clave_unidad: 'H87', material_peligroso: 'no' });
    expect(v).toMatchObject({ ok: true, registro: { cliente_id: C, sku: 'SKU-1', bienes_transp: '25172500', material_peligroso: false, embalaje: null } });
  });
  it('RFC inválido, SKU vacío y fórmula se rechazan con mensaje en español', () => {
    const rfcMalo = validarRegistro('parte', C, { rol: 'remitente', alias: 'Planta', rfc: 'MALO' });
    expect(rfcMalo.ok).toBe(false);
    expect(!rfcMalo.ok && rfcMalo.mensaje).toMatch(/RFC «MALO» no tiene forma válida/);
    const sinSku = validarRegistro('producto', C, { sku: '', bienes_transp: '25172500', clave_unidad: 'H87' });
    expect(!sinSku.ok && sinSku.mensaje).toMatch(/Falta «sku»/);
    const formula = validarRegistro('producto', C, { sku: '=cmd', bienes_transp: '25172500', clave_unidad: 'H87' });
    expect(!formula.ok && formula.mensaje).toMatch(/fórmula/);
  });
  it('el número interno exige valor y por omisión queda activo', () => {
    expect(validarRegistro('cliente_numero', C, { numero_interno: '' }).ok).toBe(false);
    expect(validarRegistro('cliente_numero', C, { numero_interno: '10001' })).toMatchObject({ ok: true, registro: { numero_interno: '10001', activo: true } });
  });
});

describe('filtrarFilas', () => {
  const filas: Registro[] = [{ sku: 'SKU-1', bienes_transp: '25172500', descripcion_patron: 'Llanta radial' }, { sku: 'SKU-2', bienes_transp: '11111111', descripcion_patron: null }];
  it('sin acentos ni mayúsculas, todas las palabras deben aparecer; vacío = todo', () => {
    const cols = ['sku', 'descripcion_patron', 'bienes_transp'];
    expect(filtrarFilas(filas, 'LLANTA sku-1', cols)).toHaveLength(1);
    expect(filtrarFilas(filas, 'llanta sku-2', cols)).toHaveLength(0);
    expect(filtrarFilas(filas, '  ', cols)).toHaveLength(2);
    expect(filtrarFilas(filas, '1111', cols)).toEqual([filas[1]]);
  });
});

describe('sugerirSku', () => {
  it('prefiere un código con guion y deja vacío si no hay ninguno', () => {
    expect(sugerirSku('LLANTA SKU-PX-205 55R16')).toBe('SKU-PX-205');
    expect(sugerirSku('Tornillo A123')).toBe('A123');
    expect(sugerirSku('Llantas radiales')).toBe('');
  });
});

describe('proponerCatalogo: solo lo que tecleó una persona', () => {
  it('con clave, unidad y embalaje humanos propone el producto y el remitente (RFC humano); el destinatario (RFC del modelo) no', () => {
    const p = proponerCatalogo(conteoHumano(), catalogoVacio());
    expect(p.productos).toHaveLength(1);
    expect(p.productos[0]).toMatchObject({ indice: 0, skuSugerido: 'SKU-PX-205', estado: 'nuevo', campos: { bienes_transp: '25172500', clave_unidad: 'H87', embalaje: '1A' } });
    expect(p.partes.map((x) => x.lado)).toEqual(['origen']);
    expect(p.partes[0]).toMatchObject({ rol: 'remitente', alias: 'Planta Norte Ejemplo', campos: { rfc: RFC, cp: '66600', estado: 'NLE' } });
  });

  it('si todo lo leyó el modelo, el XML o el catálogo, no propone nada (banner ausente)', () => {
    const e = conteoHumano({ bienes_transp: llm('25172500'), clave_unidad: cv('H87'), embalaje: { ...llm('1A'), origen: 'catalogo' } });
    e.campos.origen_rfc = llm(RFC);
    expect(proponerCatalogo(e, catalogoVacio())).toEqual({ productos: [], partes: [] });
  });

  it('no propone un producto sin clave o sin unidad (no sería una fila válida)', () => {
    const e = conteoHumano({ clave_unidad: { valor: null, confianza: 0, evidencia: null, origen: 'llm' } });
    expect(proponerCatalogo(e, catalogoVacio()).productos).toEqual([]);
  });

  it('si el catálogo ya conoce el producto se propone actualizar ESE SKU; y la parte conocida por RFC se actualiza con su nombre corto', () => {
    const e = conteoHumano();
    e.campos.origen_nombre = llm('Nombre distinto');
    const cat: CatalogoCliente = { ...catalogoVacio(), productos: [producto({ bienesTransp: '99999999' })], partes: [parte({ cp: '00000' })] };
    const p = proponerCatalogo(e, cat);
    expect(p.productos[0]).toMatchObject({ skuSugerido: 'SKU-PX-205', estado: 'cambia' });
    expect(p.partes[0]).toMatchObject({ alias: 'Planta Norte Ejemplo', estado: 'cambia' });
  });

  it('lo que ya está idéntico en el catálogo no se vuelve a ofrecer; si difiere se ofrece como «cambia»', () => {
    const igual: CatalogoCliente = { ...catalogoVacio(), productos: [producto()], partes: [parte()] };
    expect(proponerCatalogo(conteoHumano(), igual)).toEqual({ productos: [], partes: [] });
    const otro: CatalogoCliente = { ...catalogoVacio(), productos: [producto({ bienesTransp: '99999999' })] };
    expect(proponerCatalogo(conteoHumano(), otro).productos[0].estado).toBe('cambia');
  });
});

describe('registrosDePropuesta', () => {
  const propuesta = (): PropuestaCatalogo => proponerCatalogo(conteoHumano(), catalogoVacio());

  it('con el SKU confirmado y los lados marcados devuelve filas válidas del catálogo', () => {
    const r = registrosDePropuesta(propuesta(), C, { productos: [{ indice: 0, sku: 'SKU-PX-205' }], partes: ['origen'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.productos[0]).toMatchObject({ cliente_id: C, sku: 'SKU-PX-205', bienes_transp: '25172500', clave_unidad: 'H87', embalaje: '1A', material_peligroso: false });
    expect(r.partes[0]).toMatchObject({ cliente_id: C, rol: 'remitente', alias: 'Planta Norte Ejemplo', rfc: RFC, cp: '66600' });
  });

  it('un SKU vacío, uno repetido o una selección vacía se rechazan todo o nada, con el motivo', () => {
    const vacio = registrosDePropuesta(propuesta(), C, { productos: [{ indice: 0, sku: '  ' }], partes: ['origen'] });
    expect(vacio).toMatchObject({ ok: false });
    expect(!vacio.ok && vacio.errores[0]).toMatch(/Mercancía 1: Falta «sku»/);
    const nada = registrosDePropuesta(propuesta(), C, { productos: [], partes: [] });
    expect(!nada.ok && nada.errores).toEqual(['No elegiste nada para guardar.']);
    const ajeno = registrosDePropuesta(propuesta(), C, { productos: [{ indice: 0, sku: 'OTRO-999' }], partes: [] });
    expect(!ajeno.ok && ajeno.errores[0]).toMatch(/no aparece en su descripción/);
    const inexistente = registrosDePropuesta(propuesta(), C, { productos: [{ indice: 7, sku: 'X-1' }], partes: [] });
    expect(!inexistente.ok && inexistente.errores[0]).toMatch(/ya no tiene datos/);
  });

  it('guardar crea la fila y el siguiente documento del mismo SKU sale del catálogo (clave, unidad y embalaje con origen catálogo)', () => {
    const r = registrosDePropuesta(propuesta(), C, { productos: [{ indice: 0, sku: 'SKU-PX-205' }], partes: ['origen'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // «La base»: lo escrito vuelve a leerse como catálogo del cliente.
    const p = r.productos[0];
    const q = r.partes[0];
    const catalogo: CatalogoCliente = {
      ...catalogoVacio(),
      productos: [producto({ sku: String(p.sku), bienesTransp: String(p.bienes_transp), claveUnidad: String(p.clave_unidad), embalaje: p.embalaje as string | null })],
      partes: [parte({ alias: String(q.alias), rfc: String(q.rfc), cp: q.cp as string | null })],
    };
    // El siguiente embarque trae el mismo SKU, pero ni clave, ni unidad, ni RFC.
    const siguiente: Extraccion = {
      campos: { origen_nombre: llm('Planta Norte Ejemplo'), origen_cp: llm('66600') },
      mercancias: [{ descripcion: llm('LLANTA SKU-PX-205 55R16'), cantidad: llm('50'), peso_kg: llm('500') }],
    };
    const e = enriquecer(siguiente, catalogo, { tenantId: T, clienteId: C });
    for (const k of ['bienes_transp', 'clave_unidad', 'embalaje'] as const) expect(e.extraccion.mercancias[0][k]).toMatchObject({ origen: 'catalogo' });
    expect(e.extraccion.mercancias[0].bienes_transp.valor).toBe('25172500');
    expect(e.extraccion.campos.origen_rfc).toMatchObject({ valor: RFC, origen: 'catalogo' });
    // Y ya no hay nada más que ofrecer guardar.
    expect(proponerCatalogo(e.extraccion, catalogo)).toEqual({ productos: [], partes: [] });
  });
});
