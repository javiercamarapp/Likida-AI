import {
  TIPOS_HITO, estaPendiente, estaResuelto, indiceHito,
  type Contacto, type HitoFila, type Lugar, type TipoHito,
} from './tipos';
import { MAX_POSPOSICIONES } from './config';
import { aplicarCiclo, hitoEnCiclo, type CicloEfectivo, type Servicio } from './ciclo_servicio';
import type { EstadoRampa, Intencion } from './interprete';
import type { ResultadoCompuerta } from './compuerta_movimiento';

// ═══════════════════════════════════════════════════════════════════════════
// LA MÁQUINA DE ESTADOS DE LOS HITOS — pura, sin I/O.
//
// Recibe lo que el viaje ya tiene registrado y lo que el chofer dijo, y DECIDE
// qué se hace. Quien la llama (atender.ts) aplica la decisión con UPDATEs
// condicionales; aquí no se toca nada.
//
//   SECUENCIA VÁLIDA     llegada_carga → salida_carga → llegada_descarga →
//                        salida_descarga → regreso
//   ESTADOS              esperado → recibido → validado
//                        omitido (se infirió por un hito posterior)
//                        escalado (se agotaron los recordatorios; sigue pendiente)
//
// ── LAS GARANTÍAS QUE ESTO FIJA (maquina.test.ts) ──────────────────────────
//   1. «Ya llegué» A SECAS se resuelve por el ESTADO del viaje: sin nada
//      registrado es la llegada a CARGAR; con la salida de carga registrada es la
//      llegada a DESCARGAR; con la llegada a carga ya registrada y nada más, es
//      AMBIGUO y se pregunta (podría ser un duplicado o la descarga). Una llegada
//      al origen NUNCA sella la del destino.
//   2. FUERA DE ORDEN: un hito posterior marca como `omitido` a los anteriores
//      que seguían pendientes (dejan de perseguirse); un hito anterior que llega
//      tarde llena su hueco sin tocar a los posteriores.
//   3. DUPLICADOS: repetir un hito ya registrado NO mueve su hora.
//   4. CORRECCIONES: el chofer puede retirar SOLO el último hito registrado y
//      solo dentro de la ventana de la flota; uno `validado` no se retira.
//      Retirarlo regresa también a `esperado` a los que se omitieron por su causa.
// ═══════════════════════════════════════════════════════════════════════════

export type LegadoSello = 'llegada' | 'descarga' | 'regreso';

export type MotivoRechazo =
  | 'nada_que_corregir'
  | 'validado'
  | 'fuera_de_ventana'
  | 'sin_llegada'
  | 'sin_hito_pendiente';

export type Decision =
  | {
    accion: 'registrar';
    objetivo: TipoHito;
    /** Hitos anteriores que seguían pendientes: se marcan `omitido`. */
    omitir: TipoHito[];
    /** El hito estaba `omitido` y llegó tarde. */
    reabre: boolean;
    contacto: Contacto | null;
    /** El «ya llegué» no decía el lugar y se resolvió por el estado del viaje. */
    ambigua: boolean;
    legado: LegadoSello[];
    /** Hora del mensaje (recortada al reloj del servidor si venía del futuro). */
    mensajeEn: Date;
    ajustadaPorFuturo: boolean;
  }
  | { accion: 'duplicado'; objetivo: TipoHito; contacto: Contacto | null; legado: LegadoSello[] }
  | { accion: 'contacto'; objetivo: TipoHito; contacto: Contacto }
  | { accion: 'sin_contacto'; objetivo: TipoHito }
  | { accion: 'posponer'; objetivo: TipoHito; minutos: number; aplicado: boolean; legado: LegadoSello[] }
  | { accion: 'corregir'; objetivo: TipoHito; revertir: TipoHito[]; despues: Decision | null }
  /** «Ya llegué» con la llegada a carga ya registrada: ¿duplicado o es la descarga? */
  | { accion: 'aclarar'; pregunta: 'llegada' }
  | { accion: 'rechazar'; motivo: MotivoRechazo };

export interface EntradaMaquina {
  hitos: readonly HitoFila[];
  intencion: Intencion;
  contacto: Contacto | null;
  ahora: Date;
  mensajeEn: Date;
  ventanaCorreccionMin: number;
  posponerMin: number;
  /**
   * T-A5-42: el ciclo del servicio del viaje. Con él, un hito que el ciclo no tiene se lee omitido y un «ya llegué»/«ya salí» a secas
   * se resuelve por lo que el servicio SÍ tiene (importación: la descarga; exportación: la carga). Sin él, o el ciclo actual: igual que siempre.
   */
  ciclo?: CicloEfectivo;
}

type Mapa = Record<TipoHito, HitoFila | undefined>;

function mapaDe(hitos: readonly HitoFila[]): Mapa {
  const m = {} as Mapa;
  for (const t of TIPOS_HITO) m[t] = hitos.find((h) => h.tipo === t);
  return m;
}

// Un hito sin fila se trata como `esperado` (nunca resuelto).
const resuelto = (h: HitoFila | undefined): boolean => Boolean(h && estaResuelto(h));

/** El hito que toca ahora: el primero de la secuencia que sigue pendiente. */
export function hitoActivo(hitos: readonly HitoFila[]): HitoFila | null {
  const m = mapaDe(hitos);
  for (const t of TIPOS_HITO) {
    const h = m[t];
    if (h && estaPendiente(h)) return h;
  }
  return null;
}

function ultimoResuelto(m: Mapa): HitoFila | null {
  for (let i = TIPOS_HITO.length - 1; i >= 0; i--) {
    const h = m[TIPOS_HITO[i]];
    if (h && estaResuelto(h)) return h;
  }
  return null;
}

type Objetivo = { objetivo: TipoHito; ambigua: boolean } | { aclarar: true } | { duplicadoDe: TipoHito };

/** La hora (ms) en que se REPORTÓ un hito (la del mensaje del chofer; la de recepción si no hay). NaN si no se sabe. */
function horaDeHito(h: HitoFila | undefined): number {
  const v = h?.mensajeEn ?? h?.recibidoEn ?? null;
  return v ? new Date(v).getTime() : Number.NaN;
}

function objetivoLlegada(m: Mapa, lugar: Lugar | null, mensajeEn: Date, ciclo?: CicloEfectivo): Objetivo {
  if (lugar === 'carga') return { objetivo: 'llegada_carga', ambigua: false };
  if (lugar === 'descarga') return { objetivo: 'llegada_descarga', ambigua: false };
  // T-A5-42: el servicio solo tiene UNO de los dos lugares: «ya llegué» a secas es de ese lugar, sin ambigüedad.
  if (!hitoEnCiclo(ciclo, 'llegada_carga') && hitoEnCiclo(ciclo, 'llegada_descarga')) {
    return resuelto(m.llegada_descarga) ? { duplicadoDe: 'llegada_descarga' } : { objetivo: 'llegada_descarga', ambigua: false };
  }
  if (!hitoEnCiclo(ciclo, 'llegada_descarga') && hitoEnCiclo(ciclo, 'llegada_carga')) {
    return resuelto(m.llegada_carga) ? { duplicadoDe: 'llegada_carga' } : { objetivo: 'llegada_carga', ambigua: false };
  }
  const lc = m.llegada_carga, sc = m.salida_carga, ld = m.llegada_descarga;
  // Nada registrado todavía: lo primero que pasa en un viaje es llegar a cargar.
  if (!resuelto(lc) && !resuelto(sc) && !resuelto(ld)) return { objetivo: 'llegada_carga', ambigua: true };
  // Ya salió de la carga y no ha llegado: lo único que puede ser es la descarga… salvo que el mensaje sea ANTERIOR a esa
  // salida (Meta reentrega tarde; el chofer lo escribió en la carga): entonces pertenece a la carga y no sella el destino.
  if (resuelto(sc) && !resuelto(ld)) {
    if (mensajeEn.getTime() < horaDeHito(sc)) {
      return resuelto(lc) ? { duplicadoDe: 'llegada_carga' } : { objetivo: 'llegada_carga', ambigua: true };
    }
    return { objetivo: 'llegada_descarga', ambigua: false };
  }
  if (resuelto(ld)) return { duplicadoDe: 'llegada_descarga' };
  // Llegó a cargar y no ha salido: ¿repite lo mismo o ya llegó a descargar sin avisar la salida?
  return { aclarar: true };
}

function objetivoSalida(m: Mapa, lugar: Lugar | null, ciclo?: CicloEfectivo): Objetivo {
  if (lugar === 'carga') return { objetivo: 'salida_carga', ambigua: false };
  if (lugar === 'descarga') return { objetivo: 'salida_descarga', ambigua: false };
  // T-A5-42: igual que la llegada, si el servicio solo tiene la salida de un lugar.
  if (!hitoEnCiclo(ciclo, 'salida_carga') && hitoEnCiclo(ciclo, 'salida_descarga')) {
    return resuelto(m.salida_descarga) ? { duplicadoDe: 'salida_descarga' } : { objetivo: 'salida_descarga', ambigua: false };
  }
  if (!hitoEnCiclo(ciclo, 'salida_descarga') && hitoEnCiclo(ciclo, 'salida_carga')) {
    return resuelto(m.salida_carga) ? { duplicadoDe: 'salida_carga' } : { objetivo: 'salida_carga', ambigua: false };
  }
  const sc = m.salida_carga, ld = m.llegada_descarga, sd = m.salida_descarga;
  if (resuelto(sd)) return { duplicadoDe: 'salida_descarga' };
  if (resuelto(ld)) return { objetivo: 'salida_descarga', ambigua: false };
  if (resuelto(sc)) return { duplicadoDe: 'salida_carga' };
  return { objetivo: 'salida_carga', ambigua: true };
}

function legadoDe(objetivo: TipoHito, extra: LegadoSello[] = []): LegadoSello[] {
  const l = new Set<LegadoSello>(extra);
  if (objetivo === 'llegada_descarga') l.add('llegada');
  if (objetivo === 'regreso') l.add('regreso');
  return [...l];
}

function ajustarHora(mensajeEn: Date, ahora: Date): { fecha: Date; futuro: boolean } {
  // Un timestamp hostil o un reloj desfasado no puede poner el hito en el futuro.
  if (Number.isNaN(mensajeEn.getTime())) return { fecha: ahora, futuro: true };
  if (mensajeEn.getTime() > ahora.getTime() + 60_000) return { fecha: ahora, futuro: true };
  return { fecha: mensajeEn, futuro: false };
}

function registrarObjetivo(
  m: Mapa, objetivo: TipoHito, e: Pick<EntradaMaquina, 'contacto' | 'ahora' | 'mensajeEn'>,
  ambigua: boolean, extraLegado: LegadoSello[] = [],
): Decision {
  const h = m[objetivo];
  const llevaContacto = objetivo === 'llegada_carga' || objetivo === 'llegada_descarga';
  if (resuelto(h)) {
    return { accion: 'duplicado', objetivo, contacto: llevaContacto ? e.contacto : null, legado: extraLegado };
  }
  const omitir = TIPOS_HITO.filter((t) => indiceHito(t) < indiceHito(objetivo) && estaPendiente(m[t] ?? ({ estado: 'esperado' } as HitoFila)));
  const { fecha, futuro } = ajustarHora(e.mensajeEn, e.ahora);
  return {
    accion: 'registrar',
    objetivo,
    omitir,
    reabre: h?.estado === 'omitido',
    contacto: llevaContacto ? e.contacto : null,
    ambigua,
    legado: legadoDe(objetivo, extraLegado),
    mensajeEn: fecha,
    ajustadaPorFuturo: futuro,
  };
}

function desdeObjetivo(o: Objetivo, m: Mapa, e: EntradaMaquina, extraLegado: LegadoSello[] = []): Decision {
  if ('aclarar' in o) return { accion: 'aclarar', pregunta: 'llegada' };
  if ('duplicadoDe' in o) {
    const llevaContacto = o.duplicadoDe === 'llegada_descarga' || o.duplicadoDe === 'llegada_carga';
    return { accion: 'duplicado', objetivo: o.duplicadoDe, contacto: llevaContacto ? e.contacto : null, legado: extraLegado };
  }
  return registrarObjetivo(m, o.objetivo, e, o.ambigua, extraLegado);
}

/** ¿Los hitos omitidos POR CAUSA de `tipo`? (motivo `inferido_por_<tipo>`). */
function omitidosPor(m: Mapa, tipo: TipoHito): TipoHito[] {
  return TIPOS_HITO.filter((t) => m[t]?.estado === 'omitido' && m[t]?.omitidoMotivo === `inferido_por_${tipo}`);
}

function ultimaLlegadaResuelta(m: Mapa): HitoFila | null {
  if (resuelto(m.llegada_descarga)) return m.llegada_descarga!;
  if (resuelto(m.llegada_carga)) return m.llegada_carga!;
  return null;
}

/** Decide qué hacer con lo que dijo el chofer. Pura. */
export function decidir(entrada: EntradaMaquina): Decision {
  // T-A5-42: el motor ve los hitos con el ciclo del servicio del viaje (sin ciclo, o el actual, la misma lista).
  const e: EntradaMaquina = { ...entrada, hitos: aplicarCiclo(entrada.hitos, entrada.ciclo) };
  const m = mapaDe(e.hitos);
  const i = e.intencion;

  switch (i.clase) {
    case 'llegada':
      return desdeObjetivo(objetivoLlegada(m, i.lugar, e.mensajeEn, e.ciclo), m, e);

    case 'salida':
      return desdeObjetivo(objetivoSalida(m, i.lugar, e.ciclo), m, e);

    case 'regreso':
      return registrarObjetivo(m, 'regreso', e, false);

    case 'en_proceso': {
      const llegada: TipoHito = i.lugar === 'carga' ? 'llegada_carga' : 'llegada_descarga';
      const sello: LegadoSello[] = i.lugar === 'descarga' ? ['descarga'] : [];
      if (resuelto(m[llegada])) {
        // Ya estaba registrada: «sigo cargando/descargando» solo aplaza el siguiente.
        const siguiente: TipoHito = i.lugar === 'carga' ? 'salida_carga' : 'salida_descarga';
        return { accion: 'posponer', objetivo: siguiente, minutos: e.posponerMin, aplicado: true, legado: sello };
      }
      return registrarObjetivo(m, llegada, e, false, sello);
    }

    case 'sigue': {
      const llegada: TipoHito = i.lugar === 'carga' ? 'llegada_carga' : 'llegada_descarga';
      const sello: LegadoSello[] = i.lugar === 'descarga' ? ['descarga'] : [];
      if (!resuelto(m[llegada])) return registrarObjetivo(m, llegada, e, false, sello);
      const siguiente: TipoHito = i.lugar === 'carga' ? 'salida_carga' : 'salida_descarga';
      const h = m[siguiente];
      const aplicado = !h || h.pospuestoVeces < MAX_POSPOSICIONES;
      return { accion: 'posponer', objetivo: siguiente, minutos: e.posponerMin, aplicado: resuelto(h) ? false : aplicado, legado: sello };
    }

    case 'contacto': {
      if (!e.contacto) return { accion: 'rechazar', motivo: 'sin_llegada' };
      const lugar = i.lugar;
      let o: Objetivo;
      if (lugar === 'carga') o = { objetivo: 'llegada_carga', ambigua: false };
      else if (lugar === 'descarga') o = { objetivo: 'llegada_descarga', ambigua: false };
      else {
        // Sin pista de lugar: si ya llegó a algún lado, el contacto es de ahí.
        const ya = ultimaLlegadaResuelta(m);
        if (ya) return { accion: 'contacto', objetivo: ya.tipo, contacto: e.contacto };
        o = objetivoLlegada(m, null, e.mensajeEn, e.ciclo);
      }
      if ('objetivo' in o && resuelto(m[o.objetivo])) return { accion: 'contacto', objetivo: o.objetivo, contacto: e.contacto };
      return desdeObjetivo(o, m, e);
    }

    case 'sin_contacto': {
      const ya = ultimaLlegadaResuelta(m);
      if (!ya) return { accion: 'rechazar', motivo: 'sin_llegada' };
      return { accion: 'sin_contacto', objetivo: ya.tipo };
    }

    case 'retraso': {
      const activo = hitoActivo(e.hitos);
      if (!activo) return { accion: 'rechazar', motivo: 'sin_hito_pendiente' };
      const minutos = Math.min(Math.max(i.minutos ?? e.posponerMin, 5), 240);
      return {
        accion: 'posponer', objetivo: activo.tipo, minutos,
        aplicado: activo.pospuestoVeces < MAX_POSPOSICIONES, legado: [],
      };
    }

    case 'aun_no_regreso': {
      const h = m.regreso;
      if (!h || resuelto(h)) return { accion: 'rechazar', motivo: 'sin_hito_pendiente' };
      return { accion: 'posponer', objetivo: 'regreso', minutos: e.posponerMin, aplicado: h.pospuestoVeces < MAX_POSPOSICIONES, legado: [] };
    }

    case 'registrar_activo': {
      // Un recordatorio nombra SU hito: tocarlo cuando ya se registró (o ya se pasó a otra etapa)
      // contesta duplicado en vez de registrar el hito que hoy toca.
      if (i.hito) return registrarObjetivo(m, i.hito, e, false);
      const activo = hitoActivo(e.hitos);
      if (!activo) return { accion: 'rechazar', motivo: 'sin_hito_pendiente' };
      return registrarObjetivo(m, activo.tipo, e, false);
    }

    case 'correccion': {
      const ultimo = ultimoResuelto(m);
      if (!ultimo) return { accion: 'rechazar', motivo: 'nada_que_corregir' };
      if (ultimo.estado === 'validado') return { accion: 'rechazar', motivo: 'validado' };
      const desde = ultimo.recibidoEn ? new Date(ultimo.recibidoEn).getTime() : 0;
      if (e.ahora.getTime() - desde > e.ventanaCorreccionMin * 60_000) return { accion: 'rechazar', motivo: 'fuera_de_ventana' };

      const revertir = [ultimo.tipo, ...omitidosPor(m, ultimo.tipo)];
      let despues: Decision | null = null;
      if (i.como) {
        // El mundo DESPUÉS de retirar: lo retirado vuelve a `esperado`.
        const copia: Mapa = { ...m };
        for (const t of revertir) copia[t] = { ...(m[t] as HitoFila), estado: 'esperado', recibidoEn: null, fuente: null };
        despues = registrarObjetivo(copia, i.como, e, false);
      }
      return { accion: 'corregir', objetivo: ultimo.tipo, revertir, despues };
    }

    // `problema` y `pedir_ubicacion` no cambian hitos: los atiende atender.ts.
    default:
      return { accion: 'rechazar', motivo: 'sin_hito_pendiente' };
  }
}

/** ¿Quedan hitos por recibir? (para saber si el viaje está «completo» en el tablero). */
export function viajeCompleto(hitos: readonly HitoFila[]): boolean {
  return hitoActivo(hitos) === null;
}

/** Los hitos que se consideran «hechos» para efectos de anclar el siguiente. */
export function ultimoHitoRegistrado(hitos: readonly HitoFila[]): HitoFila | null {
  return ultimoResuelto(mapaDe(hitos));
}

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-43 — «CON QUIÉN TE REPORTASTE» PROACTIVO Y RAMPA. Puro, sin I/O.
//
// Al llegar al cliente los clientes cambian rampa o edificio y mandan al operador «como canica» (R15). Por eso el contacto y la rampa
// se llevan como LISTA DE REUBICACIONES (cada cambio agrega un registro con hora), no como un valor único: es la evidencia contra
// una cancelación por «no se presentó». Esta sección decide QUÉ se pregunta y cuándo, y arma la lista; quien la persiste y quien manda
// los mensajes la consume (alertas_llegada.ts, mensajes.ts, tablero.ts).
//
// Reglas de la pregunta (una por paso, sin insistir):
//   · APAGADO por omisión hasta la fase 2 (`activo`); sin llegada registrada del ciclo, no hay nada que preguntar.
//   · Unidad en movimiento (la compuerta de T-A5-36 no permite escribir) → no se pregunta; se vuelve a evaluar en la siguiente pasada.
//   · Orden: contacto → rampa (SOLO importación, en la descarga) → «¿cómo descargas?» (OPCIONAL, solo tras «no aplica»).
//   · Cada paso se pregunta UNA vez. Un paso preguntado y sin respuesta NO bloquea: pasados `esperaMin` minutos se sigue con el
//     siguiente y el ciclo del viaje nunca depende de la respuesta.
// ═══════════════════════════════════════════════════════════════════════════

/** Tope de registros por llegada: una cadena de reubicaciones real no pasa de unas pocas; el tope frena un bucle de mensajes. */
export const MAX_REUBICACIONES = 20;
/** Minutos que se espera la respuesta de un paso antes de seguir con el siguiente. */
export const MINUTOS_ESPERA_PASO_REPORTE = 10;

export type OrdenadoPor = 'chofer' | 'cliente' | 'oficina';

/** Un registro de la lista de reubicaciones de UNA llegada. `en` es ISO; el orden de la lista es el cronológico. */
export interface Reubicacion {
  en: string;
  contacto: string | null;
  rampaEstado: EstadoRampa | null;
  rampa: string | null;
  comoDescarga: string | null;
  ordenadoPor: OrdenadoPor | null;
}

export type CambioReubicacion = Partial<Omit<Reubicacion, 'en'>>;

const limpiar = (v: string | null | undefined, max: number): string | null => {
  const t = (v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  return t || null;
};
const comparable = (v: string | null): string => (v ?? '').toLocaleLowerCase('es-MX');

/** El estado vigente: el último registro (o nada si aún no hay). */
export function estadoReporte(lista: readonly Reubicacion[]): Reubicacion | null {
  return lista.length > 0 ? lista[lista.length - 1] : null;
}

/**
 * Agrega un cambio a la lista. Hereda lo vigente (cambiar solo la rampa conserva el contacto) y NO agrega nada si el resultado
 * es igual a lo vigente (un duplicado no mueve la hora ni infla la evidencia). Pura: devuelve una lista nueva.
 */
export function agregarReubicacion(
  lista: readonly Reubicacion[], cambio: CambioReubicacion, en: Date, ordenadoPor: OrdenadoPor | null = 'chofer',
): Reubicacion[] {
  const previo = estadoReporte(lista);
  const rampaEstado = cambio.rampaEstado !== undefined ? cambio.rampaEstado : previo?.rampaEstado ?? null;
  const siguiente: Reubicacion = {
    en: Number.isNaN(en.getTime()) ? new Date(0).toISOString() : en.toISOString(),
    contacto: cambio.contacto !== undefined ? limpiar(cambio.contacto, 80) : previo?.contacto ?? null,
    rampaEstado,
    // El número de rampa solo existe con «sí»: cualquier otro estado lo borra.
    rampa: rampaEstado === 'si' ? (cambio.rampa !== undefined ? limpiar(cambio.rampa, 12)?.toUpperCase() ?? null : previo?.rampa ?? null) : null,
    comoDescarga: rampaEstado === 'no_aplica' ? (cambio.comoDescarga !== undefined ? limpiar(cambio.comoDescarga, 120) : previo?.comoDescarga ?? null) : null,
    ordenadoPor: cambio.ordenadoPor !== undefined ? cambio.ordenadoPor : ordenadoPor,
  };
  if (previo
    && comparable(previo.contacto) === comparable(siguiente.contacto)
    && previo.rampaEstado === siguiente.rampaEstado
    && comparable(previo.rampa) === comparable(siguiente.rampa)
    && comparable(previo.comoDescarga) === comparable(siguiente.comoDescarga)) return [...lista];
  const nueva = [...lista, siguiente];
  return nueva.length > MAX_REUBICACIONES ? nueva.slice(nueva.length - MAX_REUBICACIONES) : nueva;
}

/** Cuántas veces cambió de rampa/contacto después del primer registro (el «canica»). */
export const reubicacionesDespuesDelPrimero = (lista: readonly Reubicacion[]): number => Math.max(0, lista.length - 1);

export type PasoReporte = 'contacto' | 'rampa' | 'como_descarga';

/** Un paso ya preguntado: cuándo (ISO) y cuántas veces no se repite (una). */
export type PreguntadosReporte = Partial<Record<PasoReporte, string>>;

export type RazonSinPregunta =
  | 'apagado' | 'sin_llegada' | 'en_movimiento' | 'esperando_respuesta' | 'completo';

export type DecisionReporte =
  | { accion: 'preguntar'; paso: PasoReporte }
  | { accion: 'nada'; razon: RazonSinPregunta };

export interface EntradaReporteLlegada {
  /** Perilla por flota; apagada por omisión hasta la fase 2. */
  activo: boolean;
  /** Los hitos del viaje (la llegada del ciclo debe estar resuelta). */
  hitos: readonly HitoFila[];
  servicio: Servicio | null;
  /** Lo vigente de la lista de reubicaciones del viaje. */
  reubicaciones: readonly Reubicacion[];
  /** `sinContacto` del hito de llegada: el chofer dijo «aún no tengo contacto» (es una respuesta, no un hueco). */
  sinContacto: boolean;
  preguntados: PreguntadosReporte;
  /** La compuerta «unidad detenida» (T-A5-36) evaluada con las posiciones del viaje. `null` = no se evaluó: no se pregunta. */
  compuerta: ResultadoCompuerta | null;
  ahora: Date;
  esperaMin?: number;
}

/** La llegada del ciclo de la que cuelga el reporte: la de descarga en importación; la de carga en exportación y nacional. */
export function hitoLlegadaDelReporte(hitos: readonly HitoFila[], servicio: Servicio | null): HitoFila | null {
  const tipo: TipoHito = servicio === 'importacion' ? 'llegada_descarga' : servicio === 'exportacion' ? 'llegada_carga' : hitoActivoLlegada(hitos);
  const h = hitos.find((x) => x.tipo === tipo);
  return h && estaResuelto(h) ? h : null;
}

/** Sin servicio conocido o nacional: la última llegada resuelta (descarga si ya hay, si no carga). */
function hitoActivoLlegada(hitos: readonly HitoFila[]): TipoHito {
  const d = hitos.find((x) => x.tipo === 'llegada_descarga');
  return d && estaResuelto(d) ? 'llegada_descarga' : 'llegada_carga';
}

/** Qué se le pregunta ahora al chofer sobre «con quién te reportaste» y la rampa. Pura; ante la duda, NO pregunta. */
export function decidirReporteLlegada(e: EntradaReporteLlegada): DecisionReporte {
  if (!e.activo) return { accion: 'nada', razon: 'apagado' };
  const llegada = hitoLlegadaDelReporte(e.hitos, e.servicio);
  if (!llegada) return { accion: 'nada', razon: 'sin_llegada' };
  if (!e.compuerta || !e.compuerta.permitido) return { accion: 'nada', razon: 'en_movimiento' };

  const vigente = estadoReporte(e.reubicaciones);
  const tieneContacto = Boolean(vigente?.contacto) || Boolean(llegada.contactoNombre) || e.sinContacto || llegada.sinContacto;
  const pideRampa = e.servicio === 'importacion' && llegada.tipo === 'llegada_descarga';
  const tieneRampa = vigente?.rampaEstado != null;
  const pideComo = pideRampa && vigente?.rampaEstado === 'no_aplica' && !vigente.comoDescarga;

  const pendientes: PasoReporte[] = [];
  if (!tieneContacto) pendientes.push('contacto');
  if (pideRampa && !tieneRampa) pendientes.push('rampa');
  if (pideComo) pendientes.push('como_descarga');
  if (pendientes.length === 0) return { accion: 'nada', razon: 'completo' };

  const espera = (e.esperaMin ?? MINUTOS_ESPERA_PASO_REPORTE) * 60_000;
  let esperando = false;
  for (const paso of pendientes) {
    const cuando = e.preguntados[paso];
    if (cuando === undefined) {
      // Un paso anterior preguntado hace poco todavía puede contestarse: no se encimen dos preguntas.
      return esperando ? { accion: 'nada', razon: 'esperando_respuesta' } : { accion: 'preguntar', paso };
    }
    const t = new Date(cuando).getTime();
    if (Number.isNaN(t) || e.ahora.getTime() - t < espera) esperando = true; // ya preguntado y aún en plazo
    // ya preguntado y vencido: no se repite y no bloquea; se sigue con el siguiente
  }
  return { accion: 'nada', razon: esperando ? 'esperando_respuesta' : 'completo' };
}
