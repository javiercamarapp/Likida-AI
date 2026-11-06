'use server';

import { resolverTenantAtadoFirmado, MENSAJE_FLOTA_CAMBIO } from '@/lib/auth/tenant-atado';
import { CAMPO_FLOTA_PINTADA } from '@/lib/auth/flota_cambio';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { appUrl } from '@/lib/env';
import { emailDeUsuario } from '@/lib/likida/conductor/trabajo';
import { enviarResumenPanel, revisarPanel, type ContextoSinAtender, type EstadoRevisionUI, type ResultadoEnvioUI } from '@/lib/likida/vigia/sin_atender_aviso/acciones';

// ═══════════════════════════════════════════════════════════════════════════
// Acciones de servidor A NIVEL DE MÓDULO: vuelven a resolver sesión, rol y flota desde la cookie y la flota pintada firmada;
// JAMÁS aceptan un tenant del formulario. Revisar no guarda nada; mandar el resumen lo decide la lógica (solo administración).
// ═══════════════════════════════════════════════════════════════════════════

const RUTA = '/dashboard/agentes/vigia/sin-atender';
const SIN_ACCESO = 'No tienes acceso a esta pantalla.';

type ResultadoContexto = { readonly error: string } | { readonly ctx: ContextoSinAtender };

async function contexto(fd: FormData): Promise<ResultadoContexto> {
  const s = await resolverTenantAtadoFirmado(RUTA, fd.get(CAMPO_FLOTA_PINTADA));
  if (!s) return { error: MENSAJE_FLOTA_CAMBIO };
  if (!puedeVerRuta(s.rol, RUTA)) return { error: SIN_ACCESO };
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
