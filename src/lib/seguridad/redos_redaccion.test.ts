import { describe, expect, it } from 'vitest';
import { redactarTexto } from '@/lib/logger';
import { redactarDetalle } from './evento_red';

// F1B (adversarial): el regex SENSIBLE era cuadratico; una ruta de 32 KB bloqueaba ~1 s el event loop.
describe('la redaccion es lineal ante entradas hostiles', () => {
  const hostiles = ['a.'.repeat(16_000) + '@', '1-'.repeat(16_000) + '@', 'a'.repeat(32_000) + '@'];
  it('redactarTexto de 32 KB tarda menos de 100 ms', () => {
    for (const h of hostiles) {
      const t0 = performance.now();
      redactarTexto(h);
      expect(performance.now() - t0).toBeLessThan(100);
    }
  });
  it('redactarDetalle con una ruta de 32 KB tarda menos de 50 ms', () => {
    for (const h of hostiles) {
      const t0 = performance.now();
      redactarDetalle({ ruta: `/api/v1/${h}` });
      expect(performance.now() - t0).toBeLessThan(50);
    }
  });
  it('un correo real se sigue redactando', () => {
    expect(redactarTexto('hola ana.perez+x@flota.mx fin')).toBe('hola [EMAIL] fin');
    expect(redactarTexto('a.b.c@x.com')).toBe('[EMAIL]');
  });
});
