import { describe, expect, it } from 'vitest';
import { avisosDelCatalogo, catalogoVacio, enriquecer, TOPE_FILAS_CATALOGO, type CatalogoCliente, type ParteCat, type ProductoCat } from './catalogo_cliente';
import { validarExtraccion } from './validacion';
import { cv, RFC } from './documentos_sinteticos.fixture';
import type { Extraccion } from './campos';

const T = 'tttttttt-tttt-4ttt-8ttt-tttttttttttt';
const OTRO_T = 'tttttttt-tttt-4ttt-8ttt-oooooooooooo';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTRO_C = 'cccccccc-cccc-4ccc-8ccc-oooooooooooo';
const ctx = { tenantId: T, clienteId: C };

const producto = (sku: string, over: Partial<ProductoCat> = {}): ProductoCat => ({
  tenantId: T, clienteId: C, sku, descripcionPatron: null, bienesTransp: '25172500', claveUnidad: 'H87', embalaje: '1A', fraccion: '4011100100', tipoMateria: '01', // grep-limpio:ok
  materialPeligroso: false, claveMaterialPeligroso: null, ...over,
});

const parte = (rol: ParteCat['rol'], alias: string, over: Partial<ParteCat> = {}): ParteCat => ({
  tenantId: T, clienteId: C, rol, alias, razonSocial: null, rfc: null, idFiscalExtranjero: null, calle: null, numExt: null, numInt: null,
  coloniaClave: null, colonia: null, cp: null, localidadClave: null, localidad: null, municipioClave: null, municipio: null, estado: null, pais: null,
  contacto: null, telefono: null, correo: null, ...over,
});

const cat = (over: Partial<CatalogoCliente> = {}): CatalogoCliente => ({ ...catalogoVacio(), ...over });

/** Un embarque «sin clave SAT ni RFC»: solo el SKU en la descripción y los nombres cortos de los sitios. */
function sinSat(descripcion = 'LLANTA SKU-PX-205 55R16'): Extraccion {
  return {
    campos: {
      folio_cliente: cv('EMB-1'), origen_nombre: cv('Planta Norte'), origen_cp: cv('66600'), destino_nombre: cv('CEDIS Centro'), destino_cp: cv('06600'),
      peso_bruto_total: cv('1000'),
    },
    mercancias: [{ descripcion: cv(descripcion), cantidad: cv('100'), peso_kg: cv('1000') }],
  };
}

describe('enriquecer · producto por SKU', () => {
  it('un SKU conocido llena cinco campos (y los peligrosos) con origen catálogo, 0.95 y evidencia', () => {
    const r = enriquecer(sinSat(), cat({ productos: [producto('SKU-PX-205')] }), ctx);
    const m = r.extraccion.mercancias[0];
    for (const [k, v] of [['bienes_transp', '25172500'], ['clave_unidad', 'H87'], ['embalaje', '1A'], ['fraccion_arancelaria', '4011100100'], ['tipo_materia', '01']] as const) { // grep-limpio:ok
      expect(m[k]).toMatchObject({ valor: v, origen: 'catalogo', confianza: 0.95 });
      expect(m[k].evidencia).toBe('Catálogo del cliente: SKU SKU-PX-205');
    }
    expect(m.material_peligroso).toMatchObject({ valor: 'false', origen: 'catalogo' });
    expect(m.clave_material_peligroso).toBeUndefined();
    expect(r.aplicados).toContain('mercancias.0.bienes_transp');
    expect(r.ambiguos).toEqual([]);
  });

  it('no muta la extracción original', () => {
    const e = sinSat();
    const copia = JSON.parse(JSON.stringify(e));
    enriquecer(e, cat({ productos: [producto('SKU-PX-205')] }), ctx);
    expect(e).toEqual(copia);
  });

  it('un SKU desconocido deja todo vacío y lo reporta', () => {
    const r = enriquecer(sinSat('LLANTA OTRO-999'), cat({ productos: [producto('SKU-PX-205')] }), ctx);
    expect(r.extraccion.mercancias[0].bienes_transp).toBeUndefined();
    expect(r.aplicados).toEqual([]);
    expect(r.desconocidos).toEqual(['mercancias.0']);
    expect(avisosDelCatalogo(r, false).join(' ')).toMatch(/sin coincidencia/);
  });

  it('el SKU es por palabra completa: «SKU-PX-2055» no es «SKU-PX-205»', () => {
    const r = enriquecer(sinSat('LLANTA SKU-PX-2055'), cat({ productos: [producto('SKU-PX-205')] }), ctx);
    expect(r.aplicados).toEqual([]);
  });

  it('un patrón de descripción (texto plano) también resuelve', () => {
    const r = enriquecer(sinSat('Alimento ENLATADO surtido'), cat({ productos: [producto('X1', { descripcionPatron: 'enlatado' })] }), ctx);
    expect(r.extraccion.mercancias[0].bienes_transp.valor).toBe('25172500');
  });

  it('un patrón con forma de regex se toma literal (no se ejecuta)', () => {
    const r = enriquecer(sinSat('abc'), cat({ productos: [producto('X1', { descripcionPatron: '(a+)+$' })] }), ctx);
    expect(r.aplicados).toEqual([]);
  });

  it('dos SKU que coinciden → ambiguo, no se aplica nada', () => {
    const r = enriquecer(sinSat('LLANTA SKU-PX-205 SKU-PX-300'), cat({ productos: [producto('SKU-PX-205'), producto('SKU-PX-300', { bienesTransp: '99999999' })] }), ctx);
    expect(r.ambiguos).toHaveLength(1);
    expect(r.ambiguos[0]).toMatch(/SKU-PX-205, SKU-PX-300/);
    expect(r.extraccion.mercancias[0].bienes_transp).toBeUndefined();
    expect(r.aplicados).toEqual([]);
  });

  it('SKU y patrón del MISMO producto cuentan como una sola coincidencia', () => {
    const r = enriquecer(sinSat('LLANTA SKU-PX-205'), cat({ productos: [producto('SKU-PX-205', { descripcionPatron: 'llanta' })] }), ctx);
    expect(r.ambiguos).toEqual([]);
    expect(r.extraccion.mercancias[0].bienes_transp.valor).toBe('25172500');
  });

  it('material peligroso con su clave', () => {
    const r = enriquecer(sinSat(), cat({ productos: [producto('SKU-PX-205', { materialPeligroso: true, claveMaterialPeligroso: '1203' })] }), ctx);
    expect(r.extraccion.mercancias[0]).toMatchObject({ material_peligroso: { valor: 'true' }, clave_material_peligroso: { valor: '1203' } });
  });
});

describe('enriquecer · nunca pisa', () => {
  it('un valor humano no se toca (ni se anota)', () => {
    const e = sinSat();
    e.mercancias[0].bienes_transp = cv('11111111', 1, 'humano');
    const r = enriquecer(e, cat({ productos: [producto('SKU-PX-205')] }), ctx);
    expect(r.extraccion.mercancias[0].bienes_transp).toEqual(cv('11111111', 1, 'humano'));
    expect(r.aplicados).not.toContain('mercancias.0.bienes_transp');
    // lo demás sí se llena
    expect(r.extraccion.mercancias[0].clave_unidad.origen).toBe('catalogo');
  });

  it('un humano que dejó un campo vacío a propósito tampoco se rellena', () => {
    const e = sinSat();
    e.mercancias[0].embalaje = cv(null, 1, 'humano');
    const r = enriquecer(e, cat({ productos: [producto('SKU-PX-205')] }), ctx);
    expect(r.extraccion.mercancias[0].embalaje.valor).toBeNull();
  });

  it('discrepancia con un valor del documento seguro: conserva el documento y deja un «confirmar»', () => {
    const e = sinSat();
    e.mercancias[0].bienes_transp = cv('24131500', 0.97);
    const r = enriquecer(e, cat({ productos: [producto('SKU-PX-205')] }), ctx);
    const campo = r.extraccion.mercancias[0].bienes_transp;
    expect(campo.valor).toBe('24131500');
    expect(campo.origen).toBe('llm');
    expect(campo.notas).toEqual(['El catálogo dice «25172500», el documento dice «24131500». Confírmalo.']);
    expect(r.aplicados).not.toContain('mercancias.0.bienes_transp');

    const v = validarExtraccion(r.extraccion);
    const h = v.hallazgos.find((x) => x.campo === 'bienes_transp' && x.severidad === 'confirmar');
    expect(h?.mensaje).toMatch(/El catálogo dice «25172500», el documento dice «24131500»/);
    expect(v.listoParaAprobar).toBe(false);

    // Un humano que decide ya no deja pendiente el hallazgo.
    r.extraccion.mercancias[0].bienes_transp = cv('24131500', 1, 'humano');
    expect(validarExtraccion(r.extraccion).hallazgos.some((x) => x.campo === 'bienes_transp' && x.severidad === 'confirmar')).toBe(false);
  });

  it('si coinciden (aunque con otra forma) no hay nota ni cambio', () => {
    const e = sinSat();
    e.mercancias[0].fraccion_arancelaria = cv('4011.10.01.00', 0.97);
    const r = enriquecer(e, cat({ productos: [producto('SKU-PX-205')] }), ctx);
    expect(r.extraccion.mercancias[0].fraccion_arancelaria.notas).toBeUndefined();
    expect(r.extraccion.mercancias[0].fraccion_arancelaria.origen).toBe('llm');
  });

  it('un valor del documento de confianza baja cede ante el catálogo y queda anotado', () => {
    const e = sinSat();
    e.mercancias[0].clave_unidad = cv('7', 0.4);
    const r = enriquecer(e, cat({ productos: [producto('SKU-PX-205')] }), ctx);
    expect(r.extraccion.mercancias[0].clave_unidad).toMatchObject({ valor: 'H87', origen: 'catalogo' });
    expect(r.extraccion.mercancias[0].clave_unidad.notas?.[0]).toMatch(/Antes se leyó «7»/);
    expect(r.aplicados).toContain('mercancias.0.clave_unidad');
  });
});

describe('enriquecer · remitente y destinatario', () => {
  const remitente = parte('remitente', 'Planta Norte', { razonSocial: 'Manufacturas del Norte SA de CV', rfc: RFC.atlas, calle: 'Av. Industria', numExt: '100', coloniaClave: '0123', colonia: 'Parque Industrial', cp: '66600', localidadClave: '01', localidad: 'Monterrey', municipioClave: '039', municipio: 'Monterrey', estado: 'NLE', pais: 'MEX' });
  const destinatario = parte('destinatario', 'CEDIS Centro', { rfc: RFC.destino1, calle: 'Calle 5', cp: '06600', estado: 'CMX', pais: 'MEX', contacto: 'Contacto Sintético', telefono: '5555550100', correo: 'contacto@ejemplo.test' }); // grep-limpio:ok

  it('por alias normalizado (acentos y mayúsculas) llena RFC y domicilio estructurado', () => {
    const e = sinSat();
    e.campos.origen_nombre = cv('PLANTA  NÓRTE'.replace('Ó', 'O'));
    const r = enriquecer(e, cat({ partes: [remitente, destinatario] }), ctx);
    expect(r.extraccion.campos).toMatchObject({
      origen_rfc: { valor: RFC.atlas, origen: 'catalogo' }, origen_calle: { valor: 'Av. Industria' }, origen_num_ext: { valor: '100' },
      origen_colonia: { valor: 'Parque Industrial' }, origen_municipio_clave: { valor: '039' }, origen_estado: { valor: 'NLE' }, origen_pais: { valor: 'MEX' },
      destino_rfc: { valor: RFC.destino1 }, destino_calle: { valor: 'Calle 5' }, contacto_destino_correo: { valor: 'contacto@ejemplo.test' },
    });
    expect(r.extraccion.campos.origen_rfc.evidencia).toBe('Catálogo del cliente: remitente «Planta Norte»');
    expect(r.extraccion.campos.origen_cp.origen).toBe('llm'); // ya coincidía: no se reescribe
  });

  it('por razón social', () => {
    const e = sinSat();
    e.campos.origen_nombre = cv('Manufacturas del Norte, S.A. de C.V.');
    expect(enriquecer(e, cat({ partes: [remitente] }), ctx).extraccion.campos.origen_rfc.valor).toBe(RFC.atlas); // puntuación y comas no cuentan
    e.campos.origen_nombre = cv('Manufacturas del Norte');
    expect(enriquecer(e, cat({ partes: [remitente] }), ctx).extraccion.campos.origen_rfc).toBeUndefined(); // igualdad, no parecido: no adivina
    e.campos.origen_nombre = cv('manufacturas del norte sa de cv');
    expect(enriquecer(e, cat({ partes: [remitente] }), ctx).extraccion.campos.origen_rfc.valor).toBe(RFC.atlas);
  });

  it('por RFC, aunque el nombre no coincida', () => {
    const e = sinSat();
    e.campos.origen_nombre = cv('Otro nombre'); e.campos.origen_rfc = cv(RFC.atlas);
    const r = enriquecer(e, cat({ partes: [remitente] }), ctx);
    expect(r.extraccion.campos.origen_calle.valor).toBe('Av. Industria');
    expect(r.extraccion.campos.origen_rfc.origen).toBe('llm');
  });

  it('el rol importa: un remitente no resuelve al destinatario', () => {
    const e = sinSat();
    e.campos.destino_nombre = cv('Planta Norte');
    expect(enriquecer(e, cat({ partes: [remitente] }), ctx).extraccion.campos.destino_rfc).toBeUndefined();
  });

  it('dos partes que coinciden (mismo RFC) → ambiguo', () => {
    const e = sinSat();
    e.campos.origen_rfc = cv(RFC.atlas);
    const r = enriquecer(e, cat({ partes: [remitente, parte('remitente', 'Otra planta', { rfc: RFC.atlas, calle: 'X' })] }), ctx);
    expect(r.ambiguos).toHaveLength(1);
    expect(r.extraccion.campos.origen_calle).toBeUndefined();
  });

  it('el RFC leído del documento seguro NO se pisa: se anota la discrepancia', () => {
    const e = sinSat();
    e.campos.origen_rfc = cv(RFC.boreal, 0.97);
    const r = enriquecer(e, cat({ partes: [remitente] }), ctx);
    expect(r.extraccion.campos.origen_rfc.valor).toBe(RFC.boreal);
    expect(r.extraccion.campos.origen_rfc.notas?.[0]).toContain(`El catálogo dice «${RFC.atlas}»`);
  });

  it('id fiscal extranjero del destinatario', () => {
    const e = sinSat();
    const r = enriquecer(e, cat({ partes: [parte('destinatario', 'CEDIS Centro', { idFiscalExtranjero: 'TAX-123456', pais: 'USA' })] }), ctx);
    expect(r.extraccion.campos).toMatchObject({ destino_id_fiscal: { valor: 'TAX-123456' }, destino_pais: { valor: 'USA' } });
  });

  it('un valor más largo que el campo no se aplica', () => {
    const e = sinSat();
    const r = enriquecer(e, cat({ partes: [parte('remitente', 'Planta Norte', { calle: 'x'.repeat(61) })] }), ctx);
    expect(r.extraccion.campos.origen_calle).toBeUndefined();
  });
});

describe('enriquecer · número interno del cliente', () => {
  const numero = { tenantId: T, clienteId: C, numeroInterno: 'CLI-0042', numeroPagador: 'CLI-0099', activo: true };

  it('lo llena desde el cliente del documento', () => {
    const r = enriquecer(sinSat(), cat({ numero }), ctx);
    expect(r.extraccion.campos.numero_cliente_interno).toMatchObject({ valor: 'CLI-0042', origen: 'catalogo', confianza: 0.95 });
  });
  it('un número inactivo no se usa', () => {
    expect(enriquecer(sinSat(), cat({ numero: { ...numero, activo: false } }), ctx).extraccion.campos.numero_cliente_interno).toBeUndefined();
  });
});

describe('enriquecer · aislamiento y no-op', () => {
  it('sin catálogo, o sin cliente en el documento, no hace nada', () => {
    const e = sinSat();
    expect(enriquecer(e, null, ctx)).toMatchObject({ aplicados: [], ambiguos: [], extraccion: e });
    expect(enriquecer(e, cat(), ctx).aplicados).toEqual([]);
    expect(enriquecer(e, cat({ productos: [producto('SKU-PX-205')] }), { tenantId: T, clienteId: null }).aplicados).toEqual([]);
  });

  it('filas de otro cliente o de otra flota no se leen aunque lleguen mezcladas', () => {
    const r = enriquecer(sinSat(), cat({
      productos: [producto('SKU-PX-205', { clienteId: OTRO_C, bienesTransp: '11111111' }), producto('SKU-PX-205', { tenantId: OTRO_T, bienesTransp: '22222222' })],
      partes: [parte('remitente', 'Planta Norte', { clienteId: OTRO_C, rfc: RFC.atlas }), parte('remitente', 'Planta Norte', { tenantId: OTRO_T, rfc: RFC.atlas })],
      numero: { tenantId: OTRO_T, clienteId: C, numeroInterno: 'AJENO', numeroPagador: null, activo: true },
    }), ctx);
    expect(r.aplicados).toEqual([]);
    expect(r.ambiguos).toEqual([]);
    expect(r.extraccion.mercancias[0].bienes_transp).toBeUndefined();
    expect(r.extraccion.campos.numero_cliente_interno).toBeUndefined();
  });

  it('el aviso de tope se muestra cuando la lectura se truncó', () => {
    const r = enriquecer(sinSat(), cat(), ctx);
    expect(avisosDelCatalogo(r, true).join(' ')).toContain(String(TOPE_FILAS_CATALOGO));
  });
});

describe('documento sin clave SAT ni RFC (cliente con SKU y alias)', () => {
  const catalogo = cat({
    numero: { tenantId: T, clienteId: C, numeroInterno: 'CLI-0042', numeroPagador: null, activo: true },
    productos: [producto('SKU-PX-205')],
    partes: [
      parte('remitente', 'Planta Norte', { rfc: RFC.atlas, cp: '66600', estado: 'NLE', pais: 'MEX', calle: 'Av. Industria' }),
      parte('destinatario', 'CEDIS Centro', { rfc: RFC.destino1, cp: '06600', estado: 'CMX', pais: 'MEX', calle: 'Calle 5' }),
    ],
  });
  const completo = (): Extraccion => {
    const e = sinSat();
    e.mercancias[0].unidad_texto = cv('Piezas');
    return e;
  };

  it('sin catálogo se bloquea por lo que el documento no trae', () => {
    const v = validarExtraccion(completo());
    const faltan = v.hallazgos.filter((h) => h.severidad === 'bloqueo').map((h) => h.campo).sort();
    expect(faltan).toEqual(expect.arrayContaining(['bienes_transp', 'clave_unidad', 'origen_rfc', 'destino_rfc']));
    expect(v.listoParaAprobar).toBe(false);
  });

  it('con catálogo ya no hay bloqueos: solo quedan valor y moneda (que el documento no trae)', () => {
    const r = enriquecer(completo(), catalogo, ctx);
    const v = validarExtraccion(r.extraccion);
    expect(v.hallazgos.filter((h) => h.severidad === 'bloqueo')).toEqual([]);
    expect(v.bloqueos).toBe(0);
    const m = r.extraccion.mercancias[0];
    expect(m.valor_mercancia).toBeUndefined();
    expect(m.moneda).toBeUndefined();
    expect(r.extraccion.campos.numero_cliente_interno.valor).toBe('CLI-0042');
  });
});

describe('A37-A3-09 — el catálogo no vuelve «No» un «Sí» peligroso del documento en silencio', () => {
  it('documento dice peligroso (0.8) y el catálogo dice No: se conserva el Sí del documento y se pide confirmar', () => {
    const e = sinSat();
    e.mercancias[0].material_peligroso = cv('true', 0.8, 'llm', 'DISOLVENTE INFLAMABLE');
    const r = enriquecer(e, cat({ productos: [producto('SKU-PX-205', { materialPeligroso: false })] }), ctx);
    const campo = r.extraccion.mercancias[0].material_peligroso;
    expect(campo).toMatchObject({ valor: 'true', origen: 'llm' });
    expect(campo.notas?.join(' ')).toMatch(/catálogo dice «false».*Confírmalo/);
    const h = validarExtraccion(r.extraccion).hallazgos.filter((x) => x.campo === 'material_peligroso');
    expect(h.map((x) => x.codigo)).toContain('normalizacion_dudosa');
  });
  it('documento dice No (0.8) y el catálogo dice peligroso: tampoco se pisa; se pide confirmar', () => {
    const e = sinSat();
    e.mercancias[0].material_peligroso = cv('false', 0.8, 'llm', 'NO PELIGROSO');
    const r = enriquecer(e, cat({ productos: [producto('SKU-PX-205', { materialPeligroso: true, claveMaterialPeligroso: '1203' })] }), ctx);
    expect(r.extraccion.mercancias[0].material_peligroso).toMatchObject({ valor: 'false', origen: 'llm' });
    expect(validarExtraccion(r.extraccion).hallazgos.map((x) => x.codigo)).toContain('normalizacion_dudosa');
  });
  it('si el documento no dice nada, el catálogo sigue llenando el campo', () => {
    const r = enriquecer(sinSat(), cat({ productos: [producto('SKU-PX-205', { materialPeligroso: true, claveMaterialPeligroso: '1203' })] }), ctx);
    expect(r.extraccion.mercancias[0].material_peligroso).toMatchObject({ valor: 'true', origen: 'catalogo' });
  });
});
