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
  estatus(args: { tenantId: string; clienteId: string; viajeId: string }): Promise<EstatusViaje | null>;
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
  for (const m of texto.toUpperCase().matchAll(/\b([A-Z]{1,4}-?\d{2,8}|[A-Z]{1,4} \d{3,8}|\d{3,8})\b/g)) {
    const crudo = m[1];
    const completo = folioNormalizado(crudo);
    const conEspacio = /^[A-Z]{1,4} \d/.test(crudo);
    const digitos = digitosDelFolio(completo);
    if (conEspacio) {
      agregar(completo, false);
      agregar(digitos, digitos.length >= 4);
    } else if (/^\d+$/.test(crudo)) {
      agregar(completo, completo.length >= 4);
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
