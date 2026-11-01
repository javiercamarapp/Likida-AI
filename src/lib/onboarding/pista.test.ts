import { describe, expect, it } from 'vitest';
import { claveDeRuta, pistaDeRuta } from './pista';

describe('pista contextual', () => {
  it('pliega los uuid a [id] y encuentra la pista de una subpantalla', () => {
    expect(claveDeRuta('/dashboard/5b0c2f4e-1111-4222-8333-444455556666')).toBe('/dashboard/[id]');
    expect(claveDeRuta('/dashboard/carta-porte/borrador/5b0c2f4e-1111-4222-8333-444455556666?x=1')).toBe('/dashboard/carta-porte/borrador/[id]');
    expect(pistaDeRuta('/dashboard/agentes/peajes/reclamacion/')?.titulo).toMatch(/reclamación/i);
    expect(pistaDeRuta('/dashboard/5b0c2f4e-1111-4222-8333-444455556666')?.ruta).toBe('/dashboard/[id]');
  });
  it('una pantalla del menú no tiene pista (ya está en el recorrido)', () => {
    expect(pistaDeRuta('/dashboard/viajes')).toBeNull();
    expect(pistaDeRuta('/dashboard')).toBeNull();
  });
});
