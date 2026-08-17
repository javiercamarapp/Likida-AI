import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));

const { promptHashActual, veredictoAgregado } = await import('./evals');

describe('promptHashActual — el ancla del re-examen', () => {
  it('es estable (mismo prompt, mismo hash) y de 64 hex', () => {
    const a = promptHashActual('analista');
    expect(a).toBe(promptHashActual('analista'));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('veredictoAgregado — binario con escalamiento, jamás promedio', () => {
  it('una trampa fallada tumba TODO aunque el resto pase', () => {
    expect(veredictoAgregado(['paso', 'paso', 'fallo', 'paso'])).toBe('fallo');
  });
  it('sin fallos pero con casos a ojo humano → revisar', () => {
    expect(veredictoAgregado(['paso', 'revisar'])).toBe('revisar');
  });
  it('paso solo cuando TODO pasó; el examen vacío NO pasa', () => {
    expect(veredictoAgregado(['paso', 'paso'])).toBe('paso');
    expect(veredictoAgregado([])).toBe('revisar');
  });
});
