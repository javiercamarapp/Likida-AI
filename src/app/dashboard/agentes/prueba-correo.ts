import type { ResultadoEnvio } from '@/lib/correo/enviar';

// ═══════════════════════════════════════════════════════════════════════════
// LA LÓGICA PURA DEL BOTÓN «MÁNDATE UNA PRUEBA» (auditoría 4, B5).
//
// La server action vive como closure dentro de `seccion-notificaciones.tsx` y
// no se puede importar desde una prueba de nodo; lo que DECIDE —el turno del
// rate limit y el acuse que el cliente lee— vive aquí, puro y probado, y la
// action solo lo cablea. Mismo criterio que `puedeConfigurarAvisos`: la
// decisión probada en un módulo, el gateo con sesión en la action.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `j***@dominio` — el acuse confirma A DÓNDE salió la prueba sin dejar el
 * correo completo en una pantalla que puede acabar en una captura. Mismo
 * formato que `ofuscado` en `admin/salud-sistema/page.tsx` (privado allá; son
 * dos sitios — al tercero, el helper se muda a un módulo compartido).
 */
export function ofuscarCorreo(correo: string): string {
  const arroba = correo.indexOf('@');
  if (arroba <= 0) return '***';
  return `${correo[0]}***@${correo.slice(arroba + 1)}`;
}

/** Una prueba por minuto por (usuario, agente). No es anti-abuso serio: es el
 *  freno para que el doble clic ansioso no queme dos envíos de Resend. */
export const INTERVALO_PRUEBA_MS = 60_000;

/**
 * EN MEMORIA, POR INSTANCIA, y basta. Cada instancia serverless arranca con
 * el mapa vacío, así que dos instancias pueden dejar pasar dos pruebas en el
 * mismo minuto — el costo es UN correo de más que el propio usuario pidió, a
 * su propia bandeja. Montar una tabla para eso sería el intercambio inverso.
 */
const ULTIMA_PRUEBA = new Map<string, number>();

export type TurnoDePrueba = { ok: true } | { ok: false; faltanSegundos: number };

/**
 * ¿Le toca turno a esta llave (usuario:agente)? Si sí, lo consume — también
 * cuando el envío posterior falle: es el mismo criterio que `reclamarAviso`
 * en el motor, porque la alternativa es reintentar sin freno contra un canal
 * roto. `ultimas` entra por parámetro solo para poder probarla.
 */
export function reclamarTurnoDePrueba(
  llave: string,
  ahora: number,
  ultimas: Map<string, number> = ULTIMA_PRUEBA,
): TurnoDePrueba {
  const previa = ultimas.get(llave);
  if (previa !== undefined && ahora - previa < INTERVALO_PRUEBA_MS) {
    return {
      ok: false,
      faltanSegundos: Math.max(1, Math.ceil((INTERVALO_PRUEBA_MS - (ahora - previa)) / 1000)),
    };
  }
  // Poda para que el mapa no crezca sin techo dentro de una instancia
  // longeva: se tiran las llaves cuyo turno ya venció de todos modos.
  if (ultimas.size >= 500) {
    for (const [k, v] of ultimas) {
      if (ahora - v >= INTERVALO_PRUEBA_MS) ultimas.delete(k);
    }
  }
  ultimas.set(llave, ahora);
  return { ok: true };
}

export interface AcusePrueba {
  enviado: boolean;
  /** Lo que la pestaña enseña tal cual. Dice la verdad del caso que tocó. */
  mensaje: string;
}

/**
 * El acuse del envío, en palabras de pantalla. Tres verdades posibles:
 * salió (y a dónde), el canal no está configurado (y qué falta), o el envío
 * se rechazó/perdió (y qué hacer). El detalle CRUDO de un fallo de red no
 * viaja nunca — `enviar.ts` lo devuelve tal como lo tiró `fetch`, y un
 * `getaddrinfo ENOTFOUND` en la pestaña del contralor no le dice qué hacer;
 * el de `rechazado` sí, porque ya llega saneado (`HTTP 403`, nunca el cuerpo).
 */
export function acuseDeEnvio(envio: ResultadoEnvio, correo: string): AcusePrueba {
  if (envio.ok) {
    return {
      enviado: true,
      mensaje: `Enviada. Revisa tu bandeja de ${ofuscarCorreo(correo)} — si en unos minutos no aparece, mira también la carpeta de spam.`,
    };
  }
  switch (envio.motivo) {
    case 'sin_configurar':
      return {
        enviado: false,
        mensaje: 'El correo saliente no está configurado: falta RESEND_API_KEY/RESEND_EMAIL_DOMAIN. Hasta que se conecte no sale ningún aviso — tampoco esta prueba.',
      };
    case 'rechazado':
      return {
        enviado: false,
        mensaje: `El servidor de correo rechazó el envío (${envio.detalle}). El detalle completo quedó en los registros del sistema.`,
      };
    case 'red':
      return {
        enviado: false,
        mensaje: 'No se pudo alcanzar el servidor de correo. Inténtalo de nuevo en un momento.',
      };
  }
}
