import { describe, it, expect } from 'vitest';
import { actorDePanel } from './actor_panel';

describe('A37-A2-20: el actor del panel lleva al usuario, no solo el rol', () => {
  it('dos usuarios con el mismo rol dan actores distintos', () => {
    const a = actorDePanel({ rol: 'contador', userId: '11111111-1111-4111-8111-111111111111' });
    const b = actorDePanel({ rol: 'contador', userId: '22222222-2222-4222-8222-222222222222' });
    expect(a).not.toBe(b);
    expect(a.startsWith('panel:contador:')).toBe(true);
  });
  it('sin id conserva la forma de siempre y nunca pasa de 80 caracteres', () => {
    expect(actorDePanel({ rol: 'contador' })).toBe('panel:contador');
    expect(actorDePanel({ rol: 'x'.repeat(200), userId: 'y'.repeat(200) }).length).toBeLessThanOrEqual(80);
  });
});
