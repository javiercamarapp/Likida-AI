import { describe, it, expect, vi, beforeEach } from 'vitest';

// A2: `cuadrarDesdeDB` decide el insumo `tarjetasEmpresa` según la FECHA DE CIERRE
// de la liquidación que se reabre (ver vigencia_tarjeta.ts). Aquí se prueba el cableado.
const getViaje = vi.fn();
const getGastos = vi.fn();
const getOperador = vi.fn();
const getAcumuladoCombustible = vi.fn();
const getPerfilCrudo = vi.fn();
const getConfig = vi.fn();
const cuadrarViaje = vi.fn();
const declarado = vi.fn();
const cadena: Record<string, unknown> = {};
for (const m of ['select', 'eq', 'not', 'gte', 'lte', 'order', 'range']) cadena[m] = () => cadena;
cadena.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);

vi.mock('../repo', () => ({
  getViaje: (...a: unknown[]) => getViaje(...a), getGastos: (...a: unknown[]) => getGastos(...a),
  getOperador: (...a: unknown[]) => getOperador(...a), getAcumuladoCombustible: (...a: unknown[]) => getAcumuladoCombustible(...a),
  getPerfilCrudo: (...a: unknown[]) => getPerfilCrudo(...a),
}));
vi.mock('../config', () => ({ getConfig: (...a: unknown[]) => getConfig(...a) }));
vi.mock('../perfil/preguntas', () => ({
  calificaEstimuloPeaje: () => ({ elegible: undefined }), facilidad15Vigente: () => undefined,
  tarjetasDeLaEmpresa: (...a: unknown[]) => declarado(...a),
}));
vi.mock('./engine', async (original) => ({ ...(await original<Record<string, unknown>>()), cuadrarViaje: (...a: unknown[]) => cuadrarViaje(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => cadena }) }));
vi.mock('../presupuesto', () => ({ acotada: (q: unknown) => q }));

const { cuadrarDesdeDB } = await import('./desde_db');
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

beforeEach(() => {
  vi.clearAllMocks();
  getViaje.mockResolvedValue({ id: U(9), anticipo: 9000, operadorId: U(5) });
  getOperador.mockResolvedValue({ id: U(5), nombre: 'Juan' });
  getConfig.mockResolvedValue({
    politica: [], agentes: { liquidacion: { umbralConfianza: 0.85 } }, empresa: {}, hidrocarburos: undefined, estimulos: undefined,
    validacion: { fechaToleranciaDiasAntes: 3 },
  });
  getGastos.mockResolvedValue([]);
  getPerfilCrudo.mockResolvedValue({});
  getAcumuladoCombustible.mockResolvedValue({ efectivo: 0, totalCombustible: 0 });
  declarado.mockReturnValue(undefined); // la flota NO ha declarado sus tarjetas
  cuadrarViaje.mockReturnValue({ viajeId: U(9), totalComprobado: 0, diferencia: 0, estatus: 'cuadrada', diferencias: [], gastos: [] });
});

const insumo = () => (cuadrarViaje.mock.calls[0][0] as { tarjetasEmpresa?: boolean }).tarjetasEmpresa;

describe('cuadrarDesdeDB — vigencia de tarjeta_no_empresa', () => {
  it('cierre nuevo (sin cerradaEn) y sin declarar: el motor recibe undefined (fail-closed)', async () => {
    await cuadrarDesdeDB('t1', U(9));
    expect(insumo()).toBeUndefined();
  });
  it('reabrir una liquidación cerrada ANTES de la regla: el motor recibe true (no retroactivo)', async () => {
    await cuadrarDesdeDB('t1', U(9), undefined, { cerradaEn: '2026-09-20T12:00:00Z' });
    expect(insumo()).toBe(true);
  });
  it('liquidación cerrada con la regla vigente: se respeta la declaración de la flota', async () => {
    declarado.mockReturnValue(false);
    await cuadrarDesdeDB('t1', U(9), undefined, { cerradaEn: '2026-10-20T12:00:00Z' });
    expect(insumo()).toBe(false);
  });
});
