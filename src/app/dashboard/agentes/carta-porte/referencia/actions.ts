'use server';

import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { rateLimit } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { fijarExigeReferencia, guardarReferenciaViaje } from '@/lib/likida/carta_porte_docs/referencia_cliente_puerto';
import * as repo from '@/lib/likida/carta_porte_docs/repo';
import type { ResultadoAccion } from '@/app/dashboard/carta-porte/documentos/forma_accion';

// ═══════════════════════════════════════════════════════════════════════════
// REFERENCIA COMERCIAL DEL CLIENTE (T-A3-65, OLA1-A3: ya tiene pantalla).
// Server actions a nivel de módulo: vuelven a resolver sesión, rol y flota desde la cookie; jamás aceptan un tenant del formulario.
// La referencia NO entra al CCP ni bloquea el viaje: es un dato comercial para que el ejecutivo la pida.
// ═══════════════════════════════════════════════════════════════════════════

const RUTA = '/dashboard/agentes/carta-porte';
const RUTA_REFERENCIA = '/dashboard/agentes/carta-porte/referencia';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const verComo = (fd: FormData) => ({
  tenant: typeof fd.get('tenant') === 'string' ? String(fd.get('tenant')) : undefined,
  rol: typeof fd.get('rol') === 'string' ? String(fd.get('rol')) : undefined,
  vista: typeof fd.get('vista') === 'string' ? String(fd.get('vista')) : undefined,
});

/** Captura (o borra, si va vacía) la referencia de UN viaje de la flota de la sesión. */
export async function capturarReferencia(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const s = await resolverTenantEfectivo(RUTA, verComo(fd));
  if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede capturar referencias de Carta Porte.' };
  try {
    const viajeId = String(fd.get('viajeId') ?? '');
    if (!UUID.test(viajeId)) return { ok: false, error: 'No reconozco ese viaje. Recarga la pantalla.' };
    if (!(await rateLimit(`cp-referencia:${s.tenantId}`, 120, 60_000))) return { ok: false, error: 'Demasiados cambios en poco tiempo. Espera un minuto.' };
    // El viaje tiene que ser de ESTA flota: el puerto escribe por (tenant, viaje) pero la FK no basta para decir qué falló.
    if (!(await repo.viajePorId(s.tenantId, viajeId))) return { ok: false, error: 'Ese viaje no es de tu flota.' };
    const r = await guardarReferenciaViaje(s.tenantId, viajeId, String(fd.get('referencia') ?? ''), s.userId);
    if (!r.ok) return { ok: false, error: r.error };
    revalidatePath(RUTA_REFERENCIA);
    return { ok: true, mensaje: 'Referencia guardada.' };
  } catch (e) {
    logger.error('carta_porte_docs.referencia_guardar', { error: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: mensajeParaPantalla(e, 'guardar la referencia') };
  }
}

/** Enciende o apaga «este cliente exige referencia». */
export async function cambiarExigencia(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const s = await resolverTenantEfectivo(RUTA, verComo(fd));
  if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede cambiar esta regla.' };
  try {
    const clienteId = String(fd.get('clienteId') ?? '');
    if (!UUID.test(clienteId)) return { ok: false, error: 'No reconozco ese cliente. Recarga la pantalla.' };
    if (!(await repo.clientePropio(s.tenantId, clienteId))) return { ok: false, error: 'Ese cliente no es de tu flota.' };
    const exige = String(fd.get('exige') ?? '') === '1';
    const r = await fijarExigeReferencia(s.tenantId, clienteId, exige, s.userId);
    if (!r.ok) return { ok: false, error: r.error };
    await anotarBitacora(
      { tenantId: s.tenantId, actor: { id: s.userId }, accion: 'ccp.referencia_exigencia', entidad: 'tenant', entidadId: s.tenantId, detalle: { exige } },
      { evento: 'carta_porte_docs.bitacora_no_escribio' },
    );
    revalidatePath(RUTA_REFERENCIA);
    return { ok: true, mensaje: exige ? 'Ese cliente ahora exige referencia: los viajes cargados sin ella aparecen como pendientes.' : 'Ese cliente ya no exige referencia.' };
  } catch (e) {
    logger.error('carta_porte_docs.referencia_regla', { error: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: mensajeParaPantalla(e, 'cambiar la regla') };
  }
}
