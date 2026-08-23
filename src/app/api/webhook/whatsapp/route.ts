import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
// `sendText` ya no se importa aquí: el único envío que salía de esta ruta era
// el aviso de rate limit, y ese aviso desapareció con el 429 (los mensajes
// vuelven solos). Esta ruta solo recibe; quien contesta es el processor.
import { verifyWebhookChallenge, verifySignature } from '@/lib/meta/client';
import { processInbound, type InboundMessage, type ResultadoInbound } from '@/lib/likida/processor';
import { rateLimit, bodyExcede } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';
import { registrarEventoSeguridad } from '@/lib/seguridad/eventos';
import { flushObservabilidad, codigoDeError } from '@/lib/observability/sentry';
import { estaApagado } from '@/lib/likida/interruptores';
import { guardarEventosPendientes, pendientesYaConocidos, reclamarPendiente, marcarPendienteProcesado, anotarFalloPendiente } from '@/lib/likida/wa_pendientes';

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
/** Los resultados de `processInbound` que dejan la fila durable SIN sellar.
 *  Local a propósito (no se importa del processor): las pruebas de esta ruta
 *  mockean el módulo entero, y `undefined` —el mock viejo— cuenta como hecho. */
function quedoPendiente(r: ResultadoInbound | undefined): boolean {
  return r === 'sin_tiempo' || r === 'en_curso' || r === 'reintentable';
}

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
// en el PEOR caso es acquireViajeLock(≤12s) + esperarIntake (LIKIDA_INTAKE_ESPERA_MS,
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
  // El reloj de la INVOCACIÓN: `maxDuration` corre desde aquí, no desde cada
  // mensaje. Se le pasa a cada `processInbound` del pool para que la foto 6
  // pida lo que queda y no los 120s enteros (auditoría 18, C4).
  const inicioInvocacion = Date.now();
  // CAP DE BODY antes de leer/HMAC: evita DoS por cuerpo enorme sin firma.
  if (bodyExcede(req, MAX_BODY)) return new NextResponse('Payload too large', { status: 413 });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return new NextResponse('Payload too large', { status: 413 }); // por si falta content-length
  if (!verifySignature(raw, req.headers.get('x-hub-signature-256'))) {
    void registrarEventoSeguridad({ origen: 'wa_webhook', tipo: 'firma_invalida', severidad: 'alta' });
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
  // LO QUE PASA DE ESTE TECHO YA NO SE DESCARTA: SE APLAZA. Es el cambio del
  // 4-ago-2026 y merece la explicación entera, porque el arreglo obvio —«hacer
  // una cola»— es el que no se puede sostener.
  //
  // EL PROBLEMA. Estos mensajes YA pasaron el HMAC: son de Meta y de un chofer
  // dado de alta. Antes se tiraban, se le avisaba al operador y se devolvía
  // 200 — y un 200 le dice a Meta que el mensaje quedó entregado, así que no
  // reintenta. Cada descarte era un comprobante perdido para siempre.
  //
  // POR QUÉ NO SE ENCOLA. Una cola de verdad (QStash, Redis, una tabla con su
  // reproceso) es infraestructura que hoy no existe, y una tabla que guarde el
  // payload crudo SIN un reproceso que la vacíe es peor que no tenerla: se ve
  // como un respaldo y es un cementerio. Subir el techo tampoco arregla nada —
  // `buckets` vive en la memoria de CADA instancia (ver `ratelimit.ts`), así
  // que el techo real ya es 40 × instancias y no hay número que se pueda
  // afinar con eso.
  //
  // LA COLA YA EXISTE Y ES DE META. Un webhook que no contesta 2xx se vuelve a
  // entregar; uno que contesta 200 no. Ese reintento es durable, tiene backoff
  // y no lo operamos nosotros. Y reentregar es SEGURO porque la idempotencia ya
  // está construida: `claimMessage` reclama cada `waMessageId` en
  // `wa_mensaje_procesado` al entrar a `processInbound`, así que lo ya
  // procesado vuelve como 'duplicado' y no se hace dos veces.
  //
  // POR QUÉ SE PROCESA LO PERMITIDO ANTES DE CONTESTAR 429, y no se devuelve el
  // lote entero sin tocar: si se descartara todo, un POST con MÁS mensajes que
  // el techo no podría procesarse NUNCA — cada reentrega volvería a excederlo
  // igual, para siempre. Atendiendo lo que cabe, cada entrega avanza y deja
  // menos por hacer, y el claim convierte lo hecho en un no-op.
  //
  // LO QUE ESTO NO CIERRA: si Meta acaba dándose por vencido, el comprobante se
  // pierde y desde aquí no hay forma de enterarse. Por eso el log conserva el
  // `waMessageId` — es lo único que permite cruzarlo contra la base después.
  //
  // ── DAT-34 · DEDUPLICAR ANTES DE COBRAR EL CUPO ───────────────────────────
  //
  // El límite corría ANTES de cualquier deduplicación, y eso volvía trampa el
  // arreglo de arriba. Meta reentrega el POST COMPLETO, no el resto: los
  // mensajes que YA se guardaron en la bandeja durable en la entrega anterior
  // vuelven a gastar sus cupos de la ventana, y los nuevos —que son los que
  // traen el comprobante que falta— se vuelven a diferir. Cada reentrega repite
  // el ciclo hasta que Meta se rinde, y ahí sí se pierden.
  //
  // Un mensaje que ya está en `wa_evento_pendiente` no cuesta trabajo nuevo: su
  // fila existe, el cron la drena y `claimMessage` lo trata como duplicado.
  // Cobrarle cupo es cobrarle dos veces por el mismo mensaje, y quien paga la
  // cuenta es el comprobante nuevo. `pendientesYaConocidos` es FAIL-OPEN: si no
  // se puede leer, el límite se aplica a todos, como antes.
  const yaEnBandeja = await pendientesYaConocidos(
    messages.map((m) => m.waMessageId ?? '').filter(Boolean),
  );
  const permitidos: InboundMessage[] = [];
  const diferidos: InboundMessage[] = [];
  for (const m of messages) {
    if (m.waMessageId && yaEnBandeja.has(m.waMessageId)) {
      // Ya guardado en una entrega anterior: pasa sin cobrar cupo. Se procesa
      // igual —es más rápido que esperar al cron— y el claim de su fila durable
      // impide que se haga dos veces.
      logger.info('wa.reentrega_ya_en_bandeja', { id: m.waMessageId });
      permitidos.push(m);
      continue;
    }
    if (await rateLimit(`wa:${m.from}`, MSGS_POR_MIN, 60_000)) { permitidos.push(m); continue; }
    diferidos.push(m);
    // WARN y no ERROR: ya no es un comprobante perdido, es uno que vuelve. Con
    // el id, porque si Meta se rinde ésta es la única línea que dice cuál era.
    logger.warn('wa.ratelimit_diferido', { from: m.from, id: m.waMessageId, tipo: m.type });
  }

  // 1.3: Meta PUEDE entregar varios mensajes (fotos) en UN POST → comparten los
  // 120s de UNA invocación. Se procesan en UN solo after() para GARANTIZAR la
  // concurrencia (no depender de si Next corre N after() en serie), pero con un
  // POOL y no con `Promise.all` a pelo: ver `MAX_EN_PARALELO` arriba para por
  // qué un lote sin techo se pierde entero y en silencio.
  //
  // Con `permitidos` vacío y `diferidos` lleno el `after()` se programa igual:
  // el pool no hace nada, pero el `flushObservabilidad` del final sí — y sin él
  // los `wa.ratelimit_diferido` de un lote enteramente aplazado se congelan con
  // la invocación y no salen nunca.
  // ── EL INBOX DURABLE GENERAL (auditoría externa 2, 16-ago-2026) ──────────
  //
  // receive → PERSIST → 2xx → worker. La bandeja 0119 dejó de ser solo la
  // del kill switch: TODO mensaje permitido se persiste AQUÍ, ANTES del
  // código de salida. Con eso, el 200 significa "recibido y GUARDADO" en
  // cualquier camino — si la invocación muere después del acuse y antes de
  // terminar el after(), la fila durable sigue ahí y el cron `wa-pendientes`
  // (cada 5 min) la recupera por el motor real.
  //
  // Y EL CASO QUE ERA PÉRDIDA REAL SE VUELVE REINTENTO: si NI guardar se
  // pudo (la base caída — la misma que antes hacía fallar-cerrado a
  // `estaApagado` DESPUÉS del acuse), ya no se contesta 200: se contesta
  // 503 y la cola durable es la de Meta, que reentrega lo no confirmado.
  // Lo que sí alcanzó a guardarse queda dedupeado por la PK (wamid) cuando
  // la reentrega vuelva.
  let filasDurables: Array<{ id: string; evento: InboundMessage; guardado: boolean }> = [];
  if (permitidos.length) {
    const persistencia = await guardarEventosPendientes(permitidos);
    filasDurables = persistencia.filas;
    if (persistencia.fallidos > 0) {
      logger.error('wa.inbox_no_persistido', {
        fallidos: persistencia.fallidos, guardados: persistencia.guardados,
        ids: filasDurables.filter((f) => !f.guardado).map((f) => f.id),
      });
      await flushObservabilidad();
      return NextResponse.json(
        { error: 'inbox no disponible', guardados: persistencia.guardados, fallidos: persistencia.fallidos },
        { status: 503, headers: { 'Retry-After': '60' } },
      );
    }
  }

  if (permitidos.length || diferidos.length) {
    if (permitidos.length > MAX_EN_PARALELO) {
      // Deja rastro de que hubo ráfaga grande ANTES de procesarla: si la
      // invocación muere, esta línea es lo único que dice cuántos entraron.
      logger.info('wa.rafaga', { mensajes: permitidos.length, pool: MAX_EN_PARALELO });
    }
    after(async () => {
      // ── EL BOTÓN DE PÁNICO NO APAGABA ESTO ────────────────────────────────
      //
      // `interruptor` (mig. 0110) existe para que Javier detenga a los agentes
      // cuando algo va mal, y hasta hoy solo lo consultaban los CRONS: siete
      // llamadas a `estaApagado`, las siete en `api/cron/*`. Apagar `global`
      // paraba la escalación, la purga y la facturación — y un chofer le
      // seguía escribiendo al bot, que le seguía contestando y gastando IA.
      //
      // Es el camino que MÁS importa apagar, no el que menos: es el único por
      // el que un cliente real toca el producto, y por el que un error se le
      // aparece a un operador enfrente de su jefe de flota. Se cierra ahora,
      // antes del primer piloto, no después del primer susto.
      //
      // POR QUÉ AQUÍ Y NO EN `processInbound`: `processInbound` es el motor y
      // se llama también desde pruebas y desde el simulador del demo, que
      // deben seguir corriendo con el sistema apagado. La puerta va en el
      // borde —donde entra el mundo real— igual que la verificación de firma.
      //
      // Y POR QUÉ NO SE CONTESTA NADA: el aviso tendría que salir por el mismo
      // WhatsApp que se acaba de declarar apagado. `estaApagado` es
      // fail-closed (una tabla ilegible cuenta como APAGADO, ver
      // `interruptores.ts`), así que si la base está caída, mandar el aviso
      // sería justo lo que no se puede hacer.
      //
      // ── APAGADO = PAUSADO Y DURABLE ─────────────────────────────────────
      // (P1 de la auditoría externa, 16-ago-2026.) La persistencia ya
      // ocurrió ANTES del código de salida (el inbox general): con la
      // palanca abajo aquí no se procesa nada — las filas durables esperan
      // al cron `wa-pendientes`, que las drena cuando la palanca suba.
      if (await estaApagado('global')) {
        logger.warn('wa.entrante_apagado', {
          mensajes: permitidos.length,
          ids: permitidos.map((m) => m.waMessageId),
        });
        await flushObservabilidad();
        return;
      }

      // ── PROCESAR RECLAMANDO LA FILA DURABLE (inbox general) ─────────────
      // Cada mensaje se procesa SOLO si esta invocación gana el claim de su
      // fila (mismo mecanismo del cron — si el cron ya la tomó, aquí es un
      // no-op). Éxito sella `procesado_en`; fallo anota el error y la fila
      // queda para el reintento del cron. Si la invocación muere a media
      // corrida, nada se pierde: lo no sellado lo recupera el cron.
      //
      // Y SOLO SE SELLA LO QUE DE VERDAD TERMINÓ (auditoría 18, A3/A27):
      // `processInbound` ya no devuelve `void`. 'sin_tiempo' (la invocación
      // no tiene presupuesto para empezarlo), 'en_curso' (otra invocación lo
      // tiene) y 'reintentable' (se abandonó por un fallo nuestro) NO se
      // sellan: se anota el motivo y el cron lo reintenta. Antes cualquier
      // retorno sin excepción sellaba `procesado_en`, incluido el 'duplicado'
      // de un claim huérfano de una invocación muerta — el mensaje quedaba
      // "procesado" sin haber corrido el OCR.
      await conPool(filasDurables, MAX_EN_PARALELO, async (f) => {
        try {
          const claim = await reclamarPendiente(f.id, 0);
          if (!claim) return; // el cron (u otra entrega) ya lo tiene.
          try {
            const resultado = await processInbound(claim.evento, { inicioInvocacionMs: inicioInvocacion });
            if (quedoPendiente(resultado)) {
              logger.warn('wa.pendiente_pospuesto', { id: f.id, resultado });
              await anotarFalloPendiente(f.id, `pospuesto: ${resultado}`);
            } else {
              await marcarPendienteProcesado(f.id);
            }
          } catch (e) {
            await anotarFalloPendiente(f.id, e instanceof Error ? e.message : String(e));
            // `codigo` (AUDITORÍA 18, M14): sin él este catch era UN solo issue
            // de Sentry para todos los fallos de procesamiento de todas las
            // flotas, para siempre — la causa nueva no notificaba.
            logger.error('processInbound', { id: f.id, err: e instanceof Error ? e.message : String(e), codigo: codigoDeError(e) });
          }
        } catch (e) {
          // Ni el claim se pudo leer: la fila sigue pendiente y el cron la
          // recupera — se anota y no se tumba el pool.
          logger.error('wa.claim_fallo', { id: f.id, err: e instanceof Error ? e.message : String(e) });
        }
      });

      // AL OPERADOR YA NO SE LE DICE NADA, y eso es parte del arreglo. El aviso
      // anterior —«espera un minuto y reenvíamelos»— describía una pérdida que
      // ya no ocurre, y le pedía trabajo que no hace falta: sus fotos vuelven
      // solas con la reentrega de Meta. Peor todavía, invitaba a mandar otra vez
      // el mismo fajo, que es lo que llena la ventana del rate limit por
      // segunda vez. Lo que queda es el `wa.ratelimit_diferido` de arriba, con
      // su `waMessageId`.

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

  // ── EL CÓDIGO DE SALIDA ES LA COLA ────────────────────────────────────────
  //
  // 200 = «esto quedó, no lo vuelvas a mandar». Es la afirmación que convertía
  // cada mensaje pasado de techo en una pérdida definitiva. Mientras quede algo
  // sin atender se contesta 429: es literalmente lo que pasó (demasiadas
  // peticiones de ese teléfono para esta invocación) y es el mismo código con
  // el que el repo ya contesta sus otros topes (`export-fiscal`).
  //
  // `Retry-After` va como declaración de cuándo tiene sentido volver —la
  // ventana del limitador es de 60 s—, no como promesa de que Meta lo lea:
  // Meta no documenta honrarlo. Lo que sí está documentado, y es de lo que
  // depende este arreglo, es que un webhook sin 2xx se vuelve a entregar.
  //
  // LO QUE CUESTA: la reentrega trae el payload COMPLETO, así que los acuses de
  // entrega de arriba se vuelven a registrar (`wa.no_entregado`/`wa.estado`
  // repetidos para el mismo wamid). Son líneas de log, no efectos: no hay
  // escritura ni envío colgando de ellas. Un comprobante recuperado vale más
  // que un log limpio.
  if (diferidos.length) {
    return NextResponse.json(
      { received: permitidos.length, diferidos: diferidos.length, estados: estados.length },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
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
          /** UNIX en SEGUNDOS, como string. Es la hora en que META recibió el
           *  mensaje, no la nuestra (DAT-38). Ver `extractMessages`. */
          timestamp?: string;
          text?: { body: string };
          // `caption` es el rótulo que el chofer escribe AL PIE de la foto —
          // la única señal determinística de qué papel es ("carta porte",
          // "se me ponchó una llanta, son 800"). Meta lo manda dentro del
          // objeto image y hasta el 14-ago-2026 se tiraba aquí.
          image?: { id: string; caption?: string };
          document?: { id: string };
          // El pin de "Compartir ubicación" (F-Ruta, 17-ago-2026): el chofer
          // en emergencia manda su posición y el sistema la registra y se la
          // pasa al jefe. Meta la manda como `type: 'location'`.
          location?: { latitude?: number; longitude?: number };
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
        // ── DAT-38 · LA HORA DEL MENSAJE ES LA DE META, NO LA NUESTRA ──────
        //
        // Meta manda `timestamp` (UNIX en segundos) en cada mensaje y aquí se
        // tiraba. La diferencia no es cosmética: entre que el chofer aprieta
        // enviar y que este código corre pueden pasar los reintentos de Meta,
        // el aplazamiento del rate limit y hasta cinco minutos de la bandeja
        // durable. Los hitos del viaje («llegué», «descargando», «de regreso»)
        // se sellaban con `new Date()` — la hora de PROCESAMIENTO— y el acuse
        // le decía al chofer «anotado: llegaste a las 14:32» sobre una hora que
        // él no vivió. Es un dato de operación que la flota va a cruzar contra
        // la bitácora del cliente.
        //
        // Se valida antes de creerle: un `timestamp` que no es un número
        // razonable no puede sustituir a un reloj que sí funciona.
        const ts = Number(m.timestamp);
        const timestampMs = Number.isFinite(ts) && ts > 0 ? ts * 1000 : undefined;
        const base = { from: m.from, waMessageId: m.id, timestampMs };
        if (m.type === 'text' && m.text) out.push({ ...base, type: 'text', text: m.text.body });
        // El caption viaja como `text` del mensaje de imagen: `InboundMessage`
        // ya tiene el campo y el processor decide con él (POD/talacha, F4).
        // `|| undefined` para que un caption vacío no se distinga de ninguno.
        else if (m.type === 'image' && m.image) out.push({ ...base, type: 'image', mediaId: m.image.id, text: m.image.caption || undefined });
        else if (m.type === 'document' && m.document) out.push({ ...base, type: 'document', mediaId: m.document.id });
        // UBICACIÓN → lat/lng planos. Solo con AMBAS coordenadas numéricas:
        // un pin a medias no es una posición, es ruido.
        else if (m.type === 'location' && typeof m.location?.latitude === 'number' && typeof m.location?.longitude === 'number') {
          out.push({ ...base, type: 'location', lat: m.location.latitude, lng: m.location.longitude });
        }
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
