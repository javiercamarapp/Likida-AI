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
// ── PENDIENTE DE VERIFICAR ANTES DE CABLEAR ESTO A engine.ts ────────────────
//
// Mapeado el flujo real (no el que describía el plan original): NO hay un
// doble `INSERT` mecánico. `conciliarLineas`/`ligarLineaAGasto` (consolidado.ts)
// ya actualizan el MISMO `gasto` cuando hay un candidato único; nunca crean
// uno nuevo. El hueco real es otro: cuando una línea ECC no liga automático
// (tolerancia ±1 día/$1 muy estrecha, candidato ambiguo, o nadie resuelve la
// cola `por_conciliar`), el ticket-foto se queda como `gasto` SIN `cfdiUuid`
// y `cubetaDe` (engine.ts) lo clasifica `por_confirmar` — una cubeta que
// implica "todavía puede llegar su factura", que es FISCALMENTE FALSO para
// un ticket de monedero (RMF 3.3.1.7 le prohíbe a la gasolinera facturarlo:
// su comprobante deducible ES el CFDI mensual del emisor, nunca va a tener
// uno propio). El fix real vive en `cubetaDe`/`engine.ts`, no aquí.
//
// NO SE CABLEÓ TODAVÍA porque falta un dato que sólo un ticket real resuelve
// (mismo criterio de cautela que Fase 1 §4, `docs/asistencia/PLAN-FASES.md`):
// `gasto.rfc_emisor` lo llena el OCR leyendo el papel impreso — y no está
// verificado si lo que ese papel imprime es el RFC DE LA ESTACIÓN o el RFC
// DEL EMISOR DEL MONEDERO (Edenred, Sí Vale…). Si es el de la estación, esta
// función (que busca RFCs de EMISORES de monedero) nunca va a hacer match
// contra `gasto.rfc_emisor` y hay que comparar contra otro campo o cambiar
// qué guarda el OCR. Cablear la clasificación sobre la suposición equivocada
// sería peor que no cablearla: reclasificaría en silencio tickets que sí son
// deducibles normales. Verificar con un ticket real de monedero antes de
// tocar `cubetaDe`.
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
