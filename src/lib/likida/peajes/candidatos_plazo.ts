import type { CandidatoPlazo } from './plazo_reclamo';

// ═══════════════════════════════════════════════════════════════════════════
// LOS CANDIDATOS SIN RECLAMAR QUE CORREN CONTRA EL PLAZO (A2 ola 1).
//
// Una sola definición de «qué cobro sigue sin reclamar» para la pantalla del agente (tarjeta «Plazo») y
// para el aviso proactivo del cron: si cada uno la calculara aparte, la pantalla diría una cosa y el aviso
// otra. PURO: sin base ni red. Vivía dentro de `revision-cobros.tsx`; se movió aquí sin cambiar su lógica.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A37-S15-03: «reclamado» es lo que de verdad LLEGÓ al proveedor. Un reclamo
 * `preparado` (nadie lo envió al portal) no detiene el plazo de 3 meses, y uno
 * `rechazado` ya no está en juego: ninguno de los dos puede apagar el aviso
 * «por vencer» ni contar como atendido.
 */
export const ESTADOS_RECLAMO_ENVIADO: ReadonlySet<string> = new Set(['enviado', 'acreditado_parcial', 'acreditado']);

export interface ReclamoParaPlazo {
  id: string;
  categoria: string;
  estado: string;
  nCruces: number;
  fechaCobroMasAntiguo: string;
}

export interface DecisionParaPlazo { indice: number; categoria: string; accion: string; reclamoId: string | null }

/**
 * Los candidatos que un reclamo ENVIADO de su categoría de verdad cubre. El
 * reclamo guarda cuántos cruces traía (`nCruces`) y la fecha del más antiguo;
 * no guarda cuáles. Por eso:
 *  · un cruce ANTERIOR a esa fecha no pudo ir en el reclamo;
 *  · del resto solo se cubren tantos como `nCruces` — y si sobran (cruces que
 *    aparecieron después de crearlo) se dejan SIN cubrir los más viejos, que son
 *    los urgentes: ante la duda el plazo avisa, no se calla.
 */
export function lineasCubiertasPorReclamo(
  candidatos: ReadonlyArray<{ indice: number; categoria: string; fecha: string }>,
  reclamos: readonly ReclamoParaPlazo[],
): Set<number> {
  const cubiertas = new Set<number>();
  for (const categoria of new Set(candidatos.map((c) => c.categoria))) {
    const enviados = reclamos.filter((r) => r.categoria === categoria && ESTADOS_RECLAMO_ENVIADO.has(r.estado));
    if (enviados.length === 0) continue;
    const desde = enviados.map((r) => r.fechaCobroMasAntiguo).sort()[0];
    let cupo = enviados.reduce((s, r) => s + r.nCruces, 0);
    const elegibles = candidatos
      .filter((c) => c.categoria === categoria && c.fecha >= desde)
      .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.indice - a.indice)); // los más nuevos primero
    for (const c of elegibles) {
      if (cupo <= 0) break;
      cubiertas.add(c.indice);
      cupo -= 1;
    }
  }
  return cubiertas;
}

/**
 * Los candidatos con fecha de UN desglose, marcando cuáles ya están reclamados (reclamo ENVIADO). A37-A2-06: un reclamo con
 * decisiones ligadas (hecho desde la tabla) cubre SOLO esas líneas; uno sin ninguna (de categoría completa) cubre lo que cubra
 * `lineasCubiertasPorReclamo`. `decisiones === undefined` = quien llama no las pide: un reclamo cubre su categoría.
 */
export function candidatosDePlazo(entrada: {
  desgloseId: string;
  candidatos: ReadonlyArray<{ indice: number; categoria: string; fecha: string | null; monto: number }>;
  reclamosDelArchivo: readonly ReclamoParaPlazo[];
  decisiones?: readonly DecisionParaPlazo[];
}): CandidatoPlazo[] {
  const { desgloseId, reclamosDelArchivo, decisiones } = entrada;
  const conDecision = new Set((decisiones ?? []).map((x) => x.reclamoId).filter((x): x is string => x !== null));
  const enviadoPorId = new Set(reclamosDelArchivo.filter((r) => ESTADOS_RECLAMO_ENVIADO.has(r.estado)).map((r) => r.id));
  const reclamosCompletos = reclamosDelArchivo.filter((r) => decisiones === undefined || !conDecision.has(r.id));
  const lineasReclamadas = new Set((decisiones ?? [])
    .filter((x) => x.accion === 'reclamado' && x.reclamoId !== null && enviadoPorId.has(x.reclamoId))
    .map((x) => `${x.indice}|${x.categoria}`));
  // A2P-09: lo que finanzas descartó o justificó por decisión está ATENDIDO: no corre contra el plazo ni se avisa.
  const atendidas = new Set((decisiones ?? [])
    .filter((x) => x.accion === 'descartado' || x.accion === 'justificado')
    .map((x) => `${x.indice}|${x.categoria}`));
  const conFecha = entrada.candidatos
    .filter((c): c is typeof c & { fecha: string } => typeof c.fecha === 'string' && c.fecha !== '');
  const cubiertas = lineasCubiertasPorReclamo(conFecha, reclamosCompletos);
  return conFecha.map((c) => ({
    lineaId: String(c.indice), desgloseId, fechaCruce: c.fecha, monto: c.monto,
    reclamado: cubiertas.has(c.indice) || lineasReclamadas.has(`${c.indice}|${c.categoria}`)
      || atendidas.has(`${c.indice}|${c.categoria}`),
  }));
}
