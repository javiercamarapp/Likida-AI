import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LEYENDA_CORTA, LEYENDA_INLINE, leyendaPdf } from './leyendas';
import { NORMAS } from '../normas/indice';

// ═══════════════════════════════════════════════════════════════════════════
// LA LEYENDA ES LA EXIMENTE, NO EL ADORNO.
//
// `docs/fase1/inventario-normas.md` declaraba CFF 90 como una de las cuatro
// citas que el código usaba SIN ficha, y era la que fundamenta este archivo. Ya
// tiene ficha: `normas/cff-89-90.yaml`, transcrita del PDF de la Cámara de
// Diputados (texto vigente, última reforma DOF 09-04-2026).
//
// Al transcribirla apareció que la mitigación es LITERAL y está en el último
// párrafo del art. 89:
//
//   "No se incurrirá en la infracción a que se refiere la fracción primera de
//    este artículo, cuando se manifieste en la opinión que se otorgue por
//    escrito que el criterio contenido en ella es diverso a los criterios dados
//    a conocer por las autoridades fiscales... o bien manifiesten también por
//    escrito al contribuyente que su asesoría puede ser contraria a la
//    interpretación de las autoridades fiscales."
//
// O sea: la frase "puede diferir de los criterios que dé a conocer el SAT" no
// es prudencia, es la conducta que la ley nombra para no caer en la infracción
// del art. 89 fr. I —la que alcanza a quien "preste servicios"—. Borrarla de
// estas constantes no ahorra una línea: quita la eximente. Por eso se fija aquí.
// ═══════════════════════════════════════════════════════════════════════════

describe('leyendas — la eximente del art. 89, último párrafo', () => {
  it('CFF 89 y 90 ya tienen ficha, y verificada contra fuente primaria', () => {
    expect(NORMAS['cff-89-90']).toBeDefined();
    expect(NORMAS['cff-89-90'].estado).toBe('verificado_fuente_primaria');
  });

  it('las tres leyendas dicen POR ESCRITO que el criterio puede diferir del SAT', () => {
    const pdf = leyendaPdf('28-jul-2026', 'TRANSPORTES DEL SURESTE SA DE CV');
    for (const texto of [LEYENDA_CORTA, pdf]) {
      expect(texto.toLowerCase()).toContain('sat');
      expect(texto).toMatch(/pueden? (diferir|ser contraria)/i);
    }
    // La inline es la versión de una línea: no repite el matiz del SAT, pero sí
    // tiene que negar que sustituya al contador. Es la que se pega junto a un
    // veredicto suelto, no la que se archiva.
    expect(LEYENDA_INLINE).toMatch(/no sustituye/i);
  });

  it('la leyenda del PDF niega ser dictamen y nombra al responsable de validar', () => {
    const pdf = leyendaPdf('28-jul-2026', 'TRANSPORTES DEL SURESTE SA DE CV');
    expect(pdf).toContain('no constituye un dictamen');
    expect(pdf).toContain('artículo 52 del Código Fiscal');
    expect(pdf).toContain('TRANSPORTES DEL SURESTE SA DE CV');
  });

  it('sin razón social, la responsabilidad recae en "el contribuyente" y no se pierde', () => {
    expect(leyendaPdf('28-jul-2026')).toContain('corresponde a el contribuyente');
    expect(leyendaPdf('28-jul-2026', '   ')).toContain('corresponde a el contribuyente');
  });

  it('el archivo apunta a la ficha, no a una cita suelta', () => {
    // La deuda que se pagó fue exactamente esta: citar CFF 89/90 sin ficha.
    const src = readFileSync(new URL('./leyendas.ts', import.meta.url), 'utf8');
    expect(src).toContain('normas/cff-89-90.yaml');
  });
});
