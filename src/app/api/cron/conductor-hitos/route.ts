import { NextResponse } from 'next/server';
import { correrConductor, puertosReales } from '@/lib/likida/conductor/ejecutor';
import { correrAlertasEstadia, type ResultadoAlertasEstadia } from '@/lib/likida/conductor/alertas_estadia';
import { correrAlertasLlegadaSinConfirmar, puertosAlertaLlegadaReales, type ResultadoAlertasLlegada } from '@/lib/likida/conductor/alertas_llegada';
import { barridoValidacion, depsValidacionReales, type ResultadoBarrido } from '@/lib/likida/conductor/validar_hito';
import { leerCandidatosValidacion, leerCandidatosSitioDerivado, leerCatalogoSitios } from '@/lib/likida/conductor/trabajo';
import { barridoCicloGps, type ResultadoCicloGps } from '@/lib/likida/conductor/ciclo_gps';
import { puertosCicloGpsReales } from '@/lib/likida/conductor/ciclo_gps_real';
import { barridoSitioDerivado, type ResultadoSitioDerivado } from '@/lib/likida/conductor/sitio_derivado';
import { asignarSitioDerivado } from '@/lib/likida/conductor/repo';
import { barridoSenalVida, type ResultadoSenalVida } from '@/lib/likida/conductor/senal_vida';
import { puertosSenalVidaReales } from '@/lib/likida/conductor/senal_vida_real';
import { barridoAcercamiento, type ResultadoAcercamiento } from '@/lib/likida/convenios/acercamiento';
import { ConveniosNoDisponibles } from '@/lib/likida/convenios/repo';
import { horaYDiaMx } from '@/lib/likida/conductor/config';
import { correrMantenimientoConductor, leerConfigConductor } from '@/lib/likida/conductor/repo';
import { leerInterruptor, type NombreInterruptor } from '@/lib/likida/interruptores';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';
import { puertaCron, registrarLatido, type EstadoLatido } from '@/lib/admin/salud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Una pasada lee, planifica y manda a lo más un mensaje por viaje activo; cada
// envío a Meta tiene techo de 10 s. El reloj de la corrida corta ANTES del claim.
export const maxDuration = 60;

/** Margen para el latido y la respuesta dentro del `maxDuration`. */
const MARGEN_MS = 12_000;

// ═══════════════════════════════════════════════════════════════════════════
// EL CRON DEL AGENTE 5 «CONDUCTOR» (0380): pide, persigue y escala los hitos.
//
// Cada 5 minutos. Todo el trabajo vive en `lib/likida/conductor/ejecutor.ts`; esto
// es la puerta (secreto), las palancas (global y `agente:conductores`, ambas
// fail-closed: este cron le ESCRIBE A PERSONAS), el mantenimiento de privacidad
// diario y el latido en TODO camino de salida.
//
// ── POR QUÉ FALLA CERRADO SIN SECRETO O CON PALANCA ILEGIBLE ───────────────
// Manda WhatsApp a choferes y a jefes de tráfico. Un 200 sin trabajo pintaría el
// cron verde para siempre; y «no sé si está apagado» no es permiso para insistirle
// a nadie (mismo criterio que `escalar`).
//
// ── EL MANTENIMIENTO ───────────────────────────────────────────────────────
// A las 03:xx de México, una vez al día: anonimiza el dato personal de los hitos
// viejos (contacto en andén, coordenadas, texto) y purga la bitácora de avisos y
// eventos. Los plazos son los DEFAULT de las funciones SQL (365 días): una
// política PROPUESTA, no una decisión tomada (ver docs/operacion/agente-conductor.md).
// ═══════════════════════════════════════════════════════════════════════════

function ilegible(interruptor: NombreInterruptor) {
  return {
    corrio: false,
    error: `No se pudo leer el interruptor ${interruptor}: no se corre sin saber si está apagado.`,
    codigo: 'interruptor_ilegible',
    interruptor,
  };
}

export async function GET(req: Request) {
  const puerta = await puertaCron('conductor-hitos', req, 'El agente Conductor no corre sin él.');
  if (puerta) return puerta;

  const global = await leerInterruptor('global');
  if (global === 'ilegible') {
    await registrarLatido('conductor-hitos', 'fallo', { codigo: 'interruptor_ilegible' });
    return NextResponse.json(ilegible('global'), { status: 500 });
  }
  if (global === 'apagado') {
    logger.warn('cron.conductor_hitos.saltado', { interruptor: 'global' });
    await registrarLatido('conductor-hitos', 'saltado', { interruptor: 'global' });
    return NextResponse.json({ corrio: false, saltado: 'interruptor global' });
  }

  const agente = await leerInterruptor('agente:conductores');
  if (agente === 'ilegible') {
    await registrarLatido('conductor-hitos', 'fallo', { codigo: 'interruptor_ilegible' });
    return NextResponse.json(ilegible('agente:conductores'), { status: 500 });
  }
  if (agente === 'apagado') {
    logger.warn('cron.conductor_hitos.saltado', { interruptor: 'agente:conductores' });
    await registrarLatido('conductor-hitos', 'saltado', { interruptor: 'agente:conductores' });
    return NextResponse.json({ corrio: false, saltado: 'interruptor agente:conductores' });
  }

  let latido: { estado: EstadoLatido; detalle: Record<string, unknown> } = { estado: 'fallo', detalle: { codigo: 'corrida_sin_cerrar' } };
  try {
    const inicio = Date.now();
    const venceEn = inicio + (maxDuration * 1000) - MARGEN_MS;
    const r = await correrConductor(puertosReales(), { venceEn });

    // 0385: las dos pasadas nuevas. Cada una aislada: si una revienta, la otra corre y el latido sale `parcial`
    // con el motivo (un `try` global las haría caer juntas y taparía cuál falló).
    const extras: string[] = [];
    let alertas: ResultadoAlertasEstadia | undefined;
    let llegadas: ResultadoAlertasLlegada | undefined;
    let validacion: ResultadoBarrido | undefined;
    let acercamiento: ResultadoAcercamiento | undefined;
    let sitios: ResultadoSitioDerivado | undefined;
    let ciclo: ResultadoCicloGps | undefined;
    let senalVida: ResultadoSenalVida | undefined;
    // P2 (0635-0637): primero el sitio de los viajes sin convenio (sin sitio no hay geocerca) y luego el ciclo por geocerca
    // (el GPS entra o sale del sitio y el hito se registra solo). Van ANTES de la validación y de los avisos de llegada: una llegada
    // que el GPS acaba de dar por hecha no debe avisar como «sin confirmar». Aislados como los demás.
    try {
      sitios = await barridoSitioDerivado({ candidatos: leerCandidatosSitioDerivado, catalogo: leerCatalogoSitios, asignar: asignarSitioDerivado }, new Date(), venceEn);
      if (sitios.fallos > 0) extras.push(`sitio derivado: ${sitios.fallos} viajes con fallo`);
    } catch (e) {
      extras.push(`sitio derivado: ${e instanceof Error ? e.message : String(e)}`);
      logger.error('cron.conductor_hitos.sitio_derivado_fallo', { error: e instanceof Error ? e.message : String(e) });
    }
    try {
      ciclo = await barridoCicloGps(puertosCicloGpsReales(), new Date(), venceEn);
      extras.push(...ciclo.fallos);
    } catch (e) {
      extras.push(`ciclo por geocerca: ${e instanceof Error ? e.message : String(e)}`);
      logger.error('cron.conductor_hitos.ciclo_gps_fallo', { error: e instanceof Error ? e.message : String(e) });
    }
    try {
      alertas = await correrAlertasEstadia(puertosReales(), { venceEn });
      extras.push(...alertas.fallos);
    } catch (e) {
      extras.push(`alertas de estadía: ${e instanceof Error ? e.message : String(e)}`);
      logger.error('cron.conductor_hitos.alertas_estadia_fallo', { error: e instanceof Error ? e.message : String(e) });
    }
    try {
      validacion = await barridoValidacion({ candidatos: leerCandidatosValidacion, configDe: leerConfigConductor, deps: depsValidacionReales }, new Date(), venceEn);
      if (validacion.fallos > 0) extras.push(`validación: ${validacion.fallos} hito(s) sin poder validar`);
    } catch (e) {
      extras.push(`validación de ubicación: ${e instanceof Error ? e.message : String(e)}`);
      logger.error('cron.conductor_hitos.validacion_fallo', { error: e instanceof Error ? e.message : String(e) });
    }
    // 0604: el aviso al jefe de tráfico por «ya llegué» sin confirmar (apagado por flota por omisión). Va DESPUÉS de la validación (una llegada que el barrido acaba de confirmar no debe avisar). Aislado como los demás;
    // una base sin la 0604/0385 no trae la perilla encendida en ninguna flota, así que no hay nada que avisar.
    try {
      llegadas = await correrAlertasLlegadaSinConfirmar(puertosAlertaLlegadaReales(), { venceEn });
      extras.push(...llegadas.fallos);
    } catch (e) {
      extras.push(`llegada sin confirmar: ${e instanceof Error ? e.message : String(e)}`);
      logger.error('cron.conductor_hitos.llegada_sin_confirmar_fallo', { error: e instanceof Error ? e.message : String(e) });
    }
    // 0580: el aviso de acercamiento a la planta (las instrucciones del convenio). Aislado como los otros dos: un fallo aquí
    // no frena el resto. La base sin migrar (sin tablas de convenios) no es un fallo: no hay nada que avisar.
    try {
      acercamiento = await barridoAcercamiento(undefined, new Date(), venceEn);
      if (acercamiento.fallos > 0) extras.push(`acercamiento: ${acercamiento.fallos} aviso(s) con fallo`);
    } catch (e) {
      if (!(e instanceof ConveniosNoDisponibles)) {
        extras.push(`acercamiento a planta: ${e instanceof Error ? e.message : String(e)}`);
        logger.error('cron.conductor_hitos.acercamiento_fallo', { error: e instanceof Error ? e.message : String(e) });
      }
    }

    // P2 (0636): «sin señal de vida» en tránsito (apagado por flota por omisión). Manda a personas: al final, aislado.
    try {
      senalVida = await barridoSenalVida(puertosSenalVidaReales(), new Date(), venceEn);
      extras.push(...senalVida.fallos);
    } catch (e) {
      extras.push(`señal de vida: ${e instanceof Error ? e.message : String(e)}`);
      logger.error('cron.conductor_hitos.senal_vida_fallo', { error: e instanceof Error ? e.message : String(e) });
    }

    // Mantenimiento de privacidad: una vez al día, a las 03:xx de México.
    let mantenimiento: Record<string, number | string> | undefined;
    const { hora } = horaYDiaMx(new Date());
    if (hora === 3 && Date.now() < inicio + (maxDuration * 1000) - MARGEN_MS) {
      mantenimiento = await correrMantenimientoConductor();
    }

    const huboFallo = r.fallos.length > 0 || r.configIlegible > 0 || r.sinDestinatario > 0 || extras.length > 0;
    const incompleto = r.cortadosPorReloj > 0 || r.cortadaPorRechazoMasivo || Boolean(senalVida?.cortadaPorRechazoMasivo);
    logger.info('cron.conductor_hitos.ok', { ...r, fallos: r.fallos.length });
    const estado: EstadoLatido = huboFallo || incompleto ? 'parcial' : 'ok';
    latido = {
      estado,
      detalle: {
        sembrados: r.sembrados, viajes: r.viajes, solicitudes: r.solicitudes, recordatorios: r.recordatorios,
        escalaciones: r.escalaciones, fallos: r.fallos.length + extras.length, cortadosPorReloj: r.cortadosPorReloj,
        rechazoMasivo: r.cortadaPorRechazoMasivo,
        alertasEstadia: alertas?.alertas ?? null, avisosLlegadaSinConfirmar: llegadas?.avisos ?? null, validados: validacion?.validados ?? null, sinCoincidencia: validacion?.sinCoincidencia ?? null,
        acercamientos: acercamiento?.enviados ?? null,
        hitosPorGps: ciclo?.detectados ?? null, sitiosDerivados: sitios?.derivados ?? null,
        senalVidaAvisos: senalVida?.avisosChofer ?? null, senalVidaEscalaciones: senalVida?.escalaciones ?? null,
      },
    };
    if (r.cortadaPorRechazoMasivo) {
      await alertarOperador('cron.conductor_hitos', {
        error: 'WhatsApp rechazó varios avisos seguidos por un motivo reintentable (rate limit o bloqueo). La corrida se detuvo; los avisos quedaron sin reclamar.',
        codigo: 'wa_rechazo_masivo',
      });
    }
    return NextResponse.json({
      corrio: true, ...r, fallos: [...r.fallos, ...extras].slice(0, 20), alertasEstadia: alertas, llegadasSinConfirmar: llegadas, validacion, acercamiento, cicloGps: ciclo, sitiosDerivados: sitios, senalVida,
      ...(mantenimiento ? { mantenimiento } : {}),
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const codigo = codigoDeError(e);
    logger.error('cron.conductor_hitos.fallo', { error, codigo });
    await alertarOperador('cron.conductor_hitos', { error, codigo });
    latido = { estado: 'fallo', detalle: { error, codigo } };
    return NextResponse.json({ corrio: false, error, codigo }, { status: 500 });
  } finally {
    // En `finally`: un motor que lanza o una respuesta que no se serializa no deja el cron «sin cerrar».
    await registrarLatido('conductor-hitos', latido.estado, latido.detalle);
  }
}
