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
// El chofer (`operador`) NO pasa por aquí — su vista es /mis-viajes con RLS
// propia (docs/superpowers/plans/2026-08-02-roles-flota.md, Task 4), no el
// panel de flota_admin/encargado/contador.
// ═══════════════════════════════════════════════════════════════════════════

const EXPORTA = new Set(['superadmin', 'flota_admin', 'encargado', 'contador']);
const ASIGNA = new Set(['superadmin', 'flota_admin', 'encargado']);
const ADMINISTRA = new Set(['superadmin', 'flota_admin']);

export function puedeExportar(rol: string): boolean {
  return EXPORTA.has(rol);
}

export function puedeAsignar(rol: string): boolean {
  return ASIGNA.has(rol);
}

export function puedeAdministrar(rol: string): boolean {
  return ADMINISTRA.has(rol);
}
