import { describe, expect, it } from 'vitest';
import { INFO, infoDe, type InfoClave, type InfoTexto } from './info-catalogo';

describe('catálogo de explicaciones (ⓘ)', () => {
  const claves = Object.keys(INFO) as InfoClave[];
  it('trae las claves de las tarjetas del Resumen', () => {
    for (const k of ['resumen.monto_comprobado', 'resumen.por_firmar', 'resumen.peajes_periodo', 'resumen.carta_porte_completas', 'resumen.a_tiempo', 'resumen.requiere_atencion', 'resumen.cierres_semana'] as const) expect(claves).toContain(k);
  });
  it('cada texto completa los bloques obligatorios y «Qué es» es UNA línea', () => {
    for (const k of claves) {
      const t = INFO[k];
      expect(t.titulo.trim().length, k).toBeGreaterThan(3);
      for (const campo of [t.queEs, t.comoSeCalcula, t.fuente]) expect(campo.trim().length, k).toBeGreaterThan(10);
      expect(t.queEs, k).not.toMatch(/\n/);
      expect(t.queEs.length, k).toBeLessThanOrEqual(110);
    }
  });
  it('sin lector verificado, el texto lo DICE: «Por confirmar» en fuente y cálculo, y nada de fórmulas, algoritmos ni reglas inventadas', () => {
    const PROHIBIDO = [/mayor monto/i, /riesgo/i, /nunca se firma/i, /en lote/i, /no se suman/i, /conciliad/i, /sistema de transporte/i, /bit[aá]cora/i, /importaci[oó]n/i, /nada se ejecuta/i, /\d/];
    for (const k of claves) {
      const t = INFO[k];
      if (t.estado !== 'verificado') {
        expect(t.fuente, k).toMatch(/^Por confirmar|Aún sin lector verificado|^Por confirmar/);
        expect(t.comoSeCalcula, k).toMatch(/Por confirmar|Aún sin lector verificado/);
      }
      const todo = [t.queEs, t.comoSeCalcula, t.fuente, (t as InfoTexto).queHacer ?? ''].join(' ');
      for (const re of PROHIBIDO) expect(todo, `${k} ${re}`).not.toMatch(re);
    }
  });
  it('una clave desconocida falla fuerte (nunca un ⓘ vacío)', () => {
    expect(() => infoDe('no.existe' as InfoClave)).toThrow(/desconocida/);
  });
});
