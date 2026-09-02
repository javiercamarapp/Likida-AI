// ═══════════════════════════════════════════════════════════════════════════
// PERMISOS DE NIVEL APLICACIÓN — separados de RLS a propósito.
//
// RLS (0001_init.sql) es por TENANT, no por rol: cualquier app_user de un
// tenant tiene lectura+escritura completa sobre las 7 tablas de negocio vía
// la policy `tenant_data`. Eso es correcto para flota_admin/encargado/
// contador — los tres viven del mismo panel, mismos datos — y estas
// funciones deciden qué ACCIÓN se les ofrece encima de esos mismos datos:
// qué botón se pinta y qué endpoint acepta la petición. Un rol desconocido
// nunca puede: fail closed, no fail open.
//
// El chofer (`operador`) NO pasa por aquí — ya no tiene login (retirado el
// 7-ago-2026, solo WhatsApp), y nunca fue parte del panel de
// flota_admin/encargado/contador.
// ═══════════════════════════════════════════════════════════════════════════

const EXPORTA = new Set(['superadmin', 'flota_admin', 'encargado', 'contador']);
const ASIGNA = new Set(['superadmin', 'flota_admin', 'encargado']);
const ADMINISTRA = new Set(['superadmin', 'flota_admin']);

// ── TIMBRAR (0227, auditoría Fable c6-3) ───────────────────────────────────
//
// Timbrar es EMITIR UN CFDI a nombre de la flota: un acto fiscal irreversible
// (cancelarlo tiene ventana, motivo SAT y a veces la aceptación del receptor)
// que además fija el ingreso declarado del viaje. Hasta hoy el único gate era
// `puedeVerRuta(rol, '/dashboard/carta-porte')` — el área `operacion` —, así
// que el ENCARGADO podía apretarlo: el jefe de tráfico, que por diseño no ve
// una sola cifra de dinero de la flota, emitía comprobantes fiscales con los
// importes del flete a la vista para poder hacerlo.
//
// Quién sí: el DUEÑO (flota_admin) y el CONTADOR — el que declara el perfil
// fiscal en su panel y el que firma. El encargado NO, y esa exclusión es el
// hallazgo entero. `superadmin` entra por el mismo criterio que las demás
// puertas de este archivo (soporte de Likida operando la cuenta).
const TIMBRA = new Set(['superadmin', 'flota_admin', 'contador']);

export function puedeExportar(rol: string): boolean {
  return EXPORTA.has(rol);
}

export function puedeAsignar(rol: string): boolean {
  return ASIGNA.has(rol);
}

export function puedeAdministrar(rol: string): boolean {
  return ADMINISTRA.has(rol);
}

/** Emitir el CFDI (y capturar los datos fiscales que van dentro). Ver TIMBRA. */
export function puedeTimbrar(rol: string): boolean {
  return TIMBRA.has(rol);
}
