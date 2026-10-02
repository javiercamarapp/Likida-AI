import { puedeAdministrar } from '@/lib/auth/permisos';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { logger } from '@/lib/logger';
import { cuerpoDesdeFormulario, llavesCambiadas, mismosContactos } from './config_forma';
import { validarCambioConfig } from './lectura';
import { cargarContactosTrafico, guardarConfigConductor, leerConfigConductor } from './repo';

// ═══════════════════════════════════════════════════════════════════════════
// GUARDAR LA CONFIGURACIÓN DE FLOTA DEL AGENTE 5 desde el panel — la lógica de la acción de servidor, con
// puertos para probarla.
//
// ── PERMISO ────────────────────────────────────────────────────────────────
// Cambiar CUÁNDO se le insiste a cada chofer y A QUIÉN se despierta es configuración, no operación diaria:
// `puedeAdministrar` (el dueño). El jefe de tráfico VE la pantalla (área `operacion`) pero no la guarda. Se
// comprueba AQUÍ además de en la página: una acción de servidor es un endpoint. El `tenantId` sale de la
// sesión, nunca del formulario.
//
// ── UNA SOLA VALIDACIÓN ────────────────────────────────────────────────────
// El cuerpo que arma el formulario pasa por `validarCambioConfig`, la misma que `PUT /v1/conductor/config`:
// la escalera ascendente, la ventana, que la escalación vaya DESPUÉS del último recordatorio, el formato de
// los teléfonos. Lo que pasa aquí no rebota en los CHECK de la base.
//
// ── BITÁCORA ───────────────────────────────────────────────────────────────
// Quién cambió qué llaves y cuántos contactos quedaron. Nombres de llaves y conteos: nunca teléfonos ni
// nombres de personas (la bitácora sobrevive a un borrado ARCO).
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoConfigPanel = { ok: true; mensaje: string } | { ok: false; error: string };

export interface DepsConfigPanel {
  leer: typeof leerConfigConductor;
  contactos: typeof cargarContactosTrafico;
  guardar: typeof guardarConfigConductor;
  bitacora: typeof anotarBitacora;
}
export const depsConfigReales: DepsConfigPanel = {
  leer: leerConfigConductor, contactos: cargarContactosTrafico, guardar: guardarConfigConductor, bitacora: anotarBitacora,
};

export interface ContextoConfigPanel { tenantId: string; rol: string; usuarioId: string | null; email: string | null }

export async function guardarConfigDelPanel(
  ctx: ContextoConfigPanel, fd: { get(k: string): unknown }, d: DepsConfigPanel = depsConfigReales,
): Promise<ResultadoConfigPanel> {
  if (!puedeAdministrar(ctx.rol)) return { ok: false, error: 'Solo el dueño de la flota cambia la configuración del agente.' };
  const cuerpo = cuerpoDesdeFormulario(fd);
  if ('error' in cuerpo) return { ok: false, error: cuerpo.error };
  try {
    const [actual, contactosActuales] = await Promise.all([d.leer(ctx.tenantId), d.contactos(ctx.tenantId)]);
    const v = validarCambioConfig(cuerpo.ok, actual);
    if ('error' in v) return { ok: false, error: v.error };
    const r = await d.guardar(ctx.tenantId, v.ok.config, v.ok.contactos);
    if (r === 'terminal_ajena') return { ok: false, error: 'Alguno de los patios elegidos no es de tu flota.' };
    const cambiadas = llavesCambiadas(actual, v.ok.config);
    const contactosCambiaron = v.ok.contactos !== undefined && !mismosContactos(contactosActuales, v.ok.contactos);
    await d.bitacora({
      tenantId: ctx.tenantId, actor: { id: ctx.usuarioId, email: ctx.email }, accion: 'conductor.config_guardada', entidad: 'conductor_config', entidadId: ctx.tenantId,
      detalle: { llaves: cambiadas, contactos: v.ok.contactos?.length ?? contactosActuales.length, contactosCambiaron },
    });
    return { ok: true, mensaje: cambiadas.length === 0 && !contactosCambiaron ? 'No había cambios: la configuración ya estaba así.' : 'Configuración guardada. Aplica desde la próxima corrida del agente (cada 5 minutos).' };
  } catch (e) {
    logger.error('conductor.config_panel_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: 'No pude guardarlo ahorita. Intenta de nuevo en un momento.' };
  }
}
