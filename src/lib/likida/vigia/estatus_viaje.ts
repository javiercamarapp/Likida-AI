// ═══════════════════════════════════════════════════════════════════════════
// ESTATUS DE UN VIAJE, COMO SE LE CUENTA A SU CLIENTE.
//
// `ServicioEstatusViaje` es la INTERFAZ que el Vigía consume para saber qué
// decir: posición, último hito, documentos, ETA. La implementación real vive en
// `repo.ts` (lee viaje, posicion, pod y factura_emitida de UNA flota y UN
// cliente); las pruebas usan dobles. Quien redacta NUNCA lee la base: solo ve
// lo que este servicio devuelve, y lo que no devuelve no existe.
//
// ── EL AISLAMIENTO ESTÁ EN LA FIRMA ─────────────────────────────────────────
// Todas las consultas piden `tenantId` Y `clienteId`. No hay un método «dame el
// viaje F-123» sin cliente: un folio de OTRO cliente de la misma flota (o de otra
// flota) simplemente no existe para esta conversación. El `clienteId` sale del
// CONTACTO autorizado (la allowlist), nunca del texto del mensaje.
//
// ── LO QUE NO SE SABE, NO SE DICE ───────────────────────────────────────────
//   · `etaIso`: es la CITA (o, si no hay, la ETA) de LLEGADA A DESCARGA que el
//     despachador o el TMS del cliente capturó en el viaje (0380: `cita_destino_en`,
//     `eta_destino_en`) y que el Agente 5 «Conductor» expone. NO es telemetría: se
//     dice de dónde salió (`etaFuente`). Sin captura (o si el viaje ya llegó) es
//     `null` y el Vigía contesta «lo consulto» y escala.
//   · `posicion`: `null` si no hay GPS (hoy casi ninguna flota lo tiene).
//   · `documentos`/`podRecibido`/`facturaEmitida`: `null` = no se pudo determinar
//     (error de lectura), que NO es lo mismo que «no hay faltantes».
// ═══════════════════════════════════════════════════════════════════════════

import type { CampoAviso } from './aviso/privacidad';

export type EtapaViaje =
  | 'en_curso' | 'en_origen' | 'en_ruta' | 'en_destino' | 'descargando' | 'entregado' | 'regresando' | 'cerrado';

/**
 * Los hitos que el cliente puede oír. `llegada`/`descarga` son los sellos viejos de la 0090 (solo si el viaje
 * no tiene hitos del Conductor); los otros cuatro son los de la 0380.
 */
export type TipoHitoViaje =
  | 'llegada' | 'descarga' | 'regreso'
  | 'llegada_carga' | 'salida_carga' | 'llegada_descarga' | 'salida_descarga';

export interface HitoViaje {
  tipo: TipoHitoViaje;
  /** ISO. Es la hora del MENSAJE del operador (no la del evento). */
  en: string;
}

/** Un archivo que Likida puede adjuntar a la respuesta (el archivo en sí lo resuelve el repo al enviar). */
export interface AdjuntoDisponible {
  clave: 'pod';
  nombre: string;
}

export interface PosicionViaje {
  lat: number;
  lng: number;
  /** ISO de la medición del GPS (no de la inserción). */
  medidaEn: string;
}

/** Lo que el adaptador sabe del avance: «va por <lugar>, le faltan ~<km> / ~<min>». Cada campo puede faltar. */
export interface AvanceViaje {
  /** Lugar cercano a la posición (poblado, caseta, tramo). */
  cercaDe: string | null;
  kmRestantes: number | null;
  minRestantes: number | null;
}

export interface DocumentoViaje {
  nombre: string;
  estado: 'entregado' | 'pendiente';
}

export interface EstatusViaje {
  viajeId: string;
  folio: string | null;
  origen: string | null;
  destino: string | null;
  etapa: EtapaViaje;
  ultimoHito: HitoViaje | null;
  posicion: PosicionViaje | null;
  /**
   * T-A4-39: avance sobre la ruta calculado por el adaptador GPS / geocodificador (A5 o conector; hoy NADIE lo llena,
   * bloqueo B12). Solo es creíble junto con una `posicion` vigente y un `destino` geocodificado; el redactor lo revalida.
   * Ausente o `null` = no hay: el estatus se queda como hoy. NO es una ETA prometida.
   */
  avance?: AvanceViaje | null;
  etaIso: string | null;
  /** De dónde salió `etaIso`: la cita pactada o la ETA capturada. `null` si no hay. */
  etaFuente: 'cita' | 'eta' | null;
  /** La cita (o ETA) de llegada a CARGAR, mientras la unidad no haya llegado ahí. */
  citaCarga: { en: string; fuente: 'cita' | 'eta' } | null;
  /** La parada en la que está AHORA el operador (llegó y no ha avisado su salida). */
  enAnden: { lugar: 'carga' | 'descarga'; desde: string | null } | null;
  /** Archivos que se pueden mandar junto con la respuesta (hoy solo el POD ya recibido). */
  adjuntos: AdjuntoDisponible[];
  documentos: DocumentoViaje[] | null;
  podRecibido: boolean | null;
  facturaEmitida: boolean | null;
  /**
   * T-A4-24: datos de la unidad del viaje, SOLO cuando alguien los pidió (`datosUnidad: true`) y solo los campos que
   * pasan `camposVisibles` (privacidad.ts). Ausente = no se pidieron; `null` = se pidieron y no hay (no se inventa).
   * Nunca llevan licencia, vigencia ni teléfono del operador: ese tipo no tiene dónde guardarlos.
   */
  caja?: string | null;
  placasCaja?: string | null;
  estadoCaja?: string | null;
  unidad?: string | null;
  placasUnidad?: string | null;
  operador?: string | null;
}

/** Los datos de la unidad ya filtrados por privacidad (los mismos nombres que `EstatusViaje`). */
export interface DatosUnidadViaje {
  caja: string | null;
  placasCaja: string | null;
  estadoCaja: string | null;
  unidad: string | null;
  placasUnidad: string | null;
  operador: string | null;
}

/** Lo que el lector (programa, catálogos, captura manual) pudo juntar de UN viaje, SIN filtrar. */
export interface DatosUnidadCrudos {
  caja: string | null;
  placasCaja: string | null;
  estadoCaja: string | null;
  unidad: string | null;
  placasUnidad: string | null;
  operadorNombre: string | null;
}

const limpiar = (v: string | null | undefined): string | null => {
  if (v == null) return null;
  const t = v.trim();
  return t === '' ? null : t;
};

/**
 * Deja pasar SOLO lo que la política de privacidad del cliente permite ver (`camposVisibles`). Cada dato es un campo
 * distinto: ocultar `operador_nombre` no oculta la caja. PURA.
 */
export function datosUnidadVisibles(crudos: DatosUnidadCrudos, visibles: ReadonlySet<CampoAviso>): DatosUnidadViaje {
  const si = (campo: CampoAviso, valor: string | null) => (visibles.has(campo) ? limpiar(valor) : null);
  return {
    caja: si('caja', crudos.caja),
    placasCaja: si('placas_caja', crudos.placasCaja),
    estadoCaja: si('estado_caja', crudos.estadoCaja),
    unidad: si('unidad', crudos.unidad),
    placasUnidad: si('placas_unidad', crudos.placasUnidad),
    operador: si('operador_nombre', crudos.operadorNombre),
  };
}

/** Lo mínimo para distinguir un viaje de otro cuando el cliente tiene varios. */
export interface ResumenViaje {
  viajeId: string;
  folio: string | null;
  origen: string | null;
  destino: string | null;
}

export interface ServicioEstatusViaje {
  /** Viajes EN CURSO de ESE cliente en ESA flota, el más reciente primero. */
  viajesEnCurso(args: { tenantId: string; clienteId: string }): Promise<ResumenViaje[]>;
  /** El estatus de UN viaje, o `null` si no es de ese cliente en esa flota. */
  estatus(args: { tenantId: string; clienteId: string; viajeId: string; datosUnidad?: boolean }): Promise<EstatusViaje | null>;
}

/** Etapa del viaje a partir de los sellos de la 0090 y el estatus. PURA. */
export function etapaDeViaje(v: {
  estatus: string | null; llegadaEn: string | null; descargaEn: string | null; regresoEn: string | null;
}): EtapaViaje {
  if (v.estatus === 'liquidado') return 'cerrado';
  if (v.regresoEn) return 'regresando';
  if (v.descargaEn) return 'descargando';
  if (v.llegadaEn) return 'en_destino';
  return 'en_curso';
}

/** El último hito con hora (el más tardío de los tres sellos). PURA. */
export function ultimoHitoDe(v: { llegadaEn: string | null; descargaEn: string | null; regresoEn: string | null }): HitoViaje | null {
  const candidatos: HitoViaje[] = [];
  if (v.llegadaEn) candidatos.push({ tipo: 'llegada', en: v.llegadaEn });
  if (v.descargaEn) candidatos.push({ tipo: 'descarga', en: v.descargaEn });
  if (v.regresoEn) candidatos.push({ tipo: 'regreso', en: v.regresoEn });
  if (candidatos.length === 0) return null;
  return candidatos.reduce((a, b) => (Date.parse(b.en) >= Date.parse(a.en) ? b : a));
}

/** Normaliza un folio para compararlo: sin espacios, guiones ni mayúsculas. PURA. */
export function folioNormalizado(folio: string | null | undefined): string {
  return (folio ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** La parte numérica final de un folio normalizado («F1042» → «1042»). */
function digitosDelFolio(normalizado: string): string {
  return /(\d+)$/.exec(normalizado)?.[1] ?? '';
}

interface CandidatoFolio {
  clave: string;
  /** Parece un folio de verdad (no una palabra pegada a un número). */
  fuerte: boolean;
}

/** «viaje», «folio», «guía», «orden», «#»… justo antes del número. */
const CONTEXTO_FOLIO = /(?:FOLIO|VIAJE|GU[ÍI]A|[ÓO]RDEN|TICKET|REMISI[ÓO]N|EMBARQUE|SERVICIO|ENV[ÍI]O|N[ÚU]MERO|NUM\.?|NO\.?|#)\s*(?:DE\s+)?[:#.]?\s*$/;
/** Una cantidad con unidad o de tiempo, justo después del número. */
const CON_UNIDAD = /^\s*(?:CAJAS?|KGS?|KILOS?|TONS?|TONELADAS?|PIEZAS?|TARIMAS?|PALLETS?|UNIDADES|LITROS?|LTS?|PESOS|MXN|USD|KMS?|KIL[ÓO]METROS|METROS|BULTOS|PAQUETES|CARTONES|SACOS|HRS?|HORAS?|MIN|MINUTOS|D[ÍI]AS|MESES|A[ÑN]OS)(?![A-ZÁÉÍÓÚÜÑ])/;

/** Palabras cortas del español que preceden a un número («las 1800», «de 2026») y no son parte de un folio. */
const PALABRAS_COMUNES: ReadonlySet<string> = new Set(['A', 'AL', 'DE', 'DEL', 'EL', 'LA', 'LAS', 'LOS', 'EN', 'POR', 'PARA', 'CON', 'SIN', 'UN', 'UNA', 'MI', 'MIS', 'SU', 'SUS', 'TU', 'HACE', 'HAY', 'SON', 'ESE', 'ESTE', 'ESA', 'ESTA', 'MAS', 'MÁS', 'Y', 'O', 'SE', 'LE', 'LO', 'QUE', 'SOLO', 'CASI', 'UNOS']);

/** Año suelto, parte de una fecha o cantidad con unidad: no es un folio. */
function pareceCantidadOFecha(digitos: string, antes: string, despues: string): boolean {
  if (CON_UNIDAD.test(despues)) return true;
  if (/\d[/.-]$/.test(antes) || /^[/-]\d/.test(despues)) return true;
  return /^(?:19|20)\d{2}$/.test(digitos) && !CONTEXTO_FOLIO.test(antes);
}

/**
 * ¿Qué folios del texto del cliente parecen un folio? Letras opcionales + dígitos
 * («F-1042», «TR 2231», «1042»). Son CANDIDATOS: después se cruzan contra los
 * viajes del propio cliente. Un prefijo de letras separado por ESPACIO puede ser
 * una palabra («el 8841», «las 10»), así que exige 3+ dígitos, y además del
 * candidato completo se agrega el solo-dígitos. PURA y acotada.
 */
function extraerCandidatos(texto: string): CandidatoFolio[] {
  const salida = new Map<string, boolean>();
  const agregar = (clave: string, fuerte: boolean) => {
    if (clave && !salida.has(clave)) salida.set(clave, fuerte);
    else if (clave && fuerte) salida.set(clave, true);
  };
  const mayus = texto.toUpperCase();
  for (const m of mayus.matchAll(/\b([A-Z]{1,4}-?\d{2,8}|[A-Z]{1,4} \d{3,8}|\d{3,8})\b/g)) {
    const crudo = m[1];
    const completo = folioNormalizado(crudo);
    const conEspacio = /^[A-Z]{1,4} \d/.test(crudo);
    const digitos = digitosDelFolio(completo);
    const inicio = m.index ?? 0;
    const antes = mayus.slice(Math.max(0, inicio - 24), inicio);
    const despues = mayus.slice(inicio + crudo.length, inicio + crudo.length + 16);
    if (conEspacio) {
      agregar(completo, false);
      const prefijo = crudo.split(' ')[0];
      agregar(digitos, digitos.length >= 4 && !PALABRAS_COMUNES.has(prefijo) && !pareceCantidadOFecha(digitos, antes, despues));
    } else if (/^\d+$/.test(crudo)) {
      // A37-S58-04: un número SOLO es folio fuerte con contexto de folio («viaje 88421»); un año, una hora o una cantidad con
      // unidad («20/10/2026», «1500 cajas», «las 1800») no. Si de verdad es su folio, igual coincide contra sus viajes.
      agregar(completo, completo.length >= 4 && CONTEXTO_FOLIO.test(antes) && !CON_UNIDAD.test(despues));
    } else {
      agregar(completo, true);
    }
    if (salida.size >= 8) break;
  }
  return [...salida].map(([clave, fuerte]) => ({ clave, fuerte }));
}

export function candidatosDeFolio(texto: string): string[] {
  return extraerCandidatos(texto).map((c) => c.clave);
}

/** ¿Este candidato del texto es ese folio? Igual, o los mismos dígitos si el cliente omitió las letras. */
function coincideFolio(candidato: string, folioNorm: string): boolean {
  if (!folioNorm) return false;
  if (candidato === folioNorm) return true;
  return /^\d{3,8}$/.test(candidato) && digitosDelFolio(folioNorm) === candidato;
}

export type ResolucionViaje =
  | { tipo: 'uno'; viajeId: string }
  | { tipo: 'ambiguo'; viajes: ResumenViaje[] }
  | { tipo: 'ninguno' }
  | { tipo: 'folio_no_encontrado' };

/**
 * Decide DE CUÁL viaje habla el cliente, SOLO entre sus propios viajes en curso.
 *   · menciona un folio que es de sus viajes → ese;
 *   · menciona un folio que NO es de sus viajes → `folio_no_encontrado` (aunque
 *     exista en otro cliente: no se confirma ni se niega nada ajeno);
 *   · no menciona folio y tiene uno → ese; varios → `ambiguo` (se le pregunta
 *     cuál, listando SOLO sus folios); ninguno → `ninguno`.
 * El viaje en foco de la conversación desempata cuando el cliente tiene varios y
 * no dice cuál («¿y a qué hora llega?» tras hablar del F-1042).
 * PURA.
 */
export function resolverViaje(texto: string, viajes: readonly ResumenViaje[], viajeEnFoco: string | null): ResolucionViaje {
  const detectados = extraerCandidatos(texto);
  const candidatos = detectados.map((c) => c.clave);
  if (candidatos.length > 0) {
    const propios = viajes.filter((v) => candidatos.some((c) => coincideFolio(c, folioNormalizado(v.folio))));
    if (propios.length === 1) return { tipo: 'uno', viajeId: propios[0].viajeId };
    if (propios.length > 1) return { tipo: 'ambiguo', viajes: propios };
    // Hay candidatos pero ninguno es suyo. Solo cuenta como «folio ajeno» si
    // alguno parece de verdad un folio (letras pegadas a dígitos, o 4+ dígitos):
    // «a las 10», «30 minutos» o «el 104» (palabra + 3 dígitos) no son un folio.
    if (detectados.some((c) => c.fuerte)) return { tipo: 'folio_no_encontrado' };
  }
  if (viajes.length === 0) return { tipo: 'ninguno' };
  if (viajes.length === 1) return { tipo: 'uno', viajeId: viajes[0].viajeId };
  if (viajeEnFoco && viajes.some((v) => v.viajeId === viajeEnFoco)) return { tipo: 'uno', viajeId: viajeEnFoco };
  return { tipo: 'ambiguo', viajes: viajes.slice(0, 5) };
}
