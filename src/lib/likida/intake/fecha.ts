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
 * CORRIGE EL VOLTEO DÍA/MES DEL MODELO, determinista y acotado — no adivina.
 *
 * El caso MEDIDO (banco de QA, 90 fotos reales, 28-ago-2026): el error de
 * fecha MÁS repetido del extractor es leer "2/8/2026" como 8 de febrero. La
 * regla ya está escrita en el prompt —México imprime DÍA/MES— pero el modelo
 * la viola justo cuando ambos componentes son ≤ 12, que es cuando no hay
 * componente imposible que lo delate. Aquí se aplica la MISMA regla,
 * determinista, sobre `fecha_impresa` (la copia literal del papel):
 *
 *   se corrige SOLO cuando (a) la impresa es puramente numérica —una fecha
 *   con el mes en letra ya manda por el prompt—, (b) su lectura DÍA/MES es
 *   una fecha válida, y (c) la fecha del modelo es EXACTAMENTE la lectura
 *   MES/DÍA — o sea, el volteo demostrado contra la regla escrita, no una
 *   discrepancia cualquiera.
 *
 * La excepción de COSTCO (el único emisor confirmado que imprime MES/DÍA,
 * ver el prompt) la aplica quien llama saltándose esta corrección cuando el
 * emisor leído la nombra. Un papel MES/DÍA sin letra y sin ser Costco NO se
 * puede resolver por regla — ése es techo, y se queda como salió en vez de
 * adivinarse. Pura, con prueba.
 */
export function corregirVolteoDiaMes(
  fechaModelo: string | undefined,
  fechaImpresa: string | null | undefined,
): string | undefined {
  if (!fechaModelo || !fechaImpresa) return fechaModelo;
  // (a) puramente numérica: nada de letras (descarta "01 de JULIO de 2026").
  const limpia = fechaImpresa.trim();
  const m = limpia.match(/^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{2,4})(\D|$)/);
  if (!m || /[a-záéíóú]/i.test(limpia)) return fechaModelo;
  const anio = m[3].length === 2 ? `20${m[3]}` : m[3];
  const ddmm = existe(anio, m[2].padStart(2, '0'), m[1].padStart(2, '0'));
  const mmdd = existe(anio, m[1].padStart(2, '0'), m[2].padStart(2, '0'));
  // (b) y (c): el volteo exacto, con ambas lecturas válidas y distintas.
  if (!ddmm || !mmdd || ddmm === mmdd) return fechaModelo;
  return fechaModelo === mmdd ? ddmm : fechaModelo;
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
