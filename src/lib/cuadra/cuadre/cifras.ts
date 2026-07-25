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
