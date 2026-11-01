import { Aviso } from '../../ui-v2/componentes/aviso';

// ═══════════════════════════════════════════════════════════════════════════
// EL AVISO DE RESULTADO — UNO, no dieciocho (W2 «producto», 1-oct-2026).
//
// Cada formulario del panel traía su propia copia de este bloque: «ok» en verde
// con un palomita, «error» en rojo con un triángulo, y dos o tres formas
// distintas de tipar el resultado (`{ ok: true, mensaje }`, `{ ok: string }`,
// `{ ok: boolean, mensaje?, error? }`). La auditoría de UI contó 18 copias que
// ya se habían desincronizado (algunas sin `role`, otras con el ícono en otra
// alineación). Aquí vive la forma, UNA vez, y acepta las tres formas de
// resultado para que migrar una pantalla sea cambiar el import, no la acción.
//
// ACCESIBILIDAD. El error es `role="alert"` (se anuncia al aparecer) y el éxito
// `role="status"` (educado). Nunca color solo: ícono + texto. El error del
// servidor se enseña VERBATIM: los `DatoInvalido` están escritos para leerse
// aquí y son lo único que dice QUÉ corregir.
//
// CUÁNDO ESTE Y CUÁNDO UN TOAST: este aviso es el resultado de UN FORMULARIO y
// vive junto a sus campos (el error tiene que verse donde se corrige). El toast
// (`notificaciones.tsx`) es para lo que no tiene campos al lado: acciones de
// fila, operaciones largas, confirmaciones tras un `revalidatePath`.
// ═══════════════════════════════════════════════════════════════════════════

/** Las formas de resultado que devuelven los server actions del panel. */
export type ResultadoUI =
  | null
  | undefined
  | { ok: true; mensaje?: string; error?: undefined }
  | { ok: false; error: string; mensaje?: undefined }
  | { ok: boolean; mensaje?: string; error?: string }
  | { ok: string; error?: undefined }
  | { error: string; ok?: undefined };

export interface ResultadoLeido { tono: 'ok' | 'error'; texto: string }

/** Normaliza cualquiera de las formas. `null` = nada que enseñar (sin enviar
 *  todavía, o un éxito sin mensaje: callar es mejor que inventar un «listo»). */
export function leerResultado(estado: ResultadoUI): ResultadoLeido | null {
  if (!estado) return null;
  if (typeof estado.error === 'string' && estado.error !== '') return { tono: 'error', texto: estado.error };
  if (typeof estado.ok === 'string') return estado.ok === '' ? null : { tono: 'ok', texto: estado.ok };
  if (estado.ok === false) return { tono: 'error', texto: 'No se pudo completar la acción.' };
  const mensaje = (estado as { mensaje?: string }).mensaje;
  return mensaje ? { tono: 'ok', texto: mensaje } : null;
}

export function AvisoResultado({ estado, compacto = false }: {
  estado: ResultadoUI;
  /** La versión de una fila (margen superior). */
  compacto?: boolean;
}) {
  const r = leerResultado(estado);
  if (!r) return null;
  // El `Aviso` único de ui-v2: icono + texto, `role="alert"` el error y `role="status"` el éxito.
  return <Aviso tono={r.tono === 'ok' ? 'ok' : 'error'} className={compacto ? 'mt-2' : undefined}>{r.texto}</Aviso>;
}
