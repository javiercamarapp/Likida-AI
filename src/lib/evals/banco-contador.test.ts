import { describe, it, expect } from 'vitest';
import { BANCO_CONTADOR, CLAVES_TRAMPA, esperaDeCaso } from './banco-contador';

// ═══════════════════════════════════════════════════════════════════════════
// EL BANCO DORADO NO SE DEGRADA EN SILENCIO (E.26).
//
// 22-evaluacion.md fija el contrato: 32 preguntas, 7 trampas con nombre
// (Q1, Q5, Q8, Q14, Q17, Q25, Q29), y cada una con respuesta correcta,
// criterio ESCRITO, fundamento citado y fecha de vigencia. Un caso que
// pierda cualquiera de esas piezas vuelve el examen un concurso de opinión
// del juez — exactamente lo que el diseño existe para impedir.
// ═══════════════════════════════════════════════════════════════════════════

describe('el banco dorado del contador (22-evaluacion.md §5)', () => {
  it('son exactamente 32 preguntas con claves Q1..Q32, sin repetir', () => {
    expect(BANCO_CONTADOR).toHaveLength(32);
    const claves = BANCO_CONTADOR.map((c) => c.clave);
    expect(new Set(claves).size).toBe(32);
    expect(claves).toEqual(Array.from({ length: 32 }, (_, i) => `Q${i + 1}`));
  });

  it('las 7 trampas son las del diseño — ni una más, ni una menos', () => {
    expect(CLAVES_TRAMPA).toEqual(['Q1', 'Q5', 'Q8', 'Q14', 'Q17', 'Q25', 'Q29']);
  });

  it('ningún caso viaja sin respuesta, criterio operativo, señal ni fundamento', () => {
    for (const c of BANCO_CONTADOR) {
      expect(c.pregunta.trim().length, c.clave).toBeGreaterThan(20);
      expect(c.respuestaCorrecta.trim().length, c.clave).toBeGreaterThan(40);
      // El criterio es OPERATIVO: dice qué pasa y qué falla, no solo qué se espera.
      expect(c.criterio, c.clave).toMatch(/PASA si/);
      expect(c.criterio, c.clave).toMatch(/FALLA si/);
      expect(c.senalDeFallo.trim().length, c.clave).toBeGreaterThan(10);
      expect(c.fundamento.length, c.clave).toBeGreaterThan(0);
      expect([1, 2, 3]).toContain(c.severidad);
    }
  });

  it('la vigencia está declarada: fecha ISO o null estructural, jamás undefined', () => {
    for (const c of BANCO_CONTADOR) {
      expect(c.vigenciaHasta === null || /^\d{4}-\d{2}-\d{2}$/.test(c.vigenciaHasta), c.clave).toBe(true);
    }
    // Todo lo fundado en RFA/RMF/LIF 2026 caduca con el ejercicio.
    const anuales = BANCO_CONTADOR.filter((c) =>
      c.fundamento.some((f) => /(RFA 2026|RMF 2026|LIF 2026)/.test(f)));
    for (const c of anuales) expect(c.vigenciaHasta, c.clave).toBe('2026-12-31');
  });

  it('donde el corpus de fichas no sostiene la respuesta, el criterio lo declara', () => {
    // La honestidad del banco: si `fichaEnCorpus` es false en una FÁCTICA, el
    // criterio debe decirle al juez cómo clasificar la abstención (que es el
    // desenlace esperable de un agente que solo afirma lo que su corpus
    // sostiene). Sin esa nota, el juez castigaría como error el comportamiento
    // diseñado. Las trampas no la necesitan: ahí la abstención ES la respuesta.
    for (const c of BANCO_CONTADOR.filter((x) => !x.fichaEnCorpus && x.tipo === 'factica')) {
      expect(c.criterio, c.clave).toMatch(/NOTA DE CORPUS/);
    }
  });

  it('esperaDeCaso arma el material del juez humano completo', () => {
    const e = esperaDeCaso(BANCO_CONTADOR[0]);
    expect(e).toContain('CRITERIO:');
    expect(e).toContain('SEÑAL DE FALLO:');
    expect(e).toContain('FUNDAMENTO:');
  });

  it('ninguna espera revienta el ancho útil del panel (los casos se leen, no se scrollean)', () => {
    for (const c of BANCO_CONTADOR) {
      expect(esperaDeCaso(c).length, c.clave).toBeLessThan(3500);
    }
  });
});
