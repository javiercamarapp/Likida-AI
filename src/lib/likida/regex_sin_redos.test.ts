// ═══════════════════════════════════════════════════════════════════════════
// ReDoS — las regex que reciben texto de DESCONOCIDOS no pueden colgarse.
//
// 23-AGO-2026, sustituyendo lo que CodeQL haría si estuviera comprado. El
// plugin de seguridad del lint marca 34 regex como "unsafe", pero mira la
// FORMA (`{0,9}` seguido de un grupo opcional), no el comportamiento. Esta
// prueba mide: entrada adversarial creciente, y falla si el tiempo explota.
//
// POR QUÉ IMPORTA AQUÍ Y NO EN CUALQUIER REPO: estas regex corren sobre el
// texto que un chofer —o cualquiera que conozca el número— manda por WhatsApp.
// Una regex con retroceso exponencial ahí no es un aviso de linter: es una
// caída del webhook provocable desde fuera con un solo mensaje.
//
// Si alguna vez esta prueba falla, el arreglo NO es subirle el tope: es acotar
// el cuantificador (`{0,9}` en vez de `+`) o partir la alternancia.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';

/** Mide el peor caso de una regex con entrada creciente. */
function msPeorCaso(re: RegExp, entrada: string): number {
  const r = new RegExp(re.source, re.flags.replace('g', '')); // sin `g`: lastIndex no interfiere
  const ini = performance.now();
  r.test(entrada);
  return performance.now() - ini;
}

/** Las que de verdad tocan texto de fuera, copiadas de su archivo. */
const EXPUESTAS: Array<{ donde: string; re: RegExp; veneno: (n: number) => string }> = [
  {
    donde: 'talacha_wa · monto con $',
    re: /\$\s*([\d][\d,]{0,9}(?:\.\d{1,2})?)/,
    veneno: (n) => '$' + '1'.repeat(n),
  },
  {
    donde: 'talacha_wa · monto en pesos',
    re: /\b([\d][\d,]{0,9}(?:\.\d{1,2})?)\s*(?:pesos|varos|mxn)\b/,
    veneno: (n) => '1'.repeat(n) + ' peso',
  },
  {
    donde: 'processor · el chofer dice que terminó',
    re: /^\s*(listo|ya est[aá]|ya qued[óo]|(ya\s+)?termin[éeoó]|cierra|cerrar)\s*[!.]*$/i,
    veneno: (n) => 'ya ' + 'a'.repeat(n),
  },
  {
    donde: 'sanitizar · dosis en el OCR',
    re: /\b\d+(\.\d+)?\s*(mg|mcg|ui)\b/,
    veneno: (n) => '1'.repeat(n) + '.'.repeat(n) + 'x',
  },
];

describe('ReDoS: ninguna regex expuesta a texto ajeno se cuelga', () => {
  for (const { donde, re, veneno } of EXPUESTAS) {
    it(`${donde} — 20,000 caracteres hostiles en menos de 100 ms`, () => {
      // 20k caracteres: más largo que cualquier mensaje de WhatsApp real
      // (4,096 es el tope de Meta), así que es holgadamente el peor caso.
      const ms = msPeorCaso(re, veneno(20_000));
      expect(ms).toBeLessThan(100);
    });

    it(`${donde} — el tiempo NO explota al doblar la entrada`, () => {
      // Lo que delata un ReDoS no es el tiempo absoluto sino la curva: si
      // doblar la entrada multiplica el tiempo por mucho más de dos, hay
      // retroceso. Se toma el mejor de tres corridas para que el ruido del
      // recolector de basura no haga fallar la prueba por su cuenta.
      const mejorDe3 = (n: number) =>
        Math.min(...[0, 1, 2].map(() => msPeorCaso(re, veneno(n))));
      const chico = Math.max(mejorDe3(5_000), 0.01);
      const grande = mejorDe3(10_000);
      expect(grande / chico).toBeLessThan(8);
    });
  }
});
