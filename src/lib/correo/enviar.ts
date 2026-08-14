import { logger } from '@/lib/logger';
import { armarHtml, aTextoPlano, type Correo } from './plantilla';

// ═══════════════════════════════════════════════════════════════════════════
// ENVÍO DE CORREO — Resend, por HTTP directo.
//
// Sin SDK a propósito. El de Resend son tres llamadas `fetch` envueltas; meter
// una dependencia al bundle (con su superficie de CVEs y su versión que
// mantener) para ahorrarse veinte líneas no vale, y el mismo criterio ya se
// aplicó en este repo con el corpus de normas.
//
// LO QUE ESTE MÓDULO NO HACE, Y ES DELIBERADO:
//
//   · No reintenta. Un correo de alerta que se manda dos veces por un reintento
//     ciego es peor que uno que no llegó: enseña a ignorar las alertas. El
//     reintento, cuando haga falta, va en la cola de quien llama, con su llave
//     de idempotencia.
//   · No tira excepción. Devuelve un resultado. Un aviso que no se pudo mandar
//     NO debe tumbar la corrida del agente que lo generó — el trabajo de fondo
//     ya se hizo y perderlo por un 429 sería el peor intercambio posible.
//   · No manda nada si no está configurado, y lo DICE. Es el mismo patrón que
//     WhatsApp en `conexiones.ts`: la ausencia de configuración es un estado
//     declarado, no un fallo silencioso.
// ═══════════════════════════════════════════════════════════════════════════

const API = 'https://api.resend.com/emails';

export type ResultadoEnvio =
  | { ok: true; id: string }
  /** No hay llave: no es un error, es que no está encendido. */
  | { ok: false; motivo: 'sin_configurar' }
  | { ok: false; motivo: 'rechazado'; detalle: string }
  | { ok: false; motivo: 'red'; detalle: string };

/** ¿Está el canal encendido? Lo usa la pantalla de Conexiones para decir la
 *  verdad en vez de pintar un semáforo. */
export function correoConfigurado(): boolean {
  return Boolean(process.env.RESEND_API_KEY && remitente());
}

/**
 * De qué dirección sale.
 *
 * El dominio viene de `RESEND_EMAIL_DOMAIN`, que la integración de Vercel puso
 * sola. Se usa un SUBDOMINIO (mail.likida.ai) y no el raíz a propósito: aísla
 * la reputación de envío, de modo que un correo marcado como spam no arrastre
 * la entregabilidad del dominio principal.
 */
function remitente(): string | null {
  const dominio = process.env.RESEND_EMAIL_DOMAIN;
  if (!dominio) return null;
  return `Likida <avisos@${dominio}>`;
}

/** Un destinatario que no parece correo no se manda: la API lo rechazaría
 *  igual, pero así no se gasta la llamada ni se ensucia el log con su error. */
function destinatarioValido(d: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.trim());
}

export async function enviarCorreo(
  para: string | string[],
  correo: Correo,
): Promise<ResultadoEnvio> {
  const llave = process.env.RESEND_API_KEY;
  const from = remitente();
  if (!llave || !from) {
    // A nivel `info`, no `error`: en un entorno sin correo configurado —el de
    // desarrollo, el de pruebas— esto es lo esperado, y sacarlo como error
    // entrenaría a ignorar los errores de verdad.
    logger.info('correo.sin_configurar', { asunto: correo.asunto });
    return { ok: false, motivo: 'sin_configurar' };
  }

  const destinos = (Array.isArray(para) ? para : [para])
    .map((d) => d.trim())
    .filter(destinatarioValido);
  if (destinos.length === 0) {
    return { ok: false, motivo: 'rechazado', detalle: 'Sin destinatarios válidos.' };
  }

  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${llave}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: destinos,
        subject: correo.asunto,
        html: armarHtml(correo),
        // La parte de texto no es opcional: un correo sin ella puntúa peor en
        // los filtros de spam y hay clientes que solo leen esa.
        text: aTextoPlano(correo),
      }),
    });

    if (!r.ok) {
      // El cuerpo del error de Resend trae el motivo real (dominio no
      // verificado, cuota, destinatario en la lista de rebotes). Se guarda
      // recortado: completo puede traer el correo del destinatario y este log
      // no es el lugar para un dato personal.
      const cuerpo = (await r.text().catch(() => '')).slice(0, 200);
      logger.error('correo.rechazado', { status: r.status, cuerpo, asunto: correo.asunto });
      return { ok: false, motivo: 'rechazado', detalle: `HTTP ${r.status}` };
    }

    const json = (await r.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: json?.id ?? '' };
  } catch (e) {
    // Red caída o DNS: el aviso se pierde, pero la corrida del agente que lo
    // generó NO se cae con él.
    const detalle = e instanceof Error ? e.message : String(e);
    logger.error('correo.red', { detalle, asunto: correo.asunto });
    return { ok: false, motivo: 'red', detalle };
  }
}
