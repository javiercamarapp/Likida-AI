import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { traerTodo, traerPorIds, conteo } from '../pg';
import { avisarCorridasPorFlota } from './notificaciones';
import { registrarCorrida } from './corridas';
import { enviarTexto, sendTemplate, motivoDeFalloWhatsApp, esReintentableMeta } from '@/lib/meta/client';
import { alertarOperador } from '@/lib/observability/alerta';
import {
  CONFIG_COBRANZA_DEFAULT, validarConfigCobranza, dentroDeVentana,
  tierPendiente, armarMensajeCobranza, type ConfigCobranza,
} from './cobranza_pura';

// El motor PURO (config, ventana, tiers, mensaje) vive en cobranza_pura.ts
// desde el 14-ago-2026 — la página del agente lo corre en el navegador para
// la vista previa. Se re-exporta entero: los llamadores del servidor y las
// pruebas siguen importando de aquí.
export * from './cobranza_pura';

// ═══════════════════════════════════════════════════════════════════════════
// EL AGENTE DE COBRANZA DE COMPROBANTES (0089, 14-ago-2026).
//
// Es el recordatorio de comprobación (0087) PRODUCTIZADO con la anatomía de
// un Agente de Cobranza (prioridad 1 del roadmap): el cliente configura tiers de
// seguimiento, horario y ventana hábil, instrucciones y firma; cada contacto
// queda en bitácora; y la página del agente enseña la cola honesta — a quién
// va a contactar, a quién NO puede (sin teléfono) y por qué.
//
// LO QUE NO CAMBIA del 0087: el claim ANTES de mandar (aquí, el INSERT con
// unique(viaje, tier) — el perdedor no manda nada), el sello
// `recordatorio_comprobacion_en` en el primer contacto (alimenta "lo que
// hizo solo" y protege del re-envío al estrenar tiers), y la regla de que un
// canal que insiste todos los días se aprende a ignorar: se insiste POR
// TIER, no por día.
// ═══════════════════════════════════════════════════════════════════════════

export async function leerConfigCobranza(tenantId: string): Promise<ConfigCobranza> {
  const { data, error } = await supabaseAdmin()
    .from('agente_cobranza_config')
    .select('activo, tiers, hora_inicio, hora_fin, dias_semana, instrucciones, firma')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new Error(`leerConfigCobranza: ${error.message}`);
  if (!data) return CONFIG_COBRANZA_DEFAULT;
  const v = validarConfigCobranza({
    activo: data.activo as boolean,
    tiers: (data.tiers as number[]) ?? undefined,
    horaInicio: data.hora_inicio as number,
    horaFin: data.hora_fin as number,
    diasSemana: (data.dias_semana as number[]) ?? undefined,
    instrucciones: (data.instrucciones as string) ?? '',
    firma: (data.firma as string) ?? '',
  });
  // Una fila corrupta no tumba al agente: se cae a los defaults y se grita.
  if ('error' in v) {
    logger.error('cobranza.config_corrupta', { tenantId, err: v.error });
    return CONFIG_COBRANZA_DEFAULT;
  }
  return v.ok;
}

export async function guardarConfigCobranza(tenantId: string, cruda: Partial<ConfigCobranza>): Promise<{ error?: string }> {
  const v = validarConfigCobranza(cruda);
  if ('error' in v) return { error: v.error };
  const { error } = await supabaseAdmin()
    .from('agente_cobranza_config')
    .upsert({
      tenant_id: tenantId,
      activo: v.ok.activo,
      tiers: v.ok.tiers,
      hora_inicio: v.ok.horaInicio,
      hora_fin: v.ok.horaFin,
      dias_semana: v.ok.diasSemana,
      instrucciones: v.ok.instrucciones,
      firma: v.ok.firma,
      updated_at: new Date().toISOString(),
    });
  if (error) return { error: 'No se pudo guardar la configuración. Inténtalo de nuevo.' };
  return {};
}

export interface FilaCola {
  viajeId: string;
  folio: string | null;
  operadorNombre: string | null;
  operadorTelefono: string | null;
  dias: number;
  tier: number;
  /** Contactos previos que ya recibió este viaje (bitácora + sello 0087). */
  contactosPrevios: number;
}

export interface ColaCobranza {
  /** Con teléfono y tier alcanzado: los contacta la próxima corrida. */
  paraContactar: FilaCola[];
  /** Tier alcanzado pero SIN teléfono — el agente declara a quién no puede. */
  sinTelefono: FilaCola[];
  /** Viajes abiertos/en_cuadre vigilados en total (con fecha de inicio). */
  vigilados: number;
}

/** La cola honesta del agente para UNA flota — lo que la página enseña y lo
 *  que `ejecutarCobranza` va a intentar. */
export async function colaCobranza(tenantId: string, ahora: Date = new Date()): Promise<ColaCobranza> {
  const config = await leerConfigCobranza(tenantId);
  // `operador:operador_id` y no `operador` a secas: viaje tiene MÁS de una
  // relación con operador y PostgREST rechaza el embed ambiguo (se pagó en
  // producción el 14-ago-2026: la página entera caía con el error boundary).
  // `traerTodo` y no el `.limit(500)` que vivía aquí (auditoría de escala
  // 15k): `cola.vigilados` — el KPI "Viajes vigilados" de la página — era
  // `viajes.length` topado a 500, y un cliente de 500 viajes/día lo llenaba
  // solo. Lo abierto está acotado por la OPERACIÓN (un abierto por operador,
  // mig. 0029), no por el tiempo: paginar aquí es barato y el conteo vuelve a
  // ser verdad.
  const viajes = await traerTodo<{
    id: unknown; folio: unknown; fecha_inicio: unknown; avisado_en: unknown;
    recordatorio_comprobacion_en: unknown; operador: unknown;
  }>(
    (d, h) => supabaseAdmin()
      .from('viaje')
      .select('id, folio, fecha_inicio, avisado_en, recordatorio_comprobacion_en, operador:operador_id(nombre, telefono)', conteo(d))
      .eq('tenant_id', tenantId)
      .in('estatus', ['abierto', 'en_cuadre'])
      .not('fecha_inicio', 'is', null)
      // SOLO VIAJES QUE LIKIDA AVISÓ (auditoría 3, BE-C1): un viaje que el
      // chofer nunca recibió por WhatsApp no se le cobra por WhatsApp — sin
      // esto, el import del TMS (viajes históricos SIN aviso a propósito)
      // armaba cientos de "Llevas N días..." en la primera corrida del cron.
      // Mismo criterio que la escalación (escalar_viaje.ts).
      .not('avisado_en', 'is', null)
      .order('id').range(d, h),
    'colaCobranza',
  );

  const ids = viajes.map((v) => v.id as string);
  const contactosPorViaje = new Map<string, number[]>();
  if (ids.length > 0) {
    // `traerPorIds`: un `.in()` con más de mil viajes vivos se recorta a
    // 1,000 en silencio y el tier de contacto se perdería (ver pg.ts).
    const contactos = await traerPorIds<{ viaje_id: unknown; tier: unknown }>(
      ids,
      (tanda) => supabaseAdmin()
        .from('cobranza_contacto')
        .select('viaje_id, tier')
        .eq('tenant_id', tenantId)
        .in('viaje_id', tanda),
      'colaCobranza.contactos',
    );
    for (const c of contactos) {
      const lista = contactosPorViaje.get(c.viaje_id as string) ?? [];
      lista.push(c.tier as number);
      contactosPorViaje.set(c.viaje_id as string, lista);
    }
  }

  const cola: ColaCobranza = { paraContactar: [], sinTelefono: [], vigilados: viajes.length };
  type Rel = { nombre?: string; telefono?: string };
  for (const v of viajes) {
    // Cinturón además del filtro de la consulta (BE-C1): si esta lectura
    // llega por otro camino, el viaje sin aviso NO entra a ninguna cubeta.
    if (!v.avisado_en) continue;
    const dias = Math.floor((ahora.getTime() - Date.parse(`${v.fecha_inicio}T00:00:00Z`)) / 86_400_000);
    const previos = contactosPorViaje.get(v.id as string) ?? [];
    const tier = tierPendiente(dias, config.tiers, previos, v.recordatorio_comprobacion_en !== null);
    if (tier === null) continue;
    const rel = v.operador as Rel | Rel[] | null;
    const op = Array.isArray(rel) ? rel[0] : rel;
    const fila: FilaCola = {
      viajeId: v.id as string,
      folio: (v.folio as string) ?? null,
      operadorNombre: op?.nombre ?? null,
      operadorTelefono: op?.telefono ?? null,
      dias,
      tier,
      contactosPrevios: previos.length + (v.recordatorio_comprobacion_en !== null && previos.length === 0 ? 1 : 0),
    };
    (fila.operadorTelefono ? cola.paraContactar : cola.sinTelefono).push(fila);
  }
  // Lo más atorado arriba — el orden con el que un humano cobraría.
  cola.paraContactar.sort((a, b) => b.dias - a.dias);
  cola.sinTelefono.sort((a, b) => b.dias - a.dias);
  return cola;
}

export interface ResultadoCobranza {
  revisados: number;
  contactados: number;
  sinTelefono: number;
  /** El agente NO corrió y el porqué (pausado / fuera de ventana). */
  omitido?: string;
  fallos: string[];
  /** Cuántos quedaron SIN intentar porque el reloj de la corrida se agotó —
   *  se dicen, no se pierden: la siguiente corrida los levanta. */
  cortadosPorReloj: number;
  /** Contactos que Meta rechazó por un motivo REINTENTABLE (RES-1) y cuyo
   *  claim se BORRÓ: el tier queda libre para la corrida siguiente. */
  rechazosReintentables?: number;
  /** WhatsApp rechazó tantos seguidos que la corrida se detuvo (RES-1). La
   *  corrida global lo lee para no seguir quemando flotas contra una pared. */
  rechazoMasivo?: boolean;
}

/** Rechazos reintentables SEGUIDOS que detienen la corrida (RES-1). Un solo
 *  número de WhatsApp atiende a todas las flotas: cinco seguidos no son cinco
 *  teléfonos malos, es la cuenta limitada o bloqueada. */
export const TOPE_RECHAZOS_META_COBRANZA = 5;

/**
 * Corre la cobranza de UNA flota. `ignorarVentana` es para el botón
 * "Ejecutar ahora" de la página del agente — el humano que aprieta ES la
 * autorización de contactar fuera de horario. Un agente pausado no corre ni
 * a mano: pausado es pausado.
 */
export async function ejecutarCobranza(
  tenantId: string,
  ahora: Date = new Date(),
  opts: { ignorarVentana?: boolean; venceEn?: number } = {},
): Promise<ResultadoCobranza> {
  const config = await leerConfigCobranza(tenantId);
  if (!config.activo) {
    return { revisados: 0, contactados: 0, sinTelefono: 0, omitido: 'el agente está pausado', fallos: [], cortadosPorReloj: 0 };
  }
  if (!opts.ignorarVentana && !dentroDeVentana(config, ahora)) {
    return { revisados: 0, contactados: 0, sinTelefono: 0, omitido: 'fuera de la ventana de contacto', fallos: [], cortadosPorReloj: 0 };
  }

  const admin = supabaseAdmin();

  // RESCATE DE CLAIMS HUÉRFANOS (auditoría 3, REND-C2): un crash entre el
  // claim y el envío dejaba la fila enviado=false SIN detalle para siempre —
  // y como la cola cuenta toda fila como contacto, ese tier quedaba
  // consumido sin que ningún chofer recibiera nada. Una fila sin resultado
  // después de 1 hora es un crash probado (el update del resultado llega en
  // segundos): se BORRA, el unique queda libre, y la cola de ESTA corrida lo
  // re-reclama por el camino normal. Las filas legítimas no caen aquí: las
  // de sin-teléfono y las de envío rechazado siempre llevan `detalle`.
  await admin.from('cobranza_contacto')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('enviado', false)
    .is('detalle', null)
    .lt('created_at', new Date(ahora.getTime() - 3_600_000).toISOString())
    .then(({ error }) => {
      if (error) logger.warn('cobranza.rescate_claims_fallo', { tenantId, err: error.message });
    });

  const cola = await colaCobranza(tenantId, ahora);
  const r: ResultadoCobranza = {
    revisados: cola.paraContactar.length + cola.sinTelefono.length,
    contactados: 0,
    sinTelefono: cola.sinTelefono.length,
    fallos: [],
    cortadosPorReloj: 0,
    rechazosReintentables: 0,
  };
  let rechazosSeguidos = 0;

  // Los sin teléfono TAMBIÉN quedan en bitácora (enviado=false, con el
  // motivo): la página los enseña y el tier no se reintenta cada corrida.
  for (const v of cola.sinTelefono) {
    await admin.from('cobranza_contacto')
      .insert({ tenant_id: tenantId, viaje_id: v.viajeId, tier: v.tier, enviado: false, detalle: 'el operador no tiene teléfono capturado' })
      .then(({ error }) => {
        // Chocar con el unique = otra corrida ya lo anotó. No es un fallo.
        if (error && error.code !== '23505') logger.warn('cobranza.sin_telefono_sin_anotar', { viaje: v.viajeId, err: error.message });
      });
  }

  for (const v of cola.paraContactar) {
    // EL RELOJ CORTA ANTES DEL CLAIM (auditoría 3, REND-C2): a 750 camiones
    // los envíos seriales no caben en maxDuration — cortar DESPUÉS de
    // reclamar consumiría tiers sin mandar nada. Lo que no alcanzó queda
    // intacto y la corrida de la siguiente hora lo levanta (los tiers
    // persisten en los días del viaje, no en esta pasada).
    if (opts.venceEn !== undefined && Date.now() >= opts.venceEn) {
      r.cortadosPorReloj = cola.paraContactar.length - (r.contactados + r.fallos.length);
      logger.warn('cobranza.corte_por_reloj', { tenantId, pendientes: r.cortadosPorReloj });
      break;
    }
    // RECLAMAR ANTES DE MANDAR (patrón 0087/0058): el INSERT con
    // unique(viaje, tier) decide quién manda. El perdedor sigue de largo.
    const { error: errClaim } = await admin.from('cobranza_contacto')
      .insert({ tenant_id: tenantId, viaje_id: v.viajeId, tier: v.tier, enviado: false });
    if (errClaim) {
      if (errClaim.code !== '23505') r.fallos.push(`reclamar ${v.folio ?? v.viajeId}: ${errClaim.message}`);
      continue;
    }

    let enviado = false;
    let detalle: string | null = null;
    /** RES-1: el rechazo fue "vuelve más tarde" y el tier NO debe consumirse. */
    let reintentable = false;
    try {
      // `enviarTexto` (RES-1): el mismo envío que `sendText`, con el código de
      // Meta — que es lo único que distingue "este teléfono no sirve" de "vas
      // demasiado rápido", y de eso depende si el tier se quema o no.
      const envio = await enviarTexto(v.operadorTelefono as string, armarMensajeCobranza(v.folio, v.dias, config));
      enviado = envio.ok;
      if (!enviado) {
        // LA PLANTILLA CUANDO EL TEXTO NO PUEDE SALIR (auditoría 3, AG-A2).
        // La población objetivo de este agente es el chofer que lleva DÍAS
        // sin escribir — exactamente el que trae la ventana de 24 h cerrada,
        // donde Meta rechaza todo texto libre. Sin este fallback el agente
        // era mudo para quien existe: el claim consumía el tier en bitácora
        // y el chofer no recibía NI UNO de los tres contactos. Mismo patrón
        // que la escalación (escalar_viaje.ts): el texto bueno primero, la
        // plantilla aprobada solo cuando Meta lo rechaza. El cuerpo de
        // `recordatorio_cierre` se escribió para el cierre de liquidación —
        // menos preciso que el texto con los días y la firma, pero es lo
        // ÚNICO que WhatsApp entrega con la ventana cerrada, y habla del
        // mismo pendiente: cerrar el viaje.
        const env = await sendTemplate(v.operadorTelefono as string, 'recordatorio_cierre', {
          parametros: [v.operadorNombre ?? 'Operador', v.folio ?? 'sin folio'],
        });
        if (env.ok) {
          enviado = true;
          detalle = 'plantilla recordatorio_cierre (ventana de 24 h cerrada)';
        } else {
          detalle = `WhatsApp rechazó el texto libre y la plantilla también falló: ${motivoDeFalloWhatsApp(env.error, env.codigo)}`;
          // ── RES-1: UN 429 NO ES UN TIER GASTADO ────────────────────────
          // El claim es el INSERT con unique(viaje, tier): si se queda ahí
          // ante un rate limit, ese tier NO SE REINTENTA NUNCA (`tierPendiente`
          // lo cuenta como contacto hecho) y el chofer se queda sin uno de sus
          // tres avisos sin que nadie haya podido mandárselo.
          reintentable = esReintentableMeta(env.codigo) || esReintentableMeta(undefined, (envio as { status?: number }).status);
        }
      }
    } catch (e) {
      detalle = e instanceof Error ? e.message : 'error inesperado al enviar';
    }

    if (reintentable) {
      // El claim se BORRA: el unique queda libre y la corrida siguiente
      // vuelve a intentar este mismo tier, entero.
      await admin.from('cobranza_contacto')
        .delete()
        .eq('tenant_id', tenantId).eq('viaje_id', v.viajeId).eq('tier', v.tier)
        .then(({ error }) => {
          if (error) logger.error('cobranza.claim_no_liberado', { viaje: v.viajeId, err: error.message });
        });
      r.rechazosReintentables = (r.rechazosReintentables ?? 0) + 1;
      rechazosSeguidos++;
      r.fallos.push(`${v.folio ?? v.viajeId}: ${detalle} (se reintenta en la siguiente corrida)`);
      logger.warn('cobranza.rechazo_reintentable', { tenantId, viaje: v.viajeId, tier: v.tier });
      if (rechazosSeguidos >= TOPE_RECHAZOS_META_COBRANZA) {
        r.rechazoMasivo = true;
        r.cortadosPorReloj = cola.paraContactar.length - (r.contactados + r.fallos.length);
        logger.error('cobranza.rechazo_masivo', { tenantId, rechazosSeguidos });
        await alertarOperador('wa.rechazo_masivo', {
          error: `WhatsApp rechazó ${rechazosSeguidos} cobranzas seguidas por un motivo reintentable (rate limit o bloqueo). La corrida se detuvo; los tiers quedaron sin consumir.`,
          codigo: 'wa_rechazo_masivo',
        });
        break;
      }
      continue;
    }

    rechazosSeguidos = 0;
    if (enviado) r.contactados++;
    else r.fallos.push(`${v.folio ?? v.viajeId}: ${detalle}`);

    // El resultado se anota AUNQUE el envío falle (mismo criterio 0087: la
    // alternativa es reintentar para siempre el mismo número roto).
    await admin.from('cobranza_contacto')
      .update({ enviado, detalle })
      .eq('viaje_id', v.viajeId).eq('tier', v.tier).eq('tenant_id', tenantId)
      .then(({ error }) => { if (error) logger.warn('cobranza.resultado_sin_anotar', { viaje: v.viajeId, err: error.message }); });

    // El sello 0087 se conserva en el PRIMER contacto: alimenta "lo que hizo
    // solo" y mantiene compatibles los feeds existentes.
    if (v.contactosPrevios === 0) {
      await admin.from('viaje')
        .update({ recordatorio_comprobacion_en: ahora.toISOString() })
        .eq('id', v.viajeId).eq('tenant_id', tenantId)
        .is('recordatorio_comprobacion_en', null)
        .then(({ error }) => { if (error) logger.warn('cobranza.sello_sin_guardar', { viaje: v.viajeId, err: error.message }); });
    }
  }

  logger.info('agente_cobranza.corrida', { tenantId, ...r, fallos: r.fallos.length });
  return r;
}

/**
 * La corrida del CRON: todas las flotas con viajes vivos, cada una con SU
 * config (ventana incluida). Reemplaza a `enviarRecordatoriosComprobacion`
 * (0087) — misma conducta por default, ahora configurable por flota.
 */
/** El reloj de la corrida GLOBAL: 90s de los 120 del maxDuration del cron —
 *  el resto es margen para la escalación que corre antes y el arranque. */
export const PLAZO_COBRANZA_GLOBAL_MS = 90_000;

/** Nadie puede llevarse más de la mitad del reloj de la corrida: sin este
 *  piso, una flota grande consumía los 90 s y las demás no existían (ESC-4). */
export const TOPE_POR_FLOTA_MS = 30_000;

/**
 * Rota el punto de arranque de la lista SEGÚN LA HORA (ESC-4 / RES-6).
 *
 * El orden salía de `[...new Set(...)]` sobre una consulta ordenada por `id`:
 * determinista, o sea que las mismas flotas iban SIEMPRE primero y las de la
 * cola del alfabeto no se cobraban jamás en cuanto el reloj empezaba a cortar.
 * Rotar por hora reparte el privilegio: cada corrida arranca donde la anterior
 * se quedaría, y en un día todas encabezan la lista varias veces. Es
 * determinista dentro de la hora (dos corridas de la misma hora hacen lo mismo)
 * y no depende de guardar estado en ningún lado.
 */
export function rotarPorHora<T>(lista: readonly T[], ahora: Date): T[] {
  if (lista.length === 0) return [];
  const desde = ahora.getUTCHours() % lista.length;
  return [...lista.slice(desde), ...lista.slice(0, desde)];
}

export async function ejecutarCobranzaGlobal(ahora: Date = new Date(), opts: { venceEn?: number } = {}): Promise<{ tenants: number; contactados: number; cortadosPorReloj: number; fallos: string[]; rechazoMasivo?: boolean }> {
  // `traerTodo` y no el `.limit(1000)` que vivía aquí — que estaba EXACTAMENTE
  // en el tope de PostgREST, donde "hay 1,000" y "hay 90,000" son
  // indistinguibles (auditoría de escala 15k). Un solo cliente de 500
  // viajes/día llenaba las 1,000 filas con sus propios abiertos y NINGUNA
  // otra flota volvía a ser cobrada, sin error y sin log. Lo abierto está
  // acotado por la operación (mig. 0029), así que paginarlo es barato.
  const data = await traerTodo<{ tenant_id: unknown }>(
    (d, h) => supabaseAdmin()
      .from('viaje')
      .select('tenant_id', conteo(d))
      .in('estatus', ['abierto', 'en_cuadre'])
      .not('fecha_inicio', 'is', null)
      .order('id').range(d, h),
    'ejecutarCobranzaGlobal',
  );
  // Orden estable (por id) y DESPUÉS rotado por hora: ver `rotarPorHora`.
  const tenants = rotarPorHora([...new Set(data.map((v) => v.tenant_id as string))].sort(), ahora);

  // Un solo vencimiento para TODA la corrida (auditoría 3, REND-C2): a 750
  // camiones los envíos seriales nunca cabían en el maxDuration y el proceso
  // moría a la mitad, con claims consumidos. Ahora corta limpio, dice
  // cuántos quedaron, y la corrida de la siguiente hora los levanta.
  // El vencimiento lo puede imponer el llamador (el cron le da lo que le
  // quedó después de la escalación, ESC-3); si no, los 90 s de siempre.
  const venceEn = opts.venceEn ?? Date.now() + PLAZO_COBRANZA_GLOBAL_MS;

  const total = { tenants: tenants.length, contactados: 0, cortadosPorReloj: 0, fallos: [] as string[], rechazoMasivo: false };
  // Cómo le fue a CADA flota que sí alcanzó turno. El aviso se manda al final
  // y no aquí adentro por el reloj: los 90s están presupuestados para los
  // envíos de WhatsApp, y meter una escritura de notificación por flota dentro
  // de esa ventana le quitaría turno a choferes reales. Las que el corte dejó
  // fuera NO entran al mapa — ver `avisarCorridasPorFlota`.
  const corridas = new Map<string, unknown>();
  // Lo que se anota en la bitácora de corridas (B3) — se escribe AL FINAL,
  // por la misma razón del comentario de arriba: la ventana de 90s es de los
  // envíos, no de las anotaciones.
  const paraBitacora: Array<{ tenant: string; inicio: Date; fin: Date; contactados: number; fallos: number; error?: string }> = [];
  for (const t of tenants) {
    if (Date.now() >= venceEn) {
      logger.warn('cobranza.global_corte_por_reloj', { tenantsSinCorrer: tenants.length - tenants.indexOf(t) });
      break;
    }
    const inicioFlota = new Date();
    try {
      // ── PRESUPUESTO POR FLOTA (ESC-4 / RES-6) ──────────────────────────
      // El reloj era UNO solo para toda la corrida, así que la primera flota
      // podía consumirlo entero y las demás no llegaban ni a leer su cola. Se
      // reparte lo que queda entre las que faltan, con un techo por flota: la
      // grande avanza lo suyo cada hora y las chicas nunca se quedan sin turno.
      const faltan = tenants.length - tenants.indexOf(t);
      const restante = venceEn - Date.now();
      const venceFlota = Date.now() + Math.min(TOPE_POR_FLOTA_MS, Math.max(5_000, Math.floor(restante / faltan)));
      const r = await ejecutarCobranza(t, ahora, { venceEn: Math.min(venceEn, venceFlota) });
      total.contactados += r.contactados;
      total.cortadosPorReloj += r.cortadosPorReloj;
      total.fallos.push(...r.fallos);
      // RES-1: si WhatsApp está rechazando en masa, el problema no es de esta
      // flota — es del número que atiende a todas. Se para la corrida entera.
      if (r.rechazoMasivo) {
        total.rechazoMasivo = true;
        total.cortadosPorReloj += tenants.length - tenants.indexOf(t) - 1;
        logger.error('cobranza.global_corte_por_rechazo', { tenantsSinCorrer: tenants.length - tenants.indexOf(t) - 1 });
        corridas.set(t, null);
        paraBitacora.push({ tenant: t, inicio: inicioFlota, fin: new Date(), contactados: r.contactados, fallos: r.fallos.length });
        break;
      }
      corridas.set(t, null);
      paraBitacora.push({ tenant: t, inicio: inicioFlota, fin: new Date(), contactados: r.contactados, fallos: r.fallos.length });
    } catch (e) {
      total.fallos.push(`${t}: ${e instanceof Error ? e.message : 'corrida fallida'}`);
      corridas.set(t, e);
      paraBitacora.push({
        tenant: t, inicio: inicioFlota, fin: new Date(), contactados: 0, fallos: 0,
        error: 'La corrida de cobranza de esta flota no se pudo completar. El detalle quedó en los registros del sistema.',
      });
    }
  }

  await avisarCorridasPorFlota('cobranza', corridas, ahora);
  // `registrarCorrida` nunca lanza; allSettled es cinturón sobre tirantes.
  await Promise.allSettled(paraBitacora.map((b) => registrarCorrida(b.tenant, 'cobranza', {
    inicio: b.inicio,
    fin: b.fin,
    estado: b.error ? 'fallo' : b.fallos > 0 ? 'parcial' : 'ok',
    disparo: 'cron',
    tareasHechas: b.contactados,
    tareasTotal: b.contactados + b.fallos,
    resumen: { contactados: b.contactados, fallos: b.fallos },
    error: b.error,
  })));
  return total;
}

/** La bitácora reciente para la página del agente. */
export interface ContactoBitacora {
  folio: string | null;
  operadorNombre: string | null;
  tier: number;
  enviado: boolean;
  detalle: string | null;
  cuando: string;
}

export async function bitacoraCobranza(tenantId: string, limite = 12): Promise<ContactoBitacora[]> {
  const { data, error } = await supabaseAdmin()
    .from('cobranza_contacto')
    .select('tier, enviado, detalle, created_at, viaje:viaje_id(folio, operador:operador_id(nombre))')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limite);
  if (error) throw new Error(`bitacoraCobranza: ${error.message}`);
  type RelOp = { nombre?: string };
  type RelViaje = { folio?: string; operador?: RelOp | RelOp[] };
  return (data ?? []).map((c) => {
    const rv = c.viaje as RelViaje | RelViaje[] | null;
    const viaje = Array.isArray(rv) ? rv[0] : rv;
    const ro = viaje?.operador;
    const op = Array.isArray(ro) ? ro[0] : ro;
    return {
      folio: viaje?.folio ?? null,
      operadorNombre: op?.nombre ?? null,
      tier: c.tier as number,
      enviado: Boolean(c.enviado),
      detalle: typeof c.detalle === 'string' ? c.detalle : null,
      cuando: c.created_at as string,
    };
  });
}
