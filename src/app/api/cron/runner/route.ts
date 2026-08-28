import { NextResponse } from 'next/server';
import {
  correrRunner, MARGEN_RELOJ_MS,
  conRelojDuro, nuevoAvanceRunner, cerrarPorRelojDuro,
} from '@/lib/likida/agentes/runner';
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
//
// AUDITORÍA CICLO 7 (c7-1): y ese reloj interno tampoco era la cura completa,
// porque era COOPERATIVO. El 28-ago-2026 a las 00:03 UTC la pasada volvió a
// morir muda: el candado 0 preguntaba la hora entre agentes, pero `loteRedactor`
// no recibía el reloj y iteraba veinte candidatos a ~25 s cada uno. 500 s
// dentro de un `maxDuration` de 300. Ahora la vuelta corre dentro de
// `conRelojDuro`, así que esta ruta NUNCA espera más de lo que puede esperar.
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
    // ── LA VUELTA, ACOTADA POR FUERA (auditoría ciclo 7, c7-1) ──────────────
    // Esta ruta ya no espera a la vuelta: espera a la CARRERA entre la vuelta y
    // el reloj. Es la diferencia entre un techo que depende de que cada motor se
    // acuerde de preguntar la hora —y el 25 y el 28 de agosto de 2026 uno no se
    // acordó, y el orquestador quedó mudo cuatro horas— y un techo que NINGÚN
    // motor, ni los diez de hoy ni el que se escriba el mes que viene, puede
    // saltarse. El `avance` es lo que hace que el corte no sea mudo: la vuelta
    // lo va llenando conforme despacha, así que al vencer sabemos exactamente
    // quién estaba en vuelo y quiénes se quedaron sin turno. La regla de la casa
    // es que un dato que no se tiene se dice; aquí sí se tiene, y se dice.
    const avance = nuevoAvanceRunner();
    const r = await conRelojDuro(
      correrRunner(undefined, undefined, { venceEn, avance }),
      venceEn,
      () => cerrarPorRelojDuro(avance),
    );
    // Los que DE VERDAD corrieron, no «los que no se saltaron por reloj»: un
    // agente cuyo lote se cortó a la mitad aparece en las dos listas, y restarlo
    // lo descontaría de un total del que sí forma parte.
    const despachados = r.agentes.filter((a) => a.resultado === 'corrio').length;
    // El reloj cortó de alguna de las dos formas: agentes con trabajo pendiente,
    // o el corte duro (que puede pegar tan temprano que no haya a quién nombrar).
    const cortoElReloj = r.saltadosPorReloj.length > 0 || r.cortadaPorRelojDuro === true;
    logger.info('cron.runner', {
      apagadoGlobal: r.apagadoGlobal,
      despachados,
      saltadosPorReloj: r.saltadosPorReloj,
      cortadaPorRelojDuro: r.cortadaPorRelojDuro === true,
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
    if (cortoElReloj) {
      try {
        const previo = await leerLatido('runner');
        cortesSeguidos = Number((previo?.detalle as { cortesSeguidos?: number } | undefined)?.cortesSeguidos ?? 0) + 1;
      } catch (e) {
        // Sin historia legible esta corrida cuenta como la primera. Subcuenta
        // —y por eso se dice en vez de tragarse: un latido ilegible repetido
        // podría diferir la alerta del tercer corte—, pero perder la racha es
        // preferible a inventarla.
        cortesSeguidos = 1;
        logger.warn('cron.runner.racha_ilegible', { err: e instanceof Error ? e.message : String(e) });
      }
    }

    // ── EL LATIDO SIEMPRE SE ESCRIBE, Y VA ANTES DEL CORREO (c7-31) ─────────
    // Estaba al revés: primero la alerta del tercer corte, después el latido.
    // En el peor caso medido —el único momento en que entra el correo— la cola
    // en serie hasta aquí era `leerLatido` (9.5 s) + reserva en Redis (1.2 s) +
    // `enviarCorreo` (5 s) + `registrarLatido` (9.5 s) = 25.2 s contra un margen
    // de 20: el latido quedaba ÚLTIMO de la fila, o sea que lo primero que se
    // perdía era exactamente lo que el margen existe para proteger. Ahora late
    // primero y grita después; si algo se pierde, que sea el correo, que además
    // ya quedó en Sentry por el `logger.error` de abajo. (El margen también
    // subió a 30 s — ver `PASOS_LATIDO` en runner.ts.)
    //
    // `parcial` cuando el reloj cortó de cualquiera de las dos formas. Una
    // pasada cortada que late es infinitamente mejor que una pasada completa
    // que muere muda.
    await registrarLatido('runner', cortoElReloj ? 'parcial' : 'ok', {
      agentes: r.agentes.length,
      despachados,
      saltadosPorReloj: r.saltadosPorReloj,
      cortesSeguidos,
    });

    // ── EL CORTE QUE SE REPITE, ya con el latido a salvo ────────────────────
    if (cortesSeguidos >= 3) {
      logger.error('cron.runner.corte_repetido', { cortesSeguidos, saltados: r.saltadosPorReloj });
      await alertarOperador('cron.runner', {
        error: `Tres pasadas seguidas del runner cortaron por reloj (esta dejó sin correr: ${r.saltadosPorReloj.join(', ') || 'la vuelta se cortó antes de nombrar a nadie'}). El trabajo ya no cabe en la cadencia actual.`,
        codigo: 'corte_por_reloj_repetido',
      });
    }
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

    // ── LA RACHA SOBREVIVE AL FALLO (auditoría ciclo 7, c7-32) ─────────────
    // Este latido escribía `{ codigo }` a secas, o sea que BORRABA
    // `cortesSeguidos`. Secuencia realizable y silenciosa: pasada 1 corta
    // (racha 1) → pasada 2 lanza (latido de fallo sin racha) → pasada 3 corta →
    // `leerLatido` devuelve un detalle sin `cortesSeguidos` → `?? 0` → racha 1
    // otra vez. Con fallos intercalados, la alerta de «tres pasadas seguidas»
    // se difiere indefinidamente: justo la señal de que el trabajo ya no cabe
    // en la cadencia, apagada por el ruido.
    //
    // Un fallo NO es un corte: ni suma a la racha ni la reinicia. Lo que
    // corresponde es ARRASTRARLA tal cual. Y si no se puede leer, se OMITE la
    // llave en vez de escribir 0: «no se sabe» no es «es cero» (regla 2). El
    // lector de arriba caerá a 0 por su `?? 0`, que subcuenta —queda dicho—,
    // pero eso es la ausencia del dato hablando, no este `catch` inventándolo.
    let rachaPrevia: number | null = null;
    try {
      const previo = await leerLatido('runner');
      const v = (previo?.detalle as { cortesSeguidos?: unknown } | undefined)?.cortesSeguidos;
      rachaPrevia = typeof v === 'number' && Number.isFinite(v) ? v : null;
    } catch (err) {
      logger.warn('cron.runner.racha_ilegible_en_fallo', { err: err instanceof Error ? err.message : String(err) });
    }
    // El latido ANTES del correo, por lo mismo que en la rama de arriba (c7-31):
    // si la invocación se muere en esta cola, que lo que se pierda sea el
    // correo —que ya quedó en Sentry— y no la única señal de que el cron vive.
    await registrarLatido('runner', 'fallo', {
      codigo,
      ...(rachaPrevia !== null ? { cortesSeguidos: rachaPrevia } : {}),
    });
    await alertarOperador('cron.runner', { error, codigo });
    return NextResponse.json({ error: 'El runner no pudo correr — el detalle quedó en los registros.' }, { status: 500 });
  }
}
