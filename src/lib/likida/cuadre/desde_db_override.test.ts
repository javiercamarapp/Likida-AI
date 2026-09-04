import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 25, BE-C1a/BE-C1b/DATOS-C1 (CRÍTICO). `cuadrarDesdeDB` aprende un
// tercer parámetro opcional, `gastosOverride`: cuando se manda, el motor
// corre sobre ESA lista (los gastos con el ajuste YA aplicado en memoria) en
// vez de leer `gasto` de la base — lo que necesita `revision_recalculo.ts`
// para recalcular el desglose ANTES de que la RPC de ajuste escriba nada.
//
// Sin `gastosOverride` el comportamiento es EXACTAMENTE el de siempre: se
// lee `getGastos` de la base. Las dos ramas se prueban aquí; el resto del
// cuadre (política, estímulos, RFA 2.9…) ya está cubierto por las pruebas de
// `engine.ts` y no se repite.
// ═══════════════════════════════════════════════════════════════════════════

const getViaje = vi.fn();
const getGastos = vi.fn();
const getOperador = vi.fn();
const getAcumuladoCombustible = vi.fn();
const getPerfilCrudo = vi.fn();
const getConfig = vi.fn();
const cuadrarViaje = vi.fn();

vi.mock('../repo', () => ({
  getViaje: (...a: unknown[]) => getViaje(...a),
  getGastos: (...a: unknown[]) => getGastos(...a),
  getOperador: (...a: unknown[]) => getOperador(...a),
  getAcumuladoCombustible: (...a: unknown[]) => getAcumuladoCombustible(...a),
  getPerfilCrudo: (...a: unknown[]) => getPerfilCrudo(...a),
}));
vi.mock('../config', () => ({ getConfig: (...a: unknown[]) => getConfig(...a) }));
vi.mock('../perfil/preguntas', () => ({
  calificaEstimuloPeaje: () => ({ elegible: undefined }),
  facilidad15Declarada: () => null,
}));
vi.mock('./engine', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  cuadrarViaje: (...a: unknown[]) => cuadrarViaje(...a),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => ({}) }) }));
vi.mock('../presupuesto', () => ({ acotada: (q: unknown) => q }));

const { cuadrarDesdeDB } = await import('./desde_db');

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

beforeEach(() => {
  vi.clearAllMocks();
  getViaje.mockResolvedValue({ id: U(9), anticipo: 9000, operadorId: U(5) });
  getOperador.mockResolvedValue({ id: U(5), nombre: 'Juan', rfc: undefined });
  getConfig.mockResolvedValue({
    politica: [], agentes: { liquidacion: { umbralConfianza: 0.85 } }, empresa: {}, hidrocarburos: undefined, estimulos: undefined,
    validacion: { fechaToleranciaDiasAntes: 3 },
  });
  getPerfilCrudo.mockResolvedValue({});
  getAcumuladoCombustible.mockResolvedValue({ efectivo: 0, totalCombustible: 0 });
  cuadrarViaje.mockReturnValue({ viajeId: U(9), totalComprobado: 0, diferencia: 0, estatus: 'cuadrada', diferencias: [], gastos: [] });
});

describe('cuadrarDesdeDB — gastosOverride (AUDITORÍA 25)', () => {
  it('sin override: lee getGastos de la base, como siempre', async () => {
    const gastosDb = [{ id: U(1), concepto: 'diesel' as const, monto: 500 }];
    getGastos.mockResolvedValueOnce(gastosDb);
    await cuadrarDesdeDB('t1', U(9));
    expect(getGastos).toHaveBeenCalledWith(U(9), 't1');
    expect(cuadrarViaje).toHaveBeenCalledTimes(1);
    expect(cuadrarViaje.mock.calls[0][0]).toMatchObject({ gastos: gastosDb });
  });

  it('con override: getGastos NUNCA se llama, y el motor corre sobre la lista ajustada', async () => {
    const override = [{ id: U(1), concepto: 'diesel' as const, monto: 8000 }];
    await cuadrarDesdeDB('t1', U(9), override);
    expect(getGastos).not.toHaveBeenCalled();
    expect(cuadrarViaje).toHaveBeenCalledTimes(1);
    expect(cuadrarViaje.mock.calls[0][0]).toMatchObject({ gastos: override });
  });
});
