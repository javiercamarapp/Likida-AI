// ═══════════════════════════════════════════════════════════════════════════
// DERIVADOS — lo que se calcula de lo que el documento SÍ dice.
//
// Idempotente: se puede correr tras la extracción y tras cada corrección humana
// sin acumular efectos. Nunca pisa un valor que un humano dejó (`origen: humano`)
// y nunca inventa: solo convierte unidades y suma renglones.
// ═══════════════════════════════════════════════════════════════════════════

import type { CampoValor, Extraccion } from './campos';
import { FACTOR_A_KG, claveUnidadDeTexto } from './catalogos';
import { normalizarNumero } from './normalizar';

const num = (c: CampoValor | undefined): number | null => (c?.valor != null ? normalizarNumero(c.valor).valor : null);
const redondea = (n: number): string => String(Math.round(n * 1000) / 1000);

export function completarDerivados(e: Extraccion): Extraccion {
  for (const fila of e.mercancias) {
    // 1. El peso llegó en OTRA unidad (ton, lb, g): se convierte a kg y se anota.
    const unidadPeso = fila.peso_unidad?.valor ? claveUnidadDeTexto(fila.peso_unidad.valor) : null;
    const peso = fila.peso_kg;
    if (peso && peso.origen !== 'humano' && unidadPeso && unidadPeso !== 'KGM' && FACTOR_A_KG[unidadPeso] !== undefined) {
      const n = num(peso);
      if (n !== null) {
        fila.peso_kg = {
          ...peso,
          valor: redondea(n * FACTOR_A_KG[unidadPeso]),
          notas: [...(peso.notas ?? []), `El documento da el peso en ${unidadPeso}: se convirtió a kilogramos (×${FACTOR_A_KG[unidadPeso]}).`],
        };
        fila.peso_unidad = { ...fila.peso_unidad!, valor: 'KGM' };
      }
    }
    // 2. La clave de unidad sale del texto de la unidad cuando es inequívoco.
    if (!fila.clave_unidad?.valor && fila.unidad_texto?.valor) {
      const k = claveUnidadDeTexto(fila.unidad_texto.valor);
      if (k) fila.clave_unidad = { valor: k, confianza: Math.min(0.9, fila.unidad_texto.confianza), evidencia: fila.unidad_texto.evidencia, origen: 'derivado', notas: [`«${fila.unidad_texto.valor}» se tradujo a ${k}.`] };
    }
    // 3. Cantidad en kg o toneladas y sin peso aparte: el peso ES la cantidad.
    const clave = fila.clave_unidad?.valor;
    if (!fila.peso_kg?.valor && fila.cantidad?.valor && (clave === 'KGM' || clave === 'TNE')) {
      const q = num(fila.cantidad);
      if (q !== null) {
        fila.peso_kg = {
          valor: redondea(q * FACTOR_A_KG[clave]),
          confianza: Math.min(0.9, fila.cantidad.confianza),
          evidencia: fila.cantidad.evidencia,
          origen: 'derivado',
          notas: [`La cantidad está en ${clave}: el peso en kg se derivó de ella.`],
        };
      }
    }
  }
  // 4. El peso bruto total, de la suma de renglones, si el documento no lo da.
  const actual = e.campos.peso_bruto_total;
  if ((!actual || actual.origen === 'derivado') && e.mercancias.length > 0) {
    const pesos = e.mercancias.map((f) => num(f.peso_kg));
    if (pesos.every((p): p is number => p !== null)) {
      const confs = e.mercancias.map((f) => f.peso_kg.confianza);
      e.campos.peso_bruto_total = {
        valor: redondea(pesos.reduce((s, p) => s + p, 0)),
        confianza: Math.min(...confs),
        evidencia: null,
        origen: 'derivado',
        notas: ['Suma de los pesos de las mercancías.'],
      };
    } else if (actual?.origen === 'derivado') {
      delete e.campos.peso_bruto_total;
    }
  }
  return e;
}
