import { logger } from '@/lib/logger';
import { armarHtml, aTextoPlano, type Correo } from './plantilla';
import { LOGO_PNG_BASE64, LOGO_CID, LOGO_NOMBRE } from './logo';

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

/**
 * Tope de la llamada a Resend (auditoría prod 22-ago-2026, RES-5).
 *
 * Este `fetch` no tenía señal, así que heredaba el default de undici —300 s—
 * y SE ESPERA en caminos que tienen 120: el `after()` del webhook y los crons
 * lo llaman a través de `alertarOperador`/`interruptores.ts`. O sea: el canal
 * que existe para AVISAR de una avería podía ser el que se llevara la
 * invocación entera, y con ella el trabajo que sí se había hecho.
 *
 * Cinco segundos: la API de Resend contesta en decenas de ms; 5 s ya es "está
 * caído", no "está lento". Un correo que no sale cuesta un aviso; una
 * invocación colgada cuesta la liquidación.
 */
export const TIMEOUT_CORREO_MS = Number(process.env.LIKIDA_TIMEOUT_CORREO_MS) || 5_000;

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
function remitente(local = 'avisos'): string | null {
  const dominio = process.env.RESEND_EMAIL_DOMAIN;
  if (!dominio) return null;
  return `Likida <${local}@${dominio}>`;
}

export interface OpcionesEnvio {
  /**
   * La parte local del remitente. El default es `avisos`, que es lo que dice
   * un correo del sistema; los correos de ACCESO salen de `acceso@` porque no
   * son un aviso — son la llave de la cuenta, y quien archiva "avisos" en una
   * carpeta no puede perder ahí su enlace de entrada. Mismo dominio, misma
   * reputación (SPF/DKIM/DMARC se firman por dominio, no por buzón): esto es
   * legibilidad para quien recibe, no un canal nuevo que verificar.
   */
  remitenteLocal?: string;
  /**
   * AUDITORÍA FABLE CICLO 5 (c5-3): la llave de idempotencia que Resend
   * deduplica de su lado. Un timeout de red es AMBIGUO — el POST pudo haber
   * sido aceptado con la respuesta perdida — y sin esta llave un reintento
   * mandaba el MISMO correo frío dos veces al mismo contacto. Quien envía
   * piezas de campaña la pasa (la llave es el id de la pieza); los avisos
   * del operador no la necesitan.
   */
  idempotencyKey?: string;
}

/** Un destinatario que no parece correo no se manda: la API lo rechazaría
 *  igual, pero así no se gasta la llamada ni se ensucia el log con su error. */
function destinatarioValido(d: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.trim());
}

export async function enviarCorreo(
  para: string | string[],
  correo: Correo,
  op: OpcionesEnvio = {},
): Promise<ResultadoEnvio> {
  const llave = process.env.RESEND_API_KEY;
  const from = remitente(op.remitenteLocal);
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
        // La llave viaja solo si el llamador la dio (c5-3): Resend rechaza
        // el duplicado de una llave ya usada, volviendo seguro el reintento
        // tras un timeout ambiguo.
        ...(op.idempotencyKey ? { 'Idempotency-Key': op.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from,
        to: destinos,
        subject: correo.asunto,
        html: armarHtml(correo),
        // La parte de texto no es opcional: un correo sin ella puntúa peor en
        // los filtros de spam y hay clientes que solo leen esa.
        text: aTextoPlano(correo),
        // EL LOGO VIAJA CON EL CORREO. `content_disposition: 'inline'` + el
        // `content_id` que el HTML referencia como `cid:` — así el logo no
        // depende de que el cliente autorice imágenes externas, que es lo que
        // lo rompió la primera vez. No aparece como adjunto descargable.
        attachments: [{
          filename: LOGO_NOMBRE,
          content: LOGO_PNG_BASE64,
          content_id: LOGO_CID,
          content_disposition: 'inline',
        }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_CORREO_MS),
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
    // Red caída, DNS o TOPE AGOTADO: el aviso se pierde, pero la corrida del
    // agente que lo generó NO se cae con él. El timeout entra por aquí a
    // propósito (un `TimeoutError` de `AbortSignal.timeout`): para el llamador
    // es el mismo hecho que un DNS muerto —el correo no salió— y merece el
    // mismo trato, con el motivo en el log para distinguirlos.
    const detalle = e instanceof Error ? e.message : String(e);
    logger.error('correo.red', { detalle, asunto: correo.asunto, topeMs: TIMEOUT_CORREO_MS });
    return { ok: false, motivo: 'red', detalle };
  }
}
