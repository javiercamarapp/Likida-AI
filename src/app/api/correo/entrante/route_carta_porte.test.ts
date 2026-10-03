import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

// El buzón `cp-<token>@…` comparte el webhook del buzón de facturas: la firma se verifica ANTES (401 sin ella),
// la flota sale del token del DESTINATARIO y el correo NUNCA entra al flujo de facturas.
const rpcs: string[] = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (n: string) => { rpcs.push(n); return Promise.resolve({ data: null, error: { message: 'no se esperaba' } }); },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const atender = vi.hoisted(() => vi.fn());
vi.mock('@/lib/likida/carta_porte_docs/correo_entrante', async (orig) => ({ ...(await orig<typeof import('@/lib/likida/carta_porte_docs/correo_entrante')>()), atenderCorreoCartaPorte: atender }));

const { POST } = await import('./route');

const SECRETO = 'whsec_' + Buffer.from('secreto-de-webhook-para-pruebas').toString('base64');
const TOKEN = 'abcdefghjkmnpqrstvwxyz23';

function pedir(data: Record<string, unknown>, firmar = true): Request {
  const texto = JSON.stringify({ type: 'email.received', data });
  const ts = String(Math.floor(Date.now() / 1000));
  const h = new Headers({ 'content-type': 'application/json' });
  if (firmar) {
    const f = createHmac('sha256', Buffer.from(SECRETO.slice(6), 'base64')).update(`msg_1.${ts}.${texto}`, 'utf8').digest('base64');
    h.set('svix-id', 'msg_1'); h.set('svix-timestamp', ts); h.set('svix-signature', `v1,${f}`);
  }
  return new Request('https://app.likida.ai/api/correo/entrante', { method: 'POST', headers: h, body: texto });
}

beforeEach(() => {
  vi.clearAllMocks(); rpcs.length = 0;
  process.env.RESEND_WEBHOOK_SECRET = SECRETO; process.env.RESEND_EMAIL_DOMAIN = 'mail.likida.ai'; process.env.RESEND_API_KEY = 'llave';
  atender.mockResolvedValue({ status: 200, cuerpo: { ok: true, recibidos: 1 } });
});

describe('POST /api/correo/entrante con un buzón de Carta Porte', () => {
  it('sin firma válida: 401 y NADA se lee ni se atiende', async () => {
    const r = await POST(pedir({ email_id: 'e1', to: [`cp-${TOKEN}@mail.likida.ai`] }, false));
    expect(r.status).toBe(401);
    expect(atender).not.toHaveBeenCalled();
  });

  it('con firma: la flota sale del token del destinatario y el correo va al agente de Carta Porte, no al de facturas', async () => {
    const r = await POST(pedir({
      email_id: 'e1', from: 'Ana <ana@cliente.example>', subject: 'Embarque', text: 'cuerpo', to: ['otro@x.com'], cc: [`CP-${TOKEN.toUpperCase()}@mail.likida.ai`],
      attachments: [{ id: 'a1', filename: 'plan.xlsx' }],
    }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, recibidos: 1 });
    expect(atender).toHaveBeenCalledTimes(1);
    const [token, correo, deps] = atender.mock.calls[0];
    expect(token).toBe(TOKEN);
    expect(correo).toMatchObject({ emailId: 'e1', from: 'Ana <ana@cliente.example>', subject: 'Embarque', text: 'cuerpo', attachments: [{ id: 'a1', filename: 'plan.xlsx' }] });
    expect(typeof deps.descargar).toBe('function');
    expect(deps.restanteMs()).toBeGreaterThan(30_000);
    expect(rpcs).toEqual([]); // jamás tocó el claim del buzón de facturas
  });

  it('el status del agente se respeta: 503 para que Resend reintente', async () => {
    atender.mockResolvedValueOnce({ status: 503, cuerpo: { error: 'no se pudieron descargar todos los adjuntos' } });
    const r = await POST(pedir({ email_id: 'e2', to: [`cp-${TOKEN}@mail.likida.ai`] }));
    expect(r.status).toBe(503);
  });

  it('dos buzones cp- distintos en el mismo correo: no se adivina a cuál iba (cae al flujo normal y se ignora)', async () => {
    const r = await POST(pedir({ email_id: 'e3', to: [`cp-${TOKEN}@mail.likida.ai`, `cp-${'z'.repeat(24).replace(/z/g, 'k')}@mail.likida.ai`] }));
    expect(atender).not.toHaveBeenCalled();
    expect(r.status).toBe(200);
  });

  it('un cp- de OTRO dominio no es nuestro', async () => {
    const r = await POST(pedir({ email_id: 'e4', to: [`cp-${TOKEN}@otro-dominio.com`] }));
    expect(atender).not.toHaveBeenCalled();
    expect(r.status).toBe(200);
  });
});
