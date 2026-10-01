import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  datos: vi.fn(), perfil: vi.fn(), terminales: vi.fn(), jefes: vi.fn(), pendientes: vi.fn(),
  opConteos: vi.fn(), uniConteos: vi.fn(), politica: vi.fn(), primeros: vi.fn(),
}));
vi.mock('./repo', () => ({ getDatosResponsable: m.datos, getPerfilCrudo: m.perfil }));
vi.mock('./perfil/preguntas', () => ({ onboardingFiscalListo: (p: unknown) => p === 'listo' }));
vi.mock('./terminales', () => ({ getTerminales: m.terminales, getJefesDeTrafico: m.jefes }));
vi.mock('./invitacion_operador', () => ({ contarPendientes: m.pendientes }));
vi.mock('./administracion', () => ({ getOperadoresConteos: m.opConteos, getUnidadesConteos: m.uniConteos, politicaPropiaDeclarada: m.politica }));
vi.mock('./primeros-pasos', () => ({ getPrimerosPasos: m.primeros }));

const { leerSenalesMarcha } = await import('./puesta_en_marcha_lectura');

const bien = () => {
  m.datos.mockResolvedValue({ razonSocial: 'X' });
  m.perfil.mockResolvedValue('listo');
  m.terminales.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
  m.jefes.mockResolvedValue([{ userId: 'j' }]);
  m.pendientes.mockResolvedValue(3);
  m.opConteos.mockResolvedValue({ activos: 10 });
  m.uniConteos.mockResolvedValue({ activas: 7 });
  m.politica.mockResolvedValue(true);
  m.primeros.mockResolvedValue({ operadores: 10, viajes: 0, comprobantes: 0, liquidaciones: 0, completado: false });
};
beforeEach(() => { Object.values(m).forEach((f) => f.mockReset()); bien(); });

describe('leerSenalesMarcha', () => {
  it('junta las señales reales', async () => {
    const s = await leerSenalesMarcha('t-1');
    expect(s).toMatchObject({
      datosResponsable: true, perfilFiscalListo: true, patios: 2, jefes: 1, politicaPropia: true, unidadesActivas: 7,
      operadores: { activos: 10, pendientesDeInvitar: 3 },
      primerosPasos: { viajes: 0 },
    });
  });

  it('sin razón social ni domicilio (getDatosResponsable → null) es FALSE: pendiente de verdad', async () => {
    m.datos.mockResolvedValue(null);
    expect((await leerSenalesMarcha('t-1')).datosResponsable).toBe(false);
  });

  it('cada lectura caída es `null` SOLA: no tumba las demás ni las vuelve pendientes', async () => {
    m.datos.mockRejectedValue(new Error('x'));
    m.terminales.mockRejectedValue(new Error('x'));
    m.politica.mockRejectedValue(new Error('x'));
    m.primeros.mockRejectedValue(new Error('x'));
    const s = await leerSenalesMarcha('t-1');
    expect(s.datosResponsable).toBeNull();
    expect(s.patios).toBeNull();
    expect(s.politicaPropia).toBeNull();
    expect(s.primerosPasos).toBeNull();
    expect(s.unidadesActivas).toBe(7);
    expect(s.jefes).toBe(1);
  });

  it('operadores es null si falla el conteo O los pendientes (no se afirma «0 pendientes» sin leerlos)', async () => {
    m.pendientes.mockRejectedValue(new Error('x'));
    expect((await leerSenalesMarcha('t-1')).operadores).toBeNull();
    bien();
    m.opConteos.mockResolvedValue(null);
    expect((await leerSenalesMarcha('t-1')).operadores).toBeNull();
  });

  it('un perfil fiscal sin declarar es false, no null', async () => {
    m.perfil.mockResolvedValue({});
    expect((await leerSenalesMarcha('t-1')).perfilFiscalListo).toBe(false);
  });
});
