import { describe, it, expect } from 'vitest';
import { ARTICULOS } from './articulos';
import { FICHAS_TEXTO } from '../normas/corpus_texto';

// ═══════════════════════════════════════════════════════════════════════════
// A46-FIS-01 — Un `cita` del blog se pinta como <blockquote> con su `fuente`
// debajo (`app/blog/[slug]/page.tsx:42-48`): atribuirle a una regla una frase
// que la regla no dice es publicar norma inventada, en una página pública,
// firmada por Likida.
//
// La ronda 46 encontró las dos que había:
//   · «La bitácora que casi nadie arma es dinero que casi nadie acredita.»
//     atribuida a «RMF 2026, regla 9.1.8, fracción II» — es una frase de la
//     casa, no el texto de la fracción.
//   · «La cuota aplicable es la disminuida…» atribuida a una «ficha verificada
//     del corpus de Likida» — `normas/criterio-1-LIF-PI.yaml` tiene
//     `texto_vigente: null` y `estado_verificacion: evidencia_corroborante`,
//     y su propia nota dice «NO está transcrito aquí».
//
// La regla que queda fijada es binaria, y es la del producto: o citas el texto
// LITERAL de una ficha, o hablas como Likida. No hay tercera forma — y la
// prueba editorial que ya existía (`articulos.test.ts:34`) sólo exigía que
// hubiera fuente, que es justo la presión que produce fuentes inventadas.
// ═══════════════════════════════════════════════════════════════════════════

/** Espacios colapsados: el YAML parte los párrafos y el artículo no. */
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

const CORPUS = FICHAS_TEXTO.map((f) => norm(f.texto));

/** ¿La frase aparece LITERAL en alguna ficha de `normas/`? */
function esCitaLiteralDeFicha(texto: string): boolean {
  const t = norm(texto);
  return CORPUS.some((c) => c.includes(t));
}

describe('A46-FIS-01 · ninguna cita del blog le pone palabras a una norma', () => {
  const citas = ARTICULOS.flatMap((a) =>
    a.bloques.filter((b): b is { t: 'cita'; texto: string; fuente: string } => b.t === 'cita')
      .map((b) => ({ slug: a.slug, ...b })),
  );

  it('hay citas que revisar (si esto falla, el barrido dejó de cubrir algo)', () => {
    expect(citas.length).toBeGreaterThanOrEqual(2);
  });

  it.each(citas.map((c) => [c.slug, c.texto.slice(0, 48), c] as const))(
    '%s · «%s…»: o es texto literal de una ficha, o la fuente dice Likida',
    (_slug, _frag, c) => {
      if (esCitaLiteralDeFicha(c.texto)) return; // cita de verdad: pasa
      // No es literal de ninguna ficha ⇒ es voz de la casa, y la fuente
      // tiene que decirlo. Atribuirla a un instrumento la disfraza de norma.
      expect(c.fuente, `cita no literal atribuida a «${c.fuente}»`).toMatch(/^Likida\b/);
    },
  );

  it('ninguna fuente se declara verificada: la verificación vive en la ficha, no en la prosa', () => {
    for (const c of citas) {
      expect(c.fuente.toLowerCase(), c.slug).not.toContain('verificad');
    }
  });
});
