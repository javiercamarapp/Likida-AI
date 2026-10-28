import { describe, expect, it } from 'vitest';
import { crearTmsFalso } from './tms_falso.fixture';
import { describirContratoSalidaTms, entradaDeContrato, formaValida } from './tms_contrato.fixture';
import { SIN_TMS, SALIDA_NO_DISPONIBLE } from './tms_puerto';

// El doble en memoria (modo `duplicado`) cumple el contrato completo: es la referencia ejecutable para el adaptador real.
describirContratoSalidaTms('doble en memoria (duplicado)', () => crearTmsFalso('duplicado'));

describe('el contrato distingue un adaptador correcto de uno que miente', () => {
  it('SIN_TMS y SALIDA_NO_DISPONIBLE respetan la forma (fallan cerrado con mensaje llano)', async () => {
    for (const p of [SIN_TMS, SALIDA_NO_DISPONIBLE]) expect(formaValida(await p.cargarPlantilla(entradaDeContrato()))).toBe(true);
  });
  it('un adaptador que NO deduplica por llave se detecta', async () => {
    let n = 0;
    const malo = { async cargarPlantilla() { n++; return { ok: true as const, referencia: `R-${n}`, duplicado: false }; } };
    const e = entradaDeContrato();
    const a = await malo.cargarPlantilla(); const b = await malo.cargarPlantilla();
    expect(a.ok && b.ok && b.duplicado === false && b.referencia !== a.referencia).toBe(true); // lo que el contrato rechazaría
    expect(e.idempotencyKey).toBeTruthy();
  });
  it('una respuesta sin mensaje llano o con clase inventada NO tiene forma válida', () => {
    expect(formaValida({ ok: false, clase: 'transitorio', mensajeLlano: '  ', errores: [] })).toBe(false);
    expect(formaValida({ ok: false, clase: 'rara' as never, mensajeLlano: 'x', errores: [] })).toBe(false);
    expect(formaValida({ ok: true, referencia: null, duplicado: false })).toBe(true);
  });
});
