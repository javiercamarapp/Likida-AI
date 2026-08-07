/** Normaliza fechas de ticket (DD/MM/YYYY o DD/MM/YY, con hora opcional) a ISO
 *  YYYY-MM-DD. Los tickets mexicanos usan día/mes/año. Si no matchea, devuelve
 *  los primeros 10 chars (por si ya viene ISO) o undefined. Puro, sin deps. */
export function normalizarFecha(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // ya ISO
  if (iso) return existe(iso[1], iso[2], iso[3]);
  const m = s.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/); // DD/MM/YY(YY)
  if (!m) return undefined;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return existe(y, m[2].padStart(2, '0'), m[1].padStart(2, '0'));
}

/**
 * Devuelve la fecha ISO solo si el día EXISTE en ese mes.
 *
 * `new Date('2026-04-31')` no truena: rueda al 1 de mayo en silencio. Una fecha
 * así entraba como buena y corría el plazo de facturación un mes entero,
 * arrastrando con ella el tope diario de alimentación y el aviso de caducidad.
 * Un ticket térmico mal leído produce este caso con facilidad.
 */
function existe(y: string, mo: string, d: string): string | undefined {
  const a = Number(y), m = Number(mo), dia = Number(d);
  if (!(a > 1900) || m < 1 || m > 12 || dia < 1) return undefined;
  // Día 0 del mes siguiente = último día de este mes. Cubre bisiestos sin tabla.
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  if (dia > ultimo) return undefined;
  return `${y}-${mo}-${d}`;
}
