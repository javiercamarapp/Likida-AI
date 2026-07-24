// Export a ERP/Excel. CSV es universalmente importable (Excel lo abre directo,
// y todo ERP acepta CSV). También expone JSON estructurado para conectores API.

export interface LiquidacionExportRow {
  folio_viaje: string;
  operador: string;
  fecha: string;
  total_comprobado: number;
  anticipo: number;
  diferencia: number;
  estatus: string;
  num_diferencias: number;
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T extends Record<string, unknown>>(rows: T[], headers?: Array<keyof T>): string {
  if (!rows.length) return '';
  const cols = (headers ?? (Object.keys(rows[0]) as Array<keyof T>));
  const head = cols.map((c) => csvCell(String(c))).join(',');
  const body = rows.map((r) => cols.map((c) => csvCell(r[c])).join(',')).join('\n');
  return `${head}\n${body}\n`;
}

/** Mapea filas crudas de liquidacion (con join de viaje/operador) a fila ERP. */
export function toLiquidacionRows(
  raw: Array<{
    created_at: string;
    total_comprobado: number;
    total_anticipo: number;
    diferencia: number;
    estatus: string;
    diferencias?: unknown[] | null;
    viaje?: { folio?: string; operador?: { nombre?: string } | null } | null;
  }>,
): LiquidacionExportRow[] {
  return raw.map((r) => ({
    folio_viaje: r.viaje?.folio ?? '',
    operador: r.viaje?.operador?.nombre ?? '',
    fecha: (r.created_at ?? '').slice(0, 10),
    total_comprobado: Number(r.total_comprobado ?? 0),
    anticipo: Number(r.total_anticipo ?? 0),
    diferencia: Number(r.diferencia ?? 0),
    estatus: r.estatus ?? '',
    num_diferencias: Array.isArray(r.diferencias) ? r.diferencias.length : 0,
  }));
}
