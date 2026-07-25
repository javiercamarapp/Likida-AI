// Detección de cifras de DINERO en un texto: símbolo $, miles con coma, o
// decimales .XX. NO marca enteros sueltos (conteos, folios, años). Puro, sin deps.
const MONEY = /\$\s?\d|\d{1,3}(?:,\d{3})+|\d+\.\d{2}(?!\d)/;

export function tieneCifrasDeDinero(texto: string): boolean {
  return MONEY.test(texto);
}
