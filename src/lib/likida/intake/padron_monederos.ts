// ═══════════════════════════════════════════════════════════════════════════
// EL PADRÓN DE EMISORES DE MONEDEROS — FASE 2 (docs/asistencia/PLAN-FASES.md).
//
// `padron_monederos.json` es una SEMILLA (13 emisores del corpus fiscal,
// docs/conocimiento/09-liquidacion.md, "los relevantes para flotas de carga"),
// NO el padrón SAT completo (~30 emisores desde 2005). El SAT publica DOS
// listas en DOS URLs que no coinciden, más un padrón separado de "no
// renovados" — ninguna de las tres se lee aquí todavía.
//
// POR ESO `estaEnPadronMonederos` DEVUELVE UN SÍ AFIRMATIVO, NUNCA UN NO
// AUTORITATIVO. Un `false` significa "no está en esta semilla" — NO "no es
// monedero". Mismo principio que `identificarPorPermiso` en permiso_cre.ts
// (auditoría 6: leer "no sé" como "no existe" es la familia de bug más cara
// del repo). Un ticket de un emisor fuera de la semilla se sigue
// reconociendo por la OTRA mitad de la regla de Fase 2: que exista una línea
// ECC del mismo día/estación/monto (ver `consolidado.ts`).
//
// Cableado el 23-ago-2026 vía `evidencia_monedero.ts` → `engine.ts`.
// Los tickets de bomba del Escritorio imprimen RFC DE ESTACIÓN (PEMEX,
// ARCO), no el del emisor: el camino A (esta función) casi no pega contra
// ellos. El camino B es la línea ECC del mismo día/estación/monto. Un
// `false` de aquí sigue sin significar "no es monedero".
// ═══════════════════════════════════════════════════════════════════════════

import padron from './padron_monederos.json';

export interface EmisorMonedero {
  rfc: string;
  emisor: string;
  producto: string;
  autorizadoDesde: string;
}

const POR_RFC = new Map<string, EmisorMonedero>(
  (padron.emisores as EmisorMonedero[]).map((e) => [e.rfc.toUpperCase(), e]),
);

/** ¿Este RFC está en la SEMILLA de emisores de monedero conocidos? Ver el
 *  aviso del encabezado: `false` no es "no es monedero", es "no está aquí". */
export function estaEnPadronMonederos(rfc: string | undefined | null): boolean {
  if (!rfc) return false;
  return POR_RFC.has(rfc.trim().toUpperCase());
}

/** El emisor completo, cuando está en la semilla — para mostrarlo en el
 *  panel (p.ej. "Sí Vale México — Diesel Fleet") en vez de solo el RFC. */
export function emisorMonedero(rfc: string | undefined | null): EmisorMonedero | undefined {
  if (!rfc) return undefined;
  return POR_RFC.get(rfc.trim().toUpperCase());
}
