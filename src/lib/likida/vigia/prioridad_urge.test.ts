import { describe, it, expect } from 'vitest';
import { prioridadDe } from './prioridad';
import { evaluarMolestia } from './molestia';

// Medido en 5 grupos reales: «me urge / nos urgen / urge el sello» aparecía 20-35 veces por chat y prioridadDe lo trataba como mensaje normal.
describe('urgencia con el verbo «urgir»', () => {
  it('«me urge», «nos urgen», «urge» son urgencia (nivel alta)', () => {
    for (const t of ['me urge el sello de la caja', 'Team nos urgen los datos', 'urge confirmar la salida', 'URGEN los datos de la unidad']) {
      const p = prioridadDe(t);
      expect(p.nivel, t).toBe(2);
      expect(p.motivos, t).toContain('urgencia');
    }
  });
  it('la negación sigue mandando: «no urge», «no me urge», «no nos urgen»', () => {
    for (const t of ['gracias, no urge', 'no me urge, con calma', 'no nos urgen todavía']) {
      expect(prioridadDe(t).motivos, t).not.toContain('urgencia');
    }
  });
  it('un mensaje normal sigue siendo normal', () => {
    expect(prioridadDe('la caja quedó en el patio').motivos).toEqual(['mensaje_normal']);
  });
  it('molestia: «me urge» suma un punto de lenguaje de molestia', () => {
    const m = evaluarMolestia({ texto: 'me urge el sello', intencion: 'otro', entradasSinRespuesta: 1, minutosEsperando: 0, slaRespuestaMin: 30 });
    expect(m.motivos).toContain('lenguaje_de_molestia');
    expect(m.nivel).toBe(1);
  });
});
