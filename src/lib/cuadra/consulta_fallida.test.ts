import { describe, it, expect } from 'vitest';
import { ConsultaFallida } from './conv';

// CRÍTICO de la auditoría 5 (backend): `resolveOperador` y `getOpenViaje`
// confunden "no hay" con "no pude preguntar", y el producto miente con la cara
// seria.
//
// Los dos hacían `if (error || !data) return null`. Con un error transitorio de
// Supabase:
//
//   · un operador que SÍ está dado de alta recibe "no te tengo registrado";
//   · y en la RE-VERIFICACIÓN posterior al mutex, el operador recibe
//     "ese viaje ya quedó cerrado 👍" sobre un viaje que sigue `abierto`, sin
//     liquidación, sin PDF y sin una sola línea de log.
//
// Es la misma confusión que el 28-jul se corrigió en el diagnóstico de
// migraciones ("FALTA la migración 0005" cuando lo que faltaba era la red).
// Vivía en dos sitios más, y en éstos le habla directo al operador.
//
// Aquí se prueba la PIEZA que hace posible la distinción. El comportamiento
// completo de `resolveOperador`/`getOpenViaje` contra un cliente real de
// Supabase no tiene arnés todavía — anotado en la síntesis de la ronda.

describe('ConsultaFallida', () => {
  it('es distinguible de cualquier otro Error', () => {
    const e: unknown = new ConsultaFallida('operador por teléfono: fetch failed');
    expect(e instanceof ConsultaFallida).toBe(true);
    expect(e instanceof Error).toBe(true);
    expect((e as Error).name).toBe('ConsultaFallida');
  });

  it('un Error normal NO se confunde con ella', () => {
    const e: unknown = new Error('cualquier otra cosa');
    expect(e instanceof ConsultaFallida).toBe(false);
  });

  it('conserva la causa para el log, que es lo que faltaba', () => {
    const e = new ConsultaFallida('viaje abierto: TypeError: fetch failed');
    expect(e.message).toContain('viaje abierto');
    expect(e.message).toContain('fetch failed');
  });
});
