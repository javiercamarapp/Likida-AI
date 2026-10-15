// ═══════════════════════════════════════════════════════════════════════════
// CATÁLOGO POR CLIENTE — resolver y enriquecer una extracción (T-A3-20).
//
// Algunos clientes grandes mandan el embarque SIN clave SAT ni RFC (solo su SKU, un alias o el nombre corto del
// sitio). Eso no se deduce del documento: se resuelve con el diccionario que la flota cargó una vez por cliente
// (0792). Esta función corre DESPUÉS del perfil/modelo y ANTES de validar, así que la validación ve ya los datos
// completados.
//
// Es PURA: recibe el catálogo ya leído (con tope de filas) y devuelve una extracción nueva. Reglas:
//   · Nunca pisa un valor `humano`.
//   · Nunca pisa un valor del documento leído con confianza ≥ UMBRAL_CRITICO: si el catálogo discrepa, conserva
//     lo del documento y deja una nota «El catálogo dice X, el documento dice Y. Confírmalo.» (la validación la
//     vuelve un hallazgo `confirmar`, que sobrevive a las revalidaciones y se limpia cuando un humano escribe).
//   · Un valor del documento leído con confianza BAJA sí cede ante el catálogo (queda anotado lo que se leyó).
//   · Dos coincidencias (dos SKU parecidos, dos partes con el mismo RFC) → `ambiguos`, no se aplica NADA.
//   · Solo se usan filas del mismo tenant y cliente que el documento (defensa en profundidad: la lectura ya filtra).
//   · El catálogo NUNCA se le manda al modelo: esto corre después de extraer y no toca el extractor.
// ═══════════════════════════════════════════════════════════════════════════

import { UMBRAL_CRITICO, campoDoc, campoMercancia, type CampoValor, type Extraccion } from './campos';
import { llaveTexto } from './catalogos';

/** Filas que se leen del catálogo de UN cliente por documento (por tabla). */
export const TOPE_FILAS_CATALOGO = 5000;

export const CONFIANZA_CATALOGO = 0.95;

export interface NumeroClienteCat { tenantId: string; clienteId: string; numeroInterno: string; numeroPagador: string | null; activo: boolean }

export interface ProductoCat {
  tenantId: string; clienteId: string; sku: string; descripcionPatron: string | null;
  bienesTransp: string; claveUnidad: string; embalaje: string | null; fraccion: string | null; tipoMateria: string | null;
  materialPeligroso: boolean; claveMaterialPeligroso: string | null;
}

export interface ParteCat {
  tenantId: string; clienteId: string; rol: 'remitente' | 'destinatario'; alias: string;
  razonSocial: string | null; rfc: string | null; idFiscalExtranjero: string | null;
  calle: string | null; numExt: string | null; numInt: string | null;
  coloniaClave: string | null; colonia: string | null; cp: string | null;
  localidadClave: string | null; localidad: string | null; municipioClave: string | null; municipio: string | null;
  estado: string | null; pais: string | null; contacto: string | null; telefono: string | null; correo: string | null;
}

export interface CatalogoCliente {
  numero: NumeroClienteCat | null;
  productos: ProductoCat[];
  partes: ParteCat[];
  /** Alguna tabla llegó al tope de filas: puede faltar una entrada (se avisa). */
  truncado?: boolean;
}

export const catalogoVacio = (): CatalogoCliente => ({ numero: null, productos: [], partes: [], truncado: false });

export interface ContextoCatalogo { tenantId: string; clienteId: string | null }

export interface ResultadoEnriquecer {
  extraccion: Extraccion;
  /** `campos.<clave>` o `mercancias.<i>.<clave>` que el catálogo llenó o reemplazó. */
  aplicados: string[];
  /** Coincidencias múltiples: no se aplicó nada en ese renglón/parte. */
  ambiguos: string[];
  /** Renglones cuyo SKU/patrón no está en el catálogo (informativo). */
  desconocidos: string[];
}

const vacio = (c: CampoValor | undefined): boolean => !c || c.valor === null || c.valor === '';
const comparable = (v: string): string => v.toUpperCase().replace(/[\s.\-_]/g, '');
const compacta = (s: string): string => llaveTexto(s).replace(/[^a-z0-9]+/g, '');
const tokens = (s: string): string[] => llaveTexto(s).split(/[^a-z0-9]+/).filter((t) => t !== '');
const textoLimpio = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

function contieneSecuencia(pajar: string[], aguja: string[]): boolean {
  if (aguja.length === 0 || aguja.length > pajar.length) return false;
  for (let i = 0; i + aguja.length <= pajar.length; i++) {
    let ok = true;
    for (let j = 0; j < aguja.length; j++) if (pajar[i + j] !== aguja[j]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

interface Acum { aplicados: string[] }

/**
 * Aplica UN valor del catálogo a UN campo respetando las reglas. `destino` es `campos` o la fila de mercancía.
 */
function poner(
  destino: Record<string, CampoValor>, clave: string, valorCat: string | null | undefined, evidencia: string,
  ruta: string, esMercancia: boolean, acum: Acum,
): void {
  const valor = textoLimpio(valorCat);
  if (valor === null) return;
  const def = esMercancia ? campoMercancia(clave) : campoDoc(clave);
  if (!def || valor.length > def.max) return;
  const actual = destino[clave];
  const nuevo = (notas?: string[]): CampoValor => ({
    valor, confianza: CONFIANZA_CATALOGO, evidencia: evidencia.slice(0, 200), origen: 'catalogo', ...(notas ? { notas } : {}),
  });

  if (actual?.origen === 'humano') return; // lo que una persona escribió no se toca
  if (vacio(actual)) {
    destino[clave] = nuevo();
    acum.aplicados.push(ruta);
    return;
  }
  const leido = actual as CampoValor;
  if (comparable(leido.valor as string) === comparable(valor)) return; // ya coinciden
  if (leido.confianza >= UMBRAL_CRITICO) {
    destino[clave] = {
      ...leido,
      notas: [...(leido.notas ?? []), `El catálogo dice «${valor}», el documento dice «${leido.valor}». Confírmalo.`],
    };
    return;
  }
  destino[clave] = nuevo([`Antes se leyó «${leido.valor}» del documento (seguridad ${Math.round(leido.confianza * 100)} %); se usó el catálogo del cliente.`]);
  acum.aplicados.push(ruta);
}

export function productosQueCoinciden(descripcion: string, productos: ProductoCat[]): ProductoCat[] {
  const toks = tokens(descripcion);
  const plano = llaveTexto(descripcion);
  return productos.filter((p) => {
    if (contieneSecuencia(toks, tokens(p.sku))) return true;
    const patron = p.descripcionPatron ? llaveTexto(p.descripcionPatron) : '';
    // El patrón es texto plano (nunca una expresión regular guardada por un tercero).
    return patron.length >= 3 && plano.includes(patron);
  });
}

const LADOS = {
  origen: { rol: 'remitente', pref: 'origen' },
  destino: { rol: 'destinatario', pref: 'destino' },
} as const;

function partesQueCoinciden(lado: 'origen' | 'destino', c: Record<string, CampoValor>, partes: ParteCat[]): ParteCat[] {
  const { rol, pref } = LADOS[lado];
  const rfc = (c[`${pref}_rfc`]?.valor ?? '').toUpperCase().trim();
  const nombre = compacta(c[`${pref}_nombre`]?.valor ?? '');
  const hallados = new Map<string, ParteCat>();
  for (const p of partes) {
    if (p.rol !== rol) continue;
    const porRfc = rfc !== '' && (p.rfc ?? '').toUpperCase() === rfc;
    const porNombre = nombre !== '' && (compacta(p.alias) === nombre || (p.razonSocial !== null && compacta(p.razonSocial) === nombre));
    if (porRfc || porNombre) hallados.set(p.alias, p);
  }
  return [...hallados.values()];
}

export function enriquecer(extraccion: Extraccion, catalogo: CatalogoCliente | null | undefined, contexto: ContextoCatalogo): ResultadoEnriquecer {
  const salida: Extraccion = structuredClone(extraccion);
  const res: ResultadoEnriquecer = { extraccion: salida, aplicados: [], ambiguos: [], desconocidos: [] };
  if (!catalogo || !contexto.clienteId) return res;
  const propio = (f: { tenantId: string; clienteId: string }): boolean => f.tenantId === contexto.tenantId && f.clienteId === contexto.clienteId;
  const productos = catalogo.productos.filter(propio);
  const partes = catalogo.partes.filter(propio);
  const numero = catalogo.numero && propio(catalogo.numero) && catalogo.numero.activo ? catalogo.numero : null;
  const acum: Acum = { aplicados: res.aplicados };

  // (1) Mercancías: SKU (o patrón) en la descripción → clave SAT, unidad, embalaje, fracción, materia, peligroso.
  if (productos.length > 0) {
    salida.mercancias.forEach((fila, i) => {
      const desc = fila.descripcion?.valor;
      if (!desc) return;
      const coinciden = productosQueCoinciden(desc, productos);
      if (coinciden.length === 0) { res.desconocidos.push(`mercancias.${i}`); return; }
      if (coinciden.length > 1) {
        res.ambiguos.push(`mercancias.${i}: coinciden ${coinciden.length} productos del catálogo (${coinciden.slice(0, 5).map((p) => p.sku).join(', ')}); no se aplicó ninguno`);
        return;
      }
      const p = coinciden[0];
      const ev = `Catálogo del cliente: SKU ${p.sku}`;
      const en = (clave: string, v: string | null): void => poner(fila, clave, v, ev, `mercancias.${i}.${clave}`, true, acum);
      en('bienes_transp', p.bienesTransp);
      en('clave_unidad', p.claveUnidad);
      en('embalaje', p.embalaje);
      en('fraccion_arancelaria', p.fraccion);
      en('tipo_materia', p.tipoMateria);
      en('material_peligroso', p.materialPeligroso ? 'true' : 'false');
      en('clave_material_peligroso', p.claveMaterialPeligroso);
    });
  }

  // (2) Remitente y destinatario: por RFC o por alias/razón social normalizada → RFC y domicilio estructurado.
  if (partes.length > 0) {
    for (const lado of ['origen', 'destino'] as const) {
      const hallados = partesQueCoinciden(lado, salida.campos, partes);
      if (hallados.length === 0) continue;
      if (hallados.length > 1) {
        res.ambiguos.push(`${lado}: coinciden ${hallados.length} ${LADOS[lado].rol}s del catálogo (${hallados.slice(0, 5).map((p) => p.alias).join(', ')}); no se aplicó ninguno`);
        continue;
      }
      const p = hallados[0];
      const ev = `Catálogo del cliente: ${LADOS[lado].rol} «${p.alias}»`;
      const en = (sufijo: string, v: string | null): void => poner(salida.campos, `${lado}_${sufijo}`, v, ev, `campos.${lado}_${sufijo}`, false, acum);
      en('rfc', p.rfc);
      en('calle', p.calle); en('num_ext', p.numExt); en('num_int', p.numInt);
      en('colonia_clave', p.coloniaClave); en('colonia', p.colonia); en('cp', p.cp);
      en('localidad_clave', p.localidadClave); en('localidad', p.localidad);
      en('municipio_clave', p.municipioClave); en('municipio', p.municipio);
      en('estado', p.estado); en('pais', p.pais);
      if (lado === 'destino') {
        en('id_fiscal', p.idFiscalExtranjero);
        poner(salida.campos, 'contacto_destino_nombre', p.contacto, ev, 'campos.contacto_destino_nombre', false, acum);
        poner(salida.campos, 'contacto_destino_telefono', p.telefono, ev, 'campos.contacto_destino_telefono', false, acum);
        poner(salida.campos, 'contacto_destino_correo', p.correo, ev, 'campos.contacto_destino_correo', false, acum);
      }
    }
  }

  // (3) Número interno del cliente (el que paga) por el cliente del documento.
  if (numero) {
    poner(salida.campos, 'numero_cliente_interno', numero.numeroInterno, 'Catálogo del cliente: número interno', 'campos.numero_cliente_interno', false, acum);
  }
  return res;
}

/** Texto para la bandeja: qué hizo el catálogo (vacío si no hizo nada que decir). */
export function avisosDelCatalogo(r: ResultadoEnriquecer, truncado: boolean): string[] {
  const avisos: string[] = [];
  if (r.aplicados.length > 0) avisos.push(`El catálogo del cliente completó ${r.aplicados.length} dato${r.aplicados.length === 1 ? '' : 's'}.`);
  for (const a of r.ambiguos) avisos.push(`Catálogo del cliente, ambiguo: ${a}.`);
  if (r.desconocidos.length > 0) avisos.push(`${r.desconocidos.length === 1 ? 'Un renglón' : `${r.desconocidos.length} renglones`} sin coincidencia en el catálogo del cliente.`);
  if (truncado) avisos.push(`El catálogo del cliente llegó al tope de ${TOPE_FILAS_CATALOGO} filas leídas: puede faltar alguna entrada.`);
  return avisos;
}
