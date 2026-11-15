import { NextResponse } from 'next/server';
import { leerInterruptor } from '@/lib/likida/interruptores';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';
import { registrarLatido, leerLatido, puertaCron } from '@/lib/admin/salud';
import { ejecutarVigilancia, marcarAvisados } from '@/lib/likida/normas/vigilancia/ejecutar';
import { leerEstado, estadoVacio, type EstadoVigilancia } from '@/lib/likida/normas/vigilancia/estado';
import { traerReal, pausarReal } from '@/lib/likida/normas/vigilancia/http';
import { detalleDeCorreo, textoDeCorreo, AVISOS_POR_CORREO, MENSAJES } from '@/lib/likida/normas/vigilancia/aviso';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Hasta 10 días × 2 peticiones de ≤12 s es el caso feo (un SIDOF lento); casi siempre son milisegundos. El reloj de
// abajo deja de empezar días que no alcanzaría a terminar, así que Vercel no la mata a media faena.
export const maxDuration = 120;

// ═══════════════════════════════════════════════════════════════════════════
// LA VIGILANCIA NORMATIVA EN PRODUCCIÓN — DIARIA, 13:30 UTC (≈ 7:30 CDMX).
//
// ── POR QUÉ EXISTE ────────────────────────────────────────────────────────
//
// Las fichas de `normas/*.yaml` no se rompen con un error: se vuelven mentira en silencio. El SAT publica, el código
// sigue igual y el PDF del contralor cita un artículo que ya dice otra cosa. La rutina remota que lo vigilaba
// (`.claude/skills/vigilancia-normativa`) quedó bloqueada por la política de egreso del entorno de Anthropic: no puede
// salir a sidofqa.segob.gob.mx. Este cron hace lo mismo desde la infraestructura propia, y la rutina remota queda de
// respaldo.
//
// ── QUÉ VIGILA (la lógica vive en `lib/likida/normas/vigilancia/`) ────────
//
//   · DIARIO — el DOF por SIDOF, desde el día siguiente a `ultimo_dia_barrido` hasta AYER hora de México (tope 10
//     días por corrida), los 7 días de la semana y las tres ediciones (la RMF 2026 salió en DOMINGO).
//   · SEMANAL (lunes) — HEAD al minisitio de normatividad del SAT: el ETag/Last-Modified cambió → «anticipada SAT
//     posible» (la 1ª modificación a la RMF 2026 vivió 4.5 meses en ese portal con efectos jurídicos sin pasar por el DOF).
//   · TRIMESTRAL (ene/abr/jul/oct) — HEAD a los PDF de CFF, LISR, LIVA y LFPDPPP: Last-Modified cambió → «deriva de ley».
//
// ── POR QUÉ UN «SIN CAMBIOS» AQUÍ TIENE QUE GANARSE ───────────────────────
//
// El SIDOF contesta 200 con arrays vacíos tanto si no hubo DOF como si se cayó (modo de falla 3 de
// `references/fuentes.md`). Por eso cada día se cruza contra `diarios/porFecha`, y un día hábil con 0 notas es FALLO de
// la fuente: NO avanza el cursor y el latido sale `fallo` con la causa. Tampoco se presenta como «sin cambios» un fallo
// de red nuestro. La respuesta lleva `sinCambios: true` solo si se leyeron notas de verdad y ningún disparador saltó.
//
// ── LO QUE ESTA RUTA NO HACE ──────────────────────────────────────────────
//
// NO cambia `estado_verificacion` de ninguna ficha ni escribe en `normas/`: solo AVISA (un correo por corrida, vía
// `alertarOperador`) y deja latido. Qué ficha contradice qué publicación se establece LEYENDO, no diffeando; eso lo
// hace una persona. Tampoco calcula la cuota del IEPS al diésel: la señala.
//
// ── EL ESTADO VIVE EN EL LATIDO ───────────────────────────────────────────
//
// Sin tabla nueva: `cron_latido.detalle.vigilancia` guarda el cursor, los codNota ya avisados (últimos 200), los
// avisos que aún no salieron y las huellas del SAT y de las leyes. `registrarLatido` REESCRIBE el detalle entero, así
// que TODO camino de salida —incluidos el 500 y el apagado— arrastra el estado leído al inicio; sin eso, un latido
// «saltado» borraría el cursor y la corrida siguiente re-barrería y re-avisaría.
// ═══════════════════════════════════════════════════════════════════════════

const CRON = 'vigilancia-normativa' as const;
const EVENTO_HALLAZGOS = 'cron.vigilancia-normativa.hallazgos';
const EVENTO_FALLO = 'cron.vigilancia-normativa';
/** Margen que se le deja a la vuelta para latir y responder sin que Vercel la mate a media faena. */
const MARGEN_MS = 15_000;
/** Corridas seguidas con fallo de la fuente antes de molestar por correo (un tropiezo de una mañana no lo merece). */
const FALLOS_PARA_CORREO = 3;
/** Los códigos que son del barrido del DOF (lo que decide `fallo` y no `parcial`). */
const CODIGOS_DOF = new Set(['red', 'diarios_forma', 'notas_forma', 'edicion_sin_notas', 'dia_habil_sin_notas']);

/** El detalle del latido: el resumen que lee el tablero y, dentro de `vigilancia`, el estado completo. */
function detalleDe(estado: EstadoVigilancia, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    vigilancia: estado,
    ultimo_dia_barrido: estado.ultimoDiaBarrido,
    etag_sat: estado.sat['2026']?.etag ?? null,
    last_modified_sat: estado.sat['2026']?.lastModified ?? null,
    last_modified_leyes: estado.leyes,
    avisos_pendientes: estado.pendientes.length,
    ...extra,
  };
}

export async function GET(req: Request) {
  const puerta = await puertaCron(CRON, req, MENSAJES.sinSecreto);
  if (puerta) {
    // Sin CRON_SECRET (500) la puerta ya alertó; se deja además el latido para que el tablero diga la causa. Un 401 NO
    // escribe nada: cualquiera puede pegarle a esta URL pública y no debe poder pisar el estado de la vigilancia.
    if (puerta.status === 500) {
      const previo = await leerPrevio();
      await registrarLatido(CRON, 'fallo', detalleDe(previo.estado, { codigo: 'cron_sin_secreto' }));
    }
    return puerta;
  }

  // El estado se lee ANTES que el interruptor: los latidos de apagado/fallo lo arrastran (ver el encabezado).
  const previo = await leerPrevio();
  const base = detalleDe(previo.estado);
  if (!previo.legible) {
    // Sin poder leer el estado no se sale a la red: re-barrer y re-avisar a ciegas es peor que esperar un día.
    await registrarLatido(CRON, 'fallo', { ...base, codigo: 'latido_ilegible' });
    return NextResponse.json({
      corrio: false,
      error: MENSAJES.latidoIlegible,
      codigo: 'latido_ilegible',
    }, { status: 500 });
  }

  // Solo el interruptor global: esto no es un agente, es una comprobación de normas. Fail-closed — un interruptor
  // ilegible es 500 y no un verde sobre una base que no se pudo leer (mismo criterio que `portales-vivos`).
  const global = await leerInterruptor('global');
  if (global === 'ilegible') {
    await registrarLatido(CRON, 'fallo', { ...base, codigo: 'interruptor_ilegible' });
    return NextResponse.json({
      corrio: false,
      error: MENSAJES.interruptorIlegible,
      codigo: 'interruptor_ilegible',
      interruptor: 'global',
    }, { status: 500 });
  }
  if (global === 'apagado') {
    logger.warn('cron.vigilancia_normativa.saltado', { interruptor: 'global' });
    await registrarLatido(CRON, 'saltado', { ...base, interruptor: 'global' });
    return NextResponse.json({ corrio: false, saltado: MENSAJES.saltadoGlobal });
  }

  try {
    const r = await ejecutarVigilancia({
      estado: previo.estado,
      ahora: new Date(),
      traer: traerReal,
      pausar: pausarReal,
      reloj: () => Date.now(),
      venceEn: Date.now() + (maxDuration * 1000 - MARGEN_MS),
    });

    // ── UN SOLO CORREO CON LOS HALLAZGOS ─────────────────────────────
    // `alertarOperador` devuelve `true` solo si el aviso SALIÓ. Lo que no salió (sin ALERTA_EMAIL, piso de una hora,
    // envío rechazado) se queda en `pendientes` y se reintenta mañana: nada se da por avisado sin haber salido.
    let estado = r.estado;
    const porAvisar = estado.pendientes.slice(0, AVISOS_POR_CORREO);
    let avisoSalio = true;
    if (estado.pendientes.length > 0) {
      avisoSalio = await alertarOperador(EVENTO_HALLAZGOS, detalleDeCorreo(estado.pendientes, r.ayer), textoDeCorreo(estado.pendientes.length));
      if (avisoSalio) estado = marcarAvisados(estado, porAvisar);
    }

    // Un fallo de la fuente repetido sí merece correo; uno solo queda en el latido y el log.
    const hayFalloDof = r.fallos.some((f) => CODIGOS_DOF.has(f.codigo));
    if (r.fallos.length > 0 && estado.fallosSeguidos >= FALLOS_PARA_CORREO) {
      await alertarOperador(EVENTO_FALLO, {
        error: MENSAJES.fallosRepetidos(estado.fallosSeguidos, r.fallos),
        codigo: 'vigilancia_fuente_fallo',
      });
    }

    const pendientesSinSalir = estado.pendientes.length;
    const estadoLatido = hayFalloDof ? 'fallo' : (r.fallos.length > 0 || r.sinTurno || r.rezagoDias > 0 || pendientesSinSalir > 0) ? 'parcial' : 'ok';
    const resumen = {
      dias_barridos: r.diasBarridos,
      notas_revisadas: r.notasRevisadas,
      notas_sin_titulo: r.sinTitulo,
      disparadores: r.disparadores,
      rezago_dias: r.rezagoDias,
      peticiones: r.peticiones,
      corrio_semanal: r.corrioSemanal,
      corrio_trimestral: r.corrioTrimestral,
      sin_turno: r.sinTurno,
      fallos: r.fallos,
      ...(r.fallos.length > 0 ? { codigo: r.fallos[0].codigo } : {}),
      ...(estado.diasSinEdicion.length > 0 ? { dias_sin_edicion: estado.diasSinEdicion } : {}),
    };
    logger.info('cron.vigilancia_normativa.ok', { ...resumen, estado: estadoLatido, aviso_salio: avisoSalio });
    await registrarLatido(CRON, estadoLatido, detalleDe(estado, resumen));

    return NextResponse.json({
      corrio: true,
      estado: estadoLatido,
      ultimoDiaBarrido: estado.ultimoDiaBarrido,
      ...resumen,
      nuevos: r.nuevos.map((a) => a.linea),
      avisoSalio,
      // Solo se afirma «sin cambios» si se LEYERON notas de verdad: un día hábil sin notas ya es fallo, y cero días
      // barridos (al día o red caída) tampoco es una lectura.
      sinCambios: r.fallos.length === 0 && r.diasBarridos > 0 && r.notasRevisadas > 0 && r.nuevos.length === 0 && pendientesSinSalir === 0,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const codigo = codigoDeError(e);
    logger.error('cron.vigilancia_normativa.fallo', { error, codigo });
    await alertarOperador(EVENTO_FALLO, { error, codigo });
    await registrarLatido(CRON, 'fallo', { ...base, codigo });
    return NextResponse.json({ error }, { status: 500 });
  }
}

/** El estado del latido anterior. `legible: false` = no se pudo leer (error de base), distinto de «nunca latió». */
async function leerPrevio(): Promise<{ estado: EstadoVigilancia; legible: boolean }> {
  try {
    const latido = await leerLatido(CRON);
    return { estado: latido ? leerEstado(latido.detalle) : estadoVacio(), legible: true };
  } catch (e) {
    logger.warn('cron.vigilancia_normativa.latido_ilegible', { error: e instanceof Error ? e.message : String(e) });
    return { estado: estadoVacio(), legible: false };
  }
}
