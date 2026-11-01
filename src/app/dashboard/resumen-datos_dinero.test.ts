import { describe, it, expect, vi, beforeEach } from 'vitest';

// El lector REAL del Resumen v2 (`leerDatosResumen`), con la capa de datos sustituida por espías: lo que se prueba es QUÉ
// lectores toca según el permiso de dinero. Sin permiso de dinero no se consulta —no solo no se pinta— ningún peso.
const getKpis = vi.fn(async () => ({ viajesLiquidados: 4, montoComprobado: 100, diferenciaDetectada: 5, conDiferencias: 1, porRevisar: 2, tasaCuadre: 75 }));
const getLiquidacionesPorDia = vi.fn(async () => []);
const getDineroObservadoPorTipo = vi.fn(async () => [{ tipo: 'duplicado', monto: 10, n: 1 }]);
const getHechosSolos = vi.fn(async () => []);
const getGastoPorSemana = vi.fn(async () => ({ categorias: ['a'], series: [{ nombre: 'caseta', valores: [100] }] }));
const contarEscalados = vi.fn(async () => 0);
vi.mock('@/lib/likida/analytics', () => ({
  getKpis, getLiquidacionesPorDia, getDineroObservadoPorTipo, getHechosSolos, getGastoPorSemana, contarEscalados,
}));
const getEstadoCartaPorte = vi.fn(async () => ({ viajes: [], total: 0 }));
vi.mock('@/lib/likida/carta_porte_datos', () => ({ getEstadoCartaPorte }));

const { leerDatosResumen } = await import('./resumen-datos');

beforeEach(() => vi.clearAllMocks());

describe('leerDatosResumen — el permiso de dinero decide qué se CONSULTA', () => {
  it('sin permiso de dinero NO llama a getGastoPorSemana ni a getDineroObservadoPorTipo, y no deja peso alguno en los datos', async () => {
    const d = await leerDatosResumen('t1', '30', false);
    expect(getGastoPorSemana).not.toHaveBeenCalled();
    expect(getDineroObservadoPorTipo).not.toHaveBeenCalled();
    expect(d.veDinero).toBe(false);
    expect(d.peajes).toBeNull();
    expect(d.porTipo).toBeNull();
    // Lo que no es dinero sí se lee.
    expect(getKpis).toHaveBeenCalledTimes(1);
    expect(getEstadoCartaPorte).toHaveBeenCalledTimes(1);
    expect(contarEscalados).toHaveBeenCalledTimes(1);
  });

  it('con permiso de dinero sí las llama (la prueba de arriba no pasa por no leer nada)', async () => {
    const d = await leerDatosResumen('t1', '30', true);
    expect(getGastoPorSemana).toHaveBeenCalledTimes(1);
    expect(getDineroObservadoPorTipo).toHaveBeenCalledTimes(1);
    expect(d.peajes).toEqual({ total: 100, semanas: 5 });
    expect(d.porTipo).toHaveLength(1);
  });
});
