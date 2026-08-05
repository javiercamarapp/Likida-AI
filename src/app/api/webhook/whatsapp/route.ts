import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { verifyWebhookChallenge, verifySignature } from '@/lib/meta/client';
import { processInbound, type InboundMessage } from '@/lib/cuadra/processor';
import { rateLimit, bodyExcede } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';
import { flushObservabilidad } from '@/lib/observability/sentry';

const MAX_BODY = 256 * 1024;   // 256 KB — un webhook de Meta es pequeño
const MSGS_POR_MIN = 40;        // por teléfono (una ráfaga de 12 fotos cabe holgada)

export const runtime = 'nodejs';
// ME-13 / AUDIT_V3 orquestación: el procesamiento corre en after() y su presupuesto
// en el PEOR caso es acquireViajeLock(≤12s) + esperarIntake (CUADRA_INTAKE_ESPERA_MS,
// hoy 20s) + cuadre (~40s) ≈ 72s. Eso NO cabía en los 60s que había aquí: una
// ráfaga de fotos lenta se cortaba a media liquidación, y Meta ya tiene su 200 —
// no reintenta. El operador se queda esperando un PDF que nadie va a mandar.
//
// El riesgo estaba abierto porque una sesión anterior no pudo confirmar el plan y
// dejó 60 por prudencia, suponiendo Hobby. VERIFICADO el 28-jul-2026 contra la API
// de Vercel: el equipo `likida` (team_uelpa362Txivu…) está en plan **pro**, donde
// el tope es 300s. Aquella nota miraba otra cuenta.
//
// Se sube a 120, que es lo que aquella misma nota recomendaba para el caso de que
// el plan lo permitiera: cubre el peor caso con casi el doble de margen sin dejar
// una petición colgada cinco minutos. El techo de 300 queda disponible si hiciera
// falta. Mover el procesamiento pesado a QStash sigue siendo el arreglo de fondo.
export const maxDuration = 120;

// GET — verificación del webhook (Meta lo llama una vez al configurar).
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (verifyWebhookChallenge(p.get('hub.mode'), p.get('hub.verify_token'))) {
    return new NextResponse(p.get('hub.challenge') ?? '', { status: 200 });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

// POST — mensajes entrantes. Verifica HMAC, responde 200 rápido y procesa en after().
export async function POST(req: NextRequest) {
  // CAP DE BODY antes de leer/HMAC: evita DoS por cuerpo enorme sin firma.
  if (bodyExcede(req, MAX_BODY)) return new NextResponse('Payload too large', { status: 413 });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return new NextResponse('Payload too large', { status: 413 }); // por si falta content-length
  if (!verifySignature(raw, req.headers.get('x-hub-signature-256'))) {
    return new NextResponse('Invalid signature', { status: 401 });
  }

  let payload: WaWebhook;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse('Bad JSON', { status: 400 });
  }

  const messages = extractMessages(payload);
  // Rate limit por TELÉFONO (no por IP: todo Meta viene de sus IPs).
  const permitidos = messages.filter((m) => {
    const ok = rateLimit(`wa:${m.from}`, MSGS_POR_MIN, 60_000);
    if (!ok) logger.warn('wa.ratelimit', { from: m.from });
    return ok;
  });

  // 1.3: Meta PUEDE entregar varios mensajes (fotos) en UN POST → comparten los
  // 60s de UNA invocación. Se procesan en UN solo after() con Promise.all para
  // GARANTIZAR concurrencia (no depender de si Next corre N after() en serie).
  // Con la barrera de intake las fotos ya corren en paralelo → un lote de 8 cabe
  // holgado en 60s (medido: 8 en paralelo ≈ 3.5s vs 24s en serie).
  if (permitidos.length) {
    after(async () => {
      await Promise.all(
        permitidos.map((m) =>
          processInbound(m).catch((e) => logger.error('processInbound', { err: e instanceof Error ? e.message : String(e) })),
        ),
      );
      // EL MECANISMO EXISTÍA Y NADIE LO LLAMABA (auditoría 6, operabilidad).
      //
      // `flushObservabilidad` se escribió para ESTE punto exacto —su comentario
      // lo dice— y con ocho pruebas unitarias, pero el único `after()` del repo
      // no la invocaba. Vercel CONGELA la invocación en cuanto esta promesa
      // resuelve, así que el evento que más importa (el último error antes de
      // morir) es justo el que menos probabilidad tiene de salir del proceso.
      // `reportar()` pide `flush` dentro del envío, pero en fire-and-forget: la
      // invocación puede congelarse antes de que esa promesa asiente.
      //
      // Aquí es donde se pueden esperar los envíos en vuelo sin retrasar al
      // operador: su mensaje ya salió. Nunca lanza — un fallo de telemetría no
      // puede sumarse al fallo que se está reportando.
      await flushObservabilidad();
    });
  }
  // ── ACUSES DE ENTREGA ──────────────────────────────────────────────────────
  //
  // El 200 de Meta al enviar significa ACEPTADO, no ENTREGADO. La entrega ocurre
  // después y Meta la reporta por este mismo webhook, en `value.statuses`. Este
  // arreglo NO SE LEÍA: `extractMessages` solo miraba `value.messages`, así que
  // un `failed` entraba, devolvía `{"received":0}` y se tiraba sin log.
  //
  // Eso es exactamente lo que pasó el 28-jul-2026: una liquidación cerró, el PDF
  // se generó y subió a storage —comprobado en la base y en el bucket— y el
  // operador no lo recibió. No hubo `pdf.no_entregado` ni error de envío, porque
  // el fallo llegó por aquí y aquí no había nadie escuchando. Se perdieron veinte
  // minutos reconstruyendo a mano lo que este log habría dicho en una línea.
  //
  // Con el wamid que `sendText`/`sendDocument` ya registran al enviar, estas dos
  // líneas cierran el circuito: se sabe qué mensaje concreto no llegó y por qué.
  const estados = extractStatuses(payload);
  for (const e of estados) {
    if (e.status === 'failed') {
      logger.error('wa.no_entregado', {
        id: e.id, para: e.recipient_id,
        codigo: e.errors?.[0]?.code,
        err: e.errors?.[0]?.title ?? e.errors?.[0]?.message,
        detalle: e.errors?.[0]?.error_data?.details,
      });
    } else {
      logger.info('wa.estado', { id: e.id, estado: e.status });
    }
  }

  return NextResponse.json({ received: permitidos.length, estados: estados.length });
}

// ── parsing del payload de WhatsApp Cloud API ───────────────────────────────

/** Acuse de entrega de un mensaje que NOSOTROS enviamos. `id` es el wamid que
 *  devolvió el envío, que es lo que permite atarlo a la línea de `wa.sendText.ok`
 *  o `wa.sendDocument.ok` correspondiente. */
interface WaEstado {
  id: string;
  status: string;            // sent | delivered | read | failed
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }>;
}

interface WaWebhook {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          id: string;
          from: string;
          type: string;
          text?: { body: string };
          image?: { id: string };
          document?: { id: string };
          // El chofer apretó un botón. Meta manda `type: 'interactive'` y dentro
          // un `interactive.type` que dice CUÁL de los interactivos fue:
          // `button_reply` (botones de respuesta rápida) o `list_reply` (lista
          // desplegable). Son formas distintas y no se pueden tratar igual.
          interactive?: {
            type?: string;
            button_reply?: { id?: string; title?: string };
          };
        }>;
        // Acuses de ENTREGA. Meta los manda por el mismo webhook y con el mismo
        // `field: 'messages'`, en un arreglo aparte. Ver `extractStatuses`.
        statuses?: WaEstado[];
      };
    }>;
  }>;
}

/** Los acuses de entrega, que viven en `value.statuses` y no en `value.messages`. */
function extractStatuses(p: WaWebhook): WaEstado[] {
  const out: WaEstado[] = [];
  for (const entry of p.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const s of change.value?.statuses ?? []) out.push(s);
    }
  }
  return out;
}

function extractMessages(p: WaWebhook): InboundMessage[] {
  const out: InboundMessage[] = [];
  for (const entry of p.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const m of change.value?.messages ?? []) {
        const base = { from: m.from, waMessageId: m.id };
        if (m.type === 'text' && m.text) out.push({ ...base, type: 'text', text: m.text.body });
        else if (m.type === 'image' && m.image) out.push({ ...base, type: 'image', mediaId: m.image.id });
        else if (m.type === 'document' && m.document) out.push({ ...base, type: 'document', mediaId: m.document.id });
        // BOTÓN APRETADO → entra como TEXTO con el id del botón por cuerpo.
        //
        // Antes caía en `other` y se perdía: el chofer apretaba, el webhook
        // devolvía 200 y nadie contestaba nunca.
        //
        // POR QUÉ TEXTO Y NO UN TIPO NUEVO. El `id` es el dato que importa —lo
        // elegimos nosotros al armar el botón, no lo escribe el chofer— y el
        // procesador ya sabe leer texto: es el mismo camino que recorre cuando
        // el operador teclea la respuesta a mano, con su idempotencia por
        // `waMessageId` intacta. Un tipo nuevo obligaría a tocar `InboundMessage`
        // y cada rama que la consume para no ganar nada: `title` es el rótulo
        // que le enseñamos, derivable del id, y guardarlo invitaría a decidir
        // por lo que el chofer VE en vez de por lo que el botón VALE.
        //
        // Se exige el id no vacío: sin él no hay nada que leer y un `text: ''`
        // le llegaría al procesador como un mensaje en blanco del operador.
        else if (m.type === 'interactive' && m.interactive?.type === 'button_reply' && m.interactive.button_reply?.id) {
          out.push({ ...base, type: 'text', text: m.interactive.button_reply.id });
        }
        // Cualquier otro interactivo (`list_reply`, `nfm_reply`…) NO se traga
        // como si fuera un botón: su forma es distinta y hoy no se manda ninguno.
        else out.push({ ...base, type: 'other' });
      }
    }
  }
  return out;
}
