import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { facturarAlVuelo } from '@/lib/cuadra/facturacion/al_vuelo';
import { portalesAutomatizados } from '@/lib/cuadra/facturacion/agente';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Cada ticket abre un navegador contra un portal: 10-60 s. El presupuesto es
// para eso, y por eso el lote va acotado (ver TOPE_POR_CORRIDA).
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
// ── EL MODO POR DEFECTO ES ENSAYO, Y NO SE CAMBIA DESDE EL CÓDIGO ────────
//
// Emitir un CFDI es IRREVERSIBLE ante el SAT: cancelarlo fuera de plazo se le
// queda al cliente en su contabilidad. Un cron corriendo solo, sin nadie
// mirando, es justo donde un selector equivocado emite cincuenta facturas malas
// antes de que alguien se entere. Se emite SOLO si `FACTURACION_MODO=emitir`
// está puesto a mano en el ambiente — una decisión de Javier, no un default.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cuántos tickets por corrida.
 *
 * A 60 s el peor caso, ocho llenan el presupuesto de 300 s con margen. Lo que
 * no entra queda para la siguiente corrida, quince minutos después — y eso se
 * DICE en la respuesta: un tope que no se anuncia se lee como "ya se facturó
 * todo", que es la lectura más cara posible.
 */
const TOPE_POR_CORRIDA = 8;

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
  const portales = portalesAutomatizados();

  // Sin un solo adaptador registrado no hay nada que este cron pueda hacer, y se
  // dice con todas sus letras. Callarlo dejaría un cron en verde en el panel de
  // Vercel dando la impresión de que la facturación automática está corriendo.
  if (portales.length === 0) {
    logger.warn('cron.facturar.sin_adaptadores', {});
    return NextResponse.json({
      corrio: false,
      motivo: 'No hay ningún adaptador de portal registrado, así que no se puede facturar nada solo todavía.',
      pendientes: null,
    });
  }

  try {
    const { data, error } = await supabaseAdmin()
      .from('gasto')
      .select('id, tenant_id')
      .is('cfdi_uuid', null)
      .not('ocr_extra', 'is', null)
      .order('created_at', { ascending: true })
      .limit(TOPE_POR_CORRIDA + 1); // uno de más, solo para saber si sobró

    if (error) throw new Error(error.message);

    const todos = data ?? [];
    const lote = todos.slice(0, TOPE_POR_CORRIDA);
    const quedaron = Math.max(0, todos.length - lote.length);

    const resultados = [];
    for (const g of lote) {
      // EN SERIE, no en paralelo. Ocho navegadores a la vez contra portales
      // distintos agota la memoria de la función y, peor, se parece a un ataque
      // desde el lado del portal — que responde bloqueando la IP.
      const r = await facturarAlVuelo({
        gastoId: g.id as string,
        tenantId: g.tenant_id as string,
        modo,
      });
      resultados.push({ gastoId: g.id, ...r });
    }

    const facturados = resultados.filter((r) => r.facturado).length;
    logger.info('cron.facturar.ok', { modo, intentados: lote.length, facturados, quedaron });

    return NextResponse.json({
      corrio: true, modo, portales,
      intentados: lote.length, facturados, quedaron,
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
