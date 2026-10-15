// ═══════════════════════════════════════════════════════════════════════════
// VALIDACIÓN — catálogos SAT, RFC, CP, pesos y coherencia, y el BLOQUEO.
//
// Tres severidades, y la diferencia entre ellas es lo que hace seguro el flujo:
//
//   · bloqueo   el valor falta o NO puede ser verdad (formato imposible, peso que
//               ningún camión carga, clave de producto fuera de rango). No se
//               aprueba hasta que alguien lo escriba bien: confirmar no basta.
//   · confirmar el valor PUEDE ser verdad pero hay una razón para dudar (el
//               modelo no está seguro, el RFC no pasa el dígito verificador, el
//               CP no es del estado que dice, los pesos no suman, el documento
//               trató de darle órdenes al modelo). Se aprueba cuando un humano lo
//               confirma o lo corrige: `origen: humano` limpia el hallazgo.
//   · aviso     informativo: se muestra y no frena nada.
//
// Un campo CRÍTICO (RFC, CP, descripción, clave, cantidad, unidad, peso) que falta
// bloquea; uno que viene dudoso exige confirmación. Es el «bloqueo de campos
// críticos dudosos» del encargo, y la razón es la de siempre: un dato falso en el
// complemento es un comprobante falso (CFF 29-A fr. IX), no un error de captura.
// ═══════════════════════════════════════════════════════════════════════════

import { CAMPOS_DOC, CAMPOS_MERCANCIA, REFERENCIAS_MERCANCIA, UMBRAL_CRITICO, etiquetaCampo, type CampoDoc, type CampoValor, type Extraccion } from './campos';
import { CLAVES_UNIDAD, CODIGOS_ESTADO, CODIGOS_ESTADO_EEUU, FACTOR_A_KG, estadoDeCp } from './catalogos';
import {
  CAT_COLONIA, CAT_CP, CAT_EMBALAJE, CAT_FRACCION, CAT_PELIGROSO, CAT_PRODUCTO, CAT_UNIDAD,
  clavesDeFraccion, esClaveProductoGenerica, esFraccionGenerica, mismaFraccion, normalizarFraccion, type ResolvedorSat,
} from './catalogos_sat';
import { valorSospechoso } from './inyeccion';
import { normalizarIdDestino, normalizarNumero } from './normalizar';
import { rfcChecksumOk } from '../intake/cfdi';
import type { ReglaTramoCliente } from './perfiles';

export type Severidad = 'bloqueo' | 'confirmar' | 'aviso';

export interface Hallazgo {
  /** Clave del campo (`origen_cp`, `peso_kg`…) o `documento` / `mercancias`. */
  campo: string;
  /** Índice del renglón de mercancía, o `null` si es del documento. */
  renglon: number | null;
  severidad: Severidad;
  codigo: string;
  mensaje: string;
  /** Otros campos que, al confirmarse, también resuelven este hallazgo. */
  relacionados?: Array<{ campo: string; renglon: number | null }>;
  /**
   * De dónde sale el hallazgo. Ausente = lo calculó `validarExtraccion` (se recalcula en cada revisión). `'tms'` = lo dejó
   * el rechazo del sistema del cliente (T-A3-29): NO se recalcula, se arrastra hasta que una persona corrige ese campo.
   */
  origen?: 'tms';
  /** Fragmento del documento que sustenta el hallazgo (T-A3-57). Ausente en los demás. */
  evidencia?: string | null;
  /**
   * Corrección que se PROPONE (T-A3-55). Nunca se aplica sola: la aplica una persona al confirmarla
   * (`aplicarPropuestaReferencia`), que deja el valor con origen `humano`. Ausente = no hay propuesta segura.
   */
  propuesta?: { campo: string; renglon: number; valor: string };
}

export interface ResultadoValidacion {
  hallazgos: Hallazgo[];
  bloqueos: number;
  porConfirmar: number;
  /** Sin bloqueos y sin nada por confirmar: un humano puede aprobar. */
  listoParaAprobar: boolean;
}

export interface OpcionesValidacion {
  /**
   * T-A3-50: regla del cliente para el tramo mexicano. Ausente = no se evalúa (comportamiento de siempre); `null` o sin el
   * valor del régimen del documento = «falta definir destino/origen» (bloqueo). Nunca se toma el extremo del documento por omisión.
   */
  reglaTramo?: ReglaTramoCliente | null;
  riesgoInyeccion?: boolean;
  remitenteReconocido?: boolean | null;
  /** Para probar con un reloj fijo. */
  ahora?: Date;
  /**
   * Catálogos SAT ya precargados (T-A3-24, `precargarCatalogosSat`). Ausente = solo las reglas locales de siempre.
   * Dentro de él, `existe() === null` significa «catálogo no cargado»: nunca bloquea, solo avisa.
   */
  catalogosSat?: ResolvedorSat;
  /**
   * Peso total (kg) del documento HERMANO del mismo embarque, ya convertido a kg (p. ej. el BOL en libras del libro de
   * Excel que se está revisando) (T-A3-52). Ausente = no hay con qué cruzar.
   */
  pesoReferencia?: { kg: number; fuente: string };
  /**
   * Fracción arancelaria que da el documento HERMANO del libro (p. ej. la de las notas del BOL) (T-A3-57). Ausente = no hay
   * documento con qué comparar: una fracción genérica solo avisa.
   */
  fraccionDocumento?: { valor: string; fuente: string };
  /**
   * Reglas de dependencia de la Guía de llenado de la plantilla del TMS (T-A3-45). Ausente = todas con los valores de la
   * Guía; `false` = ninguna (un perfil que no use esa plantilla). Parametrizable por perfil: la preferencia de un cliente
   * no se codifica aquí.
   */
  reglasGuia?: Partial<ReglasGuia> | false;
  /**
   * T-A3-53: la captura del correo llegó cortada (termina en un rótulo sin valor). Bloquea hasta que llegue el texto o una
   * captura completa (o una persona capture lo que falta y el documento se vuelva a procesar).
   */
  capturaIncompleta?: { ultimoRotulo: string } | null;
}

const RFC_MORAL = /^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/;
const RFC_FISICA = /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/;
const RFC_GENERICOS = new Set(['XAXX010101000', 'XEXX010101000']);
const FECHA_DIA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FECHA_HORA_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;
/** `[año, mes, día, hora?, minuto?]` o `null` si no es una fecha ISO del módulo (sin cuantificadores anidados). */
const partesFecha = (v: string | null | undefined): number[] | null => {
  const m = FECHA_HORA_RE.exec(v ?? '') ?? FECHA_DIA_RE.exec(v ?? '');
  return m ? m.slice(1).map(Number) : null;
};
const PLACA_RE = /^[A-Z0-9]{5,7}$/;
const PESO_MAX_BLOQUEO_KG = 80_000;
const PESO_ALERTA_KG = 60_000;

const esVacio = (c: CampoValor | undefined): boolean => !c || c.valor === null || c.valor === '';

/** Valida la forma de UN RFC. `null` = bien; si no, el motivo. */
export function problemaRfc(rfc: string): { codigo: string; mensaje: string; severidad: Severidad } | null {
  if (RFC_GENERICOS.has(rfc)) return null;
  if (!(RFC_MORAL.test(rfc) || RFC_FISICA.test(rfc))) {
    return { codigo: 'rfc_forma', mensaje: `«${rfc}» no tiene forma de RFC (12 caracteres para persona moral, 13 para física).`, severidad: 'bloqueo' };
  }
  const m = /(\d{2})(\d{2})(\d{2})/.exec(rfc.slice(rfc.length - 9));
  if (m) {
    const mes = Number(m[2]); const dia = Number(m[3]);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) {
      return { codigo: 'rfc_fecha', mensaje: `El RFC «${rfc}» trae una fecha de constitución/nacimiento imposible (${m[1]}-${m[2]}-${m[3]}).`, severidad: 'bloqueo' };
    }
  }
  if (!rfcChecksumOk(rfc)) {
    return { codigo: 'rfc_digito', mensaje: `El dígito verificador del RFC «${rfc}» no cuadra: probable error de lectura o de captura. Confírmalo contra la constancia fiscal.`, severidad: 'confirmar' };
  }
  return null;
}

/**
 * Valida la forma de un Tax ID extranjero (país ≠ MEX). Sin dígito verificador mexicano; acepta el genérico
 * extranjero y el EIN de EE. UU. `NN-NNNNNNN`. `null` = bien.
 */
export function problemaTaxId(id: string): { codigo: string; mensaje: string; severidad: Severidad } | null {
  if (RFC_GENERICOS.has(id)) return null;
  if (/^[A-Z0-9][A-Z0-9-]{2,19}$/.test(id)) return null;
  return { codigo: 'taxid_forma', mensaje: `«${id}» no tiene forma de Tax ID (3 a 20 letras, números o guiones).`, severidad: 'bloqueo' };
}

type Registrar = (h: Hallazgo) => void;

/** País que cuenta como México: MEX, MX, México (el campo recorta a 3: «Méx»). Vacío NO es México ni extranjero. */
const esPaisMexico = (p: string): boolean => /^(MEX|MX)/.test(p.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[\s.]/g, ''));
const esPaisEeuu = (p: string): boolean => /^(USA|US|EUA|EEUU)$/.test(p.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[\s.]/g, ''));
/** Contexto de país de un campo de extremo (`origen_rfc`, `destino_cp`…), o `null` si no es de un extremo o el país es México/vacío. */
function contextoExtranjero(e: Extraccion, clave: string): { eeuu: boolean } | null {
  const m = /^(origen|destino)_(rfc|cp|estado)$/.exec(clave);
  if (!m) return null;
  const p = (e.campos[`${m[1]}_pais`]?.valor ?? '').trim();
  if (p === '' || esPaisMexico(p)) return null;
  return { eeuu: esPaisEeuu(p) };
}

function validarFormato(def: CampoDoc, c: CampoValor, renglon: number | null, reg: Registrar, sat?: ResolvedorSat, ext: { eeuu: boolean } | null = null): void {
  const v = c.valor as string;
  const aqui = (severidad: Severidad, codigo: string, mensaje: string, relacionados?: Hallazgo['relacionados']) =>
    reg({ campo: def.clave, renglon, severidad, codigo, mensaje: `${etiquetaCampo(def.clave, renglon)}: ${mensaje}`, relacionados });

  switch (def.tipo) {
    case 'rfc': {
      const p = ext ? problemaTaxId(v) : problemaRfc(v);
      if (p) aqui(p.severidad, p.codigo, p.mensaje);
      break;
    }
    case 'cp': {
      if (ext) { if (!/^[A-Z0-9][A-Z0-9 -]{1,9}$/i.test(v)) aqui('bloqueo', 'cp_forma', `«${v}» no es un código postal extranjero válido.`); break; }
      if (!/^\d{5}$/.test(v)) aqui('bloqueo', 'cp_forma', `«${v}» no es un código postal (5 dígitos).`);
      else if (estadoDeCp(v) === null) aqui('bloqueo', 'cp_inexistente', `El código postal ${v} no existe (los dos primeros dígitos no corresponden a ninguna entidad).`);
      break;
    }
    case 'estado':
      if (ext) {
        if (ext.eeuu && !CODIGOS_ESTADO_EEUU.has(v)) aqui('confirmar', 'estado_no_catalogo', `«${v}» no es una clave de estado de EE. UU. de dos letras (p. ej. TX, CA).`);
        break;
      }
      if (!CODIGOS_ESTADO.has(v)) aqui('confirmar', 'estado_no_catalogo', `«${v}» no es una clave del catálogo c_Estado (p. ej. JAL, NLE, CMX).`);
      break;
    case 'fecha': {
      if (partesFecha(v) === null) aqui('confirmar', 'fecha_forma', `«${v}» no se reconoció como fecha.`);
      break;
    }
    case 'numero': {
      const n = normalizarNumero(v).valor;
      if (n === null) { aqui('bloqueo', 'numero_forma', `«${v}» no es un número.`); break; }
      if (def.clave === 'valor_mercancia' ? n < 0 : n <= 0) aqui('bloqueo', 'numero_no_positivo', `Debe ser mayor que cero (leí ${v}).`);
      else if (n >= 1e9) aqui('bloqueo', 'numero_excesivo', `${v} es una cifra fuera de rango.`);
      if (def.clave === 'peso_kg' || def.clave === 'peso_bruto_total') {
        if (n > PESO_MAX_BLOQUEO_KG) aqui('bloqueo', 'peso_imposible', `${v} kg excede el peso bruto máximo que autoriza la NOM-012 (≈ 80,000 kg). ¿Está en toneladas o gramos?`);
        else if (n > PESO_ALERTA_KG) aqui('confirmar', 'peso_alto', `${v} kg es un peso de carga excepcional (más de 60,000 kg). Confírmalo.`);
      }
      break;
    }
    case 'clave_prod': {
      if (!/^\d{8}$/.test(v)) { aqui('bloqueo', 'clave_forma', `«${v}» no es una clave c_ClaveProdServCP (8 dígitos).`); break; }
      const seg = Number(v.slice(0, 2));
      // La clave genérica 01010101 es la que el operador usa a falta de dato (T-A3-57): pasa con aviso, no bloquea.
      if (esClaveProductoGenerica(v)) break;
      if (seg < 10 || seg > 95) aqui('bloqueo', 'clave_segmento', `La clave ${v} no pertenece a ningún segmento del catálogo (10 a 95).`);
      else if (v === '78101800') aqui('confirmar', 'clave_servicio', 'La 78101800 es el SERVICIO de transporte de carga, no la mercancía. Pon la clave del producto que se transporta.');
      // Con el catálogo cargado (true/false) la verificación real la hace `verificarCatalogosSat`; el aviso solo queda si no se sabe.
      else if (sat?.existe(CAT_PRODUCTO, v) == null) aqui('aviso', 'clave_sin_catalogo', `La clave ${v} tiene forma válida; el catálogo completo lo valida el PAC al timbrar.`);
      break;
    }
    case 'clave_unidad': {
      if (CLAVES_UNIDAD.has(v)) break;
      if (/^\d{1,2}$/.test(v)) { aqui('confirmar', 'unidad_no_sat', `«${v}» no es una clave c_ClaveUnidad del SAT (probable código interno del cliente). Elige la clave correcta (p. ej. H87 pieza, XBX caja).`); break; }
      if (!/^[A-Z0-9]{2,3}$/.test(v)) aqui('bloqueo', 'unidad_forma', `«${v}» no es una clave c_ClaveUnidad (2 o 3 caracteres, p. ej. KGM, H87, XBX).`);
      else if (sat?.existe(CAT_UNIDAD, v) == null) aqui('aviso', 'unidad_fuera_subconjunto', `La clave ${v} no está entre las de uso común que Likida reconoce; verifícala contra el catálogo c_ClaveUnidad.`);
      break;
    }
    case 'fraccion': {
      const n = normalizarFraccion(v); // `8517.62.17.99` es la misma fracción que `8517621799` // grep-limpio:ok
      if (!/^\d+$/.test(n) || (n.length !== 8 && n.length !== 10)) aqui('bloqueo', 'fraccion_forma', `«${v}» no es una fracción arancelaria (8 dígitos, o 10 con NICO).`);
      break;
    }
    case 'moneda':
      if (!/^[A-Z]{3}$/.test(v)) aqui('bloqueo', 'moneda_forma', `«${v}» no es una clave de moneda ISO (MXN, USD…).`);
      else if (v !== 'MXN' && v !== 'USD') aqui('aviso', 'moneda_rara', `La moneda ${v} no es MXN ni USD; verifica el tipo de cambio al timbrar.`);
      break;
    case 'embalaje':
      if (!/^[0-9A-Z]{2,3}$/.test(v)) aqui('confirmar', 'embalaje_forma', `«${v}» no parece una clave c_TipoEmbalaje (2 o 3 caracteres).`);
      break;
    case 'placa':
      if (!PLACA_RE.test(v)) aqui('confirmar', 'placa_forma', `«${v}» no cumple 5 a 7 caracteres alfanuméricos sin guiones ni espacios.`);
      break;
    case 'booleano':
      if (v !== 'true' && v !== 'false') aqui('confirmar', 'booleano_forma', `«${v}» no se reconoció como sí/no.`);
      break;
    case 'texto':
      if (def.clave === 'operador_licencia' && !/^[A-Z0-9-]{6,16}$/i.test(v)) {
        aqui('confirmar', 'licencia_forma', `La licencia federal lleva de 6 a 16 caracteres (leí «${v}»).`);
      }
      break;
  }
}

/** ¿Algún campo de la lista relacionada lo dejó un humano? Entonces el hallazgo «confirmar» ya se atendió. */
function confirmado(e: Extraccion, h: Hallazgo): boolean {
  const lista = [{ campo: h.campo, renglon: h.renglon }, ...(h.relacionados ?? [])];
  return lista.some((r) => (r.renglon === null ? e.campos[r.campo] : e.mercancias[r.renglon]?.[r.campo])?.origen === 'humano');
}

/** Tolerancia de la verificación de sumas (T-A3-18): el mayor entre el porcentaje del total y el mínimo absoluto. */
export const TOLERANCIA_SUMA_PCT = 0.005;
export const TOLERANCIA_SUMA_MIN_KG = 1;
export const TOLERANCIA_SUMA_MIN_PIEZAS = 1;
export const TOLERANCIA_SUMA_MIN_M3 = 0.001;

/** Códigos de los bloqueos de suma; la bandeja sugiere `rechazo_causa = 'suma_no_cuadra'` mientras alguno siga abierto. */
export const CODIGOS_SUMA: readonly string[] = ['suma_piezas', 'suma_peso', 'suma_volumen'];

function numeroDe(c: CampoValor | undefined): number | null {
  return normalizarNumero(c?.valor ?? '').valor;
}

/**
 * Suma de renglones contra el total del documento. Sin total no se inventa uno (sin hallazgo); un total derivado de la
 * suma no se contradice a sí mismo; si algún renglón no trae el número, esa suma no se evalúa.
 */
function verificarSumas(e: Extraccion, reg: Registrar): void {
  if (e.mercancias.length === 0) return;
  const redondeo = (n: number) => Math.round(n * 1000) / 1000;
  const comprobar = (
    campoTotal: 'piezas_total' | 'peso_bruto_total' | 'volumen_total', campoRenglon: 'cantidad' | 'peso_kg' | 'volumen',
    codigo: string, minimo: number, sujeto: string, unidad: string,
  ) => {
    const campo = e.campos[campoTotal];
    const total = numeroDe(campo);
    if (total === null || !campo || campo.origen === 'derivado') return;
    const valores = e.mercancias.map((f) => numeroDe(f[campoRenglon]));
    if (!valores.every((v): v is number => v !== null)) return;
    const suma = valores.reduce((s, v) => s + v, 0);
    if (Math.abs(total - suma) <= Math.max(minimo, Math.abs(total) * TOLERANCIA_SUMA_PCT)) return;
    reg({
      campo: campoTotal, renglon: null, severidad: 'bloqueo', codigo,
      mensaje: `${sujeto} suman ${redondeo(suma)}${unidad} pero el documento dice ${redondeo(total)}${unidad}. Corrige el total o los renglones.`,
    });
  };
  // Piezas: solo si todos los renglones están en piezas (o sin unidad); mezclar kg con piezas no es una suma.
  const enPiezas = e.mercancias.every((f) => { const u = (f.clave_unidad?.valor ?? '').trim().toUpperCase(); return u === '' || u === 'H87'; });
  if (enPiezas) comprobar('piezas_total', 'cantidad', 'suma_piezas', TOLERANCIA_SUMA_MIN_PIEZAS, 'Las piezas', '');
  comprobar('peso_bruto_total', 'peso_kg', 'suma_peso', TOLERANCIA_SUMA_MIN_KG, 'Los pesos', ' kg');
  comprobar('volumen_total', 'volumen', 'suma_volumen', TOLERANCIA_SUMA_MIN_M3, 'Los volúmenes', ' m³');
}

/** Diferencia máxima entre dos lecturas del peso del mismo embarque antes de bloquear (T-A3-52): 1 %. */
export const TOLERANCIA_PESO_CRUZADO_PCT = 0.01;

/** `a` es ≈ 1000× `b` (o 1/1000×) dentro de la tolerancia: el error típico de coma/punto de miles o de toneladas↔kg. */
function esFactorMil(a: number, b: number): boolean {
  if (!(a > 0) || !(b > 0)) return false;
  const r = a / b;
  return Math.abs(r / 1000 - 1) <= TOLERANCIA_PESO_CRUZADO_PCT || Math.abs(r * 1000 - 1) <= TOLERANCIA_PESO_CRUZADO_PCT;
}

/**
 * Cuadre del peso entre lecturas (T-A3-52). BLOQUEA (lo ambiguo no se adivina) cuando:
 *   · el total del documento y la suma de sus renglones difieren por un factor de 1000;
 *   · el peso del documento difiere más de 1 % del peso del documento hermano del mismo embarque (`pesoReferencia`),
 *     o cambia por un factor de 1000.
 * La suma de renglones ≠ total (otro factor) ya la bloquea `verificarSumas`.
 */
function verificarPesoCruzado(e: Extraccion, ref: OpcionesValidacion['pesoReferencia'], reg: Registrar): void {
  const redondeo = (n: number) => Math.round(n * 1000) / 1000;
  const valores = e.mercancias.map((f) => numeroDe(f.peso_kg));
  const suma = valores.length > 0 && valores.every((v): v is number => v !== null) ? valores.reduce((s, v) => s + v, 0) : null;
  const campo = e.campos.peso_bruto_total;
  const total = campo && campo.origen !== 'derivado' ? numeroDe(campo) : null;
  if (total !== null && suma !== null && esFactorMil(total, suma)) {
    reg({ campo: 'peso_bruto_total', renglon: null, severidad: 'bloqueo', codigo: 'peso_factor_1000', mensaje: `El peso total del documento (${redondeo(total)} kg) y la suma de sus renglones (${redondeo(suma)} kg) difieren por un factor de 1000: revisa coma/punto de miles o toneladas contra kilos.`, relacionados: e.mercancias.map((_, i) => ({ campo: 'peso_kg', renglon: i })) });
  }
  const propio = total ?? suma;
  if (!ref || !(ref.kg > 0) || propio === null || !(propio > 0)) return;
  if (esFactorMil(propio, ref.kg)) {
    reg({ campo: total !== null ? 'peso_bruto_total' : 'peso_kg', renglon: null, severidad: 'bloqueo', codigo: 'peso_factor_1000', mensaje: `El peso del documento (${redondeo(propio)} kg) y el de ${ref.fuente} (${redondeo(ref.kg)} kg) difieren por un factor de 1000: revisa coma/punto de miles o toneladas contra kilos.` });
  } else if (Math.abs(propio - ref.kg) / ref.kg > TOLERANCIA_PESO_CRUZADO_PCT) {
    reg({ campo: total !== null ? 'peso_bruto_total' : 'peso_kg', renglon: null, severidad: 'bloqueo', codigo: 'peso_fuentes_difieren', mensaje: `El peso del documento (${redondeo(propio)} kg) difiere más de 1 % del de ${ref.fuente} (${redondeo(ref.kg)} kg). Confirma cuál es el correcto.` });
  }
}

const EMBALAJE_SACO = /^5[HLM]/; // c_TipoEmbalaje: bolsas/sacos (5H tejida, 5L textil, 5M papel)
const TEXTO_SACO = /\b(sacos?|costales?)\b/i;
const TEXTO_RACK = /\b(racks?|rack's|tarimas?|pallets?)\b/i;

/**
 * Reglas que dependen de los catálogos SAT cargados (T-A3-24).
 *   · clave inexistente en un catálogo CARGADO → bloqueo (confirmar no basta: el TMS/PAC la va a rechazar);
 *   · catálogo no cargado (`null`) → un aviso por catálogo, nunca un bloqueo;
 *   · material peligroso «sí» sin clave → bloqueo (regla local, no necesita catálogo);
 *   · embalaje que no cuadra con la mercancía → solo `confirmar` (heurística).
 *   · municipio/localidad/estado/colonia contra el código postal → `confirmar` (colonia: solo aviso, la clave de colonia
 *     del SAT se repite entre códigos postales).
 */
function verificarCatalogosSat(e: Extraccion, sat: ResolvedorSat | undefined, reg: Registrar): void {
  const sinCargar = new Set<string>();
  const consulta = (catalogo: string, clave: string): boolean | null => {
    const r = sat ? sat.existe(catalogo, clave) : null;
    if (sat && r === null) sinCargar.add(catalogo);
    return r;
  };

  e.mercancias.forEach((fila, i) => {
    const aqui = (campo: string, severidad: Severidad, codigo: string, mensaje: string, relacionados?: Hallazgo['relacionados']) =>
      reg({ campo, renglon: i, severidad, codigo, mensaje: `${etiquetaCampo(campo, i)}: ${mensaje}`, relacionados });
    const v = (k: string) => (fila[k]?.valor ?? '').trim();

    const prod = v('bienes_transp');
    if (/^\d{8}$/.test(prod) && consulta(CAT_PRODUCTO, prod) === false) {
      aqui('bienes_transp', 'bloqueo', 'clave_no_catalogo', `La clave ${prod} no existe en el catálogo del SAT (c_ClaveProdServCP).`);
    }
    const uni = v('clave_unidad');
    if (uni && !CLAVES_UNIDAD.has(uni) && /^[A-Z0-9]{2,3}$/.test(uni) && !/^\d{1,2}$/.test(uni) && consulta(CAT_UNIDAD, uni) === false) {
      aqui('clave_unidad', 'bloqueo', 'unidad_no_catalogo', `La clave de unidad ${uni} no existe en el catálogo del SAT (c_ClaveUnidad).`);
    }
    const emb = v('embalaje');
    if (/^[0-9A-Z]{2,3}$/.test(emb) && consulta(CAT_EMBALAJE, emb) === false) {
      aqui('embalaje', 'bloqueo', 'embalaje_no_catalogo', `La clave de embalaje ${emb} no existe en el catálogo del SAT (c_TipoEmbalaje).`);
    }
    const fraccion = v('fraccion_arancelaria');
    const clavesFr = clavesDeFraccion(fraccion);
    if (clavesFr.length > 0) {
      const respuestas = clavesFr.map((c) => consulta(CAT_FRACCION, c));
      if (respuestas.every((r) => r === false)) {
        aqui('fraccion_arancelaria', 'bloqueo', 'fraccion_no_catalogo', `La fracción arancelaria ${normalizarFraccion(fraccion)} no existe en el catálogo del SAT (c_FraccionArancelaria).`);
      }
    }
    const peligroso = v('material_peligroso') === 'true';
    const clavePel = v('clave_material_peligroso');
    const hayClavePel = clavePel !== '' && clavePel.toUpperCase() !== 'N/A';
    if (peligroso && !hayClavePel) {
      aqui('clave_material_peligroso', 'bloqueo', 'peligroso_sin_clave', 'La mercancía está marcada como material peligroso y no trae la clave del material (c_MaterialPeligroso).', [{ campo: 'material_peligroso', renglon: i }]);
    }
    if (hayClavePel && consulta(CAT_PELIGROSO, clavePel) === false) {
      aqui('clave_material_peligroso', 'bloqueo', 'peligroso_no_catalogo', `La clave de material peligroso ${clavePel} no existe en el catálogo del SAT (c_MaterialPeligroso).`);
    }
    // Embalaje contra la mercancía (heurística, solo confirmar): sacos en un embalaje que no es de saco, o racks en saco.
    if (emb && fila.embalaje?.origen !== 'humano') {
      const texto = `${v('descripcion')} ${v('unidad_texto')}`;
      const esSaco = EMBALAJE_SACO.test(emb);
      if (TEXTO_SACO.test(texto) && !esSaco) {
        aqui('embalaje', 'confirmar', 'embalaje_incoherente', `La mercancía habla de sacos pero el embalaje es ${emb}, que no es de saco/bolsa (5H, 5L, 5M). Confírmalo.`, [{ campo: 'descripcion', renglon: i }]);
      } else if (TEXTO_RACK.test(texto) && esSaco) {
        aqui('embalaje', 'confirmar', 'embalaje_incoherente', `La mercancía viene en racks o tarimas pero el embalaje es ${emb} (saco/bolsa). Confírmalo.`, [{ campo: 'descripcion', renglon: i }]);
      }
    }
  });

  for (const lado of ['origen', 'destino'] as const) {
    if (esExtranjero(e, lado)) continue; // un CP o colonia extranjeros no existen en el catálogo del SAT
    const cp = (e.campos[`${lado}_cp`]?.valor ?? '').trim();
    const a = (campo: string, severidad: Severidad, codigo: string, mensaje: string, relacionados?: Hallazgo['relacionados']) =>
      reg({ campo, renglon: null, severidad, codigo, mensaje: `${etiquetaCampo(campo, null)}: ${mensaje}`, relacionados });
    if (/^\d{5}$/.test(cp)) {
      const existe = consulta(CAT_CP, cp);
      if (existe === false) a(`${lado}_cp`, 'bloqueo', 'cp_no_catalogo', `El código postal ${cp} no existe en el catálogo del SAT (c_CodigoPostal).`);
      const d = existe ? sat?.datos(CAT_CP, cp) : null;
      if (d) {
        const dif = (campo: string, columna: string, codigo: string, nombre: string) => {
          const dado = (e.campos[campo]?.valor ?? '').trim();
          const esperado = (d[columna] ?? '').trim();
          if (dado && esperado && dado !== esperado && e.campos[campo]?.origen !== 'humano') {
            a(campo, 'confirmar', codigo, `${nombre} «${dado}» no corresponde al código postal ${cp} según el SAT (le corresponde «${esperado}»).`, [{ campo: `${lado}_cp`, renglon: null }]);
          }
        };
        dif(`${lado}_estado`, 'c_Estado', 'cp_estado_sat', 'El estado');
        dif(`${lado}_municipio_clave`, 'c_Municipio', 'cp_municipio', 'El municipio');
        dif(`${lado}_localidad_clave`, 'c_Localidad', 'cp_localidad', 'La localidad');
      }
    }
    const col = (e.campos[`${lado}_colonia_clave`]?.valor ?? '').trim();
    if (col && consulta(CAT_COLONIA, col) === true) {
      const cpCol = (sat?.datos(CAT_COLONIA, col)?.c_CodigoPostal ?? '').trim();
      if (cpCol && /^\d{5}$/.test(cp) && cpCol !== cp) {
        a(`${lado}_colonia_clave`, 'aviso', 'cp_colonia', `La colonia ${col} figura en el catálogo con el código postal ${cpCol}, no con ${cp}. Verifica la colonia.`, [{ campo: `${lado}_cp`, renglon: null }]);
      }
    }
  }

  for (const catalogo of sinCargar) {
    reg({ campo: 'documento', renglon: null, severidad: 'aviso', codigo: 'catalogo_no_cargado', mensaje: `El catálogo ${catalogo} no está cargado: no se pudo verificar contra el SAT (no bloquea).` });
  }
}

/**
 * Fracción (grupo 98xx) y clave de producto (`01010101`) genéricas (T-A3-57): el operador las usa cuando el documento no da
 * dato o da otro. Hoy pasarían sin aviso. Sin documento con qué comparar ⇒ solo `aviso`; si el documento da OTRA fracción
 * ⇒ `confirmar` con la diferencia (un humano que escribe el campo lo resuelve). La regla definitiva es del cliente
 * (stand-by): nada de esto bloquea.
 */
/** Cuántos orígenes/destinos trae la extracción: el mayor N con algún dato `origen_N_*` / `destino_N_*` (mínimo 1). */
function contarExtremos(e: Extraccion, lado: 'origen' | 'destino'): number {
  let max = 1;
  const re = new RegExp(`^${lado}_(\\d{1,4})_`);
  for (const [k, v] of Object.entries(e.campos)) {
    const m = re.exec(k);
    if (m && (v?.valor ?? '').trim() !== '') max = Math.max(max, Number(m[1]));
  }
  return max;
}

/**
 * Referencias huérfanas (T-A3-55): una mercancía que apunta al origen/destino N cuando el documento solo trae menos
 * (típico: 14 renglones numerados 1..14 con un solo destino, donde el número era el del renglón). Pide confirmar; con un
 * único origen/destino propone el 1, con varios no adivina. La exportación no emite una referencia inexistente (bloquea).
 */
function verificarReferencias(e: Extraccion, reg: Registrar): void {
  for (const lado of ['origen', 'destino'] as const) {
    const campo = `id_${lado}` as (typeof REFERENCIAS_MERCANCIA)[number];
    const total = contarExtremos(e, lado);
    e.mercancias.forEach((fila, i) => {
      const c = fila[campo];
      if (!c || c.origen === 'humano') return;
      const n = normalizarIdDestino(c.valor);
      if (n === null || Number(n) <= total) return;
      reg({
        campo, renglon: i, severidad: 'confirmar', codigo: `${campo}_huerfano`, evidencia: c.evidencia ?? null,
        mensaje: `Mercancía ${i + 1}: apunta al ${lado} ${n}, pero el documento trae ${total} ${total === 1 ? lado : `${lado}s`}.`
          + (total === 1 ? ` Si ${n} era el número de renglón, va al ${lado} 1: confírmalo.` : ` Indica a cuál de los ${total} va.`),
        ...(total === 1 ? { propuesta: { campo, renglon: i, valor: '1' } } : {}),
      });
    });
  }
}

/** Aplica la propuesta de un hallazgo (la decisión de una persona); devuelve una extracción nueva, el valor queda `humano`. */
export function aplicarPropuestaReferencia(e: Extraccion, h: Hallazgo): Extraccion {
  const p = h.propuesta;
  if (!p || !e.mercancias[p.renglon]) return e;
  const mercancias = e.mercancias.map((f, i) => i === p.renglon
    ? { ...f, [p.campo]: { valor: p.valor, confianza: 1, evidencia: f[p.campo]?.evidencia ?? null, origen: 'humano' as const } }
    : f);
  return { campos: e.campos, mercancias };
}

function verificarGenericos(e: Extraccion, doc: OpcionesValidacion['fraccionDocumento'], reg: Registrar): void {
  e.mercancias.forEach((fila, i) => {
    const aqui = (campo: string, severidad: Severidad, codigo: string, mensaje: string) =>
      reg({ campo, renglon: i, severidad, codigo, mensaje: `${etiquetaCampo(campo, i)}: ${mensaje}`, evidencia: fila[campo]?.evidencia ?? null });
    const fr = (fila.fraccion_arancelaria?.valor ?? '').trim();
    if (fr && esFraccionGenerica(fr)) {
      const propia = normalizarFraccion(fr);
      const otra = doc?.valor?.trim();
      if (otra && !mismaFraccion(propia, otra)) {
        if (fila.fraccion_arancelaria?.origen !== 'humano') {
          aqui('fraccion_arancelaria', 'confirmar', 'fraccion_generica_difiere', `el libro trae la fracción genérica ${propia} y ${doc!.fuente} da ${normalizarFraccion(otra)}. Confirma cuál va en el complemento.`);
        }
      } else {
        aqui('fraccion_arancelaria', 'aviso', 'fraccion_generica', `la fracción ${propia} es genérica (grupo 98xx)${otra ? '' : ' y no hay documento con qué compararla'}. Verifica que sea la que corresponde.`);
      }
    }
    const prod = (fila.bienes_transp?.valor ?? '').trim();
    if (prod && esClaveProductoGenerica(prod)) {
      aqui('bienes_transp', 'aviso', 'clave_producto_generica', `la clave de producto ${prod} es genérica. Verifica que sea la que corresponde a la mercancía.`);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// REGLAS DE DEPENDENCIA DE LA GUÍA DE LLENADO (T-A3-45) — una función pura por regla.
//
// Fuente: hoja «Guía de llenado» de la plantilla «nueva» del TMS (análisis 17 §1.3, §4.6). Cada regla devuelve sus
// hallazgos en llano y NO modifica nada; el saneo de lo que la regla dice «vacío» o «sin caracteres especiales» lo hace
// `aplicarReglasGuia` al exportar (y avisa de lo que cambió). Las que la Guía llama obligatorias bloquean; las que el
// exportador corrige solo (omitir, limpiar) son aviso: no frenan, pero la persona sabe qué saldrá distinto.
// ═══════════════════════════════════════════════════════════════════════════

/** Cada regla se puede apagar o ajustar por perfil. Los valores por omisión son los de la Guía. */
export interface ReglasGuia {
  /** Embalaje y su descripción solo si hay material peligroso. */
  embalajeSoloPeligroso: boolean;
  /** Pedimento y RFC del importador solo en importación (vacíos en exportación y en transporte nacional). */
  pedimentoSoloImportacion: boolean;
  /** Tipo de materia 01–05; la descripción es obligatoria si es «05». */
  tipoMateria: boolean;
  /** Caja y referencia con largo máximo. */
  longitudes: boolean;
  /** Descripción de la mercancía sin caracteres especiales. */
  descripcionSinEspeciales: boolean;
  /** Razón social sin puntos ni comas. */
  razonSocialSinPuntuacion: boolean;
  /** País distinto de MEX ⇒ sin claves de colonia, localidad ni municipio. */
  domicilioSoloMexico: boolean;
  maxCaja: number;
  maxReferencia: number;
  /** Signos que se permiten además de letras (con acentos y ñ), dígitos y espacio. */
  permitidosDescripcion: string;
}

export const REGLAS_GUIA_POR_OMISION: ReglasGuia = {
  embalajeSoloPeligroso: true, pedimentoSoloImportacion: true, tipoMateria: true, longitudes: true,
  descripcionSinEspeciales: true, razonSocialSinPuntuacion: true, domicilioSoloMexico: true,
  maxCaja: 15, maxReferencia: 30, permitidosDescripcion: '.,-/()',
};

export function reglasGuiaEfectivas(r: Partial<ReglasGuia> | false | undefined): ReglasGuia | null {
  return r === false ? null : { ...REGLAS_GUIA_POR_OMISION, ...(r ?? {}) };
}

export type TipoOperacion = 'exportacion' | 'importacion' | 'nacional' | 'desconocida';

const texto = (c: CampoValor | undefined): string => (c?.valor ?? '').trim();

/**
 * Importación o exportación, del régimen aduanero (documento o primera mercancía: IMD/ITR/ITE… importan; EXD/ETR/ETE…
 * exportan) y, sin régimen, de `transp_internac = false` (nacional). Sin dato no se adivina: `desconocida` (ninguna regla
 * que dependa de la operación actúa).
 */
export function tipoOperacion(e: Extraccion): TipoOperacion {
  const reg = (texto(e.campos.regimen_aduanero) || texto(e.mercancias[0]?.regimen_aduanero)).toUpperCase();
  if (/^(IM|IT|DF)/.test(reg)) return 'importacion';
  if (/^(EX|ET)/.test(reg)) return 'exportacion';
  if (reg === '' && texto(e.campos.transp_internac) === 'false') return 'nacional';
  return 'desconocida';
}

/** Prefijo de la nota que deja la regla del tramo mexicano cuando el extremo elegido no es el del documento (T-A3-50). */
export const MARCA_TRAMO_DISTINTO = 'Tramo mexicano:';

/**
 * T-A3-50 · ¿Falta la regla del cliente para el tramo mexicano? Exportación pide la del destino; importación, la del origen.
 * Otra operación (o desconocida) no la necesita. Devuelve el bloqueo «falta definir destino/origen», o `null`.
 */
export function bloqueoTramoSinRegla(e: Extraccion, regla: ReglaTramoCliente | null | undefined): { campo: string; mensaje: string } | null {
  const op = tipoOperacion(e);
  if (op === 'exportacion' && !regla?.destinoExportacion) {
    return { campo: 'destino_nombre', mensaje: 'Falta definir destino: el perfil del cliente no declara dónde termina el tramo mexicano (patio propio, frontera o el destino del documento). No se toma el destino del BOL por omisión.' };
  }
  if (op === 'importacion' && !regla?.origenImportacion) {
    return { campo: 'origen_nombre', mensaje: 'Falta definir origen: el perfil del cliente no declara dónde empieza el tramo mexicano (patio propio o el origen del documento). No se toma el origen del documento por omisión.' };
  }
  return null;
}

const mercanciaPeligrosa = (fila: Record<string, CampoValor>): boolean => texto(fila.material_peligroso) === 'true';
const CLAVES_RFC_IMPORTADOR = 'rfc_importador';

/** Quita lo que no sea letra (con acentos y ñ), dígito, espacio o alguno de los `permitidos`; deja un solo espacio. */
export function quitarCaracteresEspeciales(t: string, permitidos: string = REGLAS_GUIA_POR_OMISION.permitidosDescripcion): string {
  let fuera = '';
  for (const ch of t.normalize('NFC')) {
    if (/[\p{L}\p{N}\s]/u.test(ch) || permitidos.includes(ch)) fuera += ch; else fuera += ' ';
  }
  return fuera.replace(/\s+/g, ' ').trim();
}

/** «ACME, S.A. de C.V.» → «ACME SA de CV». */
export function limpiarRazonSocial(t: string): string {
  return t.replace(/[.,]/g, (m) => (m === ',' ? ' ' : '')).replace(/\s+/g, ' ').trim();
}

const especialesDe = (t: string, permitidos: string): string[] => {
  const raros = new Set<string>();
  for (const ch of t.normalize('NFC')) if (!/[\p{L}\p{N}\s]/u.test(ch) && !permitidos.includes(ch)) raros.add(ch);
  return [...raros];
};

type FilaMerc = Record<string, CampoValor>;
const porRenglon = (e: Extraccion, f: (fila: FilaMerc, i: number) => Hallazgo | Hallazgo[] | null): Hallazgo[] =>
  e.mercancias.flatMap((fila, i) => { const h = f(fila, i); return h === null ? [] : Array.isArray(h) ? h : [h]; });

const hay = (c: CampoValor | undefined): boolean => texto(c) !== '';

/** Regla 1 — embalaje y su descripción solo si hay material peligroso (si «NO», vacíos). Aviso: el exportador los omite. */
export function reglaEmbalajeSoloPeligroso(e: Extraccion): Hallazgo[] {
  return porRenglon(e, (fila, i) => {
    if (mercanciaPeligrosa(fila) || !(hay(fila.embalaje) || hay(fila.embalaje_descripcion))) return null;
    const campo = hay(fila.embalaje) ? 'embalaje' : 'embalaje_descripcion';
    return {
      campo, renglon: i, severidad: 'aviso', codigo: 'guia_embalaje_sin_peligroso',
      mensaje: `${etiquetaCampo(campo, i)}: la Guía de llenado pide el embalaje solo cuando la mercancía es material peligroso; como no lo es, saldrá vacío en el libro del TMS.`,
      relacionados: [{ campo: 'material_peligroso', renglon: i }],
    };
  });
}

/** Regla 2 — pedimento y RFC del importador solo en importación (vacíos en exportación y en transporte nacional). */
export function reglaPedimentoSoloImportacion(e: Extraccion): Hallazgo[] {
  const op = tipoOperacion(e);
  if (op !== 'exportacion' && op !== 'nacional') return [];
  const quien = op === 'exportacion' ? 'una exportación' : 'un transporte nacional';
  return porRenglon(e, (fila, i) => {
    const sobran = ['pedimento', CLAVES_RFC_IMPORTADOR].filter((k) => hay(fila[k]));
    return sobran.map((campo): Hallazgo => ({
      campo, renglon: i, severidad: 'aviso', codigo: campo === 'pedimento' ? 'guia_pedimento_sin_importacion' : 'guia_rfc_importador_sin_importacion',
      mensaje: `${etiquetaCampo(campo, i)}: en ${quien} la Guía de llenado lo deja vacío; saldrá vacío en el libro del TMS.`,
    }));
  });
}

/** Regla 3 — tipo de materia 01–05; si es «05» hace falta su descripción. */
export function reglaTipoMateria(e: Extraccion): Hallazgo[] {
  return porRenglon(e, (fila, i) => {
    const t = texto(fila.tipo_materia);
    if (t === '') return null;
    if (!/^0[1-5]$/.test(t)) {
      return { campo: 'tipo_materia', renglon: i, severidad: 'bloqueo', codigo: 'guia_tipo_materia', mensaje: `${etiquetaCampo('tipo_materia', i)}: «${t}» no es un tipo de materia válido; la Guía de llenado acepta de 01 a 05.` };
    }
    if (t === '05' && !hay(fila.descripcion_materia)) {
      return {
        campo: 'tipo_materia', renglon: i, severidad: 'confirmar', codigo: 'guia_materia_05_sin_descripcion',
        mensaje: `${etiquetaCampo('tipo_materia', i)}: con tipo de materia 05 la Guía de llenado exige describir la materia y no viene. Confírmalo cuando la tengas.`,
      };
    }
    return null;
  });
}

/** Regla 4 — caja de hasta 15 caracteres y referencia de hasta 30. */
export function reglaLongitudes(e: Extraccion, maxCaja = REGLAS_GUIA_POR_OMISION.maxCaja, maxReferencia = REGLAS_GUIA_POR_OMISION.maxReferencia): Hallazgo[] {
  const salida: Hallazgo[] = [];
  const revisar = (campo: 'caja_numero' | 'folio_cliente', max: number, codigo: string, nombre: string) => {
    const v = texto(e.campos[campo]);
    if (v.length > max) {
      salida.push({ campo, renglon: null, severidad: 'bloqueo', codigo, mensaje: `${etiquetaCampo(campo, null)}: «${v}» tiene ${v.length} caracteres y la Guía de llenado admite hasta ${max} en ${nombre}. Acórtalo.` });
    }
  };
  revisar('caja_numero', maxCaja, 'guia_caja_larga', 'el número de caja');
  revisar('folio_cliente', maxReferencia, 'guia_referencia_larga', 'la referencia');
  return salida;
}

/** Regla 5 — descripción de la mercancía sin caracteres especiales. Aviso: el exportador los limpia. */
export function reglaDescripcionSinEspeciales(e: Extraccion, permitidos = REGLAS_GUIA_POR_OMISION.permitidosDescripcion): Hallazgo[] {
  return porRenglon(e, (fila, i) => {
    const raros = especialesDe(texto(fila.descripcion), permitidos);
    if (raros.length === 0) return null;
    return {
      campo: 'descripcion', renglon: i, severidad: 'aviso', codigo: 'guia_descripcion_especiales',
      mensaje: `${etiquetaCampo('descripcion', i)}: trae caracteres especiales (${raros.map((c) => `«${c}»`).join(' ')}) y la Guía de llenado no los admite; se quitarán en el libro del TMS.`,
    };
  });
}

const CAMPOS_RAZON_SOCIAL = /^(origen|destino(?:_\d+)?)_nombre$/;

/** Regla 6 — razón social sin puntos ni comas. Aviso: el exportador los quita. */
export function reglaRazonSocialSinPuntuacion(e: Extraccion): Hallazgo[] {
  return Object.keys(e.campos).filter((k) => CAMPOS_RAZON_SOCIAL.test(k) && /[.,]/.test(texto(e.campos[k]))).map((campo): Hallazgo => ({
    campo, renglon: null, severidad: 'aviso', codigo: 'guia_razon_social_puntuacion',
    mensaje: `${etiquetaCampo(campo, null)}: la Guía de llenado no admite puntos ni comas en la razón social; se quitarán en el libro del TMS.`,
  }));
}

const LADOS_DOMICILIO = ['origen', 'destino', 'destino_2', 'destino_3', 'destino_4'] as const;
const CLAVES_DOMICILIO_MX = ['colonia_clave', 'localidad_clave', 'municipio_clave'] as const;
const esExtranjero = (e: Extraccion, lado: string): boolean => { const p = texto(e.campos[`${lado}_pais`]); return p !== '' && !esPaisMexico(p); };

/** Regla 7 — país distinto de MEX ⇒ sin claves de colonia, localidad ni municipio. Aviso: el exportador las omite. */
export function reglaDomicilioSoloMexico(e: Extraccion): Hallazgo[] {
  const salida: Hallazgo[] = [];
  for (const lado of LADOS_DOMICILIO) {
    if (!esExtranjero(e, lado)) continue;
    for (const k of CLAVES_DOMICILIO_MX) {
      const campo = `${lado}_${k}`;
      if (hay(e.campos[campo])) {
        salida.push({
          campo, renglon: null, severidad: 'aviso', codigo: 'guia_domicilio_extranjero',
          mensaje: `${etiquetaCampo(campo, null)}: el país es ${texto(e.campos[`${lado}_pais`])} y la Guía de llenado solo pide claves de colonia, localidad y municipio para México; saldrá vacía en el libro del TMS.`,
          relacionados: [{ campo: `${lado}_pais`, renglon: null }],
        });
      }
    }
  }
  return salida;
}

/** Todas las reglas de la Guía, según lo que el perfil tenga encendido. */
export function validarReglasGuia(e: Extraccion, reglas: Partial<ReglasGuia> | false | undefined): Hallazgo[] {
  const r = reglasGuiaEfectivas(reglas);
  if (!r) return [];
  return [
    ...(r.embalajeSoloPeligroso ? reglaEmbalajeSoloPeligroso(e) : []),
    ...(r.pedimentoSoloImportacion ? reglaPedimentoSoloImportacion(e) : []),
    ...(r.tipoMateria ? reglaTipoMateria(e) : []),
    ...(r.longitudes ? reglaLongitudes(e, r.maxCaja, r.maxReferencia) : []),
    ...(r.descripcionSinEspeciales ? reglaDescripcionSinEspeciales(e, r.permitidosDescripcion) : []),
    ...(r.razonSocialSinPuntuacion ? reglaRazonSocialSinPuntuacion(e) : []),
    ...(r.domicilioSoloMexico ? reglaDomicilioSoloMexico(e) : []),
  ];
}

/**
 * Aplica las reglas que dicen «vacío» o «limpio» a una COPIA de la extracción (la original no se toca) y dice, en llano,
 * qué cambió. Es lo que consumen la plantilla del TMS y la exportación: no escriben lo que la Guía deja vacío.
 */
export function aplicarReglasGuia(e: Extraccion, reglas: Partial<ReglasGuia> | false | undefined): { extraccion: Extraccion; avisos: string[] } {
  const r = reglasGuiaEfectivas(reglas);
  if (!r) return { extraccion: e, avisos: [] };
  const campos: Record<string, CampoValor> = { ...e.campos };
  const mercancias: FilaMerc[] = e.mercancias.map((f) => ({ ...f }));
  const cambios = new Map<string, Set<string>>();
  const anotar = (mensaje: string, donde: string) => { (cambios.get(mensaje) ?? cambios.set(mensaje, new Set()).get(mensaje)!).add(donde); };
  const vaciar = (fila: FilaMerc, k: string) => { fila[k] = { ...fila[k], valor: null }; };
  const op = tipoOperacion(e);

  mercancias.forEach((fila, i) => {
    const donde = `mercancía ${i + 1}`;
    if (r.embalajeSoloPeligroso && !mercanciaPeligrosa(fila)) {
      for (const k of ['embalaje', 'embalaje_descripcion']) if (hay(fila[k])) { vaciar(fila, k); anotar('Se omitió el embalaje y su descripción porque la mercancía no es material peligroso', donde); }
    }
    if (r.pedimentoSoloImportacion && (op === 'exportacion' || op === 'nacional')) {
      for (const k of ['pedimento', CLAVES_RFC_IMPORTADOR]) if (hay(fila[k])) { vaciar(fila, k); anotar(`Se omitió el pedimento y el RFC del importador porque es ${op === 'exportacion' ? 'una exportación' : 'un transporte nacional'}`, donde); }
    }
    if (r.descripcionSinEspeciales && hay(fila.descripcion)) {
      const limpia = quitarCaracteresEspeciales(texto(fila.descripcion), r.permitidosDescripcion);
      if (limpia !== texto(fila.descripcion)) {
        fila.descripcion = { ...fila.descripcion, valor: limpia, notas: [...(fila.descripcion.notas ?? []), 'Se quitaron caracteres especiales (Guía de llenado).'] };
        anotar('Se quitaron caracteres especiales de la descripción', donde);
      }
    }
  });
  if (r.razonSocialSinPuntuacion) {
    for (const k of Object.keys(campos).filter((x) => CAMPOS_RAZON_SOCIAL.test(x))) {
      const limpia = limpiarRazonSocial(texto(campos[k]));
      if (hay(campos[k]) && limpia !== texto(campos[k])) {
        campos[k] = { ...campos[k], valor: limpia, notas: [...(campos[k].notas ?? []), 'Se quitaron puntos y comas (Guía de llenado).'] };
        anotar('Se quitaron puntos y comas de la razón social', etiquetaCampo(k, null));
      }
    }
  }
  if (r.domicilioSoloMexico) {
    for (const lado of LADOS_DOMICILIO) {
      if (!esExtranjero(e, lado)) continue;
      for (const k of CLAVES_DOMICILIO_MX) {
        const campo = `${lado}_${k}`;
        if (hay(campos[campo])) { campos[campo] = { ...campos[campo], valor: null }; anotar('Se omitieron las claves de colonia, localidad y municipio porque el país no es México', lado); }
      }
    }
  }
  const avisos = [...cambios].map(([m, donde]) => `${m} (${[...donde].join(', ')}).`);
  return { extraccion: { campos, mercancias }, avisos };
}

export function validarExtraccion(e: Extraccion, op: OpcionesValidacion = {}): ResultadoValidacion {
  const hallazgos: Hallazgo[] = [];
  const reg: Registrar = (h) => hallazgos.push(h);
  const ahora = op.ahora ?? new Date();

  const revisarCampo = (def: CampoDoc, c: CampoValor | undefined, renglon: number | null): void => {
    const etiqueta = etiquetaCampo(def.clave, renglon);
    if (esVacio(c)) {
      if (def.critico) reg({ campo: def.clave, renglon, severidad: 'bloqueo', codigo: 'critico_ausente', mensaje: `${etiqueta}: el documento no lo trae o no se pudo leer. Captúralo para poder aprobar.` });
      return;
    }
    const campo = c as CampoValor;
    validarFormato(def, campo, renglon, reg, op.catalogosSat, contextoExtranjero(e, def.clave));
    if (campo.origen === 'humano') return; // lo demás son DUDAS sobre una lectura: un humano ya la resolvió.
    if (valorSospechoso(campo.valor)) {
      reg({ campo: def.clave, renglon, severidad: 'bloqueo', codigo: 'valor_sospechoso', mensaje: `${etiqueta}: el valor leído parece una instrucción, no un dato. Escríbelo tú.` });
    }
    if (def.critico && campo.confianza < UMBRAL_CRITICO) {
      reg({ campo: def.clave, renglon, severidad: 'confirmar', codigo: 'confianza_baja', mensaje: `${etiqueta}: la lectura no es segura (${Math.round(campo.confianza * 100)} %). Confírmala contra el documento.` });
    }
    if (def.critico && op.riesgoInyeccion) {
      reg({ campo: def.clave, renglon, severidad: 'confirmar', codigo: 'documento_con_instrucciones', mensaje: `${etiqueta}: el documento trae texto con forma de instrucción; confirma este dato a mano.` });
    }
    for (const nota of campo.notas ?? []) {
      if (/Confírmalo|confirma la cifra|No se reconoció/i.test(nota)) {
        reg({ campo: def.clave, renglon, severidad: 'confirmar', codigo: 'normalizacion_dudosa', mensaje: `${etiqueta}: ${nota}` });
      } else if (def.clave === 'destino_nombre' && nota.startsWith(MARCA_TRAMO_DISTINTO)) {
        reg({ campo: def.clave, renglon, severidad: 'aviso', codigo: 'destino_distinto_documento', mensaje: nota });
      } else if (def.clave === 'origen_nombre' && nota.startsWith(MARCA_TRAMO_DISTINTO)) {
        reg({ campo: def.clave, renglon, severidad: 'aviso', codigo: 'origen_distinto_documento', mensaje: nota });
      } else if (def.tipo === 'fecha' && /día\/mes\/año/.test(nota)) {
        reg({ campo: def.clave, renglon, severidad: 'aviso', codigo: 'fecha_ambigua', mensaje: `${etiqueta}: fecha ambigua; se leyó día/mes/año. Si el documento escribe mes/día, corrígela y el perfil lo aprenderá.` });
      }
    }
  };

  for (const def of CAMPOS_DOC) revisarCampo(def, e.campos[def.clave], null);

  if (e.mercancias.length === 0) {
    reg({ campo: 'mercancias', renglon: null, severidad: 'bloqueo', codigo: 'sin_mercancias', mensaje: 'No se encontró ninguna mercancía en el documento. Agrega al menos un renglón para poder aprobar.' });
  }
  e.mercancias.forEach((fila, i) => { for (const def of CAMPOS_MERCANCIA) revisarCampo(def, fila[def.clave], i); });

  // ── Coherencia entre campos ───────────────────────────────────────────────
  for (const lado of ['origen', 'destino'] as const) {
    const cp = e.campos[`${lado}_cp`]?.valor; const est = e.campos[`${lado}_estado`]?.valor;
    if (esExtranjero(e, lado)) continue; // el CP de EE. UU. no se cruza con un estado mexicano
    if (cp && est && /^\d{5}$/.test(cp) && CODIGOS_ESTADO.has(est)) {
      const esperado = estadoDeCp(cp);
      if (esperado && esperado !== est) {
        reg({ campo: `${lado}_cp`, renglon: null, severidad: 'confirmar', codigo: 'cp_estado', mensaje: `El código postal ${cp} corresponde a ${esperado}, pero el estado de ${lado} dice ${est}. Revisa cuál de los dos está mal.`, relacionados: [{ campo: `${lado}_estado`, renglon: null }] });
      }
    }
  }
  if (op.reglaTramo !== undefined) {
    const b = bloqueoTramoSinRegla(e, op.reglaTramo);
    if (b) reg({ campo: b.campo, renglon: null, severidad: 'bloqueo', codigo: 'tramo_sin_regla', mensaje: b.mensaje });
  }
  const f1 = partesFecha(e.campos.fecha_salida?.valor); const f2 = partesFecha(e.campos.fecha_llegada?.valor);
  if (f1 && f2) {
    const a = Date.UTC(f1[0], f1[1] - 1, f1[2], f1[3] ?? 0, f1[4] ?? 0); const b = Date.UTC(f2[0], f2[1] - 1, f2[2], f2[3] ?? 0, f2[4] ?? 0);
    if (b < a) reg({ campo: 'fecha_llegada', renglon: null, severidad: 'confirmar', codigo: 'fecha_orden', mensaje: 'La llegada es anterior a la salida.', relacionados: [{ campo: 'fecha_salida', renglon: null }] });
  }
  if (f1) {
    const dias = (Date.UTC(f1[0], f1[1] - 1, f1[2]) - ahora.getTime()) / 86_400_000;
    if (dias < -365 || dias > 365) reg({ campo: 'fecha_salida', renglon: null, severidad: 'aviso', codigo: 'fecha_lejana', mensaje: 'La fecha de salida está a más de un año de hoy.' });
  }
  if (e.campos.origen_cp?.valor && e.campos.origen_cp.valor === e.campos.destino_cp?.valor) {
    reg({ campo: 'destino_cp', renglon: null, severidad: 'aviso', codigo: 'mismo_cp', mensaje: 'El origen y el destino tienen el mismo código postal.' });
  }
  // Pesos: el total del documento contra la suma de los renglones.
  const pesos = e.mercancias.map((f) => normalizarNumero(f.peso_kg?.valor ?? '').valor);
  const total = normalizarNumero(e.campos.peso_bruto_total?.valor ?? '').valor;
  if (total !== null && pesos.length > 0 && pesos.every((p): p is number => p !== null) && e.campos.peso_bruto_total.origen !== 'derivado') {
    const suma = pesos.reduce((s, p) => s + p, 0);
    if (Math.abs(total - suma) > Math.max(1, total * 0.005)) {
      reg({ campo: 'peso_bruto_total', renglon: null, severidad: 'confirmar', codigo: 'peso_suma', mensaje: `El peso bruto total (${total} kg) no es la suma de las mercancías (${Math.round(suma * 1000) / 1000} kg). El complemento exige que coincidan.`, relacionados: e.mercancias.map((_, i) => ({ campo: 'peso_kg', renglon: i })) });
    }
  }
  // Catálogos SAT (T-A3-24): clave inexistente bloquea; catálogo sin cargar solo avisa.
  verificarCatalogosSat(e, op.catalogosSat, reg);
  // Fracción y clave de producto genéricas (T-A3-57): avisan, nunca bloquean por sí solas.
  verificarGenericos(e, op.fraccionDocumento, reg);
  // Referencias huérfanas de origen/destino por mercancía (T-A3-55).
  verificarReferencias(e, reg);
  // Verificación de sumas con rechazo (T-A3-18): piezas, kg y m³ contra el total que declara el documento.
  verificarSumas(e, reg);
  // Cuadre del peso entre lecturas y contra el documento hermano (T-A3-52).
  verificarPesoCruzado(e, op.pesoReferencia, reg);
  // Reglas de dependencia de la Guía de llenado del TMS (T-A3-45).
  for (const h of validarReglasGuia(e, op.reglasGuia)) reg(h);
  // Cantidad vs peso cuando la unidad es de masa.
  e.mercancias.forEach((fila, i) => {
    const u = fila.clave_unidad?.valor; const q = normalizarNumero(fila.cantidad?.valor ?? '').valor; const p = normalizarNumero(fila.peso_kg?.valor ?? '').valor;
    if ((u === 'KGM' || u === 'TNE') && q !== null && p !== null) {
      const esperado = q * FACTOR_A_KG[u];
      if (Math.abs(esperado - p) > Math.max(1, esperado * 0.01)) {
        reg({ campo: 'peso_kg', renglon: i, severidad: 'confirmar', codigo: 'cantidad_peso', mensaje: `${etiquetaCampo('peso_kg', i)}: la cantidad (${q} ${u}) equivale a ${Math.round(esperado * 1000) / 1000} kg y el peso dice ${p} kg.`, relacionados: [{ campo: 'cantidad', renglon: i }, { campo: 'clave_unidad', renglon: i }] });
      }
    }
    if (fila.valor_mercancia?.valor && !fila.moneda?.valor) {
      reg({ campo: 'moneda', renglon: i, severidad: 'confirmar', codigo: 'moneda_falta', mensaje: `${etiquetaCampo('valor_mercancia', i)}: hay valor pero el documento no dice la moneda. Indícala.` });
    }
    const pu = fila.peso_unidad?.valor;
    if (pu && pu !== 'KGM' && fila.peso_kg?.valor && fila.peso_kg.origen !== 'humano') {
      reg({ campo: 'peso_kg', renglon: i, severidad: 'confirmar', codigo: 'peso_unidad', mensaje: `${etiquetaCampo('peso_kg', i)}: el peso viene en «${pu}», que no se pudo convertir a kg. Escribe el peso en kilogramos.` });
    }
  });
  if (op.capturaIncompleta) {
    reg({ campo: 'documento', renglon: null, severidad: 'bloqueo', codigo: 'captura_incompleta', mensaje: `La captura del correo llegó cortada: termina en «${op.capturaIncompleta.ultimoRotulo}» sin valor, así que faltan datos (fracción, pedimento…). Pide al cliente el texto copiado del correo o una captura completa.` });
  }
  if (op.remitenteReconocido === false) {
    reg({ campo: 'documento', renglon: null, severidad: 'aviso', codigo: 'remitente_no_reconocido', mensaje: 'El documento llegó de un remitente que no está en la lista del buzón. Revisa que de verdad sea de tu cliente.' });
  }
  if (op.riesgoInyeccion) {
    reg({ campo: 'documento', renglon: null, severidad: 'aviso', codigo: 'inyeccion', mensaje: 'El documento trae texto con forma de instrucción para un modelo de IA. Se ignoró; confirma a mano cada dato crítico.' });
  }

  // Un «confirmar» que un humano ya resolvió deja de contar.
  const vigentes = hallazgos.filter((h) => h.severidad !== 'confirmar' || !confirmado(e, h));
  const bloqueos = vigentes.filter((h) => h.severidad === 'bloqueo').length;
  const porConfirmar = vigentes.filter((h) => h.severidad === 'confirmar').length;
  return { hallazgos: vigentes, bloqueos, porConfirmar, listoParaAprobar: bloqueos === 0 && porConfirmar === 0 };
}

/**
 * Arrastra a una validación recién calculada los hallazgos que dejó un rechazo del TMS (T-A3-29, `origen: 'tms'`).
 * `validarExtraccion` no los conoce (no salen del contenido, salen de la respuesta del sistema del cliente), así que sin
 * esto cualquier revalidación los borraría y el documento volvería a aprobarse tal cual.
 *
 * Se levantan solo cuando una persona CORRIGE (cambia el valor de) el campo al que apuntan; el hallazgo sin ubicación
 * (`documento`) se levanta con cualquier corrección. Quitar un renglón levanta los de ese renglón y los siguientes (se recorren).
 * Confirmar sin cambiar el valor no levanta nada: el sistema del cliente ya dijo que ese valor no sirve.
 */
export function conservarHallazgosTms(
  nueva: ResultadoValidacion, previa: Pick<ResultadoValidacion, 'hallazgos'> | null | undefined,
  correcciones: ReadonlyArray<{ campo: string; renglon: number | null }> = [],
): ResultadoValidacion {
  const resuelto = (h: Hallazgo): boolean => {
    if (h.campo === 'documento') return correcciones.length > 0;
    return correcciones.some((c) => (c.campo === h.campo && c.renglon === h.renglon)
      || (c.campo === 'mercancia' && h.renglon !== null && c.renglon !== null && h.renglon >= c.renglon));
  };
  const vigentes = (previa?.hallazgos ?? []).filter((h) => h.origen === 'tms' && !resuelto(h));
  if (vigentes.length === 0) return nueva;
  return {
    ...nueva, hallazgos: [...nueva.hallazgos.filter((h) => h.origen !== 'tms'), ...vigentes],
    bloqueos: nueva.bloqueos + vigentes.filter((h) => h.severidad === 'bloqueo').length,
    porConfirmar: nueva.porConfirmar + vigentes.filter((h) => h.severidad === 'confirmar').length,
    listoParaAprobar: false,
  };
}

/** La confianza mínima entre los campos críticos PRESENTES (para ordenar la bandeja). `null` si no hay ninguno. */
export function confianzaMinimaCritica(e: Extraccion): number | null {
  const valores: number[] = [];
  for (const def of CAMPOS_DOC) if (def.critico && !esVacio(e.campos[def.clave])) valores.push(e.campos[def.clave].confianza);
  for (const fila of e.mercancias) for (const def of CAMPOS_MERCANCIA) if (def.critico && !esVacio(fila[def.clave])) valores.push(fila[def.clave].confianza);
  return valores.length === 0 ? null : Math.round(Math.min(...valores) * 1000) / 1000;
}
