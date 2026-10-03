import { AlertTriangle, CheckCircle2 } from 'lucide-react';

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
  /** La versión de una fila (texto de 12px, margen superior). */
  compacto?: boolean;
}) {
  const r = leerResultado(estado);
  if (!r) return null;
  const tam = compacto ? 'text-[12px] px-3 py-2 mt-2' : 'text-[12.5px] px-3.5 py-2.5';
  const icono = compacto ? 14 : 15;
  return r.tono === 'ok' ? (
    <div role="status" className={`flex items-start gap-2 rounded-lg ${tam}`}
      style={{ background: 'var(--okbg)', color: 'var(--ok)' }}>
      <CheckCircle2 aria-hidden width={icono} height={icono} strokeWidth={1.75} className="mt-0.5 shrink-0" />
      <span>{r.texto}</span>
    </div>
  ) : (
    <div role="alert" className={`flex items-start gap-2 rounded-lg ${tam}`}
      style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
      <AlertTriangle aria-hidden width={icono} height={icono} strokeWidth={1.75} className="mt-0.5 shrink-0" />
      <span>{r.texto}</span>
    </div>
  );
}
