import { NextResponse } from 'next/server';
import { escalarViajesSinAceptar, PLAZO_ESCALACION_MS } from '@/lib/likida/escalar_viaje';
import { ejecutarCobranzaGlobal } from '@/lib/likida/agentes/cobranza';
import { leerInterruptor, type NombreInterruptor } from '@/lib/likida/interruptores';
import { avisarRelojesLegales, avisarVencimientos } from '@/lib/likida/relojes_legales';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';
import { puertaCron, registrarLatido, leerLatido } from '@/lib/admin/salud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Una corrida toca N viajes y cada uno manda hasta dos mensajes de WhatsApp.
// Con el índice parcial de la 0058 la consulta es corta; el presupuesto es para
// los envíos, no para la lectura.
export const maxDuration = 120;

// ═══════════════════════════════════════════════════════════════════════════
// EL CRON QUE DESTAPA LOS VIAJES QUE NADIE ATIENDE.
//
// Primer cron del repo, y desde el 8-ago-2026 corre DOS chequeos por hora —
// no dos rutas: los dos son "viaje abierto que se está pasando de tiempo",
// misma cadencia, mismo secreto, mismo modo de falla. Separarlos en dos
// URLs hubiera sido ceremonia sin beneficio.
//
//   1. Viajes que el CHOFER no aceptó — le da al jefe de flota la única
//      cosa que él puede resolver y el sistema no: cambiar de chofer
//      (`escalar_viaje.ts`).
//   2. Viajes abiertos con `fecha_inicio` vieja y sin comprobantes — le
//      insiste AL CHOFER directo, sin que nadie tenga que apretar un botón
//      (decisión de Javier el 8-ago-2026: automático, no dependiente del
//      jefe de flota). Desde el 14-ago-2026 lo corre el Agente de Cobranza
//      (`agentes/cobranza.ts`, 0089) con tiers/ventana POR FLOTA —
//      `recordatorio_comprobacion.ts` se borró al quedar supersedido.
//
// Corren en su propio try/catch cada uno: si uno truena, el otro igual
// intenta — dos causas de falla independientes no deberían dejar ciego al
// chequeo que sí funciona.
//
// ── POR QUÉ FALLA CERRADO SIN SECRETO ────────────────────────────────────
//
// Esta ruta MANDA MENSAJES DE WHATSAPP, que cuestan dinero y llegan a personas
// reales. Sin `CRON_SECRET` configurado no se ejecuta y devuelve 500 — y no 200
// con un aviso: un 200 le diría a Vercel que la corrida salió bien, el cron se
// vería verde en el panel para siempre, y nadie se enteraría de que la
// escalación lleva meses sin correr. Es el mismo modo de falla que el repo ya
// documenta en `exigir()`: quedarse ciego se lee igual que "no hay nada".
//
// ── POR QUÉ NO SE PUEDE INVOCAR DESDE EL NAVEGADOR ───────────────────────
//
// Vercel Cron manda `Authorization: Bearer <CRON_SECRET>`. Cualquiera que
// conociera la URL podría disparar avisos a voluntad; el secreto es lo único
// entre eso y un teléfono sonando de madrugada.
// ═══════════════════════════════════════════════════════════════════════════

// ── EL REINTENTO ÚNICO ANTE TIMEOUT (c5-CRON, 27-ago-2026) ────────────────
//
// Tres corridas de esta semana fallaron por la MISMA clase transitoria: un
// TimeoutError de una consulta (la estampida de crons + el tope de 8 s de
// `acotada`). El reintento en caliente es correcto SOLO donde repetir no
// duplica efectos:
//
//   · Las lecturas de interruptor: puras — gratis reintentarlas.
//   · Los dos motores claim-first (`escalarViajesSinAceptar` estampa
//     `escalado_en` ANTES de mandar; `ejecutarCobranzaGlobal` reclama con
//     unique(viaje, tier)): lo ya reclamado queda fuera de la segunda
//     pasada — el reintento no re-manda WhatsApp.
//
// Y donde NO va, EXPLÍCITAMENTE: `avisarRelojesLegales` y
// `avisarVencimientos` sellan DESPUÉS de mandar (patrón 0202) — un timeout
// ahí es ambiguo (el WhatsApp pudo haber salido sin sello) y reintentar en
// caliente REENVÍA a personas reales. Su reintento natural es la corrida
// horaria siguiente, que re-barre lo no sellado.

/** ¿El error tiene forma de timeout? Cubre el abort de `AbortSignal.timeout`
 *  y el mensaje del tope de `acotada` ("sin respuesta en N ms"). */
function esTimeout(e: unknown): boolean {
  const msj = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return /timeouterror|aborted|abort|timed?\s*out|sin respuesta en \d+ ms/i.test(msj);
}

/** Un solo reintento con backoff corto, SOLO ante timeout. */
async function conReintentoDeTimeout<T>(fn: () => Promise<T>, etiqueta: string): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!esTimeout(e)) throw e;
    logger.warn('cron.escalar.reintento_timeout', { etiqueta });
    await new Promise((r) => setTimeout(r, 1_500));
    return await fn();
  }
}

/** La lectura del interruptor, con su reintento: `leerInterruptor` no lanza
 *  (devuelve 'ilegible'), así que el reintento va sobre el VALOR. */
async function leerInterruptorConReintento(nombre: NombreInterruptor): Promise<Awaited<ReturnType<typeof leerInterruptor>>> {
  const primero = await leerInterruptor(nombre);
  if (primero !== 'ilegible') return primero;
  logger.warn('cron.escalar.reintento_timeout', { etiqueta: `interruptor:${nombre}` });
  await new Promise((r) => setTimeout(r, 1_500));
  return leerInterruptor(nombre);
}

/** Cuerpo de respuesta cuando el interruptor no se pudo leer. `codigo`
 *  estable para que el fingerprint y el tablero lo separen de un motor caído. */
function ilegible(interruptor: NombreInterruptor) {
  return {
    corrio: false,
    error: `No se pudo leer el interruptor ${interruptor}: no se corre sin saber si está apagado.`,
    codigo: 'interruptor_ilegible',
    interruptor,
  };
}

export async function GET(req: Request) {
  // La puerta común (RES-7). Sin cuerpo en el 401 —a quien no está autorizado
  // no se le dice qué hay detrás— pero CON log y `codigo: 'cron_401'`, y con
  // alerta al operador cuando el secreto no está configurado.
  const puerta = await puertaCron('escalar', req, 'La escalación no corre sin él.');
  if (puerta) return puerta;

  // ── EL KILL SWITCH (0110), DESPUÉS de la puerta y ANTES de trabajar ──────
  //
  // 'global' apaga los dos motores. Responde 200, no 500: apagado A PROPÓSITO
  // no es un fallo — un 500 aquí pintaría el cron rojo en Vercel y dispararía
  // a alguien a investigar exactamente lo que Javier acaba de decidir. El
  // `saltado` en el cuerpo es lo que distingue esta corrida de una sana.
  // El interruptor es GLOBAL por agente (v1), no por tenant: este cron barre
  // todas las flotas en una corrida y la palanca corta el barrido entero.
  // Fail-closed: si el interruptor no se puede LEER no se corre — este cron
  // manda WhatsApp a personas reales, y "no sé si está apagado" no es permiso.
  // AUDITORÍA 18, ALTO (A17): pero ese salto NO comparte código de salida con
  // el apagado a propósito. `ilegible` es un FALLO y contesta 500 con
  // `codigo`, para que Vercel pinte el cron rojo: cinco crons saltándose
  // corridas sobre una base con hipo se veían como cinco crons verdes.
  const global = await leerInterruptorConReintento('global');
  if (global === 'ilegible') {
    // El latido ANTES del 500 (tableros al día, 28-ago-2026): sin él este
    // camino era mudo y /admin/crons decía «No late» sin la causa.
    await registrarLatido('escalar', 'fallo', { codigo: 'interruptor_ilegible' });
    return NextResponse.json(ilegible('global'), { status: 500 });
  }
  if (global === 'apagado') {
    logger.warn('cron.escalar.saltado', { interruptor: 'global' });
    // Sin este latido, el apagado deliberado se pintaba como cron muerto y
    // /api/health alertaba al operador por su propia decisión.
    await registrarLatido('escalar', 'saltado', { interruptor: 'global' });
    return NextResponse.json({ corrio: false, saltado: 'interruptor global' });
  }

  // ── EL REPARTO DEL RELOJ (ESC-3 / ESC-4) ────────────────────────────────
  // Los dos motores comparten UNA invocación de 120 s y hasta hoy ninguno
  // sabía del otro: la escalación podía comerse el presupuesto entero —cuatro
  // llamadas a Meta por viaje, hasta 100 viajes— y la cobranza no llegaba ni a
  // leer su cola, cada hora, sin una sola línea que lo dijera. Ahora la
  // escalación tiene 40 s y la cobranza se queda con lo que sobre, menos un
  // margen de 15 s para los avisos y la bitácora del cierre.
  const inicioCorrida = Date.now();
  const venceEscalacion = inicioCorrida + PLAZO_ESCALACION_MS;
  const venceCobranza = inicioCorrida + (maxDuration - 15) * 1000;

  const resultado: Record<string, unknown> = {};
  // AUDITORÍA 3, OP-C1 (CRÍTICO): este cron respondía 200 con un motor
  // entero reventado — el único con ese vicio (purgar/facturar responden
  // 500/503) — y así fue como el embed roto de la 0075 acumuló ~216 corridas
  // "verdes" sin que Vercel ni Sentry levantaran la mano. Un motor caído =
  // 500, para que la plataforma cuente el cron como FALLIDO.
  let huboFallo = false;

  // El primer motor ES el Agente de Conductores —`escalar_viaje.ts` registra
  // sus corridas como 'conductores' desde la B3—, así que tiene su propia
  // palanca además de la global (Fase 1 del blueprint, 15-ago-2026: el
  // interruptor existía en el catálogo de la 0110 y ningún call site lo
  // preguntaba — era decorativo). Un comentario aquí decía que la escalación
  // "no es un agente del catálogo y no hay nombre honesto que darle": quedó
  // viejo en cuanto la B3 le dio bitácora con nombre propio.
  const conductores = await leerInterruptorConReintento('agente:conductores');
  if (conductores === 'ilegible') {
    // El grito y el correo ya salieron de `leerInterruptor`; aquí solo se
    // cuenta como fallo para que la corrida NO salga en verde (A17).
    resultado.aceptacion = ilegible('agente:conductores');
    huboFallo = true;
  } else if (conductores === 'apagado') {
    logger.warn('cron.conductores.saltado', { interruptor: 'agente:conductores' });
    resultado.aceptacion = { saltado: 'interruptor agente:conductores' };
  } else {
    try {
      const r = await conReintentoDeTimeout(() => escalarViajesSinAceptar({ venceEn: venceEscalacion }), 'escalarViajesSinAceptar');
      logger.info('cron.escalar.ok', { ...r });
      resultado.aceptacion = r;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      // El `codigo` es lo que separa "token vencido" de "tabla no existe" en el
      // fingerprint de Sentry (`discriminadores`): sin él, la causa nueva caía en
      // el issue viejo y no notificaba (reincidencia de OP-A1). Estable por
      // construcción — misma causa, mismo código, mismo issue. No hay tenant que
      // emitir: el motor corre global, sobre todas las flotas a la vez.
      const codigo = codigoDeError(e);
      logger.error('cron.escalar.falló', { error, codigo });
      await alertarOperador('cron.escalar', { error, codigo });
      resultado.aceptacion = { error };
      huboFallo = true;
    }
  }

  // El segundo motor ES el Agente de Cobranza, con su propia palanca por la
  // misma razón que el primero.
  const cobranza = await leerInterruptorConReintento('agente:cobranza');
  if (cobranza === 'ilegible') {
    resultado.comprobacion = ilegible('agente:cobranza');
    huboFallo = true;
  } else if (cobranza === 'apagado') {
    logger.warn('cron.cobranza.saltado', { interruptor: 'agente:cobranza' });
    resultado.comprobacion = { saltado: 'interruptor agente:cobranza' };
  } else {
    try {
      const r = await conReintentoDeTimeout(() => ejecutarCobranzaGlobal(new Date(), { venceEn: venceCobranza }), 'ejecutarCobranzaGlobal');
      logger.info('cron.cobranza.ok', { ...r });
      resultado.comprobacion = r;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      // Mismo criterio que el catch de arriba: código estable para el
      // fingerprint, alerta directa al operador del sistema.
      const codigo = codigoDeError(e);
      logger.error('cron.cobranza.falló', { error, codigo });
      await alertarOperador('cron.cobranza', { error, codigo });
      resultado.comprobacion = { error };
      huboFallo = true;
    }
  }

  // ── EL TERCER BARRIDO: LOS RELOJES LEGALES (Fase 6) ─────────────────────
  // Vencimientos de flota (30/7/0 días, un aviso por umbral — el sello es la
  // 0202) y los relojes colgados de una incidencia de siniestro/robo/bloqueo
  // (sustitución de CFDI, matpel, retén). Va en ESTE cron y no en el de
  // asistencia de 5 min a propósito: los plazos son de días hábiles, no de
  // minutos, y cada corrida extra del barrido de vencimientos son consultas
  // que no cambian nada. Sin palanca propia: no es un agente del catálogo,
  // es un reloj — la global lo apaga con todo lo demás.
  // Mismo criterio de aislamiento que los dos motores: su try/catch propio,
  // su fallo pinta la corrida en 500, y no le quita el turno a nadie (corre
  // al final, con lo que quede del presupuesto).
  try {
    const [relojes, vencimientos] = [
      await avisarRelojesLegales(new Date()),
      await avisarVencimientos(new Date()),
    ];
    logger.info('cron.relojes.ok', { ...relojes, vencimientos });
    resultado.relojes = { incidencias: relojes, vencimientos };
    if (relojes.fallos > 0 || vencimientos.fallos > 0) huboFallo = true;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const codigo = codigoDeError(e);
    logger.error('cron.relojes.falló', { error, codigo });
    await alertarOperador('cron.relojes', { error, codigo });
    resultado.relojes = { error };
    huboFallo = true;
  }

  // ── EL CUARTO BARRIDO: LAS REGLAS DE LA FLOTA (A19, mig. 0229) ──────────
  // Las vigilancias que el dueño o el contador declararon en lenguaje natural
  // y CONFIRMARON. Va aquí y no en un cron propio por la misma razón que los
  // relojes: es un reloj más sobre datos que Likida ya tiene, la cadencia
  // horaria le sobra (nada de esto se mide en minutos), y separarlo sería
  // ceremonia — otra URL, otro secreto, otro latido que vigilar.
  //
  // NO tiene palanca propia: no es un agente del catálogo de la compañía, es
  // una feature del producto que la flota compró. No llama a ningún modelo
  // (el traductor corre UNA vez, al crear la regla, desde el panel), así que
  // no hay techo en dólares que candar aquí. La global lo apaga con todo.
  //
  // Su try/catch propio, como los otros tres: una regla rota de una flota no
  // puede dejar ciegos a los relojes legales de las demás.
  try {
    const { vigilarReglas } = await import('@/lib/likida/reglas/vigilante');
    const reglas = await vigilarReglas(new Date());
    logger.info('cron.reglas.ok', { ...reglas });
    resultado.reglas = reglas;
    if (reglas.fallos > 0) huboFallo = true;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const codigo = codigoDeError(e);
    logger.error('cron.reglas.falló', { error, codigo });
    await alertarOperador('cron.reglas', { error, codigo });
    resultado.reglas = { error };
    huboFallo = true;
  }

  // Los fallos van en la RESPUESTA, no solo en el log. "Esa flota no tiene
  // teléfono de jefe registrado" es un problema de configuración que se
  // arregla en un minuto — si solo vive en el log, nadie lo ve hasta que
  // alguien pregunta por qué no le avisaron.
  // ── EL CORTE QUE SE REPITE (RES-6) ──────────────────────────────────────
  // Que una corrida deje flotas sin turno es normal en una hora cargada; que
  // TRES SEGUIDAS lo hagan significa que el trabajo ya no cabe en la cadencia
  // y hay que mover la palanca (más lotes, otra cadencia, QStash). La racha se
  // lleva en el latido, que es el único estado que este cron ya persiste.
  const cortados = Number((resultado.comprobacion as { cortadosPorReloj?: number } | undefined)?.cortadosPorReloj ?? 0)
    + Number((resultado.aceptacion as { cortadosPorReloj?: number } | undefined)?.cortadosPorReloj ?? 0);
  let cortesSeguidos = 0;
  if (cortados > 0) {
    try {
      const previo = await leerLatido('escalar');
      cortesSeguidos = Number((previo?.detalle as { cortesSeguidos?: number } | undefined)?.cortesSeguidos ?? 0) + 1;
    } catch {
      cortesSeguidos = 1;   // sin historia legible, esta corrida es la primera
    }
    if (cortesSeguidos >= 3) {
      logger.error('cron.escalar.corte_repetido', { cortesSeguidos, cortados });
      await alertarOperador('cron.escalar', {
        error: `Tres corridas seguidas dejaron trabajo sin hacer por falta de reloj (${cortados} en esta). El trabajo ya no cabe en la cadencia actual.`,
        codigo: 'corte_por_reloj_repetido',
      });
    }
  }
  resultado.cortadosPorReloj = cortados;

  // El latido (RES-7): esta corrida existió y así le fue. Un cron que deja de
  // correr —401, secreto ausente, cron borrado del panel— se ve en /api/health
  // como `vencido` a los 20 minutos de su cadencia.
  await registrarLatido('escalar', huboFallo ? 'fallo' : cortados > 0 ? 'parcial' : 'ok', { cortesSeguidos, cortados });

  return NextResponse.json(resultado, { status: huboFallo ? 500 : 200 });
}
