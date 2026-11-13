import { logger } from '@/lib/logger';
import { abrirToken, cambiarEstadoLinea, invalidarCacheLineas, lineaPorPhoneNumberId, lineasDeTenant, type LineaFila } from './linea_repo';

// ═══════════════════════════════════════════════════════════════════════════
// EL CANAL DE WHATSAPP — por qué número y con qué token se envía y se recibe.
//
// Hoy todo usa UN número (WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN del entorno). Un tenant puede tener, además, una línea
// propia de la MISMA app de Meta (tabla `tenant_whatsapp_linea`, mig. 1006). La firma del webhook (WHATSAPP_APP_SECRET) no cambia.
//
// REGLA DE ORO: un tenant SIN línea propia obtiene EXACTAMENTE el canal de hoy (`canalDePlataforma`). Una línea solo en alta
// (`pendiente`) tampoco cambia nada: el tenant sigue por el número global hasta que la línea se active.
//
// VARIAS LÍNEAS POR TENANT: cada una puede llevar terminal, propósito y marca de principal. `resolverCanal(tenantId, opts?)` elige la línea
// ACTIVA que coincida con `opts` (lineaId, terminalId, proposito); sin `opts` devuelve la principal; sin principal y con UNA sola activa,
// esa; con varias activas, sin principal y sin criterio, lanza `ambigua` (nunca elige al azar y nunca cae a la plataforma).
//
// FALLA CERRADO: si el tenant tiene línea y está pausada o con el token vencido, NO se manda por el número global (saldría un mensaje
// del tenant desde el número de otro): se lanza `CanalNoDisponible` y el llamador decide (encolar, avisar).
//
// AISLAMIENTO: `canalPorPhoneNumberId` resuelve el tenant dueño de un número; si el número no es de ninguna línea (o ya no está
// habilitada) devuelve null y el webhook lo descarta. Nunca cae a otro tenant.
// ═══════════════════════════════════════════════════════════════════════════

export type Canal = { phoneNumberId: string; token: string; origen: 'plataforma' | 'tenant'; lineaId: string | null };

export type MotivoCanalNoDisponible = 'pausada' | 'token_vencido' | 'sin_token' | 'ambigua' | 'sin_coincidencia';

/** Criterio para elegir entre las líneas de un tenant. Todos los campos dados deben coincidir. */
export type OpcionesCanal = { lineaId?: string; terminalId?: string; proposito?: string };

export class CanalNoDisponible extends Error {
  constructor(public tenantId: string, public motivo: MotivoCanalNoDisponible) {
    super(`La línea de WhatsApp del tenant no está disponible (${motivo})`);
    this.name = 'CanalNoDisponible';
  }
}

/** El canal global del entorno, como siempre. Lanza igual que antes si falta la configuración. */
export function canalDePlataforma(): Canal {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) throw new Error('WHATSAPP_ACCESS_TOKEN no configurado');
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneNumberId) throw new Error('WHATSAPP_PHONE_NUMBER_ID no configurado');
  return { phoneNumberId, token, origen: 'plataforma', lineaId: null };
}

function coincide(l: LineaFila, o: OpcionesCanal): boolean {
  return (o.lineaId === undefined || l.id === o.lineaId)
    && (o.terminalId === undefined || l.terminalId === o.terminalId)
    && (o.proposito === undefined || l.proposito === o.proposito);
}

function abrirCanal(tenantId: string, l: LineaFila): Canal {
  try {
    return { phoneNumberId: l.phoneNumberId, token: abrirToken(l), origen: 'tenant', lineaId: l.id };
  } catch {
    logger.error('wa.linea.token_no_abre', { tenantId, lineaId: l.id });
    throw new CanalNoDisponible(tenantId, 'sin_token');
  }
}

/**
 * El canal de un tenant. Sin `tenantId`, o sin línea propia, o con todas sus líneas aún pendientes: el de la plataforma.
 * Con `opts` elige entre las líneas que coinciden; sin `opts`, la principal activa, o la única activa si no hay principal.
 * Lanza `CanalNoDisponible` (nunca cae a la plataforma) si: la elegida está pausada/vencida, `opts` no coincide con ninguna línea
 * (`sin_coincidencia`) o hay varias activas sin principal ni criterio (`ambigua`).
 * Si la base falla, lanza (tampoco cae a la plataforma: no se sabe si el tenant tiene línea).
 */
export async function resolverCanal(tenantId?: string | null, opts?: OpcionesCanal): Promise<Canal> {
  if (!tenantId) return canalDePlataforma();
  const lineas = await lineasDeTenant(tenantId);
  if (lineas.length === 0) return canalDePlataforma();

  const hayCriterio = opts !== undefined && (opts.lineaId !== undefined || opts.terminalId !== undefined || opts.proposito !== undefined);
  const candidatas = hayCriterio ? lineas.filter((l) => coincide(l, opts)) : lineas;
  if (candidatas.length === 0) throw new CanalNoDisponible(tenantId, 'sin_coincidencia');

  const activas = candidatas.filter((l) => l.estado === 'activa');
  if (activas.length > 0) {
    // Sin criterio, una principal marcada pero vencida NO se salta en silencio hacia otra línea: falla cerrado con su motivo.
    if (!hayCriterio) {
      const principalVencida = candidatas.find((l) => l.principal && l.estado === 'token_vencido');
      if (principalVencida) throw new CanalNoDisponible(tenantId, 'token_vencido');
    }
    if (activas.length === 1) return abrirCanal(tenantId, activas[0]);
    const principales = activas.filter((l) => l.principal);
    if (principales.length === 1) return abrirCanal(tenantId, principales[0]);
    throw new CanalNoDisponible(tenantId, 'ambigua');
  }

  // Ninguna activa entre las candidatas: vencidas y pausadas fallan cerrado; solo pendientes siguen por la plataforma (como hoy).
  if (candidatas.some((l) => l.estado === 'token_vencido')) throw new CanalNoDisponible(tenantId, 'token_vencido');
  if (candidatas.some((l) => l.estado === 'pendiente')) return canalDePlataforma();
  throw new CanalNoDisponible(tenantId, 'pausada');
}

/**
 * Para el webhook entrante: el canal y el tenant dueños de un `phone_number_id`, o null si no es línea de ningún tenant.
 * Solo atiende líneas `activa` o `token_vencido` (el cliente sigue escribiendo aunque el token haya vencido; contestar es otro tema).
 * `pendiente` y `pausada` devuelven null: el mensaje se descarta. Caché de 30 s.
 */
export async function canalPorPhoneNumberId(phoneNumberId: string): Promise<{ canal: Canal; tenantId: string } | null> {
  if (!phoneNumberId) return null;
  const l = await lineaPorPhoneNumberId(phoneNumberId);
  if (!l || (l.estado !== 'activa' && l.estado !== 'token_vencido')) return null;
  try {
    return { canal: { phoneNumberId: l.phoneNumberId, token: abrirToken(l), origen: 'tenant', lineaId: l.id }, tenantId: l.tenantId };
  } catch {
    logger.error('wa.linea.token_no_abre', { tenantId: l.tenantId, lineaId: l.id });
    return null;
  }
}

/** Vacía la caché de líneas (alta, cambio de estado, rotación de token). */
export function invalidarCanales(): void { invalidarCacheLineas(); }

/** Meta contestó 190 con el token de esta línea: queda `token_vencido` y deja de enviar hasta que se renueve. No lanza. */
export async function marcarLineaTokenVencido(lineaId: string): Promise<void> {
  try {
    await cambiarEstadoLinea(lineaId, 'token_vencido', 'Meta rechazó el token de la línea (código 190). Hay que renovarlo.', ['activa', 'pendiente']);
  } catch {
    logger.error('wa.linea.marcar_vencido_fallo', { lineaId });
  }
}
