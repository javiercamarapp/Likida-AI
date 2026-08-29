import { NextResponse } from 'next/server';
import { vigilarPortales, redactarParte, portalesVigilables } from '@/lib/likida/facturacion/portales_vivos';
import { leerInterruptor } from '@/lib/likida/interruptores';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';
import { registrarLatido, puertaCron } from '@/lib/admin/salud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Una pasada son ~30 `fetch` con tope de 12 s cada uno, casi siempre en
// milisegundos. El presupuesto es para el caso feo —varios portales colgando
// hasta el tope— y aun así el reloj de abajo corta antes que Vercel.
export const maxDuration = 120;

// ═══════════════════════════════════════════════════════════════════════════
// EL VIGILANTE DE PORTALES — SEMANAL, LUNES 06:40 (hora de Vercel, UTC).
//
// ── POR QUÉ EXISTE ────────────────────────────────────────────────────────
//
// El reconocimiento de campo del 28-ago-2026 visitó los 37 portales del
// catálogo. **De las veinte URLs de la primera tanda, seis no llevaban a ningún
// portal** — tres sin DNS, una estacionada en GoDaddy, una que era un
// directorio y una en 502. Ninguna estaba mal el día que se escribió: se
// pudrieron solas.
//
// Sin esto, un portal caído se descubre cuando un ticket real falla — o sea con
// el operador esperando, el plazo corriendo y alguien teniendo que averiguar si
// el problema es el adaptador, el OCR o el portal. La lógica de la comprobación
// (y por qué un 200 no basta) vive en `portales_vivos.ts`.
//
// ── POR QUÉ SEMANAL Y NO CADA HORA ───────────────────────────────────────
//
// Porque lo que se vigila se mueve en semanas o meses, no en minutos: un
// dominio que expira, un portal que se rediseña, una URL que se muda. Golpear
// treinta portales de terceros cada hora no adelantaría el hallazgo y sí nos
// pondría en sus registros como tráfico automatizado insistente — que es
// exactamente la conducta por la que tres de estos sitios ya bloquean robots.
// El vigilante no puede ser el que provoque el problema que vino a detectar.
//
// ── POR QUÉ NO ESCALA CUALQUIER COSA A CORREO ────────────────────────────
//
// Es la regla que el PR #183 dejó asentada después de los cuatro correos falsos
// del 28-ago-2026: **sin escenario concreto verificado, no es hallazgo.** Aquí
// se aplica en tres sitios, y los tres están en `portales_vivos.ts`:
//
//   1. Cada roto se mide DOS VECES y solo se sostiene si el síntoma se repite.
//      Un 502 puede ser un despliegue del portal a media pasada.
//   2. Un fallo de NUESTRO lado es `no_medido`, nunca «el portal se cayó». Sin
//      esa distinción, un tropiezo de red manda un correo diciendo que los 30
//      portales están muertos, y al tercero nadie vuelve a leer al vigilante.
//   3. Una SPA cuyo formulario se dibuja con JavaScript sale `sin_confirmar`,
//      no «roto»: por HTML crudo, el portal vivo de Circle K se ve igual que la
//      URL rota de OXXO, y acusarlo sería el correo en falso garantizado.
//
// Lo que SÍ escala es un portal medido roto dos veces seguidas, con su código
// HTTP o su error de DNS en la evidencia.
//
// ── LO QUE ESTA RUTA NO HACE ─────────────────────────────────────────────
//
// No arregla nada ni toca el catálogo. Un portal que cambió de casa se corrige
// leyendo su sitio y escribiendo la URL nueva a mano, que es una decisión con
// dueño humano — el recon del 28-ago recuperó tres así. Aquí solo se AVISA, con
// la evidencia suficiente para que quien lo arregle no tenga que volver a medir.
// ═══════════════════════════════════════════════════════════════════════════

/** Margen que se le deja a la vuelta para redactar y responder sin que Vercel
 *  la mate a media faena. Mismo patrón que el resto de los crons. */
const MARGEN_MS = 15_000;

export async function GET(req: Request) {
  const puerta = await puertaCron('portales-vivos', req, 'La vigilancia de portales no corre sin él.');
  if (puerta) return puerta;

  // Solo el interruptor global: esto no es un agente, es una comprobación de
  // salud. Fail-closed — un interruptor ilegible es 500 y no un verde sobre una
  // base que no se pudo leer (mismo criterio que `purgar`, auditoría 18 A17).
  const global = await leerInterruptor('global');
  if (global === 'ilegible') {
    // El latido ANTES del 500 (auditoría tandas 21-24, hallazgo 4): este era
    // el ÚNICO cron con dos caminos de salida mudos — el PR del patrón
    // «latido en todo camino» (#206) y este cron (#202) entraron en tandas
    // consecutivas y nadie los cruzó. Sin él, el tablero decía «No late» sin
    // la causa. Espejo de `purgar`.
    await registrarLatido('portales-vivos', 'fallo', { codigo: 'interruptor_ilegible' });
    return NextResponse.json({
      corrio: false,
      error: 'No se pudo leer el interruptor global: no se sale a la red sin saber si está apagado.',
      codigo: 'interruptor_ilegible',
      interruptor: 'global',
    }, { status: 500 });
  }
  if (global === 'apagado') {
    logger.warn('cron.portales_vivos.saltado', { interruptor: 'global' });
    // Sin este latido, dos lunes con el global apagado envejecían el latido
    // más de 7 días y /api/health declaraba MUERTO al cron sin poder
    // distinguirlo de «saltado a propósito» — que es exactamente la ceguera
    // que el estado `saltado` existe para evitar.
    await registrarLatido('portales-vivos', 'saltado', { interruptor: 'global' });
    return NextResponse.json({ corrio: false, saltado: 'interruptor global' });
  }

  try {
    const venceEn = Date.now() + (maxDuration * 1000 - MARGEN_MS);

    const r = await vigilarPortales({
      // `fetch` con `redirect: 'follow'` a propósito: media docena de estos
      // portales redirigen (la raíz al login, el `www` al apex) y seguir el
      // redirect es lo que hace un navegador. Lo que se quiere saber es si al
      // final del camino hay un formulario.
      traer: (url, init) => fetch(url, {
        ...init,
        redirect: 'follow',
        // UA de navegador real: varios de estos sitios sirven un cuerpo
        // distinto —o nada— a un cliente sin UA. Se identifica como un
        // navegador porque eso es lo que el adaptador va a ser cuando facture;
        // medir con un cliente distinto del que va a operar mediría otra cosa.
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept-Language': 'es-MX,es;q=0.9',
        },
      }),
      venceEn,
    });

    const parte = redactarParte(r);
    const vigilables = portalesVigilables().length;

    // El log lleva el parte entero: es lo que alguien va a leer cuando quiera
    // saber por qué un ticket falló la semana pasada.
    logger.info('cron.portales_vivos.ok', {
      vigilables,
      revisados: r.revisiones.length,
      rotos: r.rotos.length,
      noMedidos: r.noMedidos,
      sinTurno: r.sinTurno.length,
      parte,
    });

    // ── LO ÚNICO QUE ESCALA A CORREO ──────────────────────────────────────
    // Portales medidos rotos y confirmados. Nada más: los `no_medido` y los
    // `sin_confirmar` quedan en el log, que es donde deben estar.
    if (r.rotos.length > 0) {
      await alertarOperador('cron.portales-vivos', {
        error:
          `${r.rotos.length} portal(es) de facturación rotos: ` +
          r.rotos.map((x) => `${x.clave} (${x.estado}: ${x.evidencia})`).join(' | ').slice(0, 800),
        codigo: 'portales_facturacion_rotos',
      });
    }

    // `parcial` y no `ok` cuando quedó algo sin mirar: es la diferencia entre
    // enterarse y no (regla del PR #152). Un vigilante que revisó la mitad y
    // reporta `ok` miente sobre la otra mitad.
    await registrarLatido('portales-vivos', r.sinTurno.length > 0 ? 'parcial' : 'ok', {
      revisados: r.revisiones.length,
      rotos: r.rotos.length,
    });

    return NextResponse.json({
      corrio: true,
      vigilables,
      revisados: r.revisiones.length,
      rotos: r.rotos,
      noMedidos: r.noMedidos,
      sinTurno: r.sinTurno,
      parte,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const codigo = codigoDeError(e);
    logger.error('cron.portales_vivos.falló', { error, codigo });
    await alertarOperador('cron.portales-vivos', { error, codigo });
    await registrarLatido('portales-vivos', 'fallo', { codigo });
    return NextResponse.json({ error }, { status: 500 });
  }
}
