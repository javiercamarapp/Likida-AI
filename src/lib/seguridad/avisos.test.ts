import { beforeEach, describe, expect, it, vi } from 'vitest';

type Resp = { data: unknown; error: { message: string; code?: string } | null };
const rpcs: Array<{ nombre: string; args: Record<string, unknown> }> = [];
let respuestas: Record<string, Resp> = {};
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ rpc: async (nombre: string, args: Record<string, unknown>) => { rpcs.push({ nombre, args }); return respuestas[nombre] ?? { data: null, error: null }; } }),
}));
const enviarCorreo = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ ok: true, id: 'm1' }));
let correoOk = true;
vi.mock('@/lib/correo/enviar', () => ({ enviarCorreo: (...a: unknown[]) => enviarCorreo(...a), correoConfigurado: () => correoOk }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.likida.ai' }));
vi.mock('@/lib/logger', async (orig) => ({ ...(await orig<typeof import('@/lib/logger')>()), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const mod = await import('./avisos');

const fila = (x: Record<string, unknown> = {}) => ({
  id: 'e1', origen: 'auth', tipo: 'cambio_rol', severidad: 'alta', tenant_id: '0b5c1c9e-6f1e-4c7a-9a55-2f4e7d1a8b30', actor: 'u-1',
  detalle: { de: 'contador', a: 'flota_admin' }, creado_en: '2026-11-04T12:00:00Z', repeticiones: 2, avisos_enviados: 1, ...x,
});
const AHORA = new Date('2026-11-04T13:00:00Z');

beforeEach(() => {
  rpcs.length = 0; respuestas = {}; enviarCorreo.mockClear(); enviarCorreo.mockResolvedValue({ ok: true, id: 'm1' }); correoOk = true;
  delete process.env.SEGURIDAD_AVISOS; delete process.env.SEGURIDAD_EMAIL; delete process.env.ALERTA_EMAIL;
});

describe('el interruptor', () => {
  it('APAGADO por omisión: no toca la base ni manda nada', async () => {
    process.env.SEGURIDAD_EMAIL = 'seg@flota.mx';
    const r = await mod.barrerAvisosSeguridad({ ahora: AHORA });
    expect(r.estado).toBe('apagado');
    expect(rpcs).toHaveLength(0);
    expect(enviarCorreo).not.toHaveBeenCalled();
  });
  it('solo «encendido» lo prende (un «1» o «true» no cuentan: se prende a propósito)', () => {
    for (const v of ['1', 'true', 'si', '']) { process.env.SEGURIDAD_AVISOS = v; expect(mod.avisosSeguridadEncendidos(), v).toBe(false); }
    process.env.SEGURIDAD_AVISOS = 'encendido';
    expect(mod.avisosSeguridadEncendidos()).toBe(true);
  });
});

describe('destinatarios', () => {
  it('SEGURIDAD_EMAIL manda; si no, ALERTA_EMAIL; direcciones que no parecen correo se descartan', () => {
    process.env.ALERTA_EMAIL = 'op@likida.ai';
    expect(mod.destinatariosSeguridad()).toEqual(['op@likida.ai']);
    process.env.SEGURIDAD_EMAIL = 'a@x.mx, basura ,b@y.mx';
    expect(mod.destinatariosSeguridad()).toEqual(['a@x.mx', 'b@y.mx']);
  });
});

describe('barrerAvisosSeguridad (encendido)', () => {
  beforeEach(() => { process.env.SEGURIDAD_AVISOS = 'encendido'; process.env.SEGURIDAD_EMAIL = 'seg@flota.mx'; });

  it('sin destinatarios o sin correo NO reclama (reclamar quema los 3 avisos del incidente)', async () => {
    delete process.env.SEGURIDAD_EMAIL;
    expect((await mod.barrerAvisosSeguridad({ ahora: AHORA })).estado).toBe('sin_canal');
    process.env.SEGURIDAD_EMAIL = 'seg@flota.mx'; correoOk = false;
    expect((await mod.barrerAvisosSeguridad({ ahora: AHORA })).estado).toBe('sin_canal');
    expect(rpcs).toHaveLength(0);
  });

  it('reclama con tope 3 y manda UN correo con todos los incidentes, sin PII', async () => {
    respuestas.reclamar_avisos_seguridad = { data: [fila(), fila({ id: 'e2', tipo: 'login_fallido', origen: 'auth', actor: 'cuenta:ab12cd34ef56', repeticiones: 40, avisos_enviados: 3, tenant_id: null, detalle: { motivo: 'limite_cuenta' } })], error: null };
    const r = await mod.barrerAvisosSeguridad({ ahora: AHORA });
    expect(rpcs[0]).toMatchObject({ nombre: 'reclamar_avisos_seguridad', args: { p_max_avisos: 3 } });
    expect(r).toMatchObject({ estado: 'ok', reclamados: 2, enviados: 2 });
    expect(enviarCorreo).toHaveBeenCalledTimes(1);
    const [para, op] = enviarCorreo.mock.calls[0] as [string[] | string, { asunto: string; datos: Array<[string, string]> }];
    expect([para].flat()).toEqual(['seg@flota.mx']);
    expect(op.asunto).toMatch(/seguridad/i);
    const cuerpo = JSON.stringify(op);
    expect(cuerpo).toContain('cambio rol');
    expect(cuerpo).toContain('login fallido');
    expect(cuerpo).toContain('×40');
    expect(cuerpo).toMatch(/aviso 3 de 3/i); // el último aviso se dice
    expect(cuerpo).toMatch(/aviso 1 de 3/i);
  });

  it('sin filas no manda correo', async () => {
    respuestas.reclamar_avisos_seguridad = { data: [], error: null };
    const r = await mod.barrerAvisosSeguridad({ ahora: AHORA });
    expect(r).toMatchObject({ estado: 'ok', reclamados: 0, enviados: 0 });
    expect(enviarCorreo).not.toHaveBeenCalled();
  });

  it('con la 0955 sin aplicar: «sin_migrar», sin error ni correo', async () => {
    respuestas.reclamar_avisos_seguridad = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.reclamar_avisos_seguridad' } };
    expect((await mod.barrerAvisosSeguridad({ ahora: AHORA })).estado).toBe('sin_migrar');
    expect(enviarCorreo).not.toHaveBeenCalled();
  });

  it('un error real de la base se DICE (estado error), no se confunde con «sin incidentes»', async () => {
    respuestas.reclamar_avisos_seguridad = { data: null, error: { message: 'boom' } };
    const r = await mod.barrerAvisosSeguridad({ ahora: AHORA });
    expect(r.estado).toBe('error');
    expect(r.error).toContain('boom');
  });

  it('el correo que no sale se cuenta como fallido y no lanza', async () => {
    respuestas.reclamar_avisos_seguridad = { data: [fila()], error: null };
    enviarCorreo.mockResolvedValue({ ok: false, motivo: 'rechazado', detalle: 'x' });
    const r = await mod.barrerAvisosSeguridad({ ahora: AHORA });
    expect(r).toMatchObject({ estado: 'parcial', reclamados: 1, enviados: 0, fallidos: 1 });
  });
});

describe('anonimizarRedEventosSeguridad', () => {
  it('llama a la función con 30 días y devuelve cuántas filas', async () => {
    respuestas.anonimizar_red_evento_seguridad = { data: 17, error: null };
    expect(await mod.anonimizarRedEventosSeguridad()).toBe(17);
    expect(rpcs[0]).toMatchObject({ nombre: 'anonimizar_red_evento_seguridad', args: { p_dias: 30 } });
  });
  it('sin la 0955 o con error devuelve null (no inventa un cero) y no lanza', async () => {
    respuestas.anonimizar_red_evento_seguridad = { data: null, error: { code: '42883', message: 'no existe' } };
    expect(await mod.anonimizarRedEventosSeguridad()).toBeNull();
  });
});
