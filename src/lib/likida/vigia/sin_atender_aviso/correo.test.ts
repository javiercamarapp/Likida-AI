import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { enviarResumenSinAtender, parrafosDelResumen, ASUNTO_RESUMEN, claveDelResumen } = await import('./correo');
const { asuntoEsSeguro, MAX_PARRAFO, MAX_PARRAFOS } = await import('@/lib/likida/avisos_correo');
const { alerta, resultado, TENANT_A, CLIENTE_A, CLIENTE_B } = await import('./fixtures');

const dest = [{ nombre: 'Servicio 1', correo: 'servicio1@ejemplo.test', origen: 'servicio' as const }];
const base = (alertas = [alerta()]) => ({ tenantId: TENANT_A, resultado: resultado(alertas), destinatarios: dest, liga: 'https://app.ejemplo.test/x', turno: 'dia' as const, fechaLocal: '2026-11-04' });
const encendido = async () => ({ ok: true as const });

describe('resumen por correo', () => {
  it('sin interruptores inyectados falla cerrado (bandera de plataforma ausente) y no llama al proveedor', async () => {
    const enviar = vi.fn();
    const antes = process.env.LIKIDA_VIGIA_SIN_ATENDER_CORREO;
    delete process.env.LIKIDA_VIGIA_SIN_ATENDER_CORREO;
    try {
      expect(await enviarResumenSinAtender(base(), { enviar })).toEqual({ ok: false, motivo: 'bandera_apagada' });
    } finally {
      if (antes !== undefined) process.env.LIKIDA_VIGIA_SIN_ATENDER_CORREO = antes;
    }
    expect(enviar).not.toHaveBeenCalled();
  });
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
    const enviar = vi.fn(async (_a: import('@/lib/likida/avisos_correo').AvisoCorreo) => ({ ok: true as const, destinatarios: 1 }));
    const a = alerta({ vistaPrevia: 'TEXTO SECRETO DEL CLIENTE' });
    const r = await enviarResumenSinAtender(base([a]), { enviar, habilitado: encendido });
    expect(r.ok).toBe(true);
    const aviso = enviar.mock.calls[0]![0];
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
  it('con nombres de 60 letras y 5 motivos el «Y N más» cuadra con las líneas que de verdad salieron', () => {
    for (const n of [12, 15, 40]) {
      const muchas = Array.from({ length: n }, (_, i) => alerta({ chatId: `g${i}`, chatNombre: 'N'.repeat(60), critico: true, clave: `c${i}`, motivos: ['espera_sobre_umbral', 'insistencia', 'urgencia', 'pregunta', 'palabra_clave'] }));
      const p = parrafosDelResumen(resultado(muchas));
      expect(p.length).toBeLessThanOrEqual(MAX_PARRAFOS);
      for (const x of p) expect(x.length).toBeLessThanOrEqual(MAX_PARRAFO);
      const salieron = p.slice(1, -1).join('\n').split('\n').length;
      const resto = n - salieron;
      const pie = p[p.length - 1]!;
      if (resto > 0) expect(pie).toContain(`Y ${resto} más en la pantalla`);
      else expect(pie).not.toContain('más en la pantalla');
    }
  });
  it('solo lista grupos con algo sin atender: los revisados sin pendientes no aparecen', () => {
    const r = resultado([alerta({ chatId: 'g1', chatNombre: 'Grupo Con Pendiente' })]);
    r.resumen.chatsRevisados = 9;
    const texto = parrafosDelResumen(r).join('\n');
    expect(texto).toContain('Grupo Con Pendiente');
    expect(texto).toContain('en 1 grupos');
    expect(texto).not.toContain('9');
  });
  it('sin pendientes: una sola línea que lo dice, sin cifras ni grupos inventados', () => {
    const p = parrafosDelResumen(resultado([]));
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/No hay conversaciones sin atender/);
    expect(p[0]).not.toMatch(/\d/);
  });
  describe('A2: un destinatario ligado a un cliente no ve alertas de otros clientes', () => {
    const aA = alerta({ chatId: 'gA', chatNombre: 'Grupo Del Cliente A', clave: 'cA' });
    const aB = alerta({ chatId: 'gB', chatNombre: 'Grupo Del Cliente B', clave: 'cB' });
    const mapa = new Map([['gA', CLIENTE_A], ['gB', CLIENTE_B]]);
    const dests = [
      { nombre: 'Servicio A', correo: 'a@ejemplo.test', origen: 'servicio' as const, clientes: [CLIENTE_A] },
      { nombre: 'Gerente', correo: 'gerente@ejemplo.test', origen: 'nivel1' as const, clientes: null },
    ];
    it('el servicio de A recibe un correo solo con A; quien ve toda la flota recibe ambos', async () => {
      const enviar = vi.fn(async (a: import('@/lib/likida/avisos_correo').AvisoCorreo) => ({ ok: true as const, destinatarios: a.para.length }));
      const r = await enviarResumenSinAtender({ ...base([aA, aB]), destinatarios: dests, clienteDeChat: mapa }, { enviar, habilitado: encendido });
      expect(r.ok).toBe(true);
      const avisos = enviar.mock.calls.map((c) => c[0]);
      const aviso = (correo: string) => avisos.find((x) => x.para.includes(correo))!;
      const textoA = aviso('a@ejemplo.test').parrafos.join('\n');
      expect(textoA).toContain('Grupo Del Cliente A');
      expect(textoA).not.toContain('Grupo Del Cliente B');
      expect(aviso('a@ejemplo.test').para).toEqual(['a@ejemplo.test']);
      const textoG = aviso('gerente@ejemplo.test').parrafos.join('\n');
      expect(textoG).toContain('Grupo Del Cliente A');
      expect(textoG).toContain('Grupo Del Cliente B');
      expect(aviso('a@ejemplo.test').clave).not.toBe(aviso('gerente@ejemplo.test').clave);
    });
    it('si todas las alertas son de A, A y la flota comparten un solo correo', async () => {
      const enviar = vi.fn(async (a: import('@/lib/likida/avisos_correo').AvisoCorreo) => ({ ok: true as const, destinatarios: a.para.length }));
      await enviarResumenSinAtender({ ...base([aA]), destinatarios: dests, clienteDeChat: mapa }, { enviar, habilitado: encendido });
      expect(enviar).toHaveBeenCalledTimes(1);
      expect(enviar.mock.calls[0]![0].para.slice().sort()).toEqual(['a@ejemplo.test', 'gerente@ejemplo.test']);
    });
    it('un grupo sin cliente conocido no se muestra a quien esta ligado a un cliente (falla cerrado)', async () => {
      const enviar = vi.fn(async (a: import('@/lib/likida/avisos_correo').AvisoCorreo) => ({ ok: true as const, destinatarios: a.para.length }));
      const huerfana = alerta({ chatId: 'gX', chatNombre: 'Grupo Sin Cliente', clave: 'cX' });
      const r = await enviarResumenSinAtender({ ...base([huerfana]), destinatarios: [dests[0]!], clienteDeChat: mapa }, { enviar, habilitado: encendido });
      expect(enviar).not.toHaveBeenCalled();
      expect(r).toEqual({ ok: false, motivo: 'sin_destinatarios' });
    });
  });
});
