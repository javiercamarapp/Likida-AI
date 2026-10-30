import { describe, expect, it } from 'vitest';
import { INFO, infoDe, type InfoClave } from './info-catalogo';

describe('catálogo de explicaciones (ⓘ)', () => {
  const claves = Object.keys(INFO) as InfoClave[];
  it('trae las claves de las tarjetas del Resumen', () => {
    for (const k of ['resumen.monto_comprobado', 'resumen.por_firmar', 'resumen.peajes_periodo', 'resumen.carta_porte_completas', 'resumen.a_tiempo', 'resumen.requiere_atencion', 'resumen.cierres_semana'] as const) expect(claves).toContain(k);
  });
  it('cada texto completa los bloques obligatorios, «Qué es» en UNA línea, sin saltos ni vacíos', () => {
    for (const k of claves) {
      const t = INFO[k];
      expect(t.titulo.trim().length, k).toBeGreaterThan(3);
      for (const campo of [t.queEs, t.comoSeCalcula, t.fuente]) expect(campo.trim().length, k).toBeGreaterThan(10);
      expect(t.queEs, k).not.toMatch(/\n/);
      expect(t.queEs.length, k).toBeLessThanOrEqual(110);
      if (t.queHacer !== undefined) expect(t.queHacer.trim().length, k).toBeGreaterThan(10);
    }
  });
  it('no inventa cifras: ningún texto contiene números sueltos (salvo «n de N»)', () => {
    for (const k of claves) {
      const todo = [INFO[k].queEs, INFO[k].comoSeCalcula, INFO[k].fuente, INFO[k].queHacer ?? ''].join(' ');
      expect(todo, k).not.toMatch(/\d/);
    }
  });
  it('una clave desconocida falla fuerte (nunca un ⓘ vacío)', () => {
    expect(() => infoDe('no.existe' as InfoClave)).toThrow(/desconocida/);
  });
});
