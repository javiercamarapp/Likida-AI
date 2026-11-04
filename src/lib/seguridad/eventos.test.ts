import { beforeEach, describe, expect, it, vi } from 'vitest';

const inserts: Array<Record<string, unknown>> = [];
const rpcs: Array<{ nombre: string; args: Record<string, unknown> }> = [];
type RespRpc = { data: unknown; error: { message: string; code?: string } | null };
let rpcRespuesta: RespRpc = { data: 'nuevo', error: null };
/** Respuestas en orden, una por llamada; agotada la cola contesta `rpcRespuesta`. */
const rpcCola: RespRpc[] = [];
let insertError: { message: string } | null = null;
let filas: Array<Record<string, unknown>> = [];
let selectError: { message: string } | null = null;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: async (nombre: string, args: Record<string, unknown>) => { rpcs.push({ nombre, args }); return rpcCola.shift() ?? rpcRespuesta; },
    from: () => ({
      insert: async (v: Record<string, unknown>) => { inserts.push(v); return { error: insertError }; },
      select: () => ({ order: () => ({ limit: async () => ({ data: filas, error: selectError }) }) }),
    }),
  }),
}));
vi.mock('@/lib/logger', async (orig) => ({ ...(await orig<typeof import('@/lib/logger')>()), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { registrarEventoSeguridad, getEventosSeguridad } = await import('./eventos');

beforeEach(() => { inserts.length = 0; rpcs.length = 0; rpcCola.length = 0; rpcRespuesta = { data: 'nuevo', error: null }; insertError = null; filas = []; selectError = null; });

describe('registrarEventoSeguridad — best-effort TOTAL, agrupando por ventana (0681)', () => {
  it('registra por la RPC que agrupa, con defaults (severidad media, tenant null) y el actor recortado a 120', async () => {
    await registrarEventoSeguridad({ origen: 'wa_webhook', tipo: 'firma_invalida', actor: 'x'.repeat(300) });
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].nombre).toBe('registrar_evento_seguridad');
    expect(rpcs[0].args).toMatchObject({ p_origen: 'wa_webhook', p_tipo: 'firma_invalida', p_severidad: 'media', p_tenant: null });
    expect((rpcs[0].args.p_actor as string).length).toBe(120);
    expect(inserts).toHaveLength(0); // sin insert directo: el flood no pasa por aquí
  });

  it('una severidad alta viaja tal cual (la base decide agrupar, jamás descartar)', async () => {
    await registrarEventoSeguridad({ origen: 'api_v1', tipo: 'acceso_denegado', severidad: 'alta', tenantId: 't1' });
    expect(rpcs[0].args).toMatchObject({ p_severidad: 'alta', p_tenant: 't1' });
  });

  it('con la 0681 sin aplicar (RPC ausente) cae al insert directo de siempre', async () => {
    rpcRespuesta = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.registrar_evento_seguridad' } };
    await registrarEventoSeguridad({ origen: 'wa_webhook', tipo: 'firma_invalida', actor: 'x'.repeat(300) });
    expect(inserts[0]).toMatchObject({ origen: 'wa_webhook', tipo: 'firma_invalida', severidad: 'media', tenant_id: null });
    expect((inserts[0].actor as string).length).toBe(120);
  });

  it('un error real de la RPC NO cae al insert (no se esquiva el tope) y NO lanza', async () => {
    rpcRespuesta = { data: null, error: { code: '23514', message: 'check violation' } };
    await expect(registrarEventoSeguridad({ origen: 'copiloto', tipo: 'intent_invalido' })).resolves.toBeUndefined();
    expect(inserts).toHaveLength(0);
  });

  it('un error de la base NO lanza — el camino vigilado jamás se cae por vigilarlo', async () => {
    rpcRespuesta = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.registrar_evento_seguridad' } };
    insertError = { message: 'db down' };
    await expect(registrarEventoSeguridad({ origen: 'copiloto', tipo: 'intent_invalido' })).resolves.toBeUndefined();
  });
});

describe('registrarEventoSeguridad — huella de red y tipos nuevos (0954/0955, CT-SEG-11)', () => {
  const RED = { ipHash: 'a'.repeat(32), ua: 'curl/8.0' };

  it('con red usa la RPC _red con ip_hash y ua', async () => {
    await registrarEventoSeguridad({ origen: 'auth', tipo: 'login_fallido', actor: 'cuenta:abc', red: RED });
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].nombre).toBe('registrar_evento_seguridad_red');
    expect(rpcs[0].args).toMatchObject({ p_origen: 'auth', p_tipo: 'login_fallido', p_ip_hash: RED.ipHash, p_ua: 'curl/8.0' });
  });

  it('sin red usa la RPC de siempre (el código nuevo no exige la 0955 para lo que ya hacía)', async () => {
    await registrarEventoSeguridad({ origen: 'copiloto', tipo: 'intent_invalido' });
    expect(rpcs.map((r) => r.nombre)).toEqual(['registrar_evento_seguridad']);
  });

  it('con la 0955 sin aplicar (RPC _red ausente) cae a la RPC anterior, sin red', async () => {
    rpcCola.push({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.registrar_evento_seguridad_red' } });
    await registrarEventoSeguridad({ origen: 'auth', tipo: 'login_fallido', red: RED });
    expect(rpcs.map((r) => r.nombre)).toEqual(['registrar_evento_seguridad_red', 'registrar_evento_seguridad']);
    expect(rpcs[1].args).not.toHaveProperty('p_ip_hash');
  });

  it('con la 0954 sin aplicar un tipo nuevo rebota por el check y se REGISTRA igual como «otro» con el tipo real en el detalle', async () => {
    rpcCola.push({ data: null, error: { code: '23514', message: 'new row violates check constraint "evento_seguridad_tipo_check"' } });
    await registrarEventoSeguridad({ origen: 'auth', tipo: 'cambio_rol', severidad: 'alta', detalle: { de: 'a', a: 'b' } });
    expect(rpcs).toHaveLength(2);
    expect(rpcs[1].args).toMatchObject({ p_origen: 'otro', p_tipo: 'otro', p_severidad: 'alta' });
    expect(rpcs[1].args.p_detalle).toMatchObject({ tipo_real: 'cambio_rol', origen_real: 'auth', de: 'a' });
  });

  it('un tipo VIEJO que rebota no se reintenta (no se esquiva el check)', async () => {
    rpcRespuesta = { data: null, error: { code: '23514', message: 'check' } };
    await registrarEventoSeguridad({ origen: 'copiloto', tipo: 'intent_invalido' });
    expect(rpcs).toHaveLength(1);
  });

  it('el detalle sale redactado (correo, token) y el actor recortado', async () => {
    await registrarEventoSeguridad({ origen: 'auth', tipo: 'login_fallido', detalle: { email: 'a@b.com', token: 'zzz', motivo: 'limite' } });
    expect(rpcs[0].args.p_detalle).toEqual({ email: '[EMAIL]', token: '[redactado]', motivo: 'limite' });
  });
});

describe('getEventosSeguridad — el panel no confunde vacío con ciego', () => {
  it('mapea filas', async () => {
    filas = [{ id: '1', origen: 'chat', tipo: 'cifra_sin_respaldo', severidad: 'media', tenant_id: 't1', actor: null, detalle: null, creado_en: '2026-08-17' }];
    const r = await getEventosSeguridad();
    expect(r[0]).toMatchObject({ origen: 'chat', tenantId: 't1', repeticiones: 1 });
  });
  it('lee las repeticiones de la 0681 y, sin la columna, cuenta una', async () => {
    filas = [
      { id: '1', origen: 'wa_webhook', tipo: 'firma_invalida', severidad: 'media', tenant_id: null, actor: null, detalle: null, creado_en: '2026-10-02', repeticiones: 412 },
      { id: '2', origen: 'wa_webhook', tipo: 'firma_invalida', severidad: 'media', tenant_id: null, actor: null, detalle: null, creado_en: '2026-10-02' },
    ];
    const r = await getEventosSeguridad();
    expect(r.map((x) => x.repeticiones)).toEqual([412, 1]);
  });
  it('LANZA en error de lectura', async () => {
    selectError = { message: 'boom' };
    await expect(getEventosSeguridad()).rejects.toThrow('boom');
  });
});
