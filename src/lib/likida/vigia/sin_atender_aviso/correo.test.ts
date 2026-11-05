import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { enviarResumenSinAtender, parrafosDelResumen, ASUNTO_RESUMEN, claveDelResumen } = await import('./correo');
const { asuntoEsSeguro, MAX_PARRAFO, MAX_PARRAFOS } = await import('@/lib/likida/avisos_correo');
const { alerta, resultado, TENANT_A } = await import('./fixtures');

const dest = [{ nombre: 'Servicio 1', correo: 'servicio1@ejemplo.test', origen: 'servicio' as const }];
const base = (alertas = [alerta()]) => ({ tenantId: TENANT_A, resultado: resultado(alertas), destinatarios: dest, liga: 'https://app.ejemplo.test/x', turno: 'dia' as const, fechaLocal: '2026-11-04' });
const encendido = async () => ({ ok: true as const });

describe('resumen por correo', () => {
  it('apagado: no llama al proveedor y dice por qué', async () => {
    const enviar = vi.fn();
    for (const motivo of ['bandera_apagada', 'interruptor_apagado'] as const) {
      const r = await enviarResumenSinAtender(base(), { enviar, habilitado: async () => ({ ok: false, motivo }) });
      expect(r).toEqual({ ok: false, motivo });
    }
    expect(enviar).not.toHaveBeenCalled();
  });
  it('sin destinatarios y sin alertas no se manda', async () => {
    const enviar = vi.fn();
    expect(await enviarResumenSinAtender({ ...base(), destinatarios: [] }, { enviar, habilitado: encendido })).toEqual({ ok: false, motivo: 'sin_destinatarios' });
    expect(await enviarResumenSinAtender(base([]), { enviar, habilitado: encendido })).toEqual({ ok: false, motivo: 'sin_alertas' });
    expect(enviar).not.toHaveBeenCalled();
  });
  it('encendido: manda un aviso seguro, sin texto de mensajes y con clave estable por tenant/turno/fecha', async () => {
    const enviar = vi.fn(async () => ({ ok: true as const, destinatarios: 1 }));
    const a = alerta({ vistaPrevia: 'TEXTO SECRETO DEL CLIENTE' });
    const r = await enviarResumenSinAtender(base([a]), { enviar, habilitado: encendido });
    expect(r.ok).toBe(true);
    const aviso = enviar.mock.calls[0]![0] as import('@/lib/likida/avisos_correo').AvisoCorreo;
    expect(aviso.tenantId).toBe(TENANT_A);
    expect(aviso.asunto).toBe(ASUNTO_RESUMEN);
    expect(asuntoEsSeguro(aviso.asunto)).toBe(true);
    expect(JSON.stringify(aviso)).not.toContain('SECRETO');
    expect(aviso.clave).toBe(claveDelResumen('dia', '2026-11-04', [a]));
    expect(claveDelResumen('noche', '2026-11-04', [a])).not.toBe(aviso.clave);
    expect(claveDelResumen('dia', '2026-11-05', [a])).not.toBe(aviso.clave);
    expect(aviso.para).toEqual(['servicio1@ejemplo.test']);
  });
  it('dos envíos iguales llevan la misma clave (el proveedor los deduplica)', async () => {
    const claves: string[] = [];
    const enviar = vi.fn(async (a: { clave?: string }) => { claves.push(a.clave ?? ''); return { ok: true as const, destinatarios: 1 }; });
    await enviarResumenSinAtender(base(), { enviar: enviar as never, habilitado: encendido });
    await enviarResumenSinAtender(base(), { enviar: enviar as never, habilitado: encendido });
    expect(claves[0]).toBeTruthy();
    expect(claves[0]).toBe(claves[1]);
  });
  it('error del proveedor: se traduce y nunca lanza', async () => {
    const mk = (motivo: string) => vi.fn(async () => ({ ok: false as const, motivo: motivo as never }));
    expect(await enviarResumenSinAtender(base(), { enviar: mk('sin_configurar'), habilitado: encendido })).toEqual({ ok: false, motivo: 'sin_configurar' });
    expect(await enviarResumenSinAtender(base(), { enviar: mk('rechazado'), habilitado: encendido })).toEqual({ ok: false, motivo: 'rechazado' });
    expect(await enviarResumenSinAtender(base(), { enviar: mk('red'), habilitado: encendido })).toEqual({ ok: false, motivo: 'red' });
    expect(await enviarResumenSinAtender(base(), { enviar: vi.fn(async () => { throw new Error('boom'); }), habilitado: encendido })).toEqual({ ok: false, motivo: 'red' });
  });
  it('15 grupos caben: máximo de párrafos y de largo, y dice cuántos quedaron en la pantalla', () => {
    const muchas = Array.from({ length: 15 }, (_, i) => alerta({ chatId: `g${i}`, chatNombre: `Grupo ${'X'.repeat(50)}`, clave: `c${i}`, motivos: ['urgencia', 'pregunta', 'espera_sobre_umbral'] }));
    const p = parrafosDelResumen(resultado(muchas));
    expect(p.length).toBeLessThanOrEqual(MAX_PARRAFOS);
    for (const x of p) expect(x.length).toBeLessThanOrEqual(MAX_PARRAFO);
    expect(p[p.length - 1]).toContain('Y 3 más en la pantalla');
  });
});
