// A37-P-01 (S45-01): el LECTOR de `ocr_extra.montoDisputado`. `marcarMontoDisputado` (gasto_correccion.ts) lo escribe cuando el
// operador aprieta «No, corregir» sin decir el monto bueno; hasta ahora nadie lo leía y la oficina nunca se enteraba. Puro (sin
// base): lo usa el panel de revisión. Una disputa deja de estar pendiente cuando una corrección (`ocr_extra.montoCorregido`) es de
// la misma hora o posterior.

export interface DisputaDeMonto {
  montoLeido: number;
  /** Quién disputó (teléfono/nombre del operador tal como lo guardó `marcarMontoDisputado`). */
  por: string | null;
  /** Lo que dijo, si lo dijo. Texto libre del operador: se pinta siempre escapado. */
  dijo: string | null;
  en: string | null;
}

function tiempo(v: unknown): number {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? NaN : t;
}

/** La disputa de monto AÚN sin atender de un gasto, o `null`. Cualquier forma inesperada del JSON → `null` (no se inventa nada). */
export function disputaPendiente(ocrExtra: Record<string, unknown> | null | undefined): DisputaDeMonto | null {
  const d = ocrExtra?.montoDisputado;
  if (d === null || typeof d !== 'object' || Array.isArray(d)) return null;
  const r = d as Record<string, unknown>;
  const montoLeido = Number(r.montoLeido);
  if (!Number.isFinite(montoLeido)) return null;
  const en = typeof r.en === 'string' ? r.en : null;
  const previas = Array.isArray(ocrExtra?.montoCorregido) ? (ocrExtra!.montoCorregido as unknown[]) : (ocrExtra?.montoCorregido ? [ocrExtra.montoCorregido] : []);
  const tDisputa = tiempo(en);
  for (const c of previas) {
    const tc = tiempo((c as { en?: unknown } | null)?.en);
    // Una corrección posterior (o, sin hora legible en alguna de las dos, cualquier corrección) la atiende.
    if (Number.isNaN(tDisputa) || Number.isNaN(tc) ? true : tc >= tDisputa) return null;
  }
  return {
    montoLeido,
    por: typeof r.por === 'string' && r.por.trim() ? r.por : null,
    dijo: typeof r.dijo === 'string' && r.dijo.trim() ? r.dijo.trim().slice(0, 300) : null,
    en,
  };
}
