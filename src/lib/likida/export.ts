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

/**
 * `YYYY-MM-DD` en hora de México, no en UTC.
 *
 * `created_at` es `timestamptz` y PostgREST lo entrega en UTC. `.slice(0, 10)`
 * se quedaba con la fecha UTC, y CST es UTC−6: una liquidación cerrada el
 * 31-jul a las 20:00 hora local salía como `2026-08-01` en el CSV que el
 * contralor importa a su ERP para el corte del mes (auditoría 5, frontend,
 * MEDIO 3). El panel arrastraba el mismo desfase; ahí se corrigió en
 * `src/app/dashboard/formato.ts`.
 *
 * Aquí el formato se queda numérico y ordenable —esto lo lee Excel, no una
 * persona—, mientras que en pantalla se pinta "31 jul 2026". Es el mismo día
 * dicho de dos maneras, que es lo que faltaba.
 */
export function fechaIsoMx(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // 'en-CA' produce YYYY-MM-DD; es la forma corta de pedir ISO con zona.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T extends object>(rows: T[], headers?: Array<keyof T>): string {
  if (!rows.length) return '';
  const cols = headers ?? (Object.keys(rows[0]) as Array<keyof T>);
  const head = cols.map((c) => csvCell(String(c))).join(',');
  const body = rows
    .map((r) => cols.map((c) => csvCell((r as Record<string, unknown>)[c as string])).join(','))
    .join('\n');
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
    fecha: fechaIsoMx(r.created_at),
    total_comprobado: Number(r.total_comprobado ?? 0),
    anticipo: Number(r.total_anticipo ?? 0),
    diferencia: Number(r.diferencia ?? 0),
    estatus: r.estatus ?? '',
    num_diferencias: Array.isArray(r.diferencias) ? r.diferencias.length : 0,
  }));
}
