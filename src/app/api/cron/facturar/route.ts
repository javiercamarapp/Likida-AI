import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { facturarAlVuelo, facturarLoteAlVuelo, type ResultadoAutofactura } from '@/lib/cuadra/facturacion/al_vuelo';
import { armar } from '@/lib/cuadra/facturacion/pendientes';
import { getFiscalDeFlota } from '@/lib/cuadra/facturacion/flota_fiscal';
import { avisarPorFacturar } from '@/lib/cuadra/facturacion/avisar';
import { telefonoJefeDe } from '@/lib/cuadra/contactos';
import { conPortales, PORTALES_CONOCIDOS } from '@/lib/cuadra/facturacion/adaptadores/registro';
import { conNavegador } from '@/lib/cuadra/facturacion/adaptadores/pagina_playwright';
import { logger } from '@/lib/logger';

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
 * `PRESUPUESTO_LOTE_MS - MARGEN_LOTE_MS` = 240 s desde que arrancó la
 * invocación, el lote se corta AHÍ —no se abre la sesión— y lo que falta queda
 * SIN marcar como intentado, para la corrida siguiente (mismo principio que
 * `falloDeArranque` usa para un Chromium que no arranca). 60 s de colchón: menos
 * de la mitad del peor caso de una sesión, pero de sobra para que la que YA
 * está abierta termine de escribir sus resultados y la ruta alcance a
 * responder.
 */
const MARGEN_LOTE_MS = 60_000;

/** Una fila de `gasto` como la trae la consulta de la cola. */
interface FilaCola {
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
 *   · es una RUTA en disco (`CUADRA_CAPTURAS_DIR` puesto, que es lo que uno
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
      capturaComoVerla: 'vuelve a llamar con ?captura=1 para que venga el JPEG, o pon CUADRA_CAPTURAS_DIR para que se escriba en disco',
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

  const modo = process.env.FACTURACION_MODO === 'emitir' ? 'emitir' as const : 'ensayo' as const;

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

  const hoy = new Date().toISOString().slice(0, 10);
  // Arranca AQUÍ, no dentro del `try`: es el reloj contra el que se mide
  // MARGEN_LOTE_MS, y tiene que cubrir la consulta de la cola también.
  const inicioLote = Date.now();

  try {
    const { data, error } = await supabaseAdmin()
      .from('gasto')
      .select('id, tenant_id, concepto, monto, fecha, folio, rfc_emisor, cfdi_uuid, ocr_extra')
      .is('cfdi_uuid', null)
      .not('ocr_extra', 'is', null)
      // LOS BLOQUEADOS NO ENTRAN (mig. 0065). Un portal que pidió CAPTCHA, o una
      // emisión que no se pudo confirmar, no se arreglan reintentando: el
      // primero daría lo mismo cada hora, y el segundo emitiría un SEGUNDO CFDI
      // por el mismo consumo. Salen por el otro camino —el aviso al encargado,
      // más abajo— y siguen visibles en la pantalla de "por facturar".
      .is('autofactura_bloqueada_en', null)
      // EL ORDEN DE LA 0063. Los nunca intentados primero y después los más
      // antiguos: sin esto, ocho tickets que no proceden se llevan el lote en
      // cada corrida y los nuevos no entran nunca.
      .order('autofactura_intentada_en', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: true })
      .limit(TOPE_POR_CORRIDA + 1); // uno de más, solo para saber si sobró

    if (error) throw new Error(error.message);

    const todos = (data ?? []) as FilaCola[];
    const lote = todos.slice(0, TOPE_POR_CORRIDA);
    const quedaron = Math.max(0, todos.length - lote.length);

    // ── Agrupar: flota → portal → tickets. El portal sale de `armar()`, que es
    // la MISMA función con la que `al_vuelo.ts` reconoce el comercio; derivarlo
    // aquí por otro camino sería tener dos opiniones sobre a qué portal va un
    // ticket, y la del cron mandaría el lote al navegador equivocado.
    const porFlota = new Map<string, Map<string, FilaCola[]>>();
    const sinPortal: FilaCola[] = [];
    const comercioDe = new Map<string, string | null>();

    for (const g of lote) {
      const clave = armar(g, hoy).comercio?.clave ?? null;
      comercioDe.set(g.id, clave);
      if (!clave || !PORTALES_CONOCIDOS.includes(clave)) {
        sinPortal.push(g);
        continue;
      }
      const porPortal = porFlota.get(g.tenant_id) ?? new Map<string, FilaCola[]>();
      porPortal.set(clave, [...(porPortal.get(clave) ?? []), g]);
      porFlota.set(g.tenant_id, porPortal);
    }

    const resultados: Renglon[] = [];
    const flotas: Array<{
      tenantId: string;
      tickets: number;
      registrados?: string[];
      problemas?: string[];
      falta?: string[];
      /** Cuántas SESIONES de portal se abrieron, contra cuántos tickets. */
      sesiones?: number;
    }> = [];
    /** Flota → los gastos que ESTA corrida sacó de la cola automática. */
    const bloqueadosPorFlota = new Map<string, Array<{ gastoId: string; motivo: string }>>();

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
      let arranco = false;
      try {
        await conNavegador(async (abrirPagina) => {
          arranco = true;
          await conPortales({ flota, abrirPagina }, async (registro) => {
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
            for (const [comercio, delPortal] of porPortal) {
              await correrLote(tenantId, comercio, delPortal);
            }
          });
        }, {
          // En la Mac se escriben los JPEG y `captura()` devuelve la RUTA, que
          // es lo que hace falta para MIRAR qué se habría enviado. En Vercel no
          // se pone: `/tmp` no sobrevive a la invocación, así que ahí la captura
          // vuelve a ser el data-uri y viaja con `?captura=1`.
          pagina: process.env.CUADRA_CAPTURAS_DIR
            ? { directorioCapturas: process.env.CUADRA_CAPTURAS_DIR }
            : undefined,
        });
      } catch (e) {
        const detalle = e instanceof Error ? e.message : String(e);
        if (arranco) throw e; // el navegador sí abrió: es otro fallo, sube

        // `conNavegador` arranca Chromium ANTES de correr el cuerpo, así que si
        // el cuerpo nunca se ejecutó, lo que falló fue el arranque.
        falloDeArranque = detalle;
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
          '(`CUADRA_CHROMIUM_PATH`), el paquete serverless (`@sparticuz/chromium`, que descomprime el suyo en /tmp) y la caché ' +
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

    logger.info('cron.facturar.ok', { modo, intentados: resultados.length, facturados, quedaron, sinTiempo, flotas: flotas.length });

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
    logger.error('cron.facturar.falló', { error });
    return NextResponse.json({ error }, { status: 500 });
  }
}
