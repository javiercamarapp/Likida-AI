import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Liquidacion } from '@/types/cuadra';

// Se mockea el motor de cuadre desde DB para probar SOLO la lógica de la guardia
// (ramas de reemplazo / passthrough / fail-closed), sin tocar Supabase.
const LIQ: Omit<Liquidacion, 'id' | 'creadaEn'> = {
  viajeId: 'v1',
  totalComprobado: 10600,
  totalAnticipo: 10600,
  diferencia: 0,
  estatus: 'cuadrada',
  totalDeducible: 10600,
  totalNoDeducible: 0,
  totalPorConfirmar: 0,
  diferencias: [],
  gastos: [],
  iepsAcreditable: 0,
  ivaAcreditable: 0,
  peajeAcreditable: 0,
};

const cuadrarDesdeDB = vi.fn();
vi.mock('./desde_db', () => ({ cuadrarDesdeDB: (...a: unknown[]) => cuadrarDesdeDB(...a) }));

const { guardiaCifras } = await import('./guardia');

const tc = (toolName: string, error?: unknown) => ({ toolName, error, args: {}, result: {} }) as never;

describe('guardiaCifras', () => {
  beforeEach(() => {
    cuadrarDesdeDB.mockReset();
    cuadrarDesdeDB.mockResolvedValue(LIQ);
  });

  it('sin cifras: deja el texto del modelo intacto', async () => {
    const r = await guardiaCifras('¿Ya mandaste todo?', [], 't', 'v');
    expect(r.forzado).toBe(false);
    expect(cuadrarDesdeDB).not.toHaveBeenCalled();
  });

  it('cifras sin cuadrar_viaje ni política: fuerza el cuadre real', async () => {
    const r = await guardiaCifras('Sobraron 500 pesos', [], 't', 'v');
    expect(r.forzado).toBe(true);
    expect(cuadrarDesdeDB).toHaveBeenCalledWith('t', 'v');
    expect(r.reply).toContain('Este es el cuadre'); // encabezado neutral (no cerró)
  });

  it('cuadrar_viaje llamada + cifras: reemplaza por el resumen autoritativo', async () => {
    const r = await guardiaCifras('sobró 999', [tc('cuadrar_viaje')], 't', 'v');
    expect(r.forzado).toBe(true);
    expect(r.reply).toContain('Listo, cuadré'); // afirma cierre porque sí cuadró
  });

  it('solo consultar_politica + cifras (topes): respeta el texto', async () => {
    const r = await guardiaCifras('El tope de efectivo es $2,000', [tc('consultar_politica')], 't', 'v');
    expect(r.forzado).toBe(false);
    expect(cuadrarDesdeDB).not.toHaveBeenCalled();
  });

  it('cuadrar_viaje con error NO cuenta como cuadre válido', async () => {
    const r = await guardiaCifras('sobró 999', [tc('cuadrar_viaje', new Error('x'))], 't', 'v');
    expect(r.forzado).toBe(true);
    expect(r.reply).toContain('Este es el cuadre'); // neutral: no hubo cierre exitoso
  });

  it('FAIL-CLOSED: si el motor falla, no envía cifras', async () => {
    cuadrarDesdeDB.mockRejectedValue(new Error('db down'));
    const r = await guardiaCifras('Sobraron 500 pesos', [], 't', 'v');
    expect(r.forzado).toBe(true);
    expect(r.reply).not.toMatch(/\$|\d{2,}/);
  });
});
