import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { sendText } from '@/lib/meta/client';
import { TZ_MX } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// EL AGENTE DE COBRANZA DE COMPROBANTES (0089, 14-ago-2026).
//
// Es el recordatorio de comprobación (0087) PRODUCTIZADO con la anatomía del
// Agente de Cobranza de Handle (docs/conocimiento/handle-el-mapa-completo-
// para-likida.md, prioridad 1 del roadmap): el cliente configura tiers de
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

export interface ConfigCobranza {
  activo: boolean;
  /** Días sin comprobar a los que se insiste, ascendentes. */
  tiers: number[];
  horaInicio: number;
  horaFin: number;
  /** Días permitidos, ISO (1 = lunes … 7 = domingo). */
  diasSemana: number[];
  /** La "estrategia" del cliente: una línea extra que viaja en el mensaje. */
  instrucciones: string;
  /** Cómo firma el agente (nombre del despacho o del ejecutivo). */
  firma: string;
}

/** La conducta del 0087, como default: sin fila de config, el agente se
 *  porta EXACTAMENTE como el recordatorio de siempre (primer tier = 3 días)
 *  más los tiers de insistencia que Handle nos enseñó a cobrar. */
export const CONFIG_COBRANZA_DEFAULT: ConfigCobranza = {
  activo: true,
  tiers: [3, 7, 14],
  horaInicio: 9,
  horaFin: 18,
  diasSemana: [1, 2, 3, 4, 5, 6],
  instrucciones: '',
  firma: '',
};

/** Valida y NORMALIZA una config que viene de un formulario. Devuelve el
 *  error en palabras de pantalla, o la config lista para guardar. */
export function validarConfigCobranza(cruda: Partial<ConfigCobranza>): { ok: ConfigCobranza } | { error: string } {
  const base = { ...CONFIG_COBRANZA_DEFAULT, ...cruda };
  const tiers = (base.tiers ?? []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 60);
  if (tiers.length === 0 || tiers.length > 5) {
    return { error: 'Los tiers necesitan entre 1 y 5 valores, de 1 a 60 días.' };
  }
  const ordenados = [...tiers].sort((a, b) => a - b);
  if (new Set(ordenados).size !== ordenados.length) {
    return { error: 'Los tiers no pueden repetirse.' };
  }
  const horaInicio = Number(base.horaInicio), horaFin = Number(base.horaFin);
  if (!Number.isInteger(horaInicio) || horaInicio < 0 || horaInicio > 23) return { error: 'La hora de inicio va de 0 a 23.' };
  if (!Number.isInteger(horaFin) || horaFin < 1 || horaFin > 24) return { error: 'La hora de fin va de 1 a 24.' };
  if (horaFin <= horaInicio) return { error: 'La ventana necesita terminar después de empezar.' };
  const diasSemana = (base.diasSemana ?? []).map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
  if (diasSemana.length === 0) return { error: 'El agente necesita al menos un día permitido.' };
  return {
    ok: {
      activo: Boolean(base.activo),
      tiers: ordenados,
      horaInicio,
      horaFin,
      diasSemana: [...new Set(diasSemana)].sort((a, b) => a - b),
      instrucciones: String(base.instrucciones ?? '').trim().slice(0, 300),
      firma: String(base.firma ?? '').trim().slice(0, 80),
    },
  };
}

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

/** ¿AHORA MISMO el agente puede contactar? Hora y día en México — la ventana
 *  es del chofer, no del servidor. */
export function dentroDeVentana(config: ConfigCobranza, ahora: Date): boolean {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ_MX, hour12: false, hour: 'numeric', weekday: 'short',
  }).formatToParts(ahora);
  const hora = Number(partes.find((p) => p.type === 'hour')?.value ?? '-1') % 24;
  const DIA_ISO: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const dia = DIA_ISO[partes.find((p) => p.type === 'weekday')?.value ?? ''] ?? 0;
  return config.diasSemana.includes(dia) && hora >= config.horaInicio && hora < config.horaFin;
}

/** El tier que TOCA para un viaje: el mayor tier ya alcanzado por los días
 *  sin comprobar que no tenga contacto en bitácora. El sello viejo (0087)
 *  cuenta como el primer tier consumido — al estrenar tiers nadie recibe de
 *  nuevo el recordatorio que ya recibió. */
export function tierPendiente(
  dias: number,
  tiers: number[],
  tiersContactados: number[],
  selloViejo: boolean,
): number | null {
  const consumidos = new Set(tiersContactados);
  if (selloViejo && tiersContactados.length === 0 && tiers.length > 0) consumidos.add(tiers[0]);
  const alcanzados = tiers.filter((t) => dias >= t && !consumidos.has(t));
  return alcanzados.length > 0 ? Math.max(...alcanzados) : null;
}

/** El mensaje al CHOFER — el texto base honesto del 0087 + la línea de
 *  instrucciones del cliente + la firma. No regaña: el viaje puede estar
 *  detenido por algo que no depende de él. */
export function armarMensajeCobranza(
  folio: string | null,
  dias: number,
  config: ConfigCobranza,
): string {
  const viaje = folio ? `tu viaje *${folio}*` : 'tu viaje abierto';
  const lineas = [
    `Llevas ${dias} días con ${viaje} sin mandarme comprobantes. 📋`,
    '',
    'Mándame las fotos de tus recibos (diésel, casetas, lo que traigas) para irlos anotando.',
    'Si el viaje ya terminó y falta cerrarlo, dime y seguimos con eso.',
  ];
  if (config.instrucciones) lineas.push('', config.instrucciones);
  if (config.firma) lineas.push('', `— ${config.firma}`);
  return lineas.join('\n');
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
  const { data, error } = await supabaseAdmin()
    .from('viaje')
    .select('id, folio, fecha_inicio, recordatorio_comprobacion_en, operador(nombre, telefono)')
    .eq('tenant_id', tenantId)
    .in('estatus', ['abierto', 'en_cuadre'])
    .not('fecha_inicio', 'is', null)
    .limit(500);
  if (error) throw new Error(`colaCobranza: ${error.message}`);

  const viajes = data ?? [];
  const ids = viajes.map((v) => v.id as string);
  const contactosPorViaje = new Map<string, number[]>();
  if (ids.length > 0) {
    const { data: contactos, error: errC } = await supabaseAdmin()
      .from('cobranza_contacto')
      .select('viaje_id, tier')
      .eq('tenant_id', tenantId)
      .in('viaje_id', ids);
    if (errC) throw new Error(`colaCobranza.contactos: ${errC.message}`);
    for (const c of contactos ?? []) {
      const lista = contactosPorViaje.get(c.viaje_id as string) ?? [];
      lista.push(c.tier as number);
      contactosPorViaje.set(c.viaje_id as string, lista);
    }
  }

  const cola: ColaCobranza = { paraContactar: [], sinTelefono: [], vigilados: viajes.length };
  type Rel = { nombre?: string; telefono?: string };
  for (const v of viajes) {
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
}

/**
 * Corre la cobranza de UNA flota. `ignorarVentana` es para el botón
 * "Ejecutar ahora" de la página del agente — el humano que aprieta ES la
 * autorización de contactar fuera de horario. Un agente pausado no corre ni
 * a mano: pausado es pausado.
 */
export async function ejecutarCobranza(
  tenantId: string,
  ahora: Date = new Date(),
  opts: { ignorarVentana?: boolean } = {},
): Promise<ResultadoCobranza> {
  const config = await leerConfigCobranza(tenantId);
  if (!config.activo) {
    return { revisados: 0, contactados: 0, sinTelefono: 0, omitido: 'el agente está pausado', fallos: [] };
  }
  if (!opts.ignorarVentana && !dentroDeVentana(config, ahora)) {
    return { revisados: 0, contactados: 0, sinTelefono: 0, omitido: 'fuera de la ventana de contacto', fallos: [] };
  }

  const cola = await colaCobranza(tenantId, ahora);
  const r: ResultadoCobranza = {
    revisados: cola.paraContactar.length + cola.sinTelefono.length,
    contactados: 0,
    sinTelefono: cola.sinTelefono.length,
    fallos: [],
  };
  const admin = supabaseAdmin();

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
    try {
      // sendText devuelve el id del mensaje de Meta, o null si rechazó.
      const idMensaje = await sendText(v.operadorTelefono as string, armarMensajeCobranza(v.folio, v.dias, config));
      enviado = idMensaje !== null;
      if (!enviado) detalle = 'WhatsApp rechazó el envío';
    } catch (e) {
      detalle = e instanceof Error ? e.message : 'error inesperado al enviar';
    }
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
export async function ejecutarCobranzaGlobal(ahora: Date = new Date()): Promise<{ tenants: number; contactados: number; fallos: string[] }> {
  const { data, error } = await supabaseAdmin()
    .from('viaje')
    .select('tenant_id')
    .in('estatus', ['abierto', 'en_cuadre'])
    .not('fecha_inicio', 'is', null)
    .limit(1000);
  if (error) throw new Error(`ejecutarCobranzaGlobal: ${error.message}`);
  const tenants = [...new Set((data ?? []).map((v) => v.tenant_id as string))];

  const total = { tenants: tenants.length, contactados: 0, fallos: [] as string[] };
  for (const t of tenants) {
    try {
      const r = await ejecutarCobranza(t, ahora);
      total.contactados += r.contactados;
      total.fallos.push(...r.fallos);
    } catch (e) {
      total.fallos.push(`${t}: ${e instanceof Error ? e.message : 'corrida fallida'}`);
    }
  }
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
    .select('tier, enviado, detalle, created_at, viaje:viaje_id(folio, operador(nombre))')
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
