// Paquete W — entrada por phone_number_id: dos líneas de tenant + plataforma, firma HMAC real con secret de prueba.
// '@/lib/meta/canal' se mockea según el contrato; nada llama a Meta real.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const SECRETO = 'app-secret-de-prueba-linea';
process.env.WHATSAPP_APP_SECRET = SECRETO;

const LINEAS: Record<string, { tenantId: string; lineaId: string }> = {
  LINEA_A: { tenantId: 'tenant-a', lineaId: 'linea-a' },
  LINEA_B: { tenantId: 'tenant-b', lineaId: 'linea-b' },
};
const canalPorPhoneNumberId = vi.fn(async (id: string) => {
  const l = LINEAS[id];
  return l ? { tenantId: l.tenantId, canal: { phoneNumberId: id, token: 'TOKEN-SECRETO', origen: 'tenant' as const, lineaId: l.lineaId } } : null;
});
vi.mock('@/lib/meta/canal', () => ({ canalPorPhoneNumberId: (id: string) => canalPorPhoneNumberId(id) }));

const processInbound = vi.fn(async (_m: unknown) => {});
vi.mock('@/lib/likida/processor', () => ({ processInbound: (m: unknown) => (processInbound as (m: unknown) => Promise<void>)(m) }));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/observability/sentry', () => ({ flushObservabilidad: vi.fn(async () => {}) }));
vi.mock('@/lib/likida/interruptores', () => ({
  estaApagado: vi.fn(async () => false),
  leerInterruptor: vi.fn(async () => 'encendido' as const),
}));
const registrar = vi.fn(async (_m: unknown[]) => ({ registrados: 0, fallidos: 0 }));
vi.mock('@/lib/likida/wa_ventana', () => ({ registrarEntrantesWhatsApp: (m: unknown[]) => registrar(m) }));

const pendientes: Array<() => unknown> = [];
vi.mock('next/server', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, after: (fn: () => unknown) => { pendientes.push(fn); } };
});

const { bandejaInbox } = vi.hoisted(() => ({ bandejaInbox: new Map<string, unknown>() }));
vi.mock('@/lib/likida/wa_pendientes', () => ({
  pendientesYaConocidos: async () => new Set<string>(),
  guardarEventosPendientes: async (ms: Array<{ waMessageId?: string }>) => {
    const filas = ms.map((m, i) => {
      const id = m.waMessageId ?? `f-${i}`;
      bandejaInbox.set(id, m);
      return { id, evento: m, guardado: true };
    });
    return { guardados: filas.length, fallidos: 0, filas };
  },
  reclamarPendiente: async (id: string) => (bandejaInbox.has(id) ? { id, evento: bandejaInbox.get(id), intentos: 1 } : null),
  marcarPendienteProcesado: async () => undefined,
  anotarFalloPendiente: async () => undefined,
}));
const rpc = vi.fn(async () => ({ data: 1, error: null }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc }) }));

const { POST } = await import('./route');

const firmar = (body: string) => 'sha256=' + crypto.createHmac('sha256', SECRETO).update(body).digest('hex');
async function postear(body: string) {
  const res = await POST(new Request('https://likidaai.vercel.app/api/webhook/whatsapp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': firmar(body) },
    body,
  }) as never);
  while (pendientes.length) await pendientes.shift()!();
  return res;
}

const ahora = () => String(Math.floor(Date.now() / 1000));
const cambio = (phoneId: string | undefined, id: string, from = '5219991110009') => ({
  field: 'messages',
  value: {
    messaging_product: 'whatsapp',
    ...(phoneId ? { metadata: { display_phone_number: '15550001111', phone_number_id: phoneId } } : {}),
    messages: [{ from, id, timestamp: ahora(), type: 'text', text: { body: 'hola' } }],
  },
});
const payload = (...cambios: unknown[]) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '1', changes: cambios }] });
const enviados = () => processInbound.mock.calls.map((c) => c[0] as { waMessageId: string; tenantId?: string; linea?: { phoneNumberId: string; lineaId: string | null } });

beforeEach(() => {
  processInbound.mockReset(); processInbound.mockImplementation(async () => {});
  canalPorPhoneNumberId.mockClear(); registrar.mockClear(); rpc.mockClear();
  pendientes.length = 0; bandejaInbox.clear();
  logger.warn.mockReset();
  process.env.WHATSAPP_PHONE_NUMBER_ID = 'PLATAFORMA';
});

describe('entrada por phone_number_id', () => {
  it('dos líneas de tenant en el mismo POST: cada mensaje lleva SU tenant y su línea, sin mezclarse', async () => {
    const r = await postear(payload(cambio('LINEA_A', 'wamid.A', '5219990000001'), cambio('LINEA_B', 'wamid.B', '5219990000001')));
    expect(r.status).toBe(200);
    const por = Object.fromEntries(enviados().map((m) => [m.waMessageId, m]));
    expect(por['wamid.A'].tenantId).toBe('tenant-a');
    expect(por['wamid.A'].linea).toMatchObject({ phoneNumberId: 'LINEA_A', lineaId: 'linea-a' });
    expect(por['wamid.B'].tenantId).toBe('tenant-b');
    expect(por['wamid.B'].linea).toMatchObject({ phoneNumberId: 'LINEA_B', lineaId: 'linea-b' });
  });

  it('el token del canal nunca viaja en el mensaje ni en logs', async () => {
    await postear(payload(cambio('LINEA_A', 'wamid.T')));
    expect(JSON.stringify(enviados())).not.toContain('TOKEN-SECRETO');
    expect(JSON.stringify([...bandejaInbox.values()])).not.toContain('TOKEN-SECRETO');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('TOKEN-SECRETO');
  });

  it('número desconocido: se descarta con webhook.numero_ajeno y no entra a ningún tenant', async () => {
    const r = await postear(payload(cambio('DESCONOCIDO', 'wamid.X')));
    expect(r.status).toBe(200);
    expect(processInbound).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('webhook.numero_ajeno', { recibido: 'DESCONOCIDO' });
  });

  it('si la consulta de líneas falla, un número ajeno se descarta (nunca cae a plataforma ni a un tenant)', async () => {
    canalPorPhoneNumberId.mockRejectedValueOnce(new Error('base caída'));
    await postear(payload(cambio('LINEA_A', 'wamid.F')));
    expect(processInbound).not.toHaveBeenCalled();
  });

  it('plataforma sin cambios: sin tenantId/linea y sin consultar líneas', async () => {
    await postear(payload(cambio('PLATAFORMA', 'wamid.P'), cambio(undefined, 'wamid.SM')));
    expect(canalPorPhoneNumberId).not.toHaveBeenCalled();
    const ms = enviados();
    expect(ms).toHaveLength(2);
    for (const m of ms) { expect(m.tenantId).toBeUndefined(); expect(m.linea).toBeUndefined(); }
  });

  it('la ventana de 24 h solo registra entrantes de plataforma (la clave actual no distingue línea)', async () => {
    await postear(payload(cambio('PLATAFORMA', 'wamid.P2'), cambio('LINEA_A', 'wamid.A2')));
    expect(registrar).toHaveBeenCalledTimes(1);
    const arg = registrar.mock.calls[0][0] as Array<{ waMessageId: string }>;
    expect(arg.map((m) => m.waMessageId)).toEqual(['wamid.P2']);
  });

  it('los estados (statuses) también se filtran por línea: de tenant pasan, de ajeno no', async () => {
    const estado = (phoneId: string, id: string) => ({ field: 'messages', value: { metadata: { phone_number_id: phoneId }, statuses: [{ id, status: 'delivered', timestamp: ahora() }] } });
    await postear(payload(estado('LINEA_A', 'wamid.E1'), estado('AJENO', 'wamid.E2')));
    const lote = (rpc.mock.calls[0] as unknown as [string, { p_estados: Array<{ wamid: string }> }])[1].p_estados;
    expect(lote.map((e) => e.wamid)).toEqual(['wamid.E1']);
  });

  it('sin WHATSAPP_PHONE_NUMBER_ID y número que no es de ningún tenant: tolerancia de siempre (plataforma)', async () => {
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    await postear(payload(cambio('CUALQUIERA', 'wamid.Z')));
    expect(enviados()).toHaveLength(1);
    expect(enviados()[0].tenantId).toBeUndefined();
  });
});
