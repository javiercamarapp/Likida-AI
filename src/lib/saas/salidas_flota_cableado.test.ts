import { beforeEach, describe, expect, it, vi } from 'vitest';

// F20: PRUEBA PARA CADA SALIDA. Con el plan pausado (o ilegible) ninguna llega a Meta ni a Resend; con el plan libre, sí sale.
vi.unmock('@/lib/saas/salidas_flota');

type R = { data: unknown; error: { message: string } | null };
let suscripcion: R = { data: [], error: null };
let operador: R = { data: [{ tenant_id: 't1' }], error: null };
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'limit', 'insert', 'order']) b[m] = () => b;
      const r = () => (t === 'suscripcion' ? suscripcion : t === 'operador' ? operador : { data: [], error: null });
      b.then = (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(r()).then(res, rej);
      return b;
    },
  }),
}));
vi.mock('@/lib/likida/presupuesto', async (i) => ({ ...(await i<typeof import('@/lib/likida/presupuesto')>()), acotada: (q: unknown) => q }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/wa_outbox', () => ({ encolarSalidaWhatsApp: vi.fn(async () => {}) }));

const meta = await import('@/lib/meta/client');
const { enviarCorreo } = await import('@/lib/correo/enviar');
const { olvidarCacheSalidas } = await import('./salidas_flota');

const CORREO = { asunto: 'Aviso', avance: 'a', titulo: 'T', parrafos: ['p'], porQueLoRecibes: 'Lo recibes por ser parte de la flota.' };
const TEL = '5215512345678';
const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }], id: 're_1' }), { status: 200 }));

beforeEach(() => {
  olvidarCacheSalidas();
  fetchSpy.mockClear();
  vi.stubGlobal('fetch', fetchSpy);
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
  process.env.RESEND_API_KEY = 're_test';
  process.env.RESEND_EMAIL_DOMAIN = 'mail.ejemplo.test';
  operador = { data: [{ tenant_id: 't1' }], error: null };
});

const ESTADOS: Array<[string, R, boolean]> = [
  ['pausada', { data: [{ estado: 'pausada' }], error: null }, false],
  ['cancelada', { data: [{ estado: 'cancelada' }], error: null }, false],
  ['plan ilegible', { data: null, error: { message: 'caída' } }, false],
  ['activa', { data: [{ estado: 'activa' }], error: null }, true],
  ['morosa', { data: [{ estado: 'morosa' }], error: null }, true],
  ['sin suscripción (demo/piloto)', { data: [], error: null }, true],
];

describe.each(ESTADOS)('WhatsApp con plan %s', (_n, plan, sale) => {
  beforeEach(() => { suscripcion = plan; });
  const llamadas: Array<[string, () => Promise<{ ok: boolean; status?: number }>]> = [
    ['enviarTexto', () => meta.enviarTexto(TEL, 'hola')],
    ['sendTemplate', () => meta.sendTemplate(TEL, 'viaje_asignado', {})],
    ['enviarBotones', () => meta.enviarBotones(TEL, 'cuerpo', [{ id: 'a', titulo: 'Sí' }])],
    ['enviarSolicitudUbicacion', () => meta.enviarSolicitudUbicacion(TEL, 'Manda tu ubicación')],
    ['sendDocument', () => meta.sendDocument(TEL, 'https://ejemplo.test/a.pdf', 'a.pdf')],
  ];
  it.each(llamadas)('%s', async (_f, enviar) => {
    const r = await enviar();
    if (sale) {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(r.ok).toBe(true);
    } else {
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(r).toMatchObject({ ok: false, status: 503 });
    }
  });
});

describe.each(ESTADOS)('correo automático de la flota con plan %s', (_n, plan, sale) => {
  beforeEach(() => { suscripcion = plan; });
  it('enviarCorreo con tenantId', async () => {
    const r = await enviarCorreo('x@ejemplo.test', CORREO, { tenantId: 't1' });
    if (sale) { expect(r.ok).toBe(true); expect(fetchSpy).toHaveBeenCalledTimes(1); }
    else {
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(r).toMatchObject({ ok: false, motivo: 'rechazado', status: 503 });
    }
  });
});

describe('lo que NO se frena', () => {
  beforeEach(() => { suscripcion = { data: [{ estado: 'pausada' }], error: null }; });
  it('un correo sin tenantId (acceso, seguridad, Likida) sale aunque haya flotas pausadas', async () => {
    const r = await enviarCorreo('x@ejemplo.test', CORREO);
    expect(r.ok).toBe(true);
  });
  it('un teléfono que no es de ninguna flota sale', async () => {
    operador = { data: [], error: null };
    const r = await meta.enviarTexto('5215500000000', 'hola');
    expect(r.ok).toBe(true);
  });
  it('la respuesta ARCO (obligación legal) no consulta el plan', async () => {
    const r = await meta.enviarRespuestaArco(TEL, 'Tu solicitud fue atendida');
    expect(fetchSpy).toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });
});
