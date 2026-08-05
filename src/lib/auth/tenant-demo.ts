// ═══════════════════════════════════════════════════════════════════════════
// A QUÉ FLOTA MIRA UN SUPERADMIN.
//
// `app_user.tenant_id` de un superadmin es NULL por diseño (0001: "null =
// superadmin"): no pertenece a ninguna flota. Pero las 25 páginas del panel del
// cliente necesitan UN tenant para consultar, así que hay que darle uno.
//
// ── POR QUÉ ESTE ARCHIVO EXISTE ──────────────────────────────────────────
//
// Esta constante estaba copiada TRES veces —`guard.ts`, `tenant-api.ts` y el
// route del asistente—, cada una con su propio uuid escrito a mano. El día que
// se limpió la base de producción (5-ago-2026) las tres quedaron apuntando a
// una flota que ya no existe, y hubo que buscarlas de una en una. Una constante
// duplicada no es un problema hasta que hay que cambiarla.
//
// ── QUÉ PASA CUANDO ESE UUID NO RESUELVE ─────────────────────────────────
//
// Nada revienta, y eso es lo peligroso: cada consulta hace `.eq('tenant_id',
// uuid)` y vuelve con cero filas SIN error, así que el panel abre y pinta ceros
// que se leen como medición. Por eso `resolverTenantEfectivo` comprueba que la
// flota exista y las páginas enseñan `AvisoSinFlota` — el aviso vive allá
// porque es una decisión de pantalla, no de autorización.
//
// NO se cae automáticamente a "la primera flota que haya". Con varias flotas
// dadas de alta, "la primera" es arbitraria, y un superadmin mirando datos de un
// cliente que no eligió es peor que un panel vacío que dice qué falta.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * La flota que ve un superadmin cuando no eligió ninguna.
 *
 * Se lee del ambiente en cada llamada, no al importar el módulo: en serverless
 * el módulo sobrevive entre invocaciones y una variable que cambia en Vercel no
 * se reflejaría hasta el siguiente despliegue frío.
 */
export function tenantDemo(): string {
  return process.env.DEMO_TENANT_ID ?? '11111111-1111-1111-1111-111111111111';
}
