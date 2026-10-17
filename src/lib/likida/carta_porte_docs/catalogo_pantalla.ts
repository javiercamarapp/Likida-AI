// ═══════════════════════════════════════════════════════════════════════════
// LA PANTALLA «CATÁLOGO DEL CLIENTE» Y «GUARDAR DESDE UN DOCUMENTO» (T-A3-22). Todo lo puro:
//
//   · pasar el catálogo leído (camelCase) a las filas que pinta y edita la pantalla (snake_case, como la importación);
//   · validar UNA fila editada con las MISMAS reglas que la importación por CSV (un solo juego de reglas, no dos);
//   · filtrar las tablas;
//   · proponer qué guardar en el catálogo cuando una persona tecleó un dato de SKU o de remitente/destinatario en la
//     revisión de un documento. La propuesta es solo una SUGERENCIA: nada se guarda sin que la persona lo pida
//     (el botón del banner), y el SKU —que ningún documento declara como campo— lo confirma ella.
//
// La base entra por el puerto de `catalogo_import` (recibe quien llama); aquí no hay base.
// ═══════════════════════════════════════════════════════════════════════════

import type { CampoValor, Extraccion } from './campos';
import { llaveTexto } from './catalogos';
import { productosQueCoinciden, type CatalogoCliente, type ProductoCat } from './catalogo_cliente';
import { columnasDePlantilla, validarFilas, type Registro, type TipoPlantilla } from './catalogo_import';

// ── Filas de la pantalla ────────────────────────────────────────────────────

export interface FilasCatalogo { numero: Registro | null; productos: Registro[]; partes: Registro[] }

/** El catálogo de un cliente tal como lo pinta y edita la pantalla (mismas claves que las columnas de la plantilla CSV). */
export function filasDeCatalogo(c: CatalogoCliente): FilasCatalogo {
  return {
    numero: c.numero
      ? { numero_interno: c.numero.numeroInterno, numero_pagador: c.numero.numeroPagador, activo: c.numero.activo }
      : null,
    productos: c.productos.map((p): Registro => ({
      sku: p.sku, descripcion_patron: p.descripcionPatron, bienes_transp: p.bienesTransp, clave_unidad: p.claveUnidad,
      embalaje: p.embalaje, fraccion: p.fraccion, tipo_materia: p.tipoMateria, material_peligroso: p.materialPeligroso,
      clave_material_peligroso: p.claveMaterialPeligroso,
    })),
    partes: c.partes.map((p): Registro => ({
      rol: p.rol, alias: p.alias, razon_social: p.razonSocial, rfc: p.rfc, id_fiscal_extranjero: p.idFiscalExtranjero,
      calle: p.calle, num_ext: p.numExt, num_int: p.numInt, colonia_clave: p.coloniaClave, colonia: p.colonia, cp: p.cp,
      localidad_clave: p.localidadClave, localidad: p.localidad, municipio_clave: p.municipioClave, municipio: p.municipio,
      estado: p.estado, pais: p.pais, contacto: p.contacto, telefono: p.telefono, correo: p.correo,
    })),
  };
}

/** Los rótulos en lenguaje llano de cada columna (la pantalla y los mensajes de error hablan igual). */
export const ROTULO_COLUMNA: Readonly<Record<string, string>> = {
  sku: 'SKU', descripcion_patron: 'Texto que lo identifica', bienes_transp: 'Clave de producto SAT', clave_unidad: 'Unidad SAT',
  embalaje: 'Embalaje', fraccion: 'Fracción arancelaria', tipo_materia: 'Tipo de materia', material_peligroso: 'Material peligroso',
  clave_material_peligroso: 'Clave de material peligroso', rol: 'Rol', alias: 'Nombre corto', razon_social: 'Razón social', rfc: 'RFC',
  id_fiscal_extranjero: 'ID fiscal extranjero', calle: 'Calle', num_ext: 'Núm. exterior', num_int: 'Núm. interior',
  colonia_clave: 'Clave de colonia', colonia: 'Colonia', cp: 'Código postal', localidad_clave: 'Clave de localidad', localidad: 'Localidad',
  municipio_clave: 'Clave de municipio', municipio: 'Municipio', estado: 'Estado', pais: 'País', contacto: 'Contacto', telefono: 'Teléfono',
  correo: 'Correo', numero_interno: 'Número interno del cliente', numero_pagador: 'Número del que paga', activo: 'Activo',
};

/** Las columnas de la fila (sin «cliente», que ya es la elegida en la pantalla) en el orden de la plantilla. */
export const columnasDeFila = (tipo: TipoPlantilla): string[] => columnasDePlantilla(tipo).slice(1);

/** Las columnas que forman la clave natural: no se editan en una fila que ya existe (cambiarlas sería crear otra). */
export const COLUMNAS_CLAVE: Readonly<Record<TipoPlantilla, readonly string[]>> = { producto: ['sku'], parte: ['rol', 'alias'], cliente_numero: [] };

const textoDe = (v: Registro[string] | undefined): string => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'si' : 'no') : v);

/** Los valores de una fila como texto de formulario (booleanos «si»/«no»). */
export function valoresDeFormulario(tipo: TipoPlantilla, fila: Registro | null): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const c of columnasDeFila(tipo)) salida[c] = fila ? textoDe(fila[c]) : (tipo === 'cliente_numero' && c === 'activo' ? 'si' : '');
  return salida;
}

// ── Validar UNA fila (las mismas reglas que el CSV) ─────────────────────────

export type ValidacionFila = { ok: true; registro: Registro } | { ok: false; mensaje: string };

/**
 * Valida una fila de texto como si fuera la única de un CSV de ese cliente: mismo RFC, mismos largos, mismo bloqueo de
 * fórmulas, mismos mensajes en español. Devuelve el registro canónico (con `cliente_id`) listo para el upsert.
 */
export function validarRegistro(tipo: TipoPlantilla, clienteId: string, valores: Readonly<Record<string, string>>): ValidacionFila {
  const cols = columnasDeFila(tipo);
  const v = validarFilas(tipo, [columnasDePlantilla(tipo), [clienteId, ...cols.map((c) => (valores[c] ?? '').trim())]], [{ id: clienteId, nombre: '' }]);
  if (!v.ok) return { ok: false, mensaje: v.mensaje };
  if (v.errores.length > 0) return { ok: false, mensaje: v.errores[0].mensaje };
  return { ok: true, registro: v.validas[0].registro };
}

// ── Filtrar ─────────────────────────────────────────────────────────────────

/** Sin acentos ni mayúsculas, todas las palabras escritas deben aparecer en alguna de las columnas dadas. */
export function filtrarFilas(filas: readonly Registro[], texto: string, columnas: readonly string[]): Registro[] {
  const palabras = llaveTexto(texto).split(' ').filter((p) => p !== '');
  if (palabras.length === 0) return [...filas];
  return filas.filter((f) => {
    const pajar = llaveTexto(columnas.map((c) => textoDe(f[c])).join(' '));
    return palabras.every((p) => pajar.includes(p));
  });
}

// ── Proponer qué guardar desde un documento ─────────────────────────────────

export interface ItemProducto {
  /** Posición del renglón en el documento. */
  indice: number;
  descripcion: string;
  /** Una sugerencia (un código dentro de la descripción); la persona la confirma o la corrige. */
  skuSugerido: string;
  /** `cambia` = el SKU sugerido ya está en el catálogo con otros datos. */
  estado: 'nuevo' | 'cambia';
  campos: { bienes_transp: string; clave_unidad: string; embalaje: string | null; fraccion: string | null; tipo_materia: string | null; material_peligroso: boolean; clave_material_peligroso: string | null };
}

export type LadoParte = 'origen' | 'destino';

export interface ItemParte {
  lado: LadoParte;
  rol: 'remitente' | 'destinatario';
  alias: string;
  estado: 'nuevo' | 'cambia';
  campos: Record<string, string | null>;
}

export interface PropuestaCatalogo { productos: ItemProducto[]; partes: ItemParte[] }

export const propuestaVacia = (p: PropuestaCatalogo): boolean => p.productos.length === 0 && p.partes.length === 0;

const compacta = (s: string): string => llaveTexto(s).replace(/[^a-z0-9]+/g, '');
const valorDe = (c: CampoValor | undefined): string | null => { const t = (c?.valor ?? '').trim(); return t === '' ? null : t; };
const esHumano = (c: CampoValor | undefined): boolean => c?.origen === 'humano' && valorDe(c) !== null;

/** Un código de producto dentro de la descripción: una «palabra» con letras y números (mejor si lleva guion). Vacío si no hay. */
export function sugerirSku(descripcion: string): string {
  const candidatos = descripcion.split(/[\s,;:()/]+/).filter((t) => t.length >= 3 && t.length <= 80 && /[0-9]/.test(t) && /[A-Za-z]/.test(t));
  return candidatos.find((t) => /[-_]/.test(t)) ?? candidatos[0] ?? '';
}

/** Los datos de producto que, tecleados por una persona, valen la pena en el catálogo. */
const CLAVES_PRODUCTO_HUMANO = ['bienes_transp', 'clave_unidad', 'embalaje', 'fraccion_arancelaria'] as const;

/**
 * Qué ofrecer guardar en el catálogo tras revisar un documento. Solo entra lo que una PERSONA tecleó o confirmó
 * (`origen:'humano'`) en clave de producto, unidad, embalaje, fracción o RFC; lo que ya leyó el XML, el perfil, el
 * modelo o el propio catálogo no se vuelve a ofrecer. Lo que ya está idéntico en el catálogo tampoco.
 */
export function proponerCatalogo(extraccion: Extraccion, catalogo: CatalogoCliente | null | undefined): PropuestaCatalogo {
  const propuesta: PropuestaCatalogo = { productos: [], partes: [] };
  const productos = catalogo?.productos ?? [];
  const partes = catalogo?.partes ?? [];

  extraccion.mercancias.forEach((fila, indice) => {
    if (!CLAVES_PRODUCTO_HUMANO.some((k) => esHumano(fila[k]))) return;
    const bienes = valorDe(fila.bienes_transp);
    const unidad = valorDe(fila.clave_unidad);
    if (!bienes || !unidad) return; // sin clave y unidad no hay fila de catálogo válida
    const descripcion = valorDe(fila.descripcion) ?? '';
    // Si el catálogo ya conoce este producto (el SKU está en la descripción), se propone actualizar ESE SKU, no crear otro.
    const conocidos = productosQueCoinciden(descripcion, productos);
    const previo = conocidos.length === 1 ? conocidos[0] : undefined;
    const sku = previo?.sku ?? sugerirSku(descripcion);
    const campos: ItemProducto['campos'] = {
      bienes_transp: bienes, clave_unidad: unidad, embalaje: valorDe(fila.embalaje), fraccion: valorDe(fila.fraccion_arancelaria),
      tipo_materia: valorDe(fila.tipo_materia), material_peligroso: valorDe(fila.material_peligroso)?.toLowerCase() === 'true',
      clave_material_peligroso: valorDe(fila.clave_material_peligroso),
    };
    if (previo && previo.bienesTransp === campos.bienes_transp && previo.claveUnidad === campos.clave_unidad && (previo.embalaje ?? null) === campos.embalaje
      && (previo.fraccion ?? null) === campos.fraccion) return;
    propuesta.productos.push({ indice, descripcion, skuSugerido: sku, estado: previo ? 'cambia' : 'nuevo', campos });
  });

  for (const lado of ['origen', 'destino'] as const) {
    const c = extraccion.campos;
    if (!esHumano(c[`${lado}_rfc`])) continue;
    const nombre = valorDe(c[`${lado}_nombre`]);
    const rfc = valorDe(c[`${lado}_rfc`]);
    if (!nombre || !rfc) continue;
    const rol = lado === 'origen' ? 'remitente' : 'destinatario';
    // Si el catálogo ya conoce a esta parte (mismo nombre corto o mismo RFC), se actualiza ESA fila, no se crea otra con el mismo RFC.
    const previo = partes.find((p) => p.rol === rol && (compacta(p.alias) === compacta(nombre) || (p.rfc ?? '').toUpperCase() === rfc.toUpperCase()));
    const alias = previo?.alias ?? nombre.slice(0, 120);
    const campos: Record<string, string | null> = {
      razon_social: nombre, rfc: rfc.toUpperCase(),
      calle: valorDe(c[`${lado}_calle`]), num_ext: valorDe(c[`${lado}_num_ext`]), num_int: valorDe(c[`${lado}_num_int`]),
      colonia_clave: valorDe(c[`${lado}_colonia_clave`]), colonia: valorDe(c[`${lado}_colonia`]), cp: valorDe(c[`${lado}_cp`]),
      localidad_clave: valorDe(c[`${lado}_localidad_clave`]), localidad: valorDe(c[`${lado}_localidad`]),
      municipio_clave: valorDe(c[`${lado}_municipio_clave`]), municipio: valorDe(c[`${lado}_municipio`]),
      estado: valorDe(c[`${lado}_estado`]), pais: valorDe(c[`${lado}_pais`]),
      ...(lado === 'destino'
        ? { id_fiscal_extranjero: valorDe(c.destino_id_fiscal), contacto: valorDe(c.contacto_destino_nombre), telefono: valorDe(c.contacto_destino_telefono), correo: valorDe(c.contacto_destino_correo) }
        : {}),
    };
    if (previo && (previo.rfc ?? '').toUpperCase() === campos.rfc && (previo.cp ?? null) === campos.cp) continue;
    propuesta.partes.push({ lado, rol, alias, estado: previo ? 'cambia' : 'nuevo', campos });
  }
  return propuesta;
}

/** Lo que la persona dejó marcado en el banner: el SKU de cada renglón que quiere guardar y los lados (remitente/destinatario). */
export interface EleccionCatalogo { productos: Array<{ indice: number; sku: string }>; partes: LadoParte[] }

export type RegistrosPropuesta =
  | { ok: true; productos: Registro[]; partes: Registro[] }
  | { ok: false; errores: string[] };

const productoDeSku = (sku: string): ProductoCat => ({
  tenantId: '', clienteId: '', sku, descripcionPatron: null, bienesTransp: '', claveUnidad: '', embalaje: null, fraccion: null, tipoMateria: null,
  materialPeligroso: false, claveMaterialPeligroso: null,
});

const BOOLEANO = (b: boolean): string => (b ? 'si' : 'no');

/**
 * Pasa lo elegido a filas válidas del catálogo (las reglas del CSV). Todo o nada: si una sola fila no valida, no se
 * escribe ninguna y se dice cuál y por qué.
 */
export function registrosDePropuesta(propuesta: PropuestaCatalogo, clienteId: string, eleccion: EleccionCatalogo): RegistrosPropuesta {
  const errores: string[] = [];
  const productos: Registro[] = [];
  const partes: Registro[] = [];
  const skus = new Set<string>();

  for (const e of eleccion.productos) {
    const item = propuesta.productos.find((p) => p.indice === e.indice);
    if (!item) { errores.push(`La mercancía ${e.indice + 1} ya no tiene datos para guardar. Recarga la pantalla.`); continue; }
    const sku = e.sku.trim();
    if (sku !== '' && skus.has(sku)) { errores.push(`Mercancía ${e.indice + 1}: el SKU «${sku}» está repetido en esta selección.`); continue; }
    skus.add(sku);
    // El agente encuentra un producto por su SKU DENTRO de la descripción: un SKU que ahí no aparece no serviría nunca.
    if (sku !== '' && productosQueCoinciden(item.descripcion, [productoDeSku(sku)]).length === 0) {
      errores.push(`Mercancía ${e.indice + 1}: el SKU «${sku}» no aparece en su descripción, así que el agente no lo reconocería en otros documentos. Escríbelo como aparece en el documento.`);
      continue;
    }
    const c = item.campos;
    const v = validarRegistro('producto', clienteId, {
      sku, bienes_transp: c.bienes_transp, clave_unidad: c.clave_unidad, embalaje: c.embalaje ?? '', fraccion: c.fraccion ?? '',
      tipo_materia: c.tipo_materia ?? '', material_peligroso: BOOLEANO(c.material_peligroso), clave_material_peligroso: c.clave_material_peligroso ?? '',
    });
    if (v.ok) productos.push(v.registro); else errores.push(`Mercancía ${e.indice + 1}: ${v.mensaje}`);
  }

  for (const lado of eleccion.partes) {
    const item = propuesta.partes.find((p) => p.lado === lado);
    if (!item) { errores.push(`El ${lado === 'origen' ? 'remitente' : 'destinatario'} ya no tiene datos para guardar. Recarga la pantalla.`); continue; }
    const valores: Record<string, string> = { rol: item.rol, alias: item.alias };
    for (const [k, val] of Object.entries(item.campos)) valores[k] = val ?? '';
    const v = validarRegistro('parte', clienteId, valores);
    if (v.ok) partes.push(v.registro); else errores.push(`${item.rol === 'remitente' ? 'Remitente' : 'Destinatario'}: ${v.mensaje}`);
  }

  if (errores.length === 0 && productos.length + partes.length === 0) errores.push('No elegiste nada para guardar.');
  return errores.length > 0 ? { ok: false, errores } : { ok: true, productos, partes };
}
