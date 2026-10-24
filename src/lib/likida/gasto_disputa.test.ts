import { describe, it, expect } from 'vitest';
import { disputaPendiente } from './gasto_disputa';

// A37-P-01: lector de `ocr_extra.montoDisputado` (lo escribe marcarMontoDisputado).
describe('disputaPendiente', () => {
  it('sin marca, o con una forma rara, no hay disputa (no se inventa)', () => {
    expect(disputaPendiente(undefined)).toBeNull();
    expect(disputaPendiente({})).toBeNull();
    expect(disputaPendiente({ montoDisputado: 'x' })).toBeNull();
    expect(disputaPendiente({ montoDisputado: { montoLeido: 'abc' } })).toBeNull();
    expect(disputaPendiente({ montoDisputado: [] })).toBeNull();
  });

  it('una disputa sin corrección queda pendiente con lo que dijo el operador', () => {
    const d = disputaPendiente({ montoDisputado: { montoLeido: 800, por: 'o1', dijo: ' son 8000 ', en: '2026-10-20T10:00:00Z' } });
    expect(d).toEqual({ montoLeido: 800, por: 'o1', dijo: 'son 8000', en: '2026-10-20T10:00:00Z' });
  });

  it('una corrección posterior la atiende; una anterior no', () => {
    const base = { montoDisputado: { montoLeido: 800, por: 'o1', dijo: null, en: '2026-10-20T10:00:00Z' } };
    expect(disputaPendiente({ ...base, montoCorregido: [{ antes: 800, despues: 8000, en: '2026-10-20T11:00:00Z' }] })).toBeNull();
    expect(disputaPendiente({ ...base, montoCorregido: { antes: 800, despues: 8000, en: '2026-10-20T11:00:00Z' } })).toBeNull();
    expect(disputaPendiente({ ...base, montoCorregido: [{ antes: 700, despues: 800, en: '2026-10-19T11:00:00Z' }] })).not.toBeNull();
  });
});
