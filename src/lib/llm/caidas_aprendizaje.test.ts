// A37-L-10: lo que el proceso «aprende» de un 400 (apagar el esquema estricto de un
// modelo) caduca; un 400 transitorio no lo apaga hasta el siguiente cold start.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { aprenderSinEsquemaEstricto, usaEsquemaEstricto, reiniciarCaidas, VIGENCIA_APRENDIDO_MS } from './caidas';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T12:00:00Z')); reiniciarCaidas(); });
afterEach(() => { vi.useRealTimers(); });

describe('A37-L-10 · el aprendizaje de «sin esquema estricto» caduca', () => {
  it('tras aprenderlo, el modelo va en json_object mientras dure la vigencia', () => {
    aprenderSinEsquemaEstricto('proveedor/modelo-x');
    expect(usaEsquemaEstricto('proveedor/modelo-x')).toBe(false);
    vi.advanceTimersByTime(VIGENCIA_APRENDIDO_MS - 1000);
    expect(usaEsquemaEstricto('proveedor/modelo-x')).toBe(false);
  });

  it('pasada la vigencia, el esquema estricto se vuelve a intentar', () => {
    aprenderSinEsquemaEstricto('proveedor/modelo-x');
    vi.advanceTimersByTime(VIGENCIA_APRENDIDO_MS + 1000);
    expect(usaEsquemaEstricto('proveedor/modelo-x')).toBe(true);
  });

  it('la lista MEDIDA (modelos sin esquema estricto) no caduca', () => {
    vi.advanceTimersByTime(24 * 3600 * 1000);
    expect(usaEsquemaEstricto('google/gemini-3.5-flash-lite')).toBe(false);
  });
});
