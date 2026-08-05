import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { facturarAlVuelo, type ResultadoAutofactura } from '@/lib/cuadra/facturacion/al_vuelo';
import { armar } from '@/lib/cuadra/facturacion/pendientes';
import { getFiscalDeFlota } from '@/lib/cuadra/facturacion/flota_fiscal';
import { conPortales, PORTALES_CONOCIDOS } from '@/lib/cuadra/facturacion/adaptadores/registro';
import { conNavegador } from '@/lib/cuadra/facturacion/adaptadores/pagina_playwright';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Un lote abre UN navegador por flota y una sesión de portal por ticket: 10-60 s
// cada una. El presupuesto es para eso, y por eso el lote va acotado (ver
// TOPE_POR_CORRIDA).
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
// ── HOY NO HAY CHROMIUM EN VERCEL, Y ESTA RUTA LO DICE EN ROJO ───────────
//
// `playwright-core` no trae el binario y el contenedor de la función no tiene la
// caché de Playwright: `chromium.launch()` falla con "Executable doesn't exist"
// hasta que `CUADRA_CHROMIUM_PATH` apunte a un Chromium empaquetado para
// serverless. Cuando eso pasa esta ruta responde **503**, no 200, y NO marca los
// tickets como intentados: se recogen enteros en la corrida en que sí se pueda.
// Un 200 con la lista vacía dejaría el cron verde en el panel de Vercel para
// siempre, que es el modo de fallo que este archivo existe para no tener.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cuántos tickets por corrida.
 *
 * A 60 s el peor caso, ocho llenan el presupuesto de 300 s con margen. Lo que
 * no entra queda para la siguiente corrida, una hora después — y eso se DICE en
 * la respuesta: un tope que no se anuncia se lee como "ya se facturó todo", que
 * es la lectura más cara posible.
 */
const TOPE_POR_CORRIDA = 8;

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

  try {
    const { data, error } = await supabaseAdmin()
      .from('gasto')
      .select('id, tenant_id, concepto, monto, fecha, folio, rfc_emisor, cfdi_uuid, ocr_extra')
      .is('cfdi_uuid', null)
      .not('ocr_extra', 'is', null)
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
    }> = [];

    const correr = async (g: FilaCola) => {
      // Se vuelve a leer el gasto dentro de `facturarAlVuelo` a propósito: es el
      // único sitio que decide si se emite y el único que escribe el UUID. Entre
      // esta consulta y el intento pudo facturarlo otro camino (la pantalla de
      // "por facturar", el cierre del viaje), y la segunda lectura es lo que
      // impide emitir un segundo CFDI por el mismo ticket.
      const r = await facturarAlVuelo({ gastoId: g.id, tenantId: g.tenant_id, modo, hoy });
      resultados.push({ gastoId: g.id, tenantId: g.tenant_id, comercio: comercioDe.get(g.id) ?? null, ...r });
    };

    // ── 1. Lo que no necesita navegador. Se despacha primero: si Chromium no
    // arranca, este trabajo YA quedó hecho y su sello puesto, así que la cola
    // avanza aunque la parte de portales no se pueda correr todavía.
    for (const g of sinPortal) await correr(g);

    // ── 2. Una flota, un navegador, su registro de portales.
    let falloDeArranque: string | null = null;
    let sinIntentar = 0;

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
            });
            // EN SERIE, no en paralelo. Varias pestañas a la vez contra el mismo
            // portal agotan la memoria de la función y, peor, se parecen a un
            // ataque desde el lado del portal — que responde bloqueando la IP.
            // El orden es el del agrupamiento: todos los de un portal seguidos.
            for (const g of tickets) await correr(g);
          });
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
          '`playwright-core` no trae el binario y el contenedor de la función no tiene la caché de Playwright: hay que poner en `CUADRA_CHROMIUM_PATH` la ruta a un Chromium empaquetado para serverless (@sparticuz/chromium o equivalente), o cambiar a un navegador remoto por CDP.',
        error: falloDeArranque,
        portalesConocidos: PORTALES_CONOCIDOS,
        // Lo que sí se alcanzó a hacer sin navegador, para que el 503 no se lea
        // como "no pasó nada".
        intentados: resultados.length,
        facturados,
        sinIntentar,
        quedaron,
        flotas,
        detalle: resultados,
      }, { status: 503 });
    }

    logger.info('cron.facturar.ok', { modo, intentados: resultados.length, facturados, quedaron, flotas: flotas.length });

    return NextResponse.json({
      corrio: true,
      modo,
      portalesConocidos: PORTALES_CONOCIDOS,
      intentados: resultados.length,
      facturados,
      quedaron,
      // Por flota: qué portales quedaron operables y qué le falta a la que no.
      // Es lo que dice si el problema se arregla configurando al cliente o
      // tocando código.
      flotas,
      // El detalle va en la respuesta: "requiere_cuenta" o "confianza_baja" por
      // ticket es lo que dice si el problema se arregla configurando o mirando.
      detalle: resultados,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error('cron.facturar.falló', { error });
    return NextResponse.json({ error }, { status: 500 });
  }
}
