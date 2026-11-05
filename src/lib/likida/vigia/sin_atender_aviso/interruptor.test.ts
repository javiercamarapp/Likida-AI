import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));

const { resumenHabilitado, banderaResumenEncendida, BANDERA_RESUMEN } = await import('./interruptor');

describe('interruptor del resumen', () => {
  it('apagado por omisión: sin la bandera de la plataforma no hay envío ni se consultan interruptores', async () => {
    const leer = vi.fn();
    expect(await resumenHabilitado({ bandera: () => false, leer })).toEqual({ ok: false, motivo: 'bandera_apagada' });
    expect(leer).not.toHaveBeenCalled();
  });
  it('la bandera solo vale con «si»', () => {
    delete process.env[BANDERA_RESUMEN];
    expect(banderaResumenEncendida()).toBe(false);
    process.env[BANDERA_RESUMEN] = 'tal vez';
    expect(banderaResumenEncendida()).toBe(false);
    process.env[BANDERA_RESUMEN] = 'si';
    expect(banderaResumenEncendida()).toBe(true);
    delete process.env[BANDERA_RESUMEN];
  });
  it('apagado o ilegible en cualquiera de los dos interruptores = apagado; excepción = apagado', async () => {
    for (const malo of ['apagado', 'ilegible'] as const) {
      expect(await resumenHabilitado({ bandera: () => true, leer: async (n) => (n === 'agente:vigia' ? malo : 'encendido') })).toEqual({ ok: false, motivo: 'interruptor_apagado' });
    }
    expect(await resumenHabilitado({ bandera: () => true, leer: async () => { throw new Error('x'); } })).toEqual({ ok: false, motivo: 'interruptor_apagado' });
    expect(await resumenHabilitado({ bandera: () => true, leer: async () => 'encendido' })).toEqual({ ok: true });
  });
});
