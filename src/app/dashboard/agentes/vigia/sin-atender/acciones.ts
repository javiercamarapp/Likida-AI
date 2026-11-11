'use server';

import { resolverTenantAtadoFirmado, MENSAJE_FLOTA_CAMBIO } from '@/lib/auth/tenant-atado';
import { CAMPO_FLOTA_PINTADA } from '@/lib/auth/flota_cambio';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { appUrl } from '@/lib/env';
import { getT } from '@/lib/i18n/servidor';
import { emailDeUsuario } from '@/lib/likida/conductor/trabajo';
import { enviarResumenPanel, guardarConfigPanel, revisarPanel, type ContextoSinAtender, type EstadoRevisionUI, type ResultadoEnvioUI, type ResultadoGuardadoUI } from '@/lib/likida/vigia/sin_atender_aviso/acciones';
import { type TAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';

// ═══════════════════════════════════════════════════════════════════════════
// Acciones de servidor A NIVEL DE MÓDULO: vuelven a resolver sesión, rol y flota desde la cookie y la flota pintada firmada;
// JAMÁS aceptan un tenant del formulario. Revisar no guarda nada; mandar el resumen y guardar la configuración los decide la lógica (solo administración).
// ═══════════════════════════════════════════════════════════════════════════

const RUTA = '/dashboard/agentes/vigia/sin-atender';
const sinAcceso = (tx: TAgentes = TR_ES.t) => (tx('rest.no_tienes_acceso_a_esta_pantalla'));

type ResultadoContexto = { readonly error: string } | { readonly ctx: ContextoSinAtender };

async function contexto(fd: FormData): Promise<ResultadoContexto> {
  const s = await resolverTenantAtadoFirmado(RUTA, fd.get(CAMPO_FLOTA_PINTADA));
  if (!s) return { error: MENSAJE_FLOTA_CAMBIO };
  if (!puedeVerRuta(s.rol, RUTA)) return { error: sinAcceso((await getT('agentes')).t) };
  const email = (await emailDeUsuario(s.userId).catch(() => null)) ?? null;
  return { ctx: { tenantId: s.tenantId, rol: s.rol, usuarioId: s.userId, email, liga: `${appUrl()}${RUTA}` } };
}

export async function revisarSinAtenderAccion(_previo: EstadoRevisionUI, fd: FormData): Promise<EstadoRevisionUI> {
  const c = await contexto(fd);
  if ('error' in c) return { ok: false, error: c.error };
  return revisarPanel(c.ctx, fd);
}

export async function enviarResumenAccion(_previo: ResultadoEnvioUI | null, fd: FormData): Promise<ResultadoEnvioUI> {
  const c = await contexto(fd);
  if ('error' in c) return { ok: false, error: c.error };
  return enviarResumenPanel(c.ctx, fd);
}

export async function guardarConfigAccion(_previo: ResultadoGuardadoUI | null, fd: FormData): Promise<ResultadoGuardadoUI> {
  const c = await contexto(fd);
  if ('error' in c) return { ok: false, error: c.error };
  return guardarConfigPanel(c.ctx, fd);
}
