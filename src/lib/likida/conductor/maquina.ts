import {
  TIPOS_HITO, estaPendiente, estaResuelto, indiceHito,
  type Contacto, type HitoFila, type Lugar, type TipoHito,
} from './tipos';
import { MAX_POSPOSICIONES } from './config';
import type { Intencion } from './interprete';

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

function objetivoLlegada(m: Mapa, lugar: Lugar | null): Objetivo {
  if (lugar === 'carga') return { objetivo: 'llegada_carga', ambigua: false };
  if (lugar === 'descarga') return { objetivo: 'llegada_descarga', ambigua: false };
  const lc = m.llegada_carga, sc = m.salida_carga, ld = m.llegada_descarga;
  // Nada registrado todavía: lo primero que pasa en un viaje es llegar a cargar.
  if (!resuelto(lc) && !resuelto(sc) && !resuelto(ld)) return { objetivo: 'llegada_carga', ambigua: true };
  // Ya salió de la carga y no ha llegado: lo único que puede ser es la descarga.
  if (resuelto(sc) && !resuelto(ld)) return { objetivo: 'llegada_descarga', ambigua: false };
  if (resuelto(ld)) return { duplicadoDe: 'llegada_descarga' };
  // Llegó a cargar y no ha salido: ¿repite lo mismo o ya llegó a descargar sin avisar la salida?
  return { aclarar: true };
}

function objetivoSalida(m: Mapa, lugar: Lugar | null): Objetivo {
  if (lugar === 'carga') return { objetivo: 'salida_carga', ambigua: false };
  if (lugar === 'descarga') return { objetivo: 'salida_descarga', ambigua: false };
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
export function decidir(e: EntradaMaquina): Decision {
  const m = mapaDe(e.hitos);
  const i = e.intencion;

  switch (i.clase) {
    case 'llegada':
      return desdeObjetivo(objetivoLlegada(m, i.lugar), m, e);

    case 'salida':
      return desdeObjetivo(objetivoSalida(m, i.lugar), m, e);

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
        o = objetivoLlegada(m, null);
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
