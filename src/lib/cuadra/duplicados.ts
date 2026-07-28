// ═══════════════════════════════════════════════════════════════════════════
// EL MISMO COMPROBANTE EN DOS VIAJES.
//
// Es el fraude número uno del sector, y el que ninguna liquidación puede ver
// sola: cada una se ve impecable por separado. El motor de cuadre ya detecta
// duplicados DENTRO de un viaje; esto los detecta ENTRE viajes.
//
// Lógica PURA a propósito: la versión anterior vivía pegada a Supabase y por eso
// nunca se probó — y tenía la mitad sin implementar. Declaraba detectar
// `folio_duplicado` y solo producía `cfdi_duplicado`, que es justo la mitad que
// NO importa en una flota: la mayoría de sus gastos son tickets sin timbrar, y
// si solo se vigila el UUID, el fraude más fácil de cometer es el que no se mira.
// ═══════════════════════════════════════════════════════════════════════════

export interface FilaGasto {
  viajeId: string;
  concepto: string;
  monto: number;
  folio?: string;
  cfdiUuid?: string;
}

export interface Anomalia {
  tipo: 'cfdi_duplicado' | 'folio_duplicado';
  detalle: string;
  monto: number;
  viajes: string[];
}

/** Agrupa por una llave y devuelve solo los grupos que tocan 2+ viajes. */
function entreViajes(filas: FilaGasto[], llave: (f: FilaGasto) => string | null) {
  const grupos = new Map<string, { viajes: Set<string>; monto: number }>();
  for (const f of filas) {
    const k = llave(f);
    if (!k) continue;
    const g = grupos.get(k) ?? { viajes: new Set<string>(), monto: f.monto };
    g.viajes.add(f.viajeId);
    grupos.set(k, g);
  }
  return [...grupos.entries()].filter(([, g]) => g.viajes.size > 1);
}

export function detectarDuplicadosEntreViajes(filas: FilaGasto[]): Anomalia[] {
  const out: Anomalia[] = [];

  // 1) Por UUID: regla dura, el CFDI es único por definición.
  for (const [uuid, g] of entreViajes(filas, (f) => f.cfdiUuid?.toLowerCase() ?? null)) {
    out.push({
      tipo: 'cfdi_duplicado',
      detalle: `CFDI ${uuid.slice(0, 8)}… liquidado en ${g.viajes.size} viajes`,
      monto: g.monto,
      viajes: [...g.viajes],
    });
  }

  // 2) Por folio: solo cuando COINCIDEN concepto, folio Y monto.
  //
  // Los folios se repiten entre estaciones distintas —"A-991" de una gasolinera
  // y "A-991" de otra son comprobantes legítimos—, así que el folio solo no
  // basta. Acusar a un operador de fraude por una coincidencia de numeración es
  // peor que no detectarlo: destruye la confianza en toda la herramienta.
  const conUuid = new Set(filas.filter((f) => f.cfdiUuid).map((f) => f.cfdiUuid!.toLowerCase()));
  for (const [k, g] of entreViajes(filas, (f) =>
    // Si ya tiene UUID se reporta arriba; no se cuenta dos veces.
    !f.folio || f.cfdiUuid ? null : `${f.concepto.toLowerCase()}|${f.folio}|${f.monto}`,
  )) {
    if (conUuid.size && [...conUuid].some((u) => k.includes(u))) continue;
    out.push({
      tipo: 'folio_duplicado',
      detalle: `Folio ${k.split('|')[1]} (${k.split('|')[0]}) liquidado en ${g.viajes.size} viajes`,
      monto: g.monto,
      viajes: [...g.viajes],
    });
  }

  return out;
}
