// Detección de cifras de DINERO en un texto. Marca:
//  - $ (con o sin espacio):            "$500", "$ 6,850"
//  - miles con coma:                    "10,600"
//  - decimales .XX:                     "5700.00"
//  - entero ≥2 dígitos + palabra-moneda: "500 pesos", "8000 MXN"
//  - palabra-cuadre + entero ≥2 dígitos: "comprobaste 8000", "sobró 500"
//  - entero ≥2 dígitos + marcador:       "1500 a favor", "500 del anticipo"
// NO marca enteros sueltos sin contexto de dinero (conteos, folios, años).
const MONEY =
  /\$\s?\d|\d{1,3}(?:,\d{3})+|\d+\.\d{2}(?!\d)|\b\d{2,}\s*(?:pesos?|mxn|m\.?\s?n\.?)\b|\b(?:anticipo|comprob\w*|sobr\w*|falt\w*|diferencia|acredit\w*|reembols\w*|adeud\w*)\b[^.\d]{0,14}\d{2,}|\b\d{2,}\s*(?:a favor|del anticipo|de tu bolsa)\b/i;

export function tieneCifrasDeDinero(texto: string): boolean {
  return MONEY.test(texto);
}

// ═══════════════════════════════════════════════════════════════════════════
// ¿QUÉ CIFRA DEL TEXTO NO SALIÓ DE NINGUNA TOOL?
//
// `tieneCifrasDeDinero` solo dice si hay dinero en el texto. Eso bastaba para
// la regla gruesa ("¿llamó una tool?"), pero esa regla tenía una puerta
// trasera: llamando `consultar_politica` —barata e irrelevante— el modelo
// desbloqueaba narrar CUALQUIER cifra, incluidas las que nadie calculó.
//
// Grounded tiene que significar que la cifra está en lo que la tool devolvió.
// ═══════════════════════════════════════════════════════════════════════════

/** Las mismas formas que detecta MONEY, pero capturando el número. */
const MONEY_G =
  /\$\s?(\d[\d,]*(?:\.\d+)?)|(\d{1,3}(?:,\d{3})+(?:\.\d+)?)|(\d+\.\d{2})(?!\d)|(\d{2,})\s*(?:pesos?|mxn|m\.?\s?n\.?)\b|\b(?:anticipo|comprob\w*|sobr\w*|falt\w*|diferencia|acredit\w*|reembols\w*|adeud\w*)\b[^.\d]{0,14}(\d[\d,]*(?:\.\d+)?)|(\d{2,})\s*(?:a favor|del anticipo|de tu bolsa)\b/gi;

/** Centavo de tolerancia: el motor redondea y el modelo formatea. */
const TOL = 0.011;

function numerosDe(valor: unknown, acc: number[], profundidad = 0): number[] {
  if (profundidad > 8 || acc.length > 5000) return acc;   // cota dura: los resultados de tool son datos ajenos
  if (typeof valor === 'number') { if (Number.isFinite(valor)) acc.push(valor); return acc; }
  if (typeof valor === 'string') {
    // Un string puede ser "750.00" o traer cifras embebidas en una nota.
    for (const m of valor.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
      const n = Number(m[0].replace(/,/g, ''));
      if (Number.isFinite(n)) acc.push(n);
    }
    return acc;
  }
  if (Array.isArray(valor)) { for (const v of valor) numerosDe(v, acc, profundidad + 1); return acc; }
  if (valor && typeof valor === 'object') {
    for (const v of Object.values(valor as Record<string, unknown>)) numerosDe(v, acc, profundidad + 1);
  }
  return acc;
}

/**
 * Devuelve las cifras de dinero del texto que NO aparecen en ningún resultado
 * de tool. Lista vacía = todo lo que el modelo dijo salió de una herramienta.
 *
 * Estricto a propósito: una cifra DERIVADA por el modelo (restar el anticipo
 * del comprobado, por ejemplo) no está respaldada aunque sus operandos sí lo
 * estén. Quien calcula diferencias es el motor; si el número no salió de él,
 * no se manda por WhatsApp.
 */
export function cifrasSinRespaldo(texto: string, resultados: unknown[]): number[] {
  const respaldo = numerosDe(resultados, []);
  const fuera: number[] = [];
  for (const m of texto.matchAll(MONEY_G)) {
    const crudo = m.slice(1).find((g) => g != null);
    if (!crudo) continue;
    const n = Number(crudo.replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    if (respaldo.some((r) => Math.abs(r - n) <= TOL)) continue;
    if (!fuera.includes(n)) fuera.push(n);
  }
  return fuera;
}
