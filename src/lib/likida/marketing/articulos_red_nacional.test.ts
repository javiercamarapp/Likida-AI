import { describe, it, expect } from 'vitest';
import { ARTICULOS } from './articulos';

// ═══════════════════════════════════════════════════════════════════════════
// FIS-46-01b — abierto desde la auditoría 44, confirmado en la 46 y en la 47.
//
// `normas/red-nacional-autopistas.yaml` está `verificado_fuente_primaria` y su
// regla de negocio dice, en mayúsculas:
//
//   «NO CONSTRUIR LISTA BLANCA DE CASETAS. Prácticamente toda plaza del RNC cae
//    dentro de la Red; lo que hay que filtrar NO es la geografía sino el medio
//    de pago y la trazabilidad.»
//
// El blog público decía lo contrario: que la Red Nacional «es un término fiscal
// con lista propia: no toda caseta del país entra». Eso le manda al contralor a
// buscar una lista que no existe, y lo invita a NO acreditar casetas que sí
// entran — el error va en su contra, en una página pública firmada por Likida.
//
// Por qué se escapó cuatro rondas: el ancla de A46-FIS-01
// (`articulos_citas_reales.test.ts`) sólo vigila los bloques `t:'cita'`, y esta
// frase vive dentro de un `t:'ul'`. Esta prueba barre TODO el texto del artículo.
//
// Se fija por los DOS lados a propósito (la 42 ya aprendió que prohibir una
// frase no basta): que no se afirme la lista blanca, y que SÍ se diga cuál es el
// filtro verdadero. Negar sin afirmar deja el hueco abierto para la próxima
// redacción.
// ═══════════════════════════════════════════════════════════════════════════

/** Todo el texto visible de un artículo, venga del bloque que venga. */
function textoDe(a: (typeof ARTICULOS)[number]): string {
  return a.bloques
    .flatMap((b) => (b.t === 'ul' ? b.items : [b.texto]))
    .join(' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

const DEL_PEAJE = ARTICULOS.filter((a) => textoDe(a).includes('red nacional de autopistas'));

describe('FIS-46-01b · el blog no manda a buscar una lista blanca de casetas', () => {
  it('hay artículo que hable de la Red Nacional (si esto falla, el barrido dejó de cubrir algo)', () => {
    expect(DEL_PEAJE.length).toBeGreaterThanOrEqual(1);
  });

  // Lado A: no se afirma lo que la ficha prohíbe afirmar.
  it.each(DEL_PEAJE.map((a) => [a.slug, a] as const))(
    '%s no afirma que la Red Nacional tenga lista propia ni que falten casetas',
    (_slug, a) => {
      const texto = textoDe(a);
      for (const prohibida of ['lista propia', 'lista blanca', 'no toda caseta', 'no todas las casetas']) {
        expect(texto).not.toContain(prohibida);
      }
    },
  );

  // Lado B: se dice cuál ES el filtro, que es lo que la ficha sí sostiene.
  it.each(DEL_PEAJE.map((a) => [a.slug, a] as const))(
    '%s nombra el filtro verdadero: medio de pago y trazabilidad',
    (_slug, a) => {
      const texto = textoDe(a);
      expect(texto).toMatch(/tag|medio[s]? electrónico[s]?|medios electrónicos/);
      expect(texto).toMatch(/bitácora|trazabilidad/);
    },
  );
});
