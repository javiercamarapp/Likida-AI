import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

// ═══════════════════════════════════════════════════════════════════════════
// EL WEBHOOK DE ENTREGA (0124) — lo que se fija:
//  · Sin secreto configurado: 500 (Resend reintenta; nadie procesa sin
//    firma). Firma inválida o vieja: 401.
//  · delivered/bounced/complained escriben el estado sobre la pieza por
//    provider_message_id; un "entregado" tardío NO pisa a un rebote.
//  · Si la base no responde: 500 — el evento es la única fuente del dato.
// ═══════════════════════════════════════════════════════════════════════════

const respuestas: Array<{ data: unknown; error: { message: string } | null }> = [];
const filtros: Array<{ eq: Array<[string, unknown]>; neq: Array<[string, unknown]>; payload: unknown }> = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const f = { eq: [] as Array<[string, unknown]>, neq: [] as Array<[string, unknown]>, payload: null as unknown };
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        update: (p: unknown) => { f.payload = p; filtros.push(f); return b; },
        eq: (c: string, v: unknown) => { f.eq.push([c, v]); return b; },
        neq: (c: string, v: unknown) => { f.neq.push([c, v]); return b; },
        select: () => b,
        then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve().then(() => respuestas.shift() ?? { data: [{ id: 'pz-1' }], error: null }).then(res, rej),
      });
      return b;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { POST } = await import('./route');

const SECRETO_CRUDO = crypto.randomBytes(24);
const SECRETO = `whsec_${SECRETO_CRUDO.toString('base64')}`;

function postear(cuerpo: string, opts: { firmar?: boolean; ts?: number } = {}) {
  const id = 'msg_1';
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const firma = crypto.createHmac('sha256', SECRETO_CRUDO).update(`${id}.${ts}.${cuerpo}`).digest('base64');
  return POST(new Request('https://app.likida.ai/api/correo/eventos', {
    method: 'POST',
    headers: {
      'svix-id': id, 'svix-timestamp': ts,
      'svix-signature': opts.firmar === false ? 'v1,AAAA' : `v1,${firma}`,
    },
    body: cuerpo,
  }));
}

const EVENTO = JSON.stringify({ type: 'email.bounced', data: { email_id: 're_123' } });

beforeEach(() => {
  respuestas.length = 0;
  filtros.length = 0;
  process.env.RESEND_WEBHOOK_SECRET = SECRETO;
});

describe('la puerta', () => {
  it('sin secreto configurado: 500 — Resend reintenta, nadie procesa sin firma', async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    expect((await postear(EVENTO)).status).toBe(500);
  });

  it('firma inválida: 401; timestamp viejo (replay): 401', async () => {
    expect((await postear(EVENTO, { firmar: false })).status).toBe(401);
    expect((await postear(EVENTO, { ts: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401);
  });
});

describe('el circuito', () => {
  it('un rebote escribe el estado sobre la pieza, por provider_message_id', async () => {
    const r = await postear(EVENTO);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ pieza: 'pz-1', estado: 'rebotado' });
    expect(filtros[0].eq).toContainEqual(['provider_message_id', 're_123']);
    expect(filtros[0].payload).toMatchObject({ entrega_estado: 'rebotado' });
  });

  it('un "entregado" tardío NO pisa a un rebote — la mala noticia es la que opera', async () => {
    await postear(JSON.stringify({ type: 'email.delivered', data: { email_id: 're_123' } }));
    expect(filtros[0].neq).toContainEqual(['entrega_estado', 'rebotado']);
  });

  it('un tipo que no rastrea entrega se acusa sin efecto', async () => {
    const r = await postear(JSON.stringify({ type: 'email.opened', data: { email_id: 're_123' } }));
    expect(await r.json()).toMatchObject({ ignorado: 'email.opened' });
    expect(filtros).toHaveLength(0);
  });

  it('base caída: 500 para que Resend reintente — el evento es la única fuente', async () => {
    respuestas.push({ data: null, error: { message: 'db down' } });
    expect((await postear(EVENTO)).status).toBe(500);
  });
});
