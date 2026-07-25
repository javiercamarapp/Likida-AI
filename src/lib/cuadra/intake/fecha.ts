/** Normaliza fechas de ticket (DD/MM/YYYY o DD/MM/YY, con hora opcional) a ISO
 *  YYYY-MM-DD. Los tickets mexicanos usan día/mes/año. Si no matchea, devuelve
 *  los primeros 10 chars (por si ya viene ISO) o undefined. Puro, sin deps. */
export function normalizarFecha(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // ya ISO
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = s.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/); // DD/MM/YY(YY)
  if (!m) return undefined;
  const d = m[1].padStart(2, '0');
  const mo = m[2].padStart(2, '0');
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${mo}-${d}`;
}
