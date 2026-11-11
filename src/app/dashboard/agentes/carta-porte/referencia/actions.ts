'use server';

import { revalidatePath } from 'next/cache';
import { resolverTenantAtadoFirmado, CAMPO_FLOTA_PINTADA, MENSAJE_FLOTA_CAMBIO } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { rateLimit } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { fijarExigeReferencia, guardarReferenciaViaje } from '@/lib/likida/carta_porte_docs/referencia_cliente_puerto';
import * as repo from '@/lib/likida/carta_porte_docs/repo';
import type { ResultadoAccion } from '@/app/dashboard/carta-porte/documentos/forma_accion';
import { getT } from '@/lib/i18n/servidor';

// ═══════════════════════════════════════════════════════════════════════════
// REFERENCIA COMERCIAL DEL CLIENTE (T-A3-65, OLA1-A3: ya tiene pantalla).
// Server actions a nivel de módulo: vuelven a resolver sesión, rol y flota desde la cookie; jamás aceptan un tenant del formulario.
// La referencia NO entra al CCP ni bloquea el viaje: es un dato comercial para que el ejecutivo la pida.
// ═══════════════════════════════════════════════════════════════════════════

const RUTA = '/dashboard/agentes/carta-porte';
const RUTA_REFERENCIA = '/dashboard/agentes/carta-porte/referencia';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Captura (o borra, si va vacía) la referencia de UN viaje de la flota de la sesión. */
export async function capturarReferencia(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t: tx } = await getT('agentes');
  // MX-002: la flota que se pintó es la que escribe (la pantalla firma la flota en un campo oculto; la cookie del selector
  // es compartida entre pestañas). Sin firma válida —o con otra flota— no se escribe nada.
  const s = await resolverTenantAtadoFirmado(RUTA, fd.get(CAMPO_FLOTA_PINTADA));
  if (!s) return { ok: false, error: MENSAJE_FLOTA_CAMBIO };
  if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: tx('rest.tu_rol_no_puede_capturar_referencias') };
  try {
    const viajeId = String(fd.get('viajeId') ?? '');
    if (!UUID.test(viajeId)) return { ok: false, error: tx('rest.no_reconozco_ese_viaje_recarga_la') };
    if (!(await rateLimit(`cp-referencia:${s.tenantId}`, 120, 60_000))) return { ok: false, error: tx('rest.demasiados_cambios_en_poco_tiempo_espera') };
    // El viaje tiene que ser de ESTA flota: el puerto escribe por (tenant, viaje) pero la FK no basta para decir qué falló.
    if (!(await repo.viajePorId(s.tenantId, viajeId))) return { ok: false, error: tx('rest.ese_viaje_no_es_de_tu') };
    const r = await guardarReferenciaViaje(s.tenantId, viajeId, String(fd.get('referencia') ?? ''), s.userId);
    if (!r.ok) return { ok: false, error: r.error };
    revalidatePath(RUTA_REFERENCIA);
    return { ok: true, mensaje: tx('rest.referencia_guardada') };
  } catch (e) {
    logger.error('carta_porte_docs.referencia_guardar', { error: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: mensajeParaPantalla(e, 'guardar la referencia') };
  }
}

/** Enciende o apaga «este cliente exige referencia». */
export async function cambiarExigencia(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t: tx } = await getT('agentes');
  // MX-002: la flota que se pintó es la que escribe (la pantalla firma la flota en un campo oculto; la cookie del selector
  // es compartida entre pestañas). Sin firma válida —o con otra flota— no se escribe nada.
  const s = await resolverTenantAtadoFirmado(RUTA, fd.get(CAMPO_FLOTA_PINTADA));
  if (!s) return { ok: false, error: MENSAJE_FLOTA_CAMBIO };
  if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: tx('rest.tu_rol_no_puede_cambiar_esta') };
  try {
    const clienteId = String(fd.get('clienteId') ?? '');
    if (!UUID.test(clienteId)) return { ok: false, error: tx('rest.no_reconozco_ese_cliente_recarga_la') };
    if (!(await repo.clientePropio(s.tenantId, clienteId))) return { ok: false, error: tx('rest.ese_cliente_no_es_de_tu') };
    const exige = String(fd.get('exige') ?? '') === '1';
    const r = await fijarExigeReferencia(s.tenantId, clienteId, exige, s.userId);
    if (!r.ok) return { ok: false, error: r.error };
    await anotarBitacora(
      { tenantId: s.tenantId, actor: { id: s.userId }, accion: 'ccp.referencia_exigencia', entidad: 'tenant', entidadId: s.tenantId, detalle: { exige } },
      { evento: 'carta_porte_docs.bitacora_no_escribio' },
    );
    revalidatePath(RUTA_REFERENCIA);
    return { ok: true, mensaje: exige ? tx('rest.ese_cliente_ahora_exige_referencia_los') : tx('rest.ese_cliente_ya_no_exige_referencia') };
  } catch (e) {
    logger.error('carta_porte_docs.referencia_regla', { error: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: mensajeParaPantalla(e, 'cambiar la regla') };
  }
}
