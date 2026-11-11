import { describe, expect, it } from 'vitest';
import { casillasDeArranque, resumenArranque } from './arranque';

const ob = { credenciales: { total: 2, probadas: 1 }, avisosConfigurados: 0, avisoPrivacidad: { razonSocial: true, domicilio: false } };
const base = { id: 't1', viajes: 3, politicaPropia: true, telefono: '5512345678', telefonosLegibles: true, onboarding: ob };

describe('arranque de la flota', () => {
  it('son seis casillas y cada una apunta a donde se resuelve', () => {
    const c = casillasDeArranque(base);
    expect(c).toHaveLength(6);
    expect(c.find((x) => x.clave === 'politica')?.href).toBe('/dashboard/politicas?tenant=t1');
  });
  it('cuenta las hechas', () => {
    expect(resumenArranque(casillasDeArranque(base))).toEqual({ hechas: 4, total: 6 });
  });
  it('lectura caída = sin medir y NO un número a medias', () => {
    const c = casillasDeArranque({ ...base, onboarding: null });
    expect(c.filter((x) => x.estado === 'sin_medir')).toHaveLength(3);
    expect(resumenArranque(c)).toBeNull();
  });
  it('teléfono ilegible no es pendiente', () => {
    expect(casillasDeArranque({ ...base, telefono: undefined, telefonosLegibles: false })[0].estado).toBe('sin_medir');
  });
  it('sin viajes queda pendiente', () => {
    expect(casillasDeArranque({ ...base, viajes: 0 }).find((x) => x.clave === 'viaje')?.estado).toBe('pendiente');
  });
});
