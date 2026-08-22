import { NextResponse } from 'next/server';
import { Client as QstashClient } from '@upstash/qstash';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { facturarAlVuelo, facturarLoteAlVuelo, type ResultadoAutofactura } from '@/lib/likida/facturacion/al_vuelo';
import { armar } from '@/lib/likida/facturacion/pendientes';
import { getFiscalDeFlota } from '@/lib/likida/facturacion/flota_fiscal';
import { avisarPorFacturar } from '@/lib/likida/facturacion/avisar';
import { telefonoJefeDe } from '@/lib/likida/contactos';
import { conPortales, PORTALES_CONOCIDOS, portalesOperables, pilotoHabilitado } from '@/lib/likida/facturacion/adaptadores/registro';
import { credencialesDePortales } from '@/lib/likida/facturacion/cuentas';
import { conNavegador } from '@/lib/likida/facturacion/adaptadores/pagina_playwright';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';
import { avisar, avisarCorridasPorFlota, FalloDePlataforma } from '@/lib/likida/agentes/notificaciones';
import { avisoColaAtorada } from '@/lib/correo/avisos';
import { registrarCorrida, ultimasCorridas } from '@/lib/likida/agentes/corridas';
import { modoEfectivo } from '@/lib/likida/facturacion/modo';
import { leerInterruptor, type NombreInterruptor } from '@/lib/likida/interruptores';
import { hoyMx } from '@/lib/formato';
import { acotada } from '@/lib/likida/presupuesto';

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
/** Flotas por corrida del cron (cada 15 min): 25 × 20 = 500 tickets/corrida,
 *  2,000/hora, contra ~340/día en el peor caso medido. */
const FLOTAS_POR_CORRIDA = 25;
/** Filas que se leen para armar los lotes. < 1,000: PostgREST recorta ahí. */
const TOPE_CANDIDATOS = LOTE_POR_FLOTA * FLOTAS_POR_CORRIDA;
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

/** `maxDuration` de arriba, en milisegundos — la MISMA constante, no una copia. */
const PRESUPUESTO_LOTE_MS = maxDuration * 1000;

/**
 * Colchón sobre el presupuesto de la invocación antes de abrir la SIGUIENTE
 * sesión de navegador.
 *
 * Antes de este arreglo, el comentario de `TOPE_POR_CORRIDA` decía "a 60 s el
 * peor caso, ocho llenan 300 s con margen" — 8 × 60 s = 480 s, 180 s de MÁS. El
 * auditor de rendimiento lo encontró (`docs/auditoria-10/rendimiento.md`,
 * hallazgo ALTO): el peor caso medido de UNA sola sesión de portal —un ticket,
 * sumando cada tope de `pagina_playwright.ts` y `capufe.ts`— es ~147 s. Con
 * solo DOS flotas en ese escenario ya se rebasan los 300 s, y el `for` de
 * flotas no consultaba el reloj antes de abrir el siguiente navegador.
 *
 * Ahora sí lo consulta: antes de cada `conNavegador` nuevo, si ya pasaron
 * `PRESUPUESTO_LOTE_MS - MARGEN_LOTE_MS` = 150 s desde que arrancó la
 * invocación, el lote se corta AHÍ —no se abre la sesión— y lo que falta queda
 * SIN marcar como intentado, para la corrida siguiente (mismo principio que
 * `falloDeArranque` usa para un Chromium que no arranca).
 *
 * AUDITORÍA 12, ALTO (rendimiento): el margen anterior (60 s) era menos de la
 * mitad del peor caso de UNA sesión (~147 s sumando cada tope de
 * `pagina_playwright.ts`/`capufe.ts`), así que una sesión podía arrancar a
 * t=239.9 s y ser matada por Vercel a los 300 s, a media sesión — en modo
 * `emitir`, con el CFDI ya timbrado sin que `cfdi_uuid` se alcance a escribir.
 * El margen ahora cubre el peor caso de la sesión que YA está abierta: la
 * nueva no se abre si quedan menos de 150 s, y la que corre tiene espacio
 * para terminar y responder.
 */
const MARGEN_LOTE_MS = 150_000;

/** Una fila de `gasto` como la trae la consulta de la cola. */
export interface FilaCola {
  id: string;
  tenant_id: string;
  concepto: string;
  monto: number;
  fecha: string | null;
  folio: string | null;
  rfc_emisor: string | null;
  cfdi_uuid: string | null;
  ocr_extra: Record<string, unknown> | null;
}

interface Renglon extends ResultadoAutofactura {
  gastoId: string;
  tenantId: string;
  comercio: string | null;
}

/**
 * El aviso al encargado por lo que la máquina ya no va a intentar sola.
 *
 * Reusa `avisarPorFacturar` —el mismo mensaje, la misma plantilla, la misma
 * bitácora— en vez de escribir un segundo canal de avisos: lo que hace que un
 * ticket bloqueado entre en ese mensaje es `enrutar()`, que ahora lo manda por
 * 'mensaje' con el motivo. Aquí solo se decide A QUIÉN y CUÁNDO.
 *
 * NUNCA tumba la corrida: para cuando esto se llama, todo lo que había que
 * facturar ya se facturó y se guardó. Un WhatsApp que no salió es un aviso
 * perdido —y se dice en la respuesta—, no una corrida perdida.
 */
async function avisarALasPersonas(
  bloqueadosPorFlota: Map<string, Array<{ gastoId: string; motivo: string }>>,
  hoy: string,
): Promise<Array<{ tenantId: string; enviado: boolean; tickets?: number; motivo?: string }>> {
  const avisos: Array<{ tenantId: string; enviado: boolean; tickets?: number; motivo?: string }> = [];

  for (const [tenantId] of bloqueadosPorFlota) {
    try {
      const telefono = await telefonoJefeDe(tenantId);
      if (!telefono) {
        // No es un fallo del envío: es una flota sin encargado ni dueño con
        // teléfono. Se dice con esas palabras porque el arreglo es capturarlo,
        // no reintentar.
        logger.warn('cron.facturar.sin_a_quien_avisar', { tenant: tenantId });
        avisos.push({ tenantId, enviado: false, motivo: 'esa flota no tiene encargado ni dueño con teléfono registrado, así que no hay a quién avisarle' });
        continue;
      }
      const r = await avisarPorFacturar({ tenantId, telefono, hoy });
      avisos.push({ tenantId, enviado: r.enviado, tickets: r.tickets, motivo: r.motivo });
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      logger.error('cron.facturar.aviso_fallo', { tenant: tenantId, error: motivo });
      avisos.push({ tenantId, enviado: false, motivo });
    }
  }
  return avisos;
}

/**
 * LA CAPTURA VIAJA SOLO SI SE PIDE, Y SIEMPRE SE DICE QUE EXISTE.
 *
 * En `ensayo` —el modo por defecto— la captura es la ÚNICA evidencia de qué se
 * habría enviado: un ensayo sin ella solo dice que ningún selector reventó, no
 * que el RFC haya quedado en el campo del RFC. Así que no se tira.
 *
 * Pero es un data-uri de ~120 KB por sesión, y ocho en un JSON de respuesta son
 * ~1 MB que además acaba en los logs de Vercel. Regla:
 *
 *   · es una RUTA en disco (`LIKIDA_CAPTURAS_DIR` puesto, que es lo que uno
 *     quiere en la Mac para poder mirar el .jpg) → viaja siempre, pesa nada.
 *   · es un data-uri → viaja solo con `?captura=1`, y si no, se dice su tamaño
 *     y cómo pedirla. Una evidencia que existe y no se anuncia es una evidencia
 *     que nadie va a buscar.
 */
function sinCapturas(renglones: Renglon[], req: Request): unknown[] {
  const pedidas = new URL(req.url).searchParams.get('captura') === '1';
  return renglones.map((r) => {
    if (!r.captura || pedidas || !r.captura.startsWith('data:')) return r;
    const { captura, ...resto } = r;
    return {
      ...resto,
      capturaKb: Math.round(captura.length / 1024),
      capturaComoVerla: 'vuelve a llamar con ?captura=1 para que venga el JPEG, o pon LIKIDA_CAPTURAS_DIR para que se escriba en disco',
    };
  });
}

export async function GET(req: Request) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    logger.error('cron.facturar.sin_secreto', {});
    return NextResponse.json({ error: 'CRON_SECRET no está configurado.' }, { status: 500 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secreto}`) {
    return new NextResponse(null, { status: 401 });
  }

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
    return NextResponse.json({ corrio: false, saltado: `interruptor ${apagadoPor}` });
  }

  // Sin un solo portal escrito no hay nada que este cron pueda hacer, y se dice
  // con todas sus letras. Callarlo dejaría un cron en verde dando la impresión
  // de que la facturación automática está corriendo.
  if (PORTALES_CONOCIDOS.length === 0) {
    logger.warn('cron.facturar.sin_adaptadores', {});
    return NextResponse.json({
      corrio: false,
      motivo: 'No hay ningún adaptador de portal escrito, así que no se puede facturar nada solo todavía.',
      pendientes: null,
    });
  }

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
    const conQstash = Boolean(process.env.UPSTASH_QSTASH_TOKEN);
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
      const porFlota = new Map<string, FilaCola[]>();
      for (const g of todos) {
        const lote = porFlota.get(g.tenant_id) ?? [];
        if (lote.length < LOTE_POR_FLOTA) lote.push(g);
        porFlota.set(g.tenant_id, lote);
      }
      const flotas = [...porFlota.entries()].slice(0, FLOTAS_POR_CORRIDA);
      // La región del token (QSTASH_URL, p. ej. https://qstash-us-east-1.upstash.io):
      // sin ella el cliente global rutearía a otra región y el publish fallaría.
      const q = new QstashClient({
        token: process.env.UPSTASH_QSTASH_TOKEN,
        baseUrl: process.env.QSTASH_URL ?? undefined,
      });
      const base = process.env.NEXT_PUBLIC_APP_URL ?? `https://${req.headers.get('host')}`;
      const ranura = Math.floor(inicioLote / RANURA_DEDUP_MS);
      const encolados: Array<{ tenantId: string; messageId: string; tickets: number }> = [];
      const sinEncolar: Array<{ tenantId: string; tickets: number; error: string }> = [];
      const candidatos = flotas.reduce((n, [, l]) => n + l.length, 0);
      // Lo que NO viaja en esta corrida, medido contra el backlog real.
      const quedaron = backlog === null ? null : Math.max(0, backlog - candidatos);

      for (const [tenantId, lote] of flotas) {
        try {
          const publicacion = await conTope(q.publishJSON({
            url: `${base}/api/cron/facturar/cola`,
            body: { lote, quedaron: quedaron ?? 0 },
            retries: 2,
            // El MISMO presupuesto que la función que lo procesa (`cola/route.ts`).
            timeout: maxDuration,
            deduplicationId: `facturar-${tenantId}-${ranura}`,
          }), TOPE_PUBLICACION_MS, 'qstash.publish');
          encolados.push({ tenantId, messageId: publicacion.messageId, tickets: lote.length });
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          logger.error('cron.facturar.encolado_fallo', { tenant: tenantId, tickets: lote.length, err });
          sinEncolar.push({ tenantId, tickets: lote.length, error: err });
        }
      }

      if (encolados.length === 0) {
        // QStash no contestó para NADIE: falla-cerrado al camino síncrono con
        // el lote de siempre, en vez de perder la corrida entera.
        const lote = todos.slice(0, TOPE_POR_CORRIDA);
        return procesarLoteEnCola(lote, req, hoy, inicioLote, backlog === null ? Math.max(0, todos.length - lote.length) : Math.max(0, backlog - lote.length));
      }

      const tickets = encolados.reduce((n, m) => n + m.tickets, 0);
      logger.info('cron.facturar.encolado', { flotas: encolados.length, tickets, backlog, quedaron, sinEncolar: sinEncolar.length });
      if (sinEncolar.length > 0) {
        await alertarOperador('cron.facturar', { error: `QStash no aceptó ${sinEncolar.length} de ${flotas.length} lotes`, codigo: 'encolado_parcial' });
      }
      return NextResponse.json({
        corrio: true,
        encolado: true,
        flotas: encolados.length,
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
    return NextResponse.json({ error }, { status: 500 });
  }
}

// ── El procesamiento del lote (compartido: cron síncrono y callback QStash) ──
// Extraído del GET (ronda 16). La MISMA lógica; el callback de QStash corre con
// su propio presupuesto (10 min) sin el techo de 300s de una invocación directa.
/**
 * Cuántos tickets intentó y cuántos facturó CADA flota, con el desglose de
 * por qué no procedieron (RES-21).
 *
 * El desglose es de motivos, no de tickets: "requiere_cuenta ×7" dice qué
 * hacer; siete líneas de `info` iguales, no.
 */
function medirPorFlota(renglones: Renglon[]): Map<string, { intentados: number; facturados: number; motivos: Record<string, number> }> {
  const m = new Map<string, { intentados: number; facturados: number; motivos: Record<string, number> }>();
  for (const r of renglones) {
    const f = m.get(r.tenantId) ?? { intentados: 0, facturados: 0, motivos: {} };
    if (r.intentado) f.intentados += 1;
    if (r.facturado) f.facturados += 1;
    if (r.motivo) f.motivos[r.motivo] = (f.motivos[r.motivo] ?? 0) + 1;
    m.set(r.tenantId, f);
  }
  return m;
}

export async function procesarLoteEnCola(
  lote: FilaCola[],
  req: Request,
  hoy: string,
  inicioLote: number,
  quedaron: number,
): Promise<NextResponse> {
  // D7 (auditoría 4): el modo que se REPORTA pasa por `modoEfectivo`, no por
  // process.env a secas. Con FACTURACION_MODO=emitir y el mandato sin aceptar,
  // el cron corría en ensayo (bien) y su JSON y su log decían "emitir"
  // (mintiendo sobre su propio estado). Ahora dice el modo con el que de
  // verdad va a correr — el mismo que decide `conNavegador`.
  const modo = modoEfectivo(process.env.FACTURACION_MODO === 'emitir' ? 'emitir' : 'ensayo');

  // Cómo le fue a CADA flota que alcanzó turno. El éxito SÍ se registra: es lo
  // que rearma el filo del anti-ruido (`avisarCorridasPorFlota`). Las que se
  // quedaron sin presupuesto de tiempo NO entran — no fallaron, no les tocó;
  // la corrida de la siguiente hora las levanta enteras.
  //
  // FUERA del `try` a propósito: el cierre se manda desde el `finally`, y ahí
  // esta variable tiene que estar viva incluso cuando el lote reventó — que es
  // justo el caso en que el aviso importa.
  const corridas = new Map<string, unknown>();
  const inicioCorrida = new Date();
  /** Flota → los gastos que ESTA corrida sacó de la cola automática. FUERA del
   *  `try` por la misma razón que `corridas`: el aviso de cola atorada (B2) se
   *  manda desde el `finally`, y un lote que reventó a la mitad ya pudo haber
   *  bloqueado tickets — esos siguen esperando a una persona aunque la corrida
   *  muera. Cada entrada nace con al menos un gasto (`anotarBloqueo`). */
  const bloqueadosPorFlota = new Map<string, Array<{ gastoId: string; motivo: string }>>();
  /** RES-21: cómo le fue a cada ticket. FUERA del `try` por lo mismo que
   *  `corridas`: la medición por flota se cierra desde el `finally`, y una
   *  corrida que revienta a la mitad ya intentó tickets que hay que contar. */
  const resultados: Renglon[] = [];

  try {
    // ── Agrupar: flota → portal → tickets. El portal sale de `armar()`, que es
    // la MISMA función con la que `al_vuelo.ts` reconoce el comercio; derivarlo
    // aquí por otro camino sería tener dos opiniones sobre a qué portal va un
    // ticket, y la del cron mandaría el lote al navegador equivocado.
    const porFlota = new Map<string, Map<string, FilaCola[]>>();
    const sinPortal: FilaCola[] = [];
    const comercioDe = new Map<string, string | null>();
    // Escritos + pilotables (si la palanca del piloto está puesta). Mirar solo
    // los escritos con el piloto encendido despacharía "sin navegador" tickets
    // que la máquina sí va a intentar.
    const operables = portalesOperables();

    for (const g of lote) {
      const clave = armar(g, hoy).comercio?.clave ?? null;
      comercioDe.set(g.id, clave);
      if (!clave || !operables.includes(clave)) {
        sinPortal.push(g);
        continue;
      }
      const porPortal = porFlota.get(g.tenant_id) ?? new Map<string, FilaCola[]>();
      porPortal.set(clave, [...(porPortal.get(clave) ?? []), g]);
      porFlota.set(g.tenant_id, porPortal);
    }

    const flotas: Array<{
      tenantId: string;
      tickets: number;
      registrados?: string[];
      problemas?: string[];
      falta?: string[];
      /** Cuántas SESIONES de portal se abrieron, contra cuántos tickets. */
      sesiones?: number;
    }> = [];
    const correr = async (g: FilaCola) => {
      // Se vuelve a leer el gasto dentro de `facturarAlVuelo` a propósito: es el
      // único sitio que decide si se emite y el único que escribe el UUID. Entre
      // esta consulta y el intento pudo facturarlo otro camino (la pantalla de
      // "por facturar", el cierre del viaje), y la segunda lectura es lo que
      // impide emitir un segundo CFDI por el mismo ticket.
      const r = await facturarAlVuelo({ gastoId: g.id, tenantId: g.tenant_id, modo, hoy });
      resultados.push({ gastoId: g.id, tenantId: g.tenant_id, comercio: comercioDe.get(g.id) ?? null, ...r });
      if (r.bloqueado) anotarBloqueo(g.tenant_id, g.id, r.bloqueado);
    };

    const anotarBloqueo = (tenantId: string, gastoId: string, motivo: string) => {
      bloqueadosPorFlota.set(tenantId, [...(bloqueadosPorFlota.get(tenantId) ?? []), { gastoId, motivo }]);
    };

    /**
     * TODOS los tickets de un portal, en UNA sesión.
     *
     * Es el cambio de esta ronda y la razón por la que existe `facturarLoteAlVuelo`:
     * antes esto era `for (const g of tickets) await correr(g)`, o sea una sesión
     * de portal por ticket. En CAPUFE eso son ocho veces los datos fiscales, ocho
     * veces los dos catálogos por AJAX (~1.2 s cada vez) y —lo que de verdad
     * importa— ocho sesiones idénticas seguidas contra el mismo portal, que es el
     * patrón que hace que un portal empiece a pedir CAPTCHA.
     *
     * El adaptador que no sepa hacer lotes NO se queda atrás: `facturarLoteConAgente`
     * lo llama ticket por ticket y devuelve la misma forma. El cron no pregunta.
     */
    const correrLote = async (tenantId: string, comercio: string, tickets: FilaCola[]) => {
      const r = await facturarLoteAlVuelo({
        tenantId, comercio, gastoIds: tickets.map((g) => g.id), modo, hoy,
      });
      for (const p of r.porGasto) {
        resultados.push({ tenantId, comercio, ...p });
      }
      for (const b of r.bloqueados) anotarBloqueo(tenantId, b.gastoId, b.motivo);
    };

    // ── 1. Lo que no necesita navegador. Se despacha primero: si Chromium no
    // arranca, este trabajo YA quedó hecho y su sello puesto, así que la cola
    // avanza aunque la parte de portales no se pueda correr todavía.
    for (const g of sinPortal) await correr(g);

    // ── 2. Una flota, un navegador, su registro de portales.
    let falloDeArranque: string | null = null;
    let sinIntentar = 0;
    /** Tickets con flota y portal listos, que no se intentaron porque ya no
     *  quedaba tiempo para otra sesión de navegador completa. */
    let sinTiempo = 0;

    for (const [tenantId, porPortal] of porFlota) {
      const tickets = [...porPortal.values()].flat();

      if (falloDeArranque) {
        // Ya se sabe que no hay navegador. No se vuelve a intentar arrancarlo ni
        // se marcan estos tickets: quedan enteros para la corrida en que se pueda.
        // SÍ cuenta como corrida fallida para ESTA flota, aunque el error se
        // haya descubierto en otra: su agente no pudo trabajar, y ése es
        // exactamente el hecho que el aviso existe para contar. El anti-ruido
        // lo topa en 3 correos por incidente, no uno por flota por hora.
        // Va MARCADO como fallo de plataforma (B8): Chromium es infraestructura
        // de Likida, y el correo de la flota tiene que decir «el problema es
        // nuestro, tu información está bien», no mandarla a revisar sus datos.
        corridas.set(tenantId, new FalloDePlataforma(falloDeArranque));
        sinIntentar += tickets.length;
        flotas.push({ tenantId, tickets: tickets.length, falta: ['no se intentó: el navegador no arrancó'] });
        continue;
      }

      const { flota, falta } = await getFiscalDeFlota(tenantId);
      if (!flota) {
        // Sin datos fiscales no se abre navegador: el portal los pide antes que
        // nada y el intento terminaría igual, con un Chromium gastado de más.
        // Los tickets SÍ se despachan —`facturarAlVuelo` los sella y reporta— para
        // que no vuelvan a acaparar el lote de la próxima corrida.
        logger.warn('cron.facturar.flota_sin_datos_fiscales', { tenant: tenantId, falta: falta.join('; ') });
        flotas.push({ tenantId, tickets: tickets.length, falta });
        for (const g of tickets) await correr(g);
        // La corrida SÍ terminó: lo que falta son los datos fiscales de la
        // flota, que es un hueco de captura y no un agente caído. Llamarlo
        // «corrida fallida» mandaría a alguien a revisar logs de un agente
        // que funciona.
        corridas.set(tenantId, null);
        continue;
      }

      // EL PRESUPUESTO DE TIEMPO: no abrir una sesión que no le va a dar tiempo.
      // Se comprueba AQUÍ, ya con datos fiscales confirmados, para no cortar una
      // flota que de todos modos no iba a abrir navegador. Mismo principio que
      // `falloDeArranque`: lo que no alcanza a intentarse NO se marca, y se
      // recoge entero en la corrida siguiente.
      if (Date.now() - inicioLote >= PRESUPUESTO_LOTE_MS - MARGEN_LOTE_MS) {
        sinTiempo += tickets.length;
        logger.warn('cron.facturar.sin_tiempo', { tenant: tenantId, tickets: tickets.length });
        flotas.push({ tenantId, tickets: tickets.length, falta: ['no se intentó: no quedaba presupuesto de tiempo en esta corrida'] });
        continue;
      }

      // POR FLOTA, no global: si el navegador de la primera abrió y el de la
      // segunda no, lo de la segunda sigue siendo un fallo de arranque. Con una
      // bandera compartida ese caso se reportaría como 500 y los tickets de la
      // segunda quedarían marcados como intentados sin haberlo sido.
      // Las cuentas de portal compartidas, para el piloto de visión. Solo se
      // leen con la palanca puesta: sin piloto nadie las consume, y el
      // descifrado de credenciales no se pasea por gusto.
      const cuentas = pilotoHabilitado() ? await credencialesDePortales(tenantId) : undefined;

      let arranco = false;
      try {
        await conNavegador(async (abrirPagina) => {
          arranco = true;
          await conPortales({ flota, abrirPagina, cuentas }, async (registro) => {
            flotas.push({
              tenantId,
              tickets: tickets.length,
              registrados: registro.registrados,
              problemas: registro.problemas,
              // Un portal, una sesión. Es el número que dice si el lote sirvió
              // de algo: ocho tickets de CAPUFE tienen que salir con `sesiones: 1`.
              sesiones: porPortal.size,
            });
            // EN SERIE, no en paralelo. Varias pestañas a la vez contra el mismo
            // portal agotan la memoria de la función y, peor, se parecen a un
            // ataque desde el lado del portal — que responde bloqueando la IP.
            //
            // AUDITORÍA 12, ALTO: el corte de :406 era POR FLOTA, no por
            // sesión de portal — una flota con 2+ portales distintos podía
            // consumir ~294 s en UN solo `conNavegador` sin ningún corte
            // interno y morir en la tercera sesión. Aquí se consulta el reloj
            // ANTES de cada portal nuevo (excepto el primero: el navegador ya
            // está abierto y su sesión ya se pagó — procesar el portal
            // principal de la flota es siempre mejor que no procesar nada). Lo
            // que no alcanza a intentarse NO se marca, y se recoge entero en
            // la corrida siguiente.
            let primerPortal = true;
            for (const [comercio, delPortal] of porPortal) {
              if (!primerPortal && Date.now() - inicioLote >= PRESUPUESTO_LOTE_MS - MARGEN_LOTE_MS) {
                sinTiempo += delPortal.length;
                logger.warn('cron.facturar.sin_tiempo_portal', { tenant: tenantId, comercio, tickets: delPortal.length });
                break;
              }
              primerPortal = false;
              await correrLote(tenantId, comercio, delPortal);
            }
          });
        }, {
          // En la Mac se escriben los JPEG y `captura()` devuelve la RUTA, que
          // es lo que hace falta para MIRAR qué se habría enviado. En Vercel no
          // se pone: `/tmp` no sobrevive a la invocación, así que ahí la captura
          // vuelve a ser el data-uri y viaja con `?captura=1`.
          pagina: process.env.LIKIDA_CAPTURAS_DIR
            ? { directorioCapturas: process.env.LIKIDA_CAPTURAS_DIR }
            : undefined,
        });
        corridas.set(tenantId, null);
      } catch (e) {
        const detalle = e instanceof Error ? e.message : String(e);
        if (arranco) throw e; // el navegador sí abrió: es otro fallo, sube

        // `conNavegador` arranca Chromium ANTES de correr el cuerpo, así que si
        // el cuerpo nunca se ejecutó, lo que falló fue el arranque — o sea la
        // PLATAFORMA de Likida, no los datos de la flota. La marca (B8) es lo
        // que hace que el correo diga la verdad sobre de quién es el problema.
        falloDeArranque = detalle;
        corridas.set(tenantId, new FalloDePlataforma(detalle));
        sinIntentar += tickets.length;
        flotas.push({ tenantId, tickets: tickets.length, falta: ['no se intentó: el navegador no arrancó'] });
      }
    }


    const facturados = resultados.filter((r) => r.facturado).length;

    if (falloDeArranque) {
      logger.error('cron.facturar.sin_navegador', { error: falloDeArranque, sinIntentar });
      return NextResponse.json({
        corrio: false,
        modo,
        motivo:
          'No se pudo arrancar Chromium, así que los tickets de portal NO se intentaron y quedan sin marcar para la próxima corrida. ' +
          'El campo `error` trae los TRES caminos que se probaron para conseguir el binario, en orden: la ruta explícita ' +
          '(`LIKIDA_CHROMIUM_PATH`), el paquete serverless (`@sparticuz/chromium`, que descomprime el suyo en /tmp) y la caché ' +
          'local de Playwright. Si el que falla es el serverless, lo primero que hay que mirar es si sus `bin/*.br` viajaron en ' +
          'el bundle de esta función (`outputFileTracingIncludes` en `next.config.ts`). La otra salida es un navegador remoto por CDP.',
        error: falloDeArranque,
        portalesConocidos: PORTALES_CONOCIDOS,
        // Lo que sí se alcanzó a hacer sin navegador, para que el 503 no se lea
        // como "no pasó nada".
        intentados: resultados.length,
        facturados,
        sinIntentar,
        sinTiempo,
        quedaron,
        flotas,
        detalle: sinCapturas(resultados, req),
      }, { status: 503 });
    }

    // ── 3. LO QUE YA NO LO HACE LA MÁQUINA, LO HACE UNA PERSONA.
    //
    // Aquí se cierra la señal de CAPTCHA. `pideCaptcha()` existía desde el
    // adaptador y no la consumía nadie: un portal que pide CAPTCHA se veía como
    // un fallo más en el detalle del cron, y la hora siguiente se volvía a
    // intentar contra el mismo muro. Ahora esos gastos salieron de la cola
    // (`autofactura_bloqueada_en`), `enrutar()` los manda con el encargado y
    // esto es lo que lo despierta.
    //
    // SOLO CUANDO ALGO SE BLOQUEÓ EN ESTA CORRIDA, no cada hora mientras siga
    // bloqueado: el cron corre 24 veces al día y un aviso repetido de lo mismo
    // enseña a ignorar el canal — que es justo lo que no puede pasar con el
    // canal por el que también llegan los tickets que vencen.
    const avisos = await avisarALasPersonas(bloqueadosPorFlota, hoy);

    // RES-21: el desglose de motivos va en el log de cierre. Sin él, la única
    // huella de por qué no se facturó nada eran N líneas de `info` sueltas.
    const motivos: Record<string, number> = {};
    for (const r of resultados) if (r.motivo) motivos[r.motivo] = (motivos[r.motivo] ?? 0) + 1;
    logger.info('cron.facturar.ok', { modo, intentados: resultados.length, facturados, quedaron, sinTiempo, flotas: flotas.length, motivos });

    return NextResponse.json({
      corrio: true,
      modo,
      portalesConocidos: PORTALES_CONOCIDOS,
      intentados: resultados.length,
      facturados,
      quedaron,
      // Flotas con portal listo que no se intentaron porque ya no quedaba
      // presupuesto de tiempo en esta corrida. Se recogen enteras la próxima —
      // ver MARGEN_LOTE_MS.
      sinTiempo,
      // Por flota: qué portales quedaron operables y qué le falta a la que no.
      // Es lo que dice si el problema se arregla configurando al cliente o
      // tocando código.
      flotas,
      // Los que salieron de la cola automática, y si el aviso a la persona salió.
      bloqueados: [...bloqueadosPorFlota].map(([tenantId, b]) => ({ tenantId, cuantos: b.length, detalle: b })),
      avisos,
      // El detalle va en la respuesta: "requiere_cuenta" o "confianza_baja" por
      // ticket es lo que dice si el problema se arregla configurando o mirando.
      detalle: sinCapturas(resultados, req),
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    // Mismo criterio que el catch del GET: código estable para el fingerprint
    // y alerta al operador. El fallo duro típico aquí cruza flotas (`if
    // (arranco) throw e` propaga fuera del bucle), así que tampoco hay UN
    // tenant que emitir sin mentir sobre el alcance.
    const codigo = codigoDeError(e);
    logger.error('cron.facturar.falló', { error, codigo });
    await alertarOperador('cron.facturar', { error, codigo });
    return NextResponse.json({ error }, { status: 500 });
  } finally {
    // ── EN `finally`, Y ÉSA ES LA CORRECCIÓN ────────────────────────────────
    //
    // Estaba después del bucle de flotas, que es donde parece que va y no va.
    // El camino de fallo duro de este cron —`if (arranco) throw e`, cuando el
    // navegador SÍ abrió y la sesión del portal revienta a media escritura—
    // propaga fuera del bucle y salta al catch de arriba: el aviso nunca
    // corría. O sea que el ÚNICO fallo que de verdad merecía el correo «el
    // agente no pudo trabajar» era exactamente el que lo silenciaba.
    //
    // Peor que no avisar: también se perdían los cierres de las flotas que SÍ
    // terminaron bien en ese lote, así que sus rachas quedaban sin re-armar.
    // Y QStash reintenta 2 veces sobre 5xx, de modo que el silencio se repetía
    // tres veces.
    //
    // `avisarCorridasPorFlota` nunca propaga, así que ponerlo en el `finally`
    // no puede convertir una corrida buena en un 500 — que es la única razón
    // por la que un `finally` daría miedo aquí.
    await avisarCorridasPorFlota('facturas', corridas);

    // ── RES-21: LA SEÑAL DE "INTENTA Y NO FACTURA NADA" ────────────────────
    //
    // `autofactura.no_procede` se queda en `info` a propósito: es de alto
    // volumen y por ticket, y subirlo a warn convertiría el canal de alertas
    // en el log de una cosa normal. Lo que faltaba era la señal AGREGADA — el
    // hecho de que una flota lleve corridas enteras intentando sin timbrar
    // una sola factura, que es como se ve desde fuera un adaptador roto.
    //
    // TRES CORRIDAS SEGUIDAS, no una: una corrida sin facturar es rutina
    // (tickets que no proceden, un portal caído un rato). Tres seguidas ya no.
    //
    // SOLO EN `emitir`: en `ensayo` —el modo por defecto— facturados=0 con
    // intentados>0 es EXACTAMENTE lo que tiene que pasar, y avisarlo sería
    // gritar por el funcionamiento correcto.
    const medido = medirPorFlota(resultados);
    for (const [tenantId, m] of medido) {
      if (modo !== 'emitir' || m.facturados > 0 || m.intentados === 0) continue;
      try {
        // Las DOS anteriores; la tercera es ésta, que todavía no se registra.
        const previas = await ultimasCorridas(tenantId, 'facturas', 2);
        const secas = previas.filter((c) => {
          const r = (c.resumen ?? {}) as { intentados?: number; facturados?: number };
          return typeof r.intentados === 'number' && r.intentados > 0 && r.facturados === 0;
        });
        if (previas.length >= 2 && secas.length === 2) {
          logger.warn('cron.facturar.sin_facturar_3_corridas', {
            tenant: tenantId, intentados: m.intentados, motivos: m.motivos,
          });
        }
      } catch (e) {
        // Una lectura del historial no puede tumbar el cierre de la corrida.
        logger.warn('cron.facturar.historial_ilegible', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
      }
    }
    // La bitácora de corridas (B3), en el MISMO finally y por la misma razón:
    // el fallo duro es exactamente la corrida que más merece quedar anotada.
    // Sin conteo de tareas por flota aquí (los renglones son por portal, no
    // por flota): tareas null, y la ficha pinta «—», no un 0/0 inventado.
    await Promise.allSettled([...corridas.entries()].map(([tenant, err]) =>
      registrarCorrida(tenant, 'facturas', {
        inicio: inicioCorrida,
        fin: new Date(),
        estado: err ? 'fallo' : 'ok',
        disparo: 'cron',
        // RES-21: el resumen deja de ir vacío. Intentados/facturados y el
        // desglose de motivos son lo que hace legible un `no_procede` que
        // vive en `info`, y lo que la corrida siguiente lee para saber si
        // ésta es la tercera seca seguida.
        resumen: medido.get(tenant) as Record<string, unknown> | undefined,
        // La ficha también distingue el origen (B8): un fallo de plataforma no
        // manda a nadie a revisar la información de la flota.
        error: err
          ? (err instanceof FalloDePlataforma
            ? 'La plataforma de Likida tuvo un problema y esta corrida no se pudo completar. La información de la flota está bien; se reintenta solo.'
            : 'La corrida de facturación de esta flota no se pudo completar. El detalle quedó en los registros del sistema.')
          : undefined,
      })));

    // ── LA COLA ATORADA DE FACTURAS (B2, auditoría 4) ──────────────────────
    //
    // `avisoColaAtorada` existía desde el 14-ago sin un solo llamador; éste es
    // su primer emisor real, y SOLO para Facturas: los tickets que ESTA
    // corrida bloqueó (`requiere_cuenta`, CAPTCHA, emisión sin confirmar)
    // salieron de la cola automática y esperan a una persona — exactamente lo
    // que el evento existe para contar. La magnitud es MEDIDA (cuántos bloqueó
    // esta corrida) y `diasSinBajar` va en `null` porque es la verdad: no hay
    // serie histórica de esta cola, y la plantilla lo maneja sin inventar días.
    //
    // SOLO cuando algo se bloqueó en esta corrida, igual que el WhatsApp de
    // `avisarALasPersonas`: una corrida sin bloqueos nuevos no sabe si la cola
    // vieja ya la atendió una persona, así que tampoco cierra el incidente por
    // ella. El anti-ruido (marcas de insistencia y piso de una hora) vive en
    // `avisar` — aquí no se duplica nada de eso.
    //
    // `avisar` promete no lanzar, pero la corrida no cuelga de esa promesa:
    // una invariante que solo aguanta fallos por valor no es una invariante
    // (el mismo criterio del emisor de `escalado` en escalar_viaje.ts).
    for (const [tenantId, bloqueados] of bloqueadosPorFlota) {
      try {
        await avisar(
          tenantId, 'facturas', 'cola_atorada',
          { hayProblema: true, magnitud: bloqueados.length },
          // El nombre y la ruta salen del catálogo vía `avisar` (d.agente,
          // d.ruta) — el mismo patrón que `avisarCorridaFallida`.
          (d) => avisoColaAtorada({
            flota: d.flota,
            agente: d.agente,
            href: d.ruta,
            cuantos: bloqueados.length,
            diasSinBajar: null,
          }),
        );
      } catch (e) {
        logger.error('cron.facturar.aviso_cola_roto', {
          tenant: tenantId, err: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }
}
