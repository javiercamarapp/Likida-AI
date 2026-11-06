import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));

const { resumenHabilitado, resumenHabilitadoParaFlota, banderaResumenEncendida, BANDERA_RESUMEN } = await import('./interruptor');

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

describe('interruptor propio de la flota (0999)', () => {
  const encendido = { bandera: () => true, leer: async () => 'encendido' as const };
  it('plataforma encendida y flota encendida: sale', async () => {
    expect(await resumenHabilitadoParaFlota('t1', async () => true, encendido)).toEqual({ ok: true });
  });
  it('flota apagada, sin fila (false) o con la tabla ausente: no sale aunque la plataforma esté encendida', async () => {
    expect(await resumenHabilitadoParaFlota('t1', async () => false, encendido)).toEqual({ ok: false, motivo: 'flota_apagada' });
  });
  it('si no se puede leer el interruptor de la flota o devuelve algo que no es true: apagado', async () => {
    expect(await resumenHabilitadoParaFlota('t1', async () => { throw new Error('x'); }, encendido)).toEqual({ ok: false, motivo: 'flota_apagada' });
    expect(await resumenHabilitadoParaFlota('t1', (async () => 'si') as never, encendido)).toEqual({ ok: false, motivo: 'flota_apagada' });
  });
  it('la plataforma manda primero: con la bandera apagada ni siquiera se consulta a la flota', async () => {
    const leerFlota = vi.fn(async () => true);
    expect(await resumenHabilitadoParaFlota('t1', leerFlota, { bandera: () => false, leer: async () => 'encendido' })).toEqual({ ok: false, motivo: 'bandera_apagada' });
    expect(leerFlota).not.toHaveBeenCalled();
    expect(await resumenHabilitadoParaFlota('t1', leerFlota, { bandera: () => true, leer: async () => 'apagado' })).toEqual({ ok: false, motivo: 'interruptor_apagado' });
    expect(leerFlota).not.toHaveBeenCalled();
  });
  it('consulta con el tenant que se le pasa (el de la sesión), no con otro', async () => {
    const leerFlota = vi.fn(async () => true);
    await resumenHabilitadoParaFlota('t-sesion', leerFlota, encendido);
    expect(leerFlota).toHaveBeenCalledWith('t-sesion');
  });
});
