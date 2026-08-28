import { NextResponse } from 'next/server';
import { correrRunner, MARGEN_RELOJ_MS } from '@/lib/likida/agentes/runner';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';
import { puertaCron, registrarLatido, leerLatido } from '@/lib/admin/salud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 300 s — el tope del plan Pro (documentado en `presupuesto.ts`), no 120.
//
// El comentario viejo decía "hasta 5 piezas × una completion corta: lejos del
// techo" y describía un runner de UN agente. Con 34 habilitados despachados
// EN SERIE, la pasada de las 18:00 del 25-ago-2026 murió a los 120 s con ~15
// agentes corridos y sin alcanzar `registrarLatido`: el orquestador quedó mudo
// cuatro horas hasta que saltó "Sin latido: runner hace 286 min".
//
// Subir el techo NO es la cura —es aire—: la cura es el reloj interno de
// `correrRunner`, que corta ANTES de despachar cuando ya no cabe y deja a esta
// ruta los `MARGEN_RELOJ_MS` que necesita para escribir su latido `'parcial'`.
export const maxDuration = 300;

// ═══════════════════════════════════════════════════════════════════════════
// EL LATIDO DEL RUNNER NIVEL 2 (0123) — cada 4 horas despacha los agentes
// autónomos ACOTADOS (vivos + habilitados + con techo declarado). A 5 piezas
// por vuelta son máx. 30 borradores/día — la misma banda que el tope de
// envío (20-40) protege del otro lado; los dos frenos son independientes a
// propósito.
//
// FALLA CERRADO SIN SECRETO, como todo cron: esta ruta gasta dinero de
// modelo y fabrica piezas hacia la bandeja de Javier.
// ═══════════════════════════════════════════════════════════════════════════
export async function GET(req: Request) {
  // La puerta común (RES-7): sin secreto, 500 CON alerta; 401 con log y
  // código estable. Antes ninguna de las dos dejaba huella accionable.
  const puerta = await puertaCron('runner', req, 'El runner no corre sin él.');
  if (puerta) return puerta;

  // El reloj de ESTA invocación, uno solo para toda la vuelta (el molde es
  // `venceCobranza` del cron de escalar, ESC-3). Se cuenta desde aquí y no
  // desde dentro del motor: `maxDuration` corre desde que Vercel invoca.
  const venceEn = Date.now() + maxDuration * 1000 - MARGEN_RELOJ_MS;

  try {
    const r = await correrRunner(undefined, undefined, { venceEn });
    const despachados = r.agentes.length - r.saltadosPorReloj.length;
    logger.info('cron.runner', {
      apagadoGlobal: r.apagadoGlobal,
      despachados,
      saltadosPorReloj: r.saltadosPorReloj,
      agentes: r.agentes.map((a) => ({ agente: a.agente, resultado: a.resultado, piezas: a.piezas, motivo: a.motivo?.slice(0, 120) })),
    });

    // ── EL CORTE QUE SE REPITE (RES-6, mismo patrón que el cron de escalar) ─
    // Que una pasada cargada deje agentes sin turno es tolerable: son los
    // CAROS —el orden de despacho ya sacrificó lo caro primero— y les toca en
    // la pasada de las cuatro horas siguientes. Que TRES SEGUIDAS corten
    // significa que el trabajo ya no cabe en la cadencia y hay que mover una
    // palanca (menos agentes por vuelta, otra cadencia, una cola). La racha
    // vive en el latido, que es el único estado que este cron ya persiste.
    let cortesSeguidos = 0;
    if (r.saltadosPorReloj.length > 0) {
      try {
        const previo = await leerLatido('runner');
        cortesSeguidos = Number((previo?.detalle as { cortesSeguidos?: number } | undefined)?.cortesSeguidos ?? 0) + 1;
      } catch {
        cortesSeguidos = 1;   // sin historia legible, esta corrida es la primera
      }
      if (cortesSeguidos >= 3) {
        logger.error('cron.runner.corte_repetido', { cortesSeguidos, saltados: r.saltadosPorReloj });
        await alertarOperador('cron.runner', {
          error: `Tres pasadas seguidas del runner cortaron por reloj (esta dejó sin correr: ${r.saltadosPorReloj.join(', ')}). El trabajo ya no cabe en la cadencia actual.`,
          codigo: 'corte_por_reloj_repetido',
        });
      }
    }

    // El latido SIEMPRE se escribe, y dice la verdad de la pasada: `parcial`
    // cuando el reloj cortó. Una pasada cortada que late es infinitamente
    // mejor que una pasada completa que muere muda.
    await registrarLatido('runner', r.saltadosPorReloj.length > 0 ? 'parcial' : 'ok', {
      agentes: r.agentes.length,
      despachados,
      saltadosPorReloj: r.saltadosPorReloj,
      cortesSeguidos,
    });
    return NextResponse.json(r);
  } catch (e) {
    // El runner entero no pudo ni arrancar (p. ej. la lista de agentes no se
    // leyó): 500 para que el panel de crons de Vercel lo pinte rojo — un 200
    // aquí escondería al orquestador muerto.
    //
    // AUDITORÍA 18, M15: era el único cron sin `codigo` ni correo. Sin código,
    // seis fallos al día durante una semana eran 42 eventos en UN issue de
    // Sentry que notificó una vez; sin `alertarOperador`, cero correos. Mismo
    // par que los otros cuatro crons.
    const error = e instanceof Error ? e.message : String(e);
    const codigo = codigoDeError(e);
    logger.error('cron.runner.fallo', { error, codigo });
    await alertarOperador('cron.runner', { error, codigo });
    await registrarLatido('runner', 'fallo', { codigo });
    return NextResponse.json({ error: 'El runner no pudo correr — el detalle quedó en los registros.' }, { status: 500 });
  }
}
