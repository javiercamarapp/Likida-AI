// ═══════════════════════════════════════════════════════════════════════════
// ALERTAS DE TOPE DE IA, PERSISTIDAS (CT-IA-01 · F5 · migración 0990).
//
// ANTES: el aviso salía solo al chocar con el 100 % del techo, y el "ya avisé
// hoy" era un Map por instancia: N instancias calientes = N avisos, un
// arranque en frío lo olvidaba, y al 80 % —cuando todavía hay tiempo de
// subir el techo o de apagar lo que se está comiendo el presupuesto— no
// avisaba nadie.
//
// AHORA: la deduplicación vive en `llm_alerta_tope` (PK flota/día MX/nivel) y
// `registrar_alerta_tope_llm` devuelve true SOLO a quien insertó la fila: ese
// avisa, los demás callan. Dos instancias simultáneas = un aviso.
//
// Dos entradas:
//   · `avisarTopeAlcanzado`: al rebotar con 'tope_tenant' (nivel 100).
//   · `revisarTopesIa`: barrido periódico (cada 15 min, lo dispara la guardia)
//     que compara el gasto del día de cada flota con su techo y avisa al 80 y
//     al 100. Sin tocar el camino caliente de cada llamada al modelo.
//
// NUNCA lanza: un aviso que no sale no puede tapar el error de presupuesto.
// Si la base no contesta al registrar, se AVISA igual (mejor un aviso repetido
// que un silencio) y se deja en el log.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import { hoyMx } from '@/lib/formato';
import type { OrigenTopeTenant } from './budget';
import { rpcRegistrarAlertaTope, rpcUsoLlmDiaPorFlota } from './repo';

export type NivelTope = 80 | 100;
export const NIVEL_AVISO_TEMPRANO: NivelTope = 80;
export const NIVEL_TOPE: NivelTope = 100;

/** PURA. Niveles que el gasto ya cruzó, de menor a mayor. Tope inválido = nada que avisar. */
export function nivelesCruzados(usoUsd: number, topeUsd: number): NivelTope[] {
  if (!Number.isFinite(usoUsd) || !Number.isFinite(topeUsd) || topeUsd <= 0 || usoUsd < 0) return [];
  const out: NivelTope[] = [];
  // Se compara con una tolerancia de 1e-9 para que 4.00 de 5.00 sea exactamente 80 %.
  if (usoUsd >= topeUsd * 0.8 - 1e-9) out.push(80);
  if (usoUsd >= topeUsd - 1e-9) out.push(100);
  return out;
}

/**
 * Registra el aviso en la base. `true` = ESTA llamada es la que debe avisar;
 * `false` = otra instancia ya lo hizo hoy; `null` = no se pudo saber (se avisa).
 */
export async function registrarAlertaTope(
  tenantId: string, dia: string, nivel: NivelTope, usoUsd: number, topeUsd: number, origen: OrigenTopeTenant | string,
): Promise<boolean | null> {
  try {
    const r = await rpcRegistrarAlertaTope(tenantId, dia, nivel, usoUsd, topeUsd, origen);
    if (r === null) return null;
    const { data, error } = r;
    if (error) {
      logger.warn('presupuesto_llm.alerta_tope_no_registrada', { tenantId, nivel, err: error.message });
      return null;
    }
    // Una respuesta fuera del contrato (no booleana) es "no se pudo saber": se avisa, nunca se calla.
    return typeof data === 'boolean' ? data : null;
  } catch (e) {
    logger.warn('presupuesto_llm.alerta_tope_no_registrada', { tenantId, nivel, err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

const TEXTO_NIVEL: Record<NivelTope, { evento: string; msg: string }> = {
  80: {
    evento: 'presupuesto_ia.tope_80',
    msg: 'La flota ya gastó el 80 % de su techo diario de IA. Si es un día normal de mucho trabajo, sube `tenant.config.presupuestoLlmUsdDia`; si no, revisa qué agente se está comiendo el presupuesto antes de que llegue al 100 %.',
  },
  100: {
    evento: 'presupuesto_ia.tope_tenant',
    msg: 'La flota agotó su techo diario de IA: el cuadre degrada a determinístico y las fotos esperan. Sube `tenant.config.presupuestoLlmUsdDia` si el tope quedó corto.',
  },
};

export interface AvisoTope {
  tenantId: string; nivel: NivelTope; usoUsd: number; topeUsd: number; origen: OrigenTopeTenant | string;
  proposito?: string; dia?: string; pedidoUsd?: number;
}

/** Avisa (una vez por flota/día/nivel, entre TODAS las instancias). Devuelve si esta llamada avisó. */
export async function avisarTopePersistido(a: AvisoTope): Promise<boolean> {
  const dia = a.dia ?? hoyMx();
  const primero = await registrarAlertaTope(a.tenantId, dia, a.nivel, a.usoUsd, a.topeUsd, a.origen);
  if (primero === false) return false;
  try {
    const { alertarOperador } = await import('@/lib/observability/alerta');
    const t = TEXTO_NIVEL[a.nivel];
    await alertarOperador(t.evento, {
      tenantId: a.tenantId, dia, nivel: `${a.nivel} %`,
      ...(a.proposito ? { proposito: a.proposito } : {}),
      ...(a.pedidoUsd !== undefined ? { pedidoUsd: a.pedidoUsd } : {}),
      usoUsd: Number(a.usoUsd.toFixed(4)), topeUsd: a.topeUsd, origenTope: a.origen,
      ...(primero === null ? { dedupBase: 'no verificada: la base no contestó, puede repetirse' } : {}),
      msg: t.msg,
    });
  } catch (e) {
    logger.warn('presupuesto_llm.alerta_tope_fallo', { tenantId: a.tenantId, err: e instanceof Error ? e.message : String(e) });
  }
  return true;
}

export interface ResultadoRevisionTopes { flotas: number; avisos: Array<{ tenantId: string; nivel: NivelTope }>; error?: string }

/**
 * Barrido: gasto del día por flota contra su techo. `topeDe` es inyectable
 * (por omisión, `topeDiarioDelTenant` de budget.ts: explícito → plan → piso).
 */
export async function revisarTopesIa(
  topeDe?: (tenantId: string) => Promise<{ topeUsd: number; origen: OrigenTopeTenant }>,
): Promise<ResultadoRevisionTopes> {
  const resultado: ResultadoRevisionTopes = { flotas: 0, avisos: [] };
  try {
    const dia = hoyMx();
    const r = await rpcUsoLlmDiaPorFlota(dia);
    if (r === null) return { ...resultado, error: 'cliente sin rpc' };
    const { data, error } = r;
    if (error) {
      logger.error('presupuesto_llm.barrido_tope_fallo', { err: error.message });
      return { ...resultado, error: error.message };
    }
    const filas = Array.isArray(data) ? (data as Array<{ tenant_id: string; usado_usd: number | string }>) : [];
    const resolver = topeDe ?? (await import('./budget')).topeDiarioDelTenant;
    resultado.flotas = filas.length;
    for (const f of filas) {
      const uso = Number(f.usado_usd);
      const tope = await resolver(f.tenant_id);
      for (const nivel of nivelesCruzados(uso, tope.topeUsd)) {
        const avise = await avisarTopePersistido({ tenantId: f.tenant_id, nivel, usoUsd: uso, topeUsd: tope.topeUsd, origen: tope.origen, dia });
        if (avise) resultado.avisos.push({ tenantId: f.tenant_id, nivel });
      }
    }
    return resultado;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    logger.error('presupuesto_llm.barrido_tope_fallo', { err });
    return { ...resultado, error: err };
  }
}
