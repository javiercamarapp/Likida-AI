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
import { traerTodo } from '@/lib/likida/pg';

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

/** Cuántas campañas muestra la pantalla de control (las más recientes). */
export const TOPE_CAMPANAS_PANTALLA = 100;

/**
 * UNA sola consulta de campañas (orden total: `creado_en` y `id` de desempate)
 * para la pantalla (`range` 0..99) y para el refresco de gasto (paginado
 * completo, solo Meta vivas).
 */
function consultaCampanas(desde: number, hasta: number, soloMetaVivas: boolean) {
  let q = supabaseAdmin().from('campana').select('*', { count: 'exact' });
  if (soloMetaVivas) q = q.eq('canal', 'meta').neq('estado', 'terminada').not('id_externo', 'is', null);
  return acotada(q.order('creado_en', { ascending: false }).order('id').range(desde, hasta), 'campanas.listar');
}

/** LANZA si la base no responde — cero campañas y base caída no son lo mismo.
 *  A37-S22-03: `total` es el conteo exacto; si supera `campanas.length` la
 *  pantalla debe decirlo (solo se muestran las más recientes). */
export async function listarCampanasConTotal(): Promise<{ campanas: Campana[]; total: number }> {
  const res = await consultaCampanas(0, TOPE_CAMPANAS_PANTALLA - 1, false);
  if (res.error) throw new Error(`listarCampanas: ${res.error.message}`);
  const filas = (res.data ?? []) as Array<Record<string, unknown>>;
  return { campanas: filas.map(desdeFila), total: typeof res.count === 'number' ? res.count : filas.length };
}

/** LANZA si la base no responde — cero campañas y base caída no son lo mismo. */
export async function listarCampanas(): Promise<Campana[]> {
  return (await listarCampanasConTotal()).campanas;
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
  /** A37-S22-03: campañas que NO se alcanzaron a medir porque se agotó el
   *  presupuesto de tiempo. No están en `fallidas` ni en `medidas`. */
  pendientes: number;
}

/** Presupuesto total de la acción: debajo del `maxDuration` de la plataforma. */
const PRESUPUESTO_REFRESCO_MS = 45_000;
const TIMEOUT_POR_CAMPANA_MS = 15_000;
const CONCURRENCIA_REFRESCO = 5;

/** `spend` de Meta es un string decimal: vacío, no numérico o negativo no es una medición. */
function gastoValido(spend: unknown): number | null {
  if (typeof spend !== 'string' && typeof spend !== 'number') return null;
  if (typeof spend === 'string' && spend.trim() === '') return null;
  const n = Number(spend);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Refresca el gasto REAL desde Meta (lifetime spend por campaña). Sin token
 * no finge: regresa `configurada: false`. Cada campaña falla por su lado.
 *
 * A37-S22-02: `gasto_real_usd` solo se escribe si la cuenta reporta
 * `account_currency` = USD y `spend` es un número válido; una cuenta en otra
 * moneda se rechaza con su motivo (no se inventa un tipo de cambio) y un valor
 * inválido nunca pisa la medición previa con NaN/null.
 * A37-S22-03: todas las campañas de Meta (lectura paginada, no las 100 de la
 * pantalla), 5 a la vez, con presupuesto total de tiempo, y el token en el
 * header `Authorization`, no en la URL.
 */
export async function refrescarGastoMeta(
  opts: { presupuestoMs?: number } = {},
): Promise<ResultadoRefresco> {
  const token = process.env.META_ADS_TOKEN;
  if (!token) return { medidas: 0, fallidas: [], configurada: false, pendientes: 0 };

  const venceEn = Date.now() + (opts.presupuestoMs ?? PRESUPUESTO_REFRESCO_MS);
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => consultaCampanas(d, h, true) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null; count?: number | null }>,
    'campanas.refrescar',
  );
  const campanas = filas.map(desdeFila).filter((c) => c.canal === 'meta' && c.idExterno && c.estado !== 'terminada');
  let medidas = 0;
  let siguiente = 0;
  const fallidas: Array<{ nombre: string; motivo: string }> = [];

  const medir = async (c: Campana): Promise<void> => {
    try {
      const resp = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(c.idExterno!)}/insights?fields=spend,account_currency&date_preset=maximum`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(Math.max(1, Math.min(TIMEOUT_POR_CAMPANA_MS, venceEn - Date.now()))),
        },
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const cuerpo = await resp.json() as { data?: Array<{ spend?: unknown; account_currency?: unknown }> };
      const fila = cuerpo.data?.[0];
      if (fila?.spend === undefined) throw new Error('la respuesta no trae spend');
      const moneda = typeof fila.account_currency === 'string' ? fila.account_currency.toUpperCase() : null;
      if (moneda !== 'USD') {
        throw new Error(moneda ? `la cuenta reporta en ${moneda}, no USD — no se convierte` : 'la respuesta no trae la moneda de la cuenta');
      }
      const gasto = gastoValido(fila.spend);
      if (gasto === null) throw new Error('spend no es un número válido');
      const { error } = await supabaseAdmin().from('campana')
        .update({ gasto_real_usd: gasto, gasto_medido_en: new Date().toISOString(), actualizado_en: new Date().toISOString() })
        .eq('id', c.id);
      if (error) throw new Error(error.message);
      medidas += 1;
    } catch (e) {
      fallidas.push({ nombre: c.nombre, motivo: e instanceof Error ? e.message.slice(0, 120) : 'red' });
    }
  };

  const obrero = async (): Promise<void> => {
    for (;;) {
      if (Date.now() >= venceEn) return;
      const i = siguiente++;
      if (i >= campanas.length) return;
      await medir(campanas[i]);
    }
  };
  const obreros: Array<Promise<void>> = [];
  for (let k = 0; k < Math.min(CONCURRENCIA_REFRESCO, campanas.length); k++) obreros.push(obrero());
  await Promise.all(obreros);

  const pendientes = Math.max(0, campanas.length - Math.min(siguiente, campanas.length));
  return { medidas, fallidas, configurada: true, pendientes };
}
