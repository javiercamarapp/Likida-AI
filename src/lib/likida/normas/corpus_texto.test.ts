import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { FICHAS_TEXTO } from './corpus_texto';
// El generador exporta su lector para que ESTA prueba vuelva a leer los YAML.
// Si el corpus generado se separa de la carpeta, aquí truena.
import { leerCorpusTexto } from '../../../../scripts/generar-corpus-contador.mjs';

// ═══════════════════════════════════════════════════════════════════════════
// EL CORPUS DEL CONTADOR NO SE PUEDE SEPARAR DE normas/ (E.26).
//
// El modo de falla que esto ataja es el mismo de corpus.test.ts, pero con
// dientes más largos: alguien corrige el texto_vigente de una ficha en el
// YAML (donde se revisa en el PR) y el CONTADOR sigue respondiendo con el
// texto viejo, porque lo que viaja en su prompt es este módulo generado. Un
// examen dorado corrido sobre un corpus desactualizado calificaría contra la
// norma que ya no rige — el examen mismo se volvería la fuente de alucinación
// que 22-evaluacion.md §7.3 advierte.
// ═══════════════════════════════════════════════════════════════════════════

describe('el corpus de texto del contador NO se puede separar de normas/', () => {
  it('tiene exactamente los mismos archivos que normas/ y normas/datos/', () => {
    const enDisco = [
      ...readdirSync('normas').filter((f) => f.endsWith('.yaml') || f.endsWith('.yml')).sort(),
      ...readdirSync('normas/datos').filter((f) => f.endsWith('.yaml') || f.endsWith('.yml')).sort().map((f) => `datos/${f}`),
    ];
    expect(FICHAS_TEXTO.map((n) => n.archivo)).toEqual(enDisco);
  });

  it('cada texto coincide byte a byte con su YAML — regenerar es obligatorio', () => {
    expect(JSON.parse(JSON.stringify(FICHAS_TEXTO))).toEqual(leerCorpusTexto('.'));
  });

  it('ninguna ficha viaja vacía', () => {
    for (const f of FICHAS_TEXTO) {
      expect(f.texto.trim().length, f.archivo).toBeGreaterThan(50);
    }
  });

  it('toda ficha de normas/ declara su identidad (las de datos/ son series, no fichas)', () => {
    for (const f of FICHAS_TEXTO.filter((x) => !x.archivo.startsWith('datos/'))) {
      // La identidad y el estado de verificación son lo que le permite al
      // contador distinguir lo afirmable de lo pendiente.
      expect(f.texto, f.archivo).toMatch(/^id:/m);
      expect(f.texto, f.archivo).toMatch(/^estado_verificacion:/m);
    }
  });
});
