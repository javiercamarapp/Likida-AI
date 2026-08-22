// ═══════════════════════════════════════════════════════════════════════════
// CONTROL DE CAMPAÑAS (0123, panel-de-adquisicion §4) — LEER gasto y PAUSAR.
//
// LA ASIMETRÍA ES EL DISEÑO: este módulo NO tiene función de crear campañas
// ni de subir presupuesto — esas son acciones humanas en el Ads Manager, con
// la fila local aprobada a mano (el CHECK campana_activa_solo_aprobada exige
// el aprobador). Pausar gasto sí es de un clic: es la acción contraria a
// gastar sin permiso.
//
// EL GASTO REAL es el que reporta la plataforma. Sin `META_ADS_TOKEN`, la
// lectura DICE «sin integración configurada» — jamás un $0 con cara de
// medición. Google Ads queda declarado sin cliente: su API exige developer
// token + OAuth (trámite de Javier), y fingir la lectura sería peor que
// decirlo.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { acotada } from '@/lib/likida/presupuesto';
import { DatoInvalido } from '@/lib/likida/errores';

export interface Campana {
  id: string;
  canal: 'meta' | 'google';
  idExterno: string | null;
  nombre: string;
  presupuestoAprobadoUsd: number;
  cplObjetivoUsd: number | null;
  estado: 'activa' | 'pausada' | 'terminada';
  aprobadoPorEmail: string | null;
  aprobadoEn: string | null;
  /** NULL = sin medir (y la pantalla lo dice) — nunca un 0 inventado. */
  gastoRealUsd: number | null;
  gastoMedidoEn: string | null;
}

function desdeFila(f: Record<string, unknown>): Campana {
  return {
    id: String(f.id),
    canal: f.canal as Campana['canal'],
    idExterno: (f.id_externo as string) ?? null,
    nombre: String(f.nombre),
    presupuestoAprobadoUsd: Number(f.presupuesto_aprobado_usd),
    cplObjetivoUsd: f.cpl_objetivo_usd === null ? null : Number(f.cpl_objetivo_usd),
    estado: f.estado as Campana['estado'],
    aprobadoPorEmail: (f.aprobado_por_email as string) ?? null,
    aprobadoEn: (f.aprobado_en as string) ?? null,
    gastoRealUsd: f.gasto_real_usd === null ? null : Number(f.gasto_real_usd),
    gastoMedidoEn: (f.gasto_medido_en as string) ?? null,
  };
}

/** LANZA si la base no responde — cero campañas y base caída no son lo mismo. */
export async function listarCampanas(): Promise<Campana[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('campana').select('*').order('creado_en', { ascending: false }).limit(100), 'campanas.listar');
  if (error) throw new Error(`listarCampanas: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map(desdeFila);
}

export interface ResultadoPausa {
  ok: true;
  /** `true` = la plataforma confirmó la pausa remota; `false` = solo quedó
   *  pausada AQUÍ y el mensaje dice qué falta apagar a mano. */
  remotaConfirmada: boolean;
  mensaje: string;
}

/**
 * Pausa de un clic (la única escritura remota permitida). Orden: primero la
 * plataforma, luego la fila — si Meta rechaza la pausa, la fila NO se marca
 * pausada: marcarla mentiría mientras la campaña sigue gastando. Sin token,
 * se pausa LOCAL y el mensaje exige apagarla también en el Ads Manager.
 */
export async function pausarCampana(id: string, actorId: string): Promise<ResultadoPausa> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('campana').select('id, canal, id_externo, nombre, estado')
    .eq('id', id).maybeSingle(), 'campanas.pausar.leer');
  if (error) throw new Error(`pausarCampana: ${error.message}`);
  if (!data) throw new DatoInvalido('Esa campaña no existe — recarga.');
  const c = data as { id: string; canal: string; id_externo: string | null; nombre: string; estado: string };
  if (c.estado !== 'activa') throw new DatoInvalido(`«${c.nombre}» no está activa (está ${c.estado}) — no hay gasto que pausar.`);

  const token = process.env.META_ADS_TOKEN;
  let remotaConfirmada = false;
  if (c.canal === 'meta' && token && c.id_externo) {
    const r = await pausarEnMeta(c.id_externo, token);
    if (!r.ok) {
      // La plataforma NO confirmó: la fila se queda activa — la verdad.
      throw new DatoInvalido(`Meta no aceptó la pausa (${r.detalle}) — la campaña SIGUE ACTIVA y gastando. Reintenta o pásala desde el Ads Manager.`);
    }
    remotaConfirmada = true;
  }

  const { data: upd, error: errUpd } = await acotada(supabaseAdmin()
    .from('campana')
    .update({ estado: 'pausada', actualizado_en: new Date().toISOString() })
    .eq('id', id).eq('estado', 'activa')
    .select('id'), 'campanas.pausar');
  if (errUpd) throw new Error(`pausarCampana: ${errUpd.message}`);
  if (!Array.isArray(upd) || upd.length === 0) {
    throw new DatoInvalido('Alguien más la resolvió antes — recarga.');
  }

  await anotarBitacora(
    { tenantId: null, actor: { id: actorId }, accion: 'campana.pausada', entidad: 'campana', entidadId: id,
      detalle: { remota_confirmada: remotaConfirmada, canal: c.canal } },
    { evento: 'campanas.bitacora_no_escribio', contexto: { campana: id } },
  );

  return {
    ok: true,
    remotaConfirmada,
    mensaje: remotaConfirmada
      ? `«${c.nombre}» pausada — Meta confirmó; el gasto se detuvo.`
      : `«${c.nombre}» pausada AQUÍ, pero sin integración (${c.canal === 'meta' ? 'META_ADS_TOKEN sin configurar o campaña sin id externo' : 'Google Ads sin cliente'}) — apágala también en el Ads Manager o seguirá gastando allá.`,
  };
}

/** POST a la Graph API: status=PAUSED. Reporta POR VALOR — el llamador
 *  decide qué es fatal. */
async function pausarEnMeta(idExterno: string, token: string): Promise<{ ok: true } | { ok: false; detalle: string }> {
  try {
    const resp = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(idExterno)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ status: 'PAUSED', access_token: token }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      const cuerpo = await resp.text().catch(() => '');
      return { ok: false, detalle: `HTTP ${resp.status}${cuerpo ? `: ${cuerpo.slice(0, 120)}` : ''}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, detalle: e instanceof Error ? e.message.slice(0, 120) : 'red' };
  }
}

export interface EstadoIntegracionAds {
  metaConfigurada: boolean;
  googleConfigurada: false;
  nota: string;
}

export function estadoIntegracionAds(): EstadoIntegracionAds {
  const meta = Boolean(process.env.META_ADS_TOKEN);
  return {
    metaConfigurada: meta,
    googleConfigurada: false,
    nota: meta
      ? 'Meta conectada (lectura de gasto y pausa). Google Ads sin cliente: exige developer token + OAuth — trámite pendiente.'
      : 'Sin integración de gasto: configura META_ADS_TOKEN para leer gasto real y pausar desde aquí. Google Ads además exige developer token + OAuth.',
  };
}

export interface ResultadoRefresco {
  medidas: number;
  fallidas: Array<{ nombre: string; motivo: string }>;
  /** `false` = no había token: no se midió nada y SE DICE. */
  configurada: boolean;
}

/**
 * Refresca el gasto REAL desde Meta (lifetime spend por campaña). Sin token
 * no finge: regresa `configurada: false`. Cada campaña falla por su lado.
 */
export async function refrescarGastoMeta(): Promise<ResultadoRefresco> {
  const token = process.env.META_ADS_TOKEN;
  if (!token) return { medidas: 0, fallidas: [], configurada: false };

  const campanas = (await listarCampanas()).filter((c) => c.canal === 'meta' && c.idExterno && c.estado !== 'terminada');
  let medidas = 0;
  const fallidas: Array<{ nombre: string; motivo: string }> = [];
  for (const c of campanas) {
    try {
      const resp = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(c.idExterno!)}/insights?fields=spend&date_preset=maximum&access_token=${encodeURIComponent(token)}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const cuerpo = await resp.json() as { data?: Array<{ spend?: string }> };
      const spend = cuerpo.data?.[0]?.spend;
      if (spend === undefined) throw new Error('la respuesta no trae spend');
      const { error } = await supabaseAdmin().from('campana')
        .update({ gasto_real_usd: Number(spend), gasto_medido_en: new Date().toISOString(), actualizado_en: new Date().toISOString() })
        .eq('id', c.id);
      if (error) throw new Error(error.message);
      medidas += 1;
    } catch (e) {
      fallidas.push({ nombre: c.nombre, motivo: e instanceof Error ? e.message.slice(0, 120) : 'red' });
    }
  }
  return { medidas, fallidas, configurada: true };
}
