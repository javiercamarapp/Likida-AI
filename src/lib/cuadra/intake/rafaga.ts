// ═══════════════════════════════════════════════════════════════════════════
// LO QUE SALIÓ MAL EN UNA RÁFAGA SE DICE UNA SOLA VEZ, AL FINAL.
//
// El problema, medido: un chofer fotografía sus ~22 tickets en la gasolinera y
// los manda de golpe. Tres caminos del intake contestaban POR FOTO —el fallo
// técnico del OCR, la foto ilegible y la fecha dudosa— y los tres disparadores
// son SISTÉMICOS: un 429 del proveedor de visión tumba las 22 a la vez, y una
// gasolinera mal iluminada de noche también. O sea que el caso normal no es
// "una de 22 falló": es "las 22 fallaron", y el operador recibe 22 mensajes
// idénticos seguidos.
//
// Este repo ya arregló ese antipatrón tres veces —el acuse de ráfaga, el aviso
// de acercamiento, el acuse de comprobante— y siempre con el mismo mecanismo:
// se calla en el camino de cada foto y se resume al cerrar la ráfaga. Aquí vive
// la libreta donde se anota mientras tanto.
//
// ── POR QUÉ EN MEMORIA Y NO EN LA BASE ─────────────────────────────────────
//
// Las fotos de una ráfaga llegan en UN POST de Meta y se procesan en UN
// `after()` del MISMO proceso (route.ts las corre con un pool), así que un Map
// de módulo las ve todas. Una tabla costaría un viaje de red por foto —en el
// camino que ya es el más caro del sistema— para cubrir un caso que hoy no
// ocurre: la ráfaga repartida entre dos invocaciones.
//
// Y cuando ese caso ocurra, el modo de falla es benigno y conocido: cada
// invocación resume LO SUYO. Son dos mensajes en vez de uno, nunca 22, y nunca
// un silencio. Ese es el peor caso aceptable; el de hoy no lo es.
//
// ── EL CONTADOR NO ES LA BARRERA ───────────────────────────────────────────
//
// `intake_pendientes` (conv.ts / mig. 0031) decide CUÁNDO se cierra la ráfaga;
// esta libreta solo decide QUÉ se dice al cerrarla. Se mantienen separados a
// propósito: aquél es el que protege el dinero —que "listo" no cuadre sobre
// datos parciales— y no puede depender de memoria de proceso.
// ═══════════════════════════════════════════════════════════════════════════

import { mxn } from '@/lib/formato';

/** Qué le pasó a una foto que no terminó bien. */
export type TipoIncidencia =
  /** Falló NUESTRO lado (429, truncamiento, provider caído). Reenviar sirve. */
  | 'fallo_tecnico'
  /** La foto de verdad no se lee. Reenviarla con mejor luz sirve. */
  | 'ilegible'
  /** El gasto entró, pero su fecha no cae en la ventana del viaje. */
  | 'fecha_dudosa'
  /** Se leyó, no se pudo probar, y ya no quedaban botones que gastar. */
  | 'duda';

export interface Incidencia {
  tipo: TipoIncidencia;
  /** Solo cuando se conoce: un fallo técnico no trae monto que enseñar. */
  monto?: number | null;
  etiqueta?: string | null;
}

interface Bandeja {
  /** Fotos que pasaron por aquí en esta ráfaga. Es el "de tus N fotos". */
  vistas: number;
  incidencias: Incidencia[];
  /** Confirmaciones con botón YA enviadas en esta ráfaga (tope de acuse_ticket). */
  confirmaciones: number;
}

/**
 * Techo de anotaciones por viaje. Una ráfaga real trae ~22 fotos; 60 es 3× eso.
 * Pasado el techo se deja de anotar el detalle pero se sigue CONTANDO, porque
 * el número es lo que hace que el resumen no mienta.
 */
const MAX_INCIDENCIAS = 60;

/**
 * Techo de viajes con ráfaga abierta a la vez en un proceso. La bandeja se
 * borra al cerrar la ráfaga; esto solo cubre el caso en que el `-1` de la
 * barrera no llegue a devolver 0 (RPC caída) y la bandeja quede huérfana.
 */
const MAX_VIAJES = 200;

const bandejas = new Map<string, Bandeja>();

function abrir(viajeId: string): Bandeja {
  let b = bandejas.get(viajeId);
  if (!b) {
    if (bandejas.size >= MAX_VIAJES) {
      // Se tira la más vieja por orden de alta. Un Map conserva ese orden, y
      // `set` sobre una llave existente NO la mueve al final — que es justo lo
      // que hace fiable este desalojo.
      const vieja = bandejas.keys().next();
      if (!vieja.done) bandejas.delete(vieja.value);
    }
    b = { vistas: 0, incidencias: [], confirmaciones: 0 };
    bandejas.set(viajeId, b);
  }
  return b;
}

/**
 * Una foto más de esta ráfaga. Se llama en cuanto la barrera acepta su `+1`.
 *
 * `empiezaRafaga` = el contador de intake pasó de 0 a 1, o sea que NO había
 * nada en vuelo cuando ésta se registró. Es el único límite fiable entre dos
 * ráfagas, y sirve para tirar lo que haya quedado de una anterior que nunca
 * llegó a cerrarse — pasa cuando una invocación muere entre el `+1` y el `-1`
 * y deja el contador atascado hasta que la 0031 lo olvida (10 min). Sin esto,
 * `vistas` arrastraría fotos de la ráfaga muerta y el resumen diría «de tus 9
 * fotos» a quien mandó tres. Una cifra inventada, que es la regla que no se
 * rompe en este repo.
 */
export function anotarFoto(viajeId: string, empiezaRafaga = false): void {
  if (empiezaRafaga) bandejas.delete(viajeId);
  abrir(viajeId).vistas += 1;
}

/** Algo que hay que contarle al operador AL CERRAR, no ahora. */
export function anotarIncidencia(viajeId: string, inc: Incidencia): void {
  const b = abrir(viajeId);
  if (b.incidencias.length < MAX_INCIDENCIAS) b.incidencias.push(inc);
  else b.incidencias.push({ tipo: inc.tipo });   // sin detalle, pero cuenta
}

/**
 * Reserva un turno de confirmación con botón. Devuelve el ORDINAL de esta
 * confirmación dentro de la ráfaga (1, 2, 3…), que es contra lo que el llamador
 * compara `MAX_CONFIRMACIONES_SEGUIDAS`.
 */
export function pedirTurnoDeConfirmacion(viajeId: string): number {
  const b = abrir(viajeId);
  b.confirmaciones += 1;
  return b.confirmaciones;
}

export interface RafagaCerrada {
  vistas: number;
  incidencias: Incidencia[];
}

/** Cierra la ráfaga: devuelve lo anotado y OLVIDA el viaje. */
export function cerrarRafaga(viajeId: string): RafagaCerrada {
  const b = bandejas.get(viajeId);
  bandejas.delete(viajeId);
  return { vistas: b?.vistas ?? 0, incidencias: b?.incidencias ?? [] };
}

/** Solo para pruebas: el Map es de módulo y se comparte entre casos. */
export function olvidarRafagas(): void {
  bandejas.clear();
}

/** Los montos de un tipo, ya formateados y sin los que no se conocen. */
function montosDe(incidencias: Incidencia[], tipo: TipoIncidencia): string[] {
  return incidencias
    .filter((i) => i.tipo === tipo && typeof i.monto === 'number' && i.monto > 0)
    .map((i) => mxn(i.monto as number));
}

/** "$1.00 y $2.00" · "$1.00, $2.00 y $3.00". Máximo tres, para no hacer lista. */
function enumerar(partes: string[]): string {
  const vistos = partes.slice(0, 3);
  const cola = partes.length > 3 ? ` y ${partes.length - 3} más` : '';
  if (vistos.length === 1) return `${vistos[0]}${cola}`;
  return `${vistos.slice(0, -1).join(', ')} y ${vistos[vistos.length - 1]}${cola}`;
}

/**
 * El párrafo que resume lo que salió mal en la ráfaga. `null` = no hay nada que
 * decir, y entonces NO se manda nada: el silencio es correcto cuando todo entró.
 *
 * PURA a propósito. Es el texto que decide si un chofer entiende que le faltan
 * tres comprobantes o cree que mandó todo bien, y se tiene que poder probar sin
 * base de datos ni WhatsApp de por medio.
 */
export function lineaIncidencias(vistas: number, incidencias: Incidencia[]): string | null {
  if (!incidencias.length) return null;

  const cuenta = (t: TipoIncidencia) => incidencias.filter((i) => i.tipo === t).length;
  const tecnicos = cuenta('fallo_tecnico');
  const ilegibles = cuenta('ilegible');
  const dudosas = cuenta('fecha_dudosa');

  // OJO: `duda` NO tiene frase propia aquí. Su renglón lo escribe
  // `mensajeDemasiadasDudas` (acuse_ticket.ts), que además lleva el saldo del
  // viaje; decirlo en los dos sitios ponía la misma cuenta dos veces en un
  // mismo mensaje. Se cuenta igual —entra en `vistas` y en el log— pero se
  // enuncia una sola vez.
  const frases: string[] = [];
  if (tecnicos) {
    frases.push(`*${tecnicos}* se ${tecnicos === 1 ? 'me trabó' : 'me trabaron'} de mi lado ⚙️ ` +
      `(no ${tecnicos === 1 ? 'es tu foto' : 'son tus fotos'}; ${tecnicos === 1 ? 'la guardé' : 'las guardé'} y no se ${tecnicos === 1 ? 'pierde' : 'pierden'})`);
  }
  if (ilegibles) {
    frases.push(`*${ilegibles}* no ${ilegibles === 1 ? 'la pude leer' : 'las pude leer'} 🔍`);
  }
  if (dudosas) {
    const montos = montosDe(incidencias, 'fecha_dudosa');
    const detalle = montos.length ? `: ${montos.length === 1 ? 'la de' : 'las de'} ${enumerar(montos)}` : '';
    frases.push(`*${dudosas}* ${dudosas === 1 ? 'trae' : 'traen'} fecha dudosa${detalle}`);
  }

  // Solo había dudas de lectura: las dice `mensajeDemasiadasDudas` y aquí no
  // queda nada. Devolver una frase vacía dejaría un párrafo con un punto solo.
  if (!frases.length) return null;

  const encabezado = vistas > 1 ? `De tus ${vistas} fotos, ` : '';
  const cuerpo = frases.length === 1
    ? frases[0]
    : `${frases.slice(0, -1).join(', ')} y ${frases[frases.length - 1]}`;
  const pide = ilegibles || tecnicos || dudosas
    ? '\n\nReenvíame esas fotos —tomadas otra vez, con buena luz— y las dejo bien. 📸'
    : '';
  return `${encabezado}${cuerpo}.${pide}`;
}
