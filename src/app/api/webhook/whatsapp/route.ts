import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { verifyWebhookChallenge, verifySignature, sendText } from '@/lib/meta/client';
import { processInbound, type InboundMessage } from '@/lib/cuadra/processor';
import { rateLimit, bodyExcede } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';
import { flushObservabilidad } from '@/lib/observability/sentry';

const MAX_BODY = 256 * 1024;   // 256 KB — un webhook de Meta es pequeño
const MSGS_POR_MIN = 40;        // por teléfono (una ráfaga de 12 fotos cabe holgada)

// ── CUÁNTOS MENSAJES SE PROCESAN A LA VEZ ───────────────────────────────────
//
// NADA ACOTABA ESTO. Era `Promise.all(permitidos.map(processInbound))`: si Meta
// entrega 22 fotos en un POST, arrancan las 22 llamadas de visión a la vez y
// las 22 comparten los 120 s de UNA invocación. Cada foto pide su propio tope
// de 25 s creyendo que es suyo, y no lo es.
//
// Y el final es el peor que tiene este producto: Vercel mata la invocación al
// llegar a `maxDuration`, el `finally` del intake NO corre —así que el `+1` de
// la barrera queda escrito—, el claim de `wa_mensaje_procesado` queda tomado, y
// Meta YA recibió su 200 aquí abajo, así que no reintenta. Se pierden las N
// fotos sin una línea de log: ni un error, ni un aviso al operador. Desde su
// lado mandó veintidós fotos y no pasó nada.
//
// Con un pool el reloj de cada foto vuelve a significar algo: cinco corriendo
// dan ~5 × 25 s de trabajo en vuelo, y la sexta arranca cuando una termina, con
// el presupuesto ya gastado descontado por `crearPresupuesto`.
//
// ¿POR QUÉ 5? Vercel da 1–2 vCPU a esta función y el lector de códigos de
// barras (zxing-wasm) es SÍNCRONO: bloquea el event loop mientras decodifica, y
// con él bloquea los `setTimeout` de los que dependen el abort del OCR y la red
// de seguridad de `acotada`. Medido en una M2 de 8 núcleos, 20 fotos en
// paralelo bloquean hasta 1.7 s de golpe. Cinco lo dejan por debajo del medio
// segundo sin alargar la ráfaga: el cuello de botella real es la llamada de
// visión, que es red y no CPU.
const MAX_EN_PARALELO = 5;

/**
 * Corre `fn` sobre `items` con como mucho `limite` en vuelo.
 *
 * `i++` es seguro sin candado porque JavaScript no interrumpe una expresión a
 * media evaluación: cada obrero se lleva un índice distinto. Nunca lanza —
 * `fn` trae su propio catch— para que un fallo no cancele a los demás obreros.
 */
async function conPool<T>(items: T[], limite: number, fn: (item: T) => Promise<void>): Promise<void> {
  let siguiente = 0;
  const obrero = async () => {
    for (;;) {
      const i = siguiente++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, obrero));
}

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
  // ── RATE LIMIT POR TELÉFONO (no por IP: todo Meta viene de sus IPs) ────────
  //
  // LO QUE DESCARTA AQUÍ SE PIERDE PARA SIEMPRE. Estos mensajes YA pasaron el
  // HMAC, o sea que son de Meta y son de un chofer dado de alta; y abajo se
  // devuelve 200, así que Meta no reintenta. El único rastro era un `warn` sin
  // `waMessageId`: imposible saber después QUÉ comprobante se tiró.
  //
  // La cola de verdad —reencolar y procesarlos luego— es infraestructura que
  // hoy no existe (FASE 3, deuda documentada en GUIA_BUILD.md). Lo que sí se
  // puede hacer sin ella son las dos cosas que convierten una pérdida silenciosa
  // en una visible: dejar el id en el log, y DECÍRSELO al operador para que
  // pueda reenviar. Un comprobante que el chofer sabe que no entró vale mucho
  // más que uno que cree que sí.
  const permitidos: InboundMessage[] = [];
  const descartados: InboundMessage[] = [];
  for (const m of messages) {
    if (rateLimit(`wa:${m.from}`, MSGS_POR_MIN, 60_000)) { permitidos.push(m); continue; }
    descartados.push(m);
    // ERROR y no warn: es un comprobante perdido, no una curiosidad operativa.
    logger.error('wa.ratelimit', { from: m.from, id: m.waMessageId, tipo: m.type });
  }

  // 1.3: Meta PUEDE entregar varios mensajes (fotos) en UN POST → comparten los
  // 120s de UNA invocación. Se procesan en UN solo after() para GARANTIZAR la
  // concurrencia (no depender de si Next corre N after() en serie), pero con un
  // POOL y no con `Promise.all` a pelo: ver `MAX_EN_PARALELO` arriba para por
  // qué un lote sin techo se pierde entero y en silencio.
  if (permitidos.length || descartados.length) {
    if (permitidos.length > MAX_EN_PARALELO) {
      // Deja rastro de que hubo ráfaga grande ANTES de procesarla: si la
      // invocación muere, esta línea es lo único que dice cuántos entraron.
      logger.info('wa.rafaga', { mensajes: permitidos.length, pool: MAX_EN_PARALELO });
    }
    after(async () => {
      await conPool(permitidos, MAX_EN_PARALELO, (m) =>
        processInbound(m).catch((e) => logger.error('processInbound', { err: e instanceof Error ? e.message : String(e) })),
      );

      // ── LO QUE SE DESCARTÓ SE DICE ─────────────────────────────────────────
      //
      // Va DESPUÉS del procesamiento y no antes: primero se atiende lo que sí
      // entró. UNA línea por teléfono, no una por mensaje — el mismo criterio
      // que el resumen de ráfaga, y por la misma razón: quien acaba de mandar
      // treinta fotos no necesita treinta disculpas.
      //
      // Nunca lanza: avisar de una pérdida no puede convertirse en una segunda.
      for (const telefono of new Set(descartados.map((m) => m.from))) {
        const cuantos = descartados.filter((m) => m.from === telefono).length;
        try {
          await sendText(telefono,
            `Me llegaron demasiados mensajes muy seguidos y ${cuantos === 1 ? 'uno no lo' : `${cuantos} no los`} alcancé a procesar 😕. ` +
            `Espera un minuto y ${cuantos === 1 ? 'reenvíamelo' : 'reenvíamelos'}, por favor — sin ${cuantos === 1 ? 'ese' : 'esos'} no puedo cuadrar bien tu viaje. 🙏`);
        } catch (e) {
          logger.error('wa.ratelimit_aviso_falló', { from: telefono, err: e instanceof Error ? e.message : String(e) });
        }
      }
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
