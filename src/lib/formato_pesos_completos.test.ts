import { describe, expect, it } from 'vitest';
import { mxnCompleto } from './formato';
import { archivosFuente, leer, rel } from './calidad/escanear-fuentes';

// AUDITORÍA 59 · A59-ARQ-01 (ALTO) — EL SEGUNDO FORMATEADOR DE PESOS.
//
// `src/app/dashboard/inicio-cinco-modelo.ts` tenía su propio
// `new Intl.NumberFormat('es-MX', { style: 'currency', … })` con el locale
// CABLEADO. Dos cosas salían mal:
//
//   1. La regla de la casa dice que el formato de cifras vive SOLO en
//      `lib/formato.ts`, y `CLAUDE.md` la anuncia como probada. No lo estaba
//      para esta forma: la guarda (`calidad/formato_suelto.test.ts`) solo
//      buscaba `.toLocale(Date|Time)?String(`, y no ve `Intl.NumberFormat`.
//   2. Con el panel en inglés, `mxn(n,'en')` imprime «$3,306,107.42 MXN» —el
//      sufijo existe para que no se lea como dólares, lo dice `formato.ts`—
//      y la tarjeta de la portada imprimía «$3,306,107», sin marca de moneda.
//
// `mxnEntero` NO servía para esto: compacta desde un millón («$3.3 M») y esta
// cifra es la que finanzas cuadra. Por eso la función se mudó a `formato.ts`
// como `mxnCompleto` —completo, nunca compactado— en vez de reusar la otra.

describe('mxnCompleto · pesos sin decimales y SIN compactar', () => {
  it('no compacta por encima del millón, que es su razón de existir', () => {
    expect(mxnCompleto(3_306_107.42)).toBe('$3,306,107');
    expect(mxnCompleto(2_988_680)).toBe('$2,988,680');
    // El contraste con mxnEntero, que sí compacta, es el punto:
    expect(mxnCompleto(3_306_107.42)).not.toContain('M');
  });

  it('sin dato es «—», nunca 0 — la regla de la casa', () => {
    expect(mxnCompleto(null)).toBe('—');
    expect(mxnCompleto(undefined)).toBe('—');
    expect(mxnCompleto(Number.NaN)).toBe('—');
    expect(mxnCompleto(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('-0 no se pinta como saldo negativo', () => {
    expect(mxnCompleto(-0)).toBe('$0');
    expect(mxnCompleto(-0.4)).toBe('$0');
  });

  it('en inglés lleva el sufijo MXN para que no se lea como dólares', () => {
    expect(mxnCompleto(3_306_107.42, 'en')).toBe('$3,306,107 MXN');
    expect(mxnCompleto(-1_500, 'en')).toBe('-$1,500 MXN');
    expect(mxnCompleto(null, 'en')).toBe('—');
  });
});

// La guarda que faltaba: un formateador de MONEDA fuera de `formato.ts` es
// exactamente el caso que la regla prohíbe, y es el que se había escapado.
const PATRON_MONEDA = /new\s+Intl\.NumberFormat\([^)]*style:\s*['"]currency['"]/s;

describe('ningún formateador de MONEDA vive fuera de formato.ts (A59-ARQ-01)', () => {
  it('el patrón reconoce la forma que se escapó', () => {
    // Sin esto, una guarda que no matchea nada pasaría por estar sana.
    expect(PATRON_MONEDA.test(
      "const PESOS = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });",
    )).toBe(true);
    expect(PATRON_MONEDA.test("new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 })")).toBe(false);
  });

  it('cero infractores en src/', () => {
    const infractores = [...archivosFuente()]
      .filter((p) => PATRON_MONEDA.test(leer(p)))
      .map(rel)
      .filter((r) => r !== 'src/lib/formato.ts');
    expect(infractores, 'usa mxn/mxnEntero/mxnCompleto de @/lib/formato').toEqual([]);
  });
});
