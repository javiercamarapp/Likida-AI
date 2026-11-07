import { puedeVerArea } from '@/lib/auth/visibilidad';
import { guardarCorreoAvisos, leerCorreoAvisos } from '@/lib/likida/peajes/datos';
import { enviarPruebaCorreoAvisos, type DepsPruebaCorreo } from '@/lib/likida/peajes/aviso_correo_prueba';
import type { ConfigCorreoAvisos } from '@/lib/likida/peajes/aviso_correo';

// ═══════════════════════════════════════════════════════════════════════════
// LAS ACCIONES DEL CORREO DE AVISOS DE PEAJES (pantalla de configuración). NO es un archivo de acciones de servidor: la página
// envuelve cada llamada en la suya, con la sesión ya resuelta. Aquí vive la puerta, la lectura del formulario y el guardado.
//   · Solo administración de SU flota (un superadmin entra a cualquiera).
//   · Valida con las reglas del canal (`validarCorreoAvisos`): correos válidos, tope de destinatarios, fecha real, y no se enciende
//     sin destinatario ni fecha de corte. Lo que no pasa no escribe nada.
//   · El interruptor solo está encendido si el formulario lo trae marcado: ante cualquier duda queda APAGADO.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoAccionCorreo = { ok: true; mensaje: string } | { ok: false; error: string };

export interface SesionCorreo { rol: string; tenantId: string | null }

/** `null` = puede; si no, el motivo en llano. */
export function permisoCorreoAvisos(sesion: SesionCorreo, tenantId: string): string | null {
  if (!puedeVerArea(sesion.rol, 'administracion')) return 'Solo quien administra la flota puede cambiar los avisos por correo.';
  if (sesion.rol !== 'superadmin' && sesion.tenantId !== tenantId) return 'Esta configuración no es de tu flota.';
  return null;
}

/** Lo escrito en la caja de destinatarios: uno por línea (o separados por coma o punto y coma). */
export function destinatariosDeTexto(texto: string): string[] {
  return texto.split(/[\n,;]+/).map((d) => d.trim()).filter((d) => d !== '');
}

export async function guardarCorreoAvisosDeFormulario(sesion: SesionCorreo, tenantId: string, fd: FormData): Promise<ResultadoAccionCorreo> {
  const no = permisoCorreoAvisos(sesion, tenantId);
  if (no) return { ok: false, error: no };
  let previa: ConfigCorreoAvisos;
  try { previa = await leerCorreoAvisos(tenantId); } catch { return { ok: false, error: 'No se pudo leer la configuración ahora mismo. Inténtalo de nuevo.' }; }
  const activo = String(fd.get('correo_activo') ?? '') === '1';
  const r = await guardarCorreoAvisos(tenantId, {
    activo,
    destinatarios: destinatariosDeTexto(String(fd.get('correo_destinatarios') ?? '').slice(0, 4_000)),
    noEnviarAntes: String(fd.get('correo_corte') ?? '').trim() || null,
    asunto: previa.asunto,
  });
  if (!r.ok) return { ok: false, error: r.motivo };
  return { ok: true, mensaje: r.valor.activo ? 'Avisos por correo guardados y ENCENDIDOS.' : 'Avisos por correo guardados. Siguen apagados: no se manda ningún correo hasta que los enciendas.' };
}

export async function enviarPruebaDeFormulario(
  sesion: SesionCorreo, tenantId: string, deps: Partial<DepsPruebaCorreo> = {},
): Promise<ResultadoAccionCorreo> {
  const no = permisoCorreoAvisos(sesion, tenantId);
  if (no) return { ok: false, error: no };
  const r = await enviarPruebaCorreoAvisos(tenantId, { leerConfig: leerCorreoAvisos, ...deps });
  return r.ok ? { ok: true, mensaje: r.mensaje } : { ok: false, error: r.mensaje };
}
