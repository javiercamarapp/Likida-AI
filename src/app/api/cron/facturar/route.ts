import { NextResponse } from 'next/server';
import { Client as QstashClient } from '@upstash/qstash';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { armar } from '@/lib/likida/facturacion/pendientes';
import { PORTALES_CONOCIDOS } from '@/lib/likida/facturacion/adaptadores/registro';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';
import { puertaCron, registrarLatido, leerLatido } from '@/lib/admin/salud';
import { appUrl } from '@/lib/env';
import { leerInterruptor, type NombreInterruptor } from '@/lib/likida/interruptores';
import { hoyMx } from '@/lib/formato';
import { acotada } from '@/lib/likida/presupuesto';
import { procesarLoteEnCola, type FilaCola } from './lote';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Un lote abre UN navegador por flota y una sesión de portal por ticket: 10-60 s
// en el caso típico, hasta ~147 s en el peor caso medido (arranque de Chromium +
// navegar + los campos fiscales + validar + leer + capturar, cada paso a su
// propio tope en pagina_playwright.ts/capufe.ts). TOPE_POR_CORRIDA limita
// CUÁNTOS TICKETS entran a la cola, pero no CUÁNTAS FLOTAS —y por tanto cuántos
// navegadores— entran en un lote: ocho tickets de ocho flotas distintas son ocho
// sesiones independientes, y esas SÍ rebasan los 300 s de aquí abajo. Por eso el
// `for` de flotas (más abajo) comprueba el reloj contra MARGEN_LOTE_MS antes de
// abrir cada navegador nuevo, y corta el lote ahí en vez de dejar que Vercel mate
// la invocación a medio camino.
// LITERAL, no una referencia: Next exige un literal estático para leer este
// valor en build (`cola/route.test.ts` lo lee del FUENTE con una regex por
// la misma razón). `lote.ts` declara `TOPE_DURACION_S` con el MISMO número
// para derivar `PRESUPUESTO_LOTE_MS` — si uno cambia, cambia el otro.
export const maxDuration = 300;

// ═══════════════════════════════════════════════════════════════════════════
// FACTURAR LOS TICKETS PENDIENTES, FUERA DEL WEBHOOK.
//
// ── POR QUÉ NO VA EN EL PROCESADOR DE FOTOS ──────────────────────────────
//
// Era el plan original —facturar en cuanto llega la foto— y se descartó al
// medir. El webhook de WhatsApp contesta 200 rápido y procesa en `after()` con
// 120 s COMPARTIDOS por toda la ráfaga. Facturar mete un NAVEGADOR REAL en un
// portal: 10-60 s por ticket. Con cinco fotos seguidas ese presupuesto revienta,
// y lo que se pierde no es la factura: es el procesamiento de las fotos, que es
// el camino del que depende la liquidación.
//
// ── ESTO ES LA RED DE SEGURIDAD, NO EL CAMINO PRINCIPAL ──────────────────
//
// El camino principal es al CERRAR el viaje, agrupando por portal. La razón
// salió de mirar el portal de CAPUFE, no de teoría: pide los datos fiscales UNA
// vez y luego acepta N códigos en la misma sesión. Ocho casetas de un viaje son
// ~128 s de navegador en memoria de una en una, contra ~48 s en una sola
// sesión. Lo caro es ABRIR el navegador, no llenar el campo.
//
// Y hay una razón mejor que el costo: al cierre, los montos dudosos ya pasaron
// por el botón de confirmación del chofer (`acuse_ticket.ts`). Facturar al
// instante es facturar una lectura de OCR que nadie validó, y el portal lo
// advierte en rojo en su propia página: una vez emitida no se corrige.
//
// Este cron recoge lo que se quedó suelto: viajes que no cerraron, portales que
// estaban caídos, tickets que llegaron tarde. Cada hora basta — el plazo real
// son 7-15 días en gasolineras y el mes fiscal en casetas. Correr cada 2
// minutos sería 720 invocaciones diarias casi todas vacías, y como los tickets
// llegan de uno en uno, cada uno abriría su propio navegador: el caso caro,
// repetido setecientas veces.
//
// ── CÓMO SE ARMA UN LOTE: POR FLOTA, Y DENTRO POR PORTAL ─────────────────
//
// 1. Se toman los gastos sin CFDI ordenados por `autofactura_intentada_en nulls
//    first, created_at` — el índice de la 0063. Ese orden es lo que impide que
//    los mismos ocho tickets que NO proceden se re-elijan en cada corrida y
//    bloqueen la cola contra sí misma.
// 2. Se agrupan POR FLOTA y, dentro de cada flota, POR PORTAL.
// 3. Los que no tienen portal automatizable se despachan SIN NAVEGADOR: no hay
//    a dónde entrar, y arrancar Chromium para descubrirlo cuesta segundos.
// 4. Por cada flota con trabajo de portal se abre UN Chromium
//    (`conNavegador`) y se registran SUS adaptadores (`conPortales`). Todos sus
//    tickets comparten ese navegador; sin esto era uno por ticket.
//
// UN NAVEGADOR POR FLOTA Y NO UNO PARA LA CORRIDA: `SesionNavegador` comparte un
// solo BrowserContext entre sus pestañas —o sea las cookies—. Que CAPUFE
// reconozca la sesión entre códigos es deseable DENTRO de una flota y es
// exactamente lo que no se quiere entre dos: el portal podría recordar el RFC
// de la anterior.
//
// ── EL MODO POR DEFECTO ES ENSAYO, Y NO SE CAMBIA DESDE EL CÓDIGO ────────
//
// Emitir un CFDI es IRREVERSIBLE ante el SAT: cancelarlo fuera de plazo se le
// queda al cliente en su contabilidad. Un cron corriendo solo, sin nadie
// mirando, es justo donde un selector equivocado emite cincuenta facturas malas
// antes de que alguien se entere. Se emite SOLO si `FACTURACION_MODO=emitir`
// está puesto a mano en el ambiente — una decisión de Javier, no un default.
//
// ── SI CHROMIUM NO ARRANCA, ESTA RUTA LO DICE EN ROJO ────────────────────
//
// `playwright-core` no trae el binario y el contenedor de la función no tiene la
// caché de Playwright. El binario lo pone `@sparticuz/chromium`, y
// `resolverEjecutable()` prueba tres orígenes en orden —ruta explícita, paquete
// serverless, caché local— antes de rendirse. Cuando ninguno da, el error que
// sube trae LOS TRES INTENTOS con su motivo, y esta ruta responde **503**, no
// 200, y NO marca los tickets como intentados: se recogen enteros en la corrida
// en que sí se pueda. Un 200 con la lista vacía dejaría el cron verde en el
// panel de Vercel para siempre, que es el modo de fallo que este archivo existe
// para no tener.
//
// ── EL LOTE SE CORTA POR RELOJ, NO SE ESTIRA HASTA QUE VERCEL MATE LA FUNCIÓN ─
//
// TOPE_POR_CORRIDA acota tickets, no sesiones de navegador: ocho tickets de
// ocho flotas distintas son ocho navegadores, y a ~147 s el peor caso de UNA
// sesión, dos flotas ya rebasan `maxDuration`. Si Vercel mata la invocación A
// MEDIO CAMINO de una sesión de portal en modo `emitir`, el CFDI puede haber
// quedado timbrado en el SAT sin que `cfdi_uuid` se alcanzara a escribir de
// vuelta — el claim expira en `CLAIM_MINUTOS` y ese mismo ticket vuelve a la
// cola arriesgando una segunda emisión. Por eso el `for` de flotas comprueba el
// reloj contra MARGEN_LOTE_MS antes de CADA `conNavegador` nuevo: si no alcanza
// el tiempo para otra sesión completa, el lote se corta ahí, esa flota queda
// SIN marcar (`sinTiempo`) para la corrida siguiente, y la respuesta lo dice.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cuántos tickets por corrida, no cuántas sesiones de navegador.
 *
 * Ocho tickets de LA MISMA flota comparten un navegador y caben con margen.
 * Pero si esos ocho pertenecen a ocho flotas distintas —posible: son 96
 * empresas censadas como prospecto, y basta que unas pocas operen ya con 1-2
 * tickets pendientes cada una—, son ocho sesiones independientes, y ningún
 * valor de TOPE_POR_CORRIDA arregla eso solo: lo que de verdad frena el lote a
 * tiempo es MARGEN_LOTE_MS, abajo. Lo que no entra en la cola, o lo que sí
 * entró pero no alcanzó tiempo, queda para la corrida siguiente, una hora
 * después — y eso se DICE en la respuesta (`quedaron`, `sinTiempo`): un tope
 * que no se anuncia se lee como "ya se facturó todo", la lectura más cara
 * posible.
 */
const TOPE_POR_CORRIDA = 8;

// ═══════════════════════════════════════════════════════════════════════════
// ESC-5 (auditoría prod): UN MENSAJE DE QSTASH POR FLOTA, NO UN LOTE DE 8.
//
// Con TOPE_POR_CORRIDA=8 y el cron cada hora, el techo era 192 tickets/día
// contra ~170-340 sueltos/día a 50k tickets/mes: la cola crecía sin que nada
// lo dijera, porque `limit(9)` solo sabía si "sobró uno". Ahora:
//
//   · El cron corre cada 15 min (`vercel.json`) y NO procesa: cuenta el
//     backlog real (`count` head) y encola UN mensaje por flota con hasta
//     LOTE_POR_FLOTA tickets. Cada mensaje = un navegador = una sesión por
//     portal, en su propia invocación de 300 s. Veinte tickets de CAPUFE en
//     una sesión son ~2 min; el reloj de `procesarLoteEnCola` sigue cortando.
//   · El backlog se MIDE (count exact, head) y viaja en la respuesta como
//     `backlog` y `quedaron`. Un tope que no se anuncia se lee como "ya se
//     facturó todo".
//   · Sin UPSTASH_QSTASH_TOKEN (la Mac, los tests) queda el camino síncrono
//     de siempre con TOPE_POR_CORRIDA.
// ═══════════════════════════════════════════════════════════════════════════

/** Tickets por mensaje de QStash — o sea por navegador. */
const LOTE_POR_FLOTA = 20;
/**
 * SESIONES por corrida del cron (cada 15 min): 25 × 20 = 500 tickets/corrida.
 *
 * AUDITORÍA 24, REN-5: esto era «flotas por corrida» y el mensaje de QStash
 * iba por FLOTA. ESC-5 lo diseñó para muchas flotas chicas; una flota grande
 * (Innovativos: 15,000 viajes/mes ⇒ ~500 tickets/día) necesita paralelismo
 * DENTRO de la flota. Con un mensaje por flota, sus 20 tickets de tres
 * portales iban en UN navegador que abre las sesiones en serie y corta a los
 * 150 s: 2-5 tickets reales por corrida ⇒ 192-480/día contra 500 — la cola
 * solo crecía. Ahora el mensaje va por (flota, portal): cada uno es su
 * propio navegador en su propia invocación, y una flota con tres portales
 * ocupa tres sesiones en paralelo. El tope de 25 es de sesiones, no de flotas.
 */
const SESIONES_POR_CORRIDA = 25;
/** Filas que se leen para armar los lotes. < 1,000: PostgREST recorta ahí. */
const TOPE_CANDIDATOS = LOTE_POR_FLOTA * SESIONES_POR_CORRIDA;
/** REN-5: el backlog que ya no es «una hora cargada». Dos días de la demanda
 *  del piloto (500 tickets/día): pasar de aquí es que la cola no drena, y
 *  eso se avisa al operador en vez de dejarlo en un número del JSON. */
const BACKLOG_ALERTA = 1_000;

/**
 * AUDITORÍA 24, BE-6 (ALTO): UNA sola variable decidía «hay QStash» y el
 * callback exige TRES. Con `UPSTASH_QSTASH_TOKEN` puesto y una signing key
 * ausente o rotada, cada 15 min se publicaban 25 lotes, el latido decía `ok`
 * y los callbacks contestaban 503: cero CFDI hasta que los tickets salían de
 * la ventana de 45 días. La condición es la MISMA que la de `cola/route.ts`:
 * si no está completa, no se encola — se factura aquí, síncrono.
 */
function qstashConfigurado(): 'completo' | 'a_medias' | 'sin' {
  const token = process.env.UPSTASH_QSTASH_TOKEN;
  const actual = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const siguiente = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (token && actual && siguiente) return 'completo';
  if (token || actual || siguiente) return 'a_medias';
  return 'sin';
}
/** Periodo de la cola: un ticket con más de 45 días no se factura en ningún
 *  portal (el plazo más largo es el mes natural). Mismo criterio que
 *  `DIAS_VENTANA_POR_FACTURAR` en pendientes.ts (ESC-12). */
const DIAS_VENTANA_COLA = 45;
/** RES-23: `publishJSON` no tiene tope propio; un QStash colgado se comería
 *  los 300 s del cron sin encolar nada. */
const TOPE_PUBLICACION_MS = 10_000;
/** Ranura del `deduplicationId`: Vercel Cron entrega at-least-once, y dos
 *  disparos del mismo cuarto de hora deben encolar UNA vez por flota. */
const RANURA_DEDUP_MS = 15 * 60_000;

/** Un tope de reloj sobre una promesa que no sabe abortarse. */
async function conTope<T>(p: Promise<T>, ms: number, etiqueta: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rechazar) => { t = setTimeout(() => rechazar(new Error(`${etiqueta}: sin respuesta en ${ms} ms`)), ms); }),
    ]);
  } finally {
    clearTimeout(t);
  }
}

export async function GET(req: Request) {
  // La puerta común (RES-7): el secreto ausente ALERTA (antes solo se
  // logueaba) y el 401 deja log con `codigo: 'cron_401'` — un secreto
  // desfasado entre Vercel y el proyecto se veía como un cron que nunca corre.
  const puerta = await puertaCron('facturar', req, 'La facturación no corre sin él.');
  if (puerta) return puerta;

  // ── EL KILL SWITCH (0110), DESPUÉS de la puerta y ANTES de tocar la cola ─
  //
  // Este cron entero ES el Agente de Facturas, así que dos palancas lo
  // apagan: 'global' (todo el trabajo programado) y 'agente:facturas' (solo
  // él). Responde 200, no error: apagado A PROPÓSITO no es un fallo, y un
  // 500 mandaría a alguien a investigar la decisión de Javier como si fuera
  // un incidente. El interruptor es GLOBAL por agente (v1), no por tenant:
  // el barrido por flota de `procesarLoteEnCola` se corta ENTERO — apagar
  // facturas para una sola flota sería config de esa flota, no esta palanca.
  // Fail-closed: si el interruptor no se puede LEER no se corre — emitir CFDIs
  // con la palanca ilegible es el error caro; saltar una corrida que reintenta
  // en una hora, el barato. AUDITORÍA 18, ALTO (A17): pero ese salto es un
  // FALLO y contesta 500 con `codigo`, no el 200 `saltado` del apagado a
  // propósito — si no, nueve días de base con hipo se ven como nueve días de
  // cron verde. El grito y el correo ya salieron de `leerInterruptor`.
  let apagadoPor: NombreInterruptor | null = null;
  for (const nombre of ['global', 'agente:facturas'] as const) {
    const lectura = await leerInterruptor(nombre);
    if (lectura === 'ilegible') {
      // El latido ANTES del 500 (tableros al día, 28-ago-2026): sin él este
      // camino era mudo y el tablero decía «No late» sin la causa. El nombre
      // de la palanca ilegible va en `cual`, NUNCA en `interruptor`: esa llave
      // del detalle es la que `motivoDeSalto()` lee como «apagado a propósito».
      await registrarLatido('facturar', 'fallo', { codigo: 'interruptor_ilegible', cual: nombre });
      return NextResponse.json({
        corrio: false,
        error: `No se pudo leer el interruptor ${nombre}: no se factura sin saber si está apagado.`,
        codigo: 'interruptor_ilegible',
        interruptor: nombre,
      }, { status: 500 });
    }
    if (lectura === 'apagado') { apagadoPor = nombre; break; }
  }
  if (apagadoPor) {
    logger.warn('cron.facturar.saltado', { interruptor: apagadoPor });
    // El latido (RES-7): saltarse una corrida A PROPÓSITO no es estar muerto,
    // y `/api/health` tiene que poder distinguir las dos cosas.
    await registrarLatido('facturar', 'saltado', { interruptor: apagadoPor });
    return NextResponse.json({ corrio: false, saltado: `interruptor ${apagadoPor}` });
  }

  // Sin un solo portal escrito no hay nada que este cron pueda hacer, y se dice
  // con todas sus letras. Callarlo dejaría un cron en verde dando la impresión
  // de que la facturación automática está corriendo.
  if (PORTALES_CONOCIDOS.length === 0) {
    logger.warn('cron.facturar.sin_adaptadores', {});
    // El latido con su motivo (tableros al día, 28-ago-2026): sin él, este
    // camino corría a diario sin dejar rastro y /admin/crons daba por MUERTO
    // a un cron que en realidad no tiene nada que hacer. `motivo` es la llave
    // que `motivoDeSalto()` traduce a la columna «Por qué».
    await registrarLatido('facturar', 'saltado', {
      motivo: 'no hay ningún adaptador de portal escrito — no hay nada que facturar solo',
    });
    return NextResponse.json({
      corrio: false,
      motivo: 'No hay ningún adaptador de portal escrito, así que no se puede facturar nada solo todavía.',
      pendientes: null,
    });
  }

  // El latido ya NO se escribe aquí (tableros al día, 28-ago-2026). Antes iba
  // un `registrarLatido('facturar','ok',{})` en este punto —«llegó a trabajar,
  // eso es el latido»— y el efecto era un OK mentiroso: un timeout de Vercel a
  // los 300 s o un 500 sin `throw` dejaban escrito «ok, hace 30 segundos» de
  // una corrida que no terminó. Ahora el latido va en cada salida terminal
  // (encolado, lote procesado, 503 de Chromium, catch) — como en los otros
  // nueve crons, el pulso afirma que la corrida TERMINÓ, y cómo.

    // RES-13 (auditoría prod): era `toISOString().slice(0, 10)` — el día UTC. De
  // las 18:00 a medianoche hora de México el cron ya vivía en "mañana": el
  // plazo de caducidad de cada ticket (`armar` → `calcularCaducidad`) se
  // calculaba con un día de más y un ticket vigente hasta hoy se trataba
  // como vencido seis horas antes de tiempo. El SAT, la flota y el portal
  // están todos en México: `hoyMx()`.
  const hoy = hoyMx();
  // Arranca AQUÍ, no dentro del `try`: es el reloj contra el que se mide
  // MARGEN_LOTE_MS, y tiene que cubrir la consulta de la cola también.
  const inicioLote = Date.now();

  try {
    const qstash = qstashConfigurado();
    const conQstash = qstash === 'completo';
    if (qstash === 'a_medias') {
      // BE-6 (a): se dice fuerte y se cae al camino síncrono. El síncrono
      // factura 8 por corrida — poco, pero no es cero en silencio.
      logger.error('cron.facturar.qstash_a_medias', {
        token: Boolean(process.env.UPSTASH_QSTASH_TOKEN),
        current: Boolean(process.env.QSTASH_CURRENT_SIGNING_KEY),
        next: Boolean(process.env.QSTASH_NEXT_SIGNING_KEY),
      });
      await alertarOperador('cron.facturar', {
        error: 'QStash está a medio configurar (falta UPSTASH_QSTASH_TOKEN, QSTASH_CURRENT_SIGNING_KEY o QSTASH_NEXT_SIGNING_KEY): la facturación corre síncrona, a 8 tickets por corrida, hasta que estén las tres.',
        codigo: 'qstash_config_incompleta',
      });
    }
    const desde = new Date(inicioLote - DIAS_VENTANA_COLA * 86_400_000).toISOString();
    /**
     * LOS FILTROS DE LA COLA, ESCRITOS UNA VEZ.
     *
     * El conteo del backlog y la lectura de candidatos tienen que medir
     * EXACTAMENTE lo mismo: si se separan, `quedaron` miente y el número que
     * existe para decir "la cola crece" es el primero en dejar de ser cierto.
     *
     * El periodo va sobre `created_at` y no sobre `fecha`: `fecha` es la del
     * ticket y viene NULL cuando el OCR no la pudo leer — filtrar por ella
     * dejaría esos tickets fuera de la cola PARA SIEMPRE, en silencio.
     */
    const enCola = <Q extends {
      is(columna: string, valor: null): Q;
      not(columna: string, operador: string, valor: null): Q;
      gte(columna: string, valor: string): Q;
    }>(q: Q): Q =>
      q
        .is('cfdi_uuid', null)
        .not('ocr_extra', 'is', null)
        // LOS BLOQUEADOS NO ENTRAN (mig. 0065). Un portal que pidió CAPTCHA, o
        // una emisión que no se pudo confirmar, no se arreglan reintentando: el
        // primero daría lo mismo cada corrida, y el segundo emitiría un SEGUNDO
        // CFDI por el mismo consumo. Salen por el otro camino —el aviso al
        // encargado— y siguen visibles en la pantalla de "por facturar".
        .is('autofactura_bloqueada_en', null)
        // ESC-5: el periodo. Un ticket de hace más de 45 días ya no lo factura
        // ningún portal (el plazo más largo es el mes natural), así que
        // arrastrarlo en cada corrida solo infla la cola con lo que nadie puede
        // bajar. Mismo criterio que DIAS_VENTANA_POR_FACTURAR (ESC-12).
        .gte('created_at', desde);

    // ── 1. EL BACKLOG REAL: cuántos esperan, no "si sobró uno".
    const conteo = await acotada(
      enCola(supabaseAdmin().from('gasto').select('id', { count: 'exact', head: true })),
      'cron.facturar.backlog',
    );
    const backlog = conteo.error || typeof conteo.count !== 'number' ? null : conteo.count;
    if (conteo.error) logger.warn('cron.facturar.backlog_sin_contar', { err: conteo.error.message });
    if (backlog !== null && backlog > BACKLOG_ALERTA) {
      // REN-5: la cola que no drena se avisa, no solo se mide.
      logger.error('cron.facturar.backlog_alto', { backlog, umbral: BACKLOG_ALERTA });
      await alertarOperador('cron.facturar', {
        error: `La cola de autofactura trae ${backlog} tickets pendientes (umbral ${BACKLOG_ALERTA} = dos días de la demanda del piloto): no está drenando.`,
        codigo: 'backlog_facturacion',
      });
    }

    // ── 2. Los candidatos, en el orden de la cola.
    const { data, error } = await acotada(
      enCola(supabaseAdmin()
        .from('gasto')
        .select('id, tenant_id, concepto, monto, fecha, folio, rfc_emisor, cfdi_uuid, ocr_extra'))
        // EL ORDEN DE LA 0063. Los nunca intentados primero y después los más
        // antiguos: sin esto, ocho tickets que no proceden se llevan el lote en
        // cada corrida y los nuevos no entran nunca.
        .order('autofactura_intentada_en', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: true })
        // Con QStash se leen hasta TOPE_CANDIDATOS para repartir por flota;
        // sin él, el lote síncrono de siempre (+1, solo para saber si sobró).
        .limit(conQstash ? TOPE_CANDIDATOS : TOPE_POR_CORRIDA + 1),
      'cron.facturar.cola',
    );

    if (error) throw new Error(error.message);

    const todos = (data ?? []) as FilaCola[];

    // ── 3. Despacho: un mensaje de QStash POR FLOTA, o síncrono.
    // El callback (POST /cola) procesa cada lote con su propio presupuesto;
    // esta invocación contesta en segundos. Sin token, el camino síncrono.
    if (conQstash && todos.length > 0) {
      // ── BE-6 (c): ¿EL CALLBACK PROCESÓ LO DE LA CORRIDA ANTERIOR? ──────
      //
      // El latido de este camino dice «encolé», y el del callback dice «procesé».
      // Si el último latido escrito sigue siendo el de «encolé» de hace 15 min,
      // NINGÚN callback latió desde entonces: QStash no entrega, o el callback
      // rebota (401 por llave rotada, 503 por config) antes de trabajar. Es la
      // muerte muda que la auditoría encontró: se cruza aquí, en el único
      // sitio que ve las dos mitades, y esta corrida factura SÍNCRONA (8
      // tickets, pero tickets) en vez de volver a encolar al vacío. Su latido
      // sale `parcial` con la causa, para que /api/health deje de estar en verde.
      let previo: Awaited<ReturnType<typeof leerLatido>> = null;
      try { previo = await leerLatido('facturar'); } catch (e) {
        logger.warn('cron.facturar.latido_previo_ilegible', { err: e instanceof Error ? e.message : String(e) });
      }
      if (previo?.detalle?.encolado === true) {
        logger.error('cron.facturar.cola_sin_procesar', {
          encoladoEn: previo.ultimoLatido, sesiones: previo.detalle.sesiones ?? previo.detalle.flotas, tickets: previo.detalle.tickets,
        });
        await alertarOperador('cron.facturar', {
          error: `Se encoló a QStash a las ${previo.ultimoLatido} y ningún callback procesó nada desde entonces: la cola de autofactura está muda (revisa las signing keys de QStash y la URL del callback). Esta corrida factura síncrona.`,
          codigo: 'cola_sin_procesar',
        });
        const lote = todos.slice(0, TOPE_POR_CORRIDA);
        const quedaron = backlog === null ? Math.max(0, todos.length - lote.length) : Math.max(0, backlog - lote.length);
        return procesarLoteEnCola(lote, req, hoy, inicioLote, quedaron, { parcialPor: 'cola_sin_procesar' });
      }

      // REN-5: un mensaje por (flota, portal). El portal sale de `armar()`, la
      // MISMA función con la que `procesarLoteEnCola` y `al_vuelo.ts` reconocen
      // el comercio — dos opiniones sobre a qué portal va un ticket mandarían
      // el lote al navegador equivocado. Lo que no tiene portal reconocido va
      // en su propio mensaje: se despacha sin navegador y no ocupa sesión.
      const porSesion = new Map<string, { tenantId: string; portal: string; lote: FilaCola[] }>();
      for (const g of todos) {
        const portal = armar(g, hoy).comercio?.clave ?? 'sin_portal';
        const clave = `${g.tenant_id}|${portal}`;
        const sesion = porSesion.get(clave) ?? { tenantId: g.tenant_id, portal, lote: [] };
        if (sesion.lote.length < LOTE_POR_FLOTA) sesion.lote.push(g);
        porSesion.set(clave, sesion);
      }
      const sesiones = [...porSesion.values()].slice(0, SESIONES_POR_CORRIDA);
      // La región del token (QSTASH_URL, p. ej. https://qstash-us-east-1.upstash.io):
      // sin ella el cliente global rutearía a otra región y el publish fallaría.
      const q = new QstashClient({
        token: process.env.UPSTASH_QSTASH_TOKEN,
        baseUrl: process.env.QSTASH_URL ?? undefined,
      });
      // BE-32: `appUrl()` es el ÚNICO accesor de la URL base (env.ts, guardia
      // A2), como en `wa-pendientes/drenado.ts`; el host de la petición queda
      // de red de seguridad para un preview sin env.
      const base = appUrl() || `https://${req.headers.get('host')}`;
      const ranura = Math.floor(inicioLote / RANURA_DEDUP_MS);
      const encolados: Array<{ tenantId: string; portal: string; messageId: string; tickets: number }> = [];
      const sinEncolar: Array<{ tenantId: string; portal: string; tickets: number; error: string }> = [];
      const candidatos = sesiones.reduce((n, s) => n + s.lote.length, 0);
      // Lo que NO viaja en esta corrida, medido contra el backlog real.
      const quedaron = backlog === null ? null : Math.max(0, backlog - candidatos);

      for (const { tenantId, portal, lote } of sesiones) {
        try {
          const publicacion = await conTope(q.publishJSON({
            url: `${base}/api/cron/facturar/cola`,
            body: { lote, quedaron: quedaron ?? 0 },
            retries: 2,
            // El MISMO presupuesto que la función que lo procesa (`cola/route.ts`).
            timeout: maxDuration,
            deduplicationId: `facturar-${tenantId}-${portal}-${ranura}`,
          }), TOPE_PUBLICACION_MS, 'qstash.publish');
          encolados.push({ tenantId, portal, messageId: publicacion.messageId, tickets: lote.length });
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          logger.error('cron.facturar.encolado_fallo', { tenant: tenantId, portal, tickets: lote.length, err });
          sinEncolar.push({ tenantId, portal, tickets: lote.length, error: err });
        }
      }

      if (encolados.length === 0) {
        // QStash no contestó para NADIE: falla-cerrado al camino síncrono con
        // el lote de siempre, en vez de perder la corrida entera.
        const lote = todos.slice(0, TOPE_POR_CORRIDA);
        return procesarLoteEnCola(lote, req, hoy, inicioLote, backlog === null ? Math.max(0, todos.length - lote.length) : Math.max(0, backlog - lote.length));
      }

      const tickets = encolados.reduce((n, m) => n + m.tickets, 0);
      const flotasEncoladas = new Set(encolados.map((m) => m.tenantId)).size;
      logger.info('cron.facturar.encolado', { sesiones: encolados.length, flotas: flotasEncoladas, tickets, backlog, quedaron, sinEncolar: sinEncolar.length });
      if (sinEncolar.length > 0) {
        await alertarOperador('cron.facturar', { error: `QStash no aceptó ${sinEncolar.length} de ${sesiones.length} lotes`, codigo: 'encolado_parcial' });
      }
      // El latido del camino encolado: la corrida del CRON terminó (encolar
      // era su trabajo); el resultado del lote lo latirá el callback de QStash
      // al procesar, por `procesarLoteEnCola`. Parcial si QStash rechazó lotes.
      // `encolado: true` es lo que la corrida siguiente cruza (BE-6 c): si
      // sigue ahí en 15 min, nadie procesó.
      await registrarLatido('facturar', sinEncolar.length > 0 ? 'parcial' : 'ok', {
        encolado: true, encoladoEn: new Date(inicioLote).toISOString(),
        sesiones: encolados.length, flotas: flotasEncoladas, tickets, sinEncolar: sinEncolar.length, backlog, quedaron,
      });
      return NextResponse.json({
        corrio: true,
        encolado: true,
        flotas: flotasEncoladas,
        // REN-5: sesiones de navegador encoladas — una por (flota, portal).
        sesiones: encolados.length,
        mensajes: encolados,
        // Las que no se pudieron encolar quedan SIN marcar: el siguiente cuarto
        // de hora las vuelve a leer enteras.
        sinEncolar,
        tickets,
        // El backlog MEDIDO al arrancar (null = no se pudo contar, y se dice).
        backlog,
        quedaron,
      });
    }

    const lote = todos.slice(0, TOPE_POR_CORRIDA);
    const quedaron = backlog === null
      ? Math.max(0, todos.length - lote.length)
      : Math.max(0, backlog - lote.length);
    return procesarLoteEnCola(lote, req, hoy, inicioLote, quedaron);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    // El `codigo` discrimina la causa en el fingerprint de Sentry ("base
    // caída" hoy y "cola malformada" mañana son issues DISTINTOS, o sea dos
    // notificaciones); la alerta va al operador del sistema porque los avisos
    // por tenant no cubren un fallo del cron entero. Aquí todavía no hay
    // flota en juego —el fallo es antes de armar el lote—, no hay tenant que
    // emitir.
    const codigo = codigoDeError(e);
    logger.error('cron.facturar.falló', { error, codigo });
    await alertarOperador('cron.facturar', { error, codigo });
    await registrarLatido('facturar', 'fallo', { codigo });
    return NextResponse.json({ error }, { status: 500 });
  }
}
