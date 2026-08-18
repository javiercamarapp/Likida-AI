import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

// ═══════════════════════════════════════════════════════════════════════════
// EL HOOK DE CORREO DE AUTH. Este endpoint está en el CAMINO CRÍTICO del
// login: con el hook encendido, Supabase ya no manda nada por su cuenta. Lo
// que se fija:
//
//  · Sin secreto, con firma inválida o vieja: NO se manda correo. Sin eso
//    esto sería una máquina pública de mandar correos con nuestro remitente.
//  · Nunca 200 en falso. Si el correo no salió, Supabase tiene que enterarse
//    para poder decírselo a la persona.
//  · La mitad `email_change_new` va a la dirección NUEVA y con SU token.
//  · Ni la dirección ni el token acaban en el log.
// ═══════════════════════════════════════════════════════════════════════════

const enviados: Array<{ para: unknown; correo: { asunto: string; boton?: { href: string } }; op: unknown }> = [];
let resultadoEnvio: { ok: boolean; motivo?: string; id?: string } = { ok: true, id: 're_1' };
vi.mock('@/lib/correo/enviar', () => ({
  enviarCorreo: (para: unknown, correo: never, op: unknown) => {
    enviados.push({ para, correo, op });
    return Promise.resolve(resultadoEnvio);
  },
}));

const logs: Array<[string, string, Record<string, unknown>]> = [];
vi.mock('@/lib/logger', () => ({
  logger: {
    info: (e: string, d: Record<string, unknown>) => logs.push(['info', e, d]),
    warn: (e: string, d: Record<string, unknown>) => logs.push(['warn', e, d]),
    error: (e: string, d: Record<string, unknown>) => logs.push(['error', e, d]),
  },
}));

const { POST } = await import('./route');

const LLAVE = crypto.randomBytes(24);
const SECRETO = `v1,whsec_${LLAVE.toString('base64')}`;

function postear(payload: unknown, opts: { firmar?: boolean; ts?: number; cuerpo?: string } = {}) {
  const cuerpo = opts.cuerpo ?? JSON.stringify(payload);
  const id = 'msg_1';
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const firma = crypto.createHmac('sha256', LLAVE).update(`${id}.${ts}.${cuerpo}`).digest('base64');
  return POST(new Request('https://app.likida.ai/api/auth/correo', {
    method: 'POST',
    headers: {
      'webhook-id': id,
      'webhook-timestamp': ts,
      'webhook-signature': opts.firmar === false ? 'v1,AAAA' : `v1,${firma}`,
    },
    body: cuerpo,
  }));
}

const MAGIC = {
  user: { email: 'contralor@flota.mx' },
  email_data: {
    token: '123456',
    token_hash: 'hash-del-token',
    redirect_to: 'https://app.likida.ai/auth/callback?next=/dashboard',
    email_action_type: 'login',
  },
};

beforeEach(() => {
  enviados.length = 0;
  logs.length = 0;
  resultadoEnvio = { ok: true, id: 're_1' };
  process.env.SUPABASE_AUTH_HOOK_SECRET = SECRETO;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdefgh.supabase.co';
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.likida.ai';
});

describe('sin firma válida no sale un solo correo', () => {
  it('sin secreto configurado: 500 y cero envíos', async () => {
    delete process.env.SUPABASE_AUTH_HOOK_SECRET;
    const r = await postear(MAGIC);
    expect(r.status).toBe(500);
    expect(enviados).toHaveLength(0);
  });

  it('firma inválida: 401 y cero envíos', async () => {
    const r = await postear(MAGIC, { firmar: false });
    expect(r.status).toBe(401);
    expect(enviados).toHaveLength(0);
  });

  it('un webhook capturado y reenviado media hora después: 401', async () => {
    const r = await postear(MAGIC, { ts: Math.floor(Date.now() / 1000) - 1800 });
    expect(r.status).toBe(401);
    expect(enviados).toHaveLength(0);
  });

  it('el motivo real NO se le dice a quien llama, solo al log', async () => {
    const r = await postear(MAGIC, { firmar: false });
    expect(JSON.stringify(await r.json())).not.toMatch(/firma_invalida|fuera_de_tiempo/);
    expect(logs.some(([, e]) => e === 'auth.correo.firma_rechazada')).toBe(true);
  });
});

describe('el magic link, de punta a punta', () => {
  it('manda el correo de la marca a quien lo pidió, desde acceso@', async () => {
    const r = await postear(MAGIC);
    expect(r.status).toBe(200);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].para).toBe('contralor@flota.mx');
    expect(enviados[0].correo.asunto).toBe('Tu acceso a Likida');
    expect(enviados[0].op).toEqual({ remitenteLocal: 'acceso' });
  });

  it('la liga apunta al verificador de Supabase con el token del payload', async () => {
    await postear(MAGIC);
    const u = new URL(enviados[0].correo.boton!.href);
    expect(u.origin).toBe('https://abcdefgh.supabase.co');
    expect(u.pathname).toBe('/auth/v1/verify');
    expect(u.searchParams.get('token')).toBe('hash-del-token');
    expect(u.searchParams.get('type')).toBe('magiclink');
    expect(u.searchParams.get('redirect_to')).toBe('https://app.likida.ai/auth/callback?next=/dashboard');
  });

  it('un redirect_to ajeno NO viaja en el correo', async () => {
    await postear({ ...MAGIC, email_data: { ...MAGIC.email_data, redirect_to: 'https://evil.com/roba' } });
    const u = new URL(enviados[0].correo.boton!.href);
    expect(u.searchParams.get('redirect_to')).toBe('https://app.likida.ai/auth/callback');
  });

  it('ni la dirección ni el token acaban en el log', async () => {
    await postear(MAGIC);
    const texto = JSON.stringify(logs);
    expect(texto).not.toContain('contralor@flota.mx');
    expect(texto).not.toContain('hash-del-token');
    expect(logs.some(([, e]) => e === 'auth.correo.enviado')).toBe(true);
  });
});

describe('el cambio de correo va a la dirección nueva con SU token', () => {
  it('email_change_new usa new_email y token_hash_new', async () => {
    await postear({
      user: { email: 'viejo@flota.mx', new_email: 'nuevo@flota.mx' },
      email_data: {
        token: '111111', token_hash: 'hash-viejo',
        token_new: '222222', token_hash_new: 'hash-nuevo',
        email_action_type: 'email_change_new',
      },
    });
    expect(enviados[0].para).toBe('nuevo@flota.mx');
    const u = new URL(enviados[0].correo.boton!.href);
    expect(u.searchParams.get('token')).toBe('hash-nuevo');
    expect(u.searchParams.get('type')).toBe('email_change');
  });

  it('email_change_current va a la dirección de siempre', async () => {
    await postear({
      user: { email: 'viejo@flota.mx', new_email: 'nuevo@flota.mx' },
      email_data: { token_hash: 'hash-viejo', token_hash_new: 'hash-nuevo', email_action_type: 'email_change_current' },
    });
    expect(enviados[0].para).toBe('viejo@flota.mx');
    expect(new URL(enviados[0].correo.boton!.href).searchParams.get('token')).toBe('hash-viejo');
  });
});

describe('nunca 200 en falso', () => {
  it('si Resend no está configurado: 500 con el motivo, no un acuse mentiroso', async () => {
    resultadoEnvio = { ok: false, motivo: 'sin_configurar' };
    const r = await postear(MAGIC);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).toContain('RESEND_API_KEY');
  });

  it('si el envío se rechaza: 500 sin filtrar el detalle del proveedor', async () => {
    resultadoEnvio = { ok: false, motivo: 'rechazado' };
    const r = await postear(MAGIC);
    expect(r.status).toBe(500);
    expect(logs.some(([n, e]) => n === 'error' && e === 'auth.correo.no_salio')).toBe(true);
  });

  it('sin NEXT_PUBLIC_SUPABASE_URL no se arma media liga: 500', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const r = await postear(MAGIC);
    expect(r.status).toBe(500);
    expect(enviados).toHaveLength(0);
  });
});

describe('payloads que no se pueden atender', () => {
  it('JSON roto: 400', async () => {
    const r = await postear(null, { cuerpo: '{no json' });
    expect(r.status).toBe(400);
  });

  it('una acción que no conocemos se rechaza RUIDOSA, no en silencio', async () => {
    const r = await postear({ ...MAGIC, email_data: { ...MAGIC.email_data, email_action_type: 'inventada' } });
    expect(r.status).toBe(400);
    expect(enviados).toHaveLength(0);
    expect(logs.some(([n, e]) => n === 'error' && e === 'auth.correo.accion_desconocida')).toBe(true);
  });

  it('sin destinatario o sin token: 400', async () => {
    expect((await postear({ email_data: MAGIC.email_data })).status).toBe(400);
    expect((await postear({ user: { email: 'a@b.mx' }, email_data: { email_action_type: 'login' } })).status).toBe(400);
    expect(enviados).toHaveLength(0);
  });

  it('la reautenticación no necesita token_hash, pero sí código', async () => {
    const ok = await postear({
      user: { email: 'a@b.mx' },
      email_data: { token: '654321', email_action_type: 'reauthentication' },
    });
    expect(ok.status).toBe(200);
    expect(enviados[0].correo).toMatchObject({ codigo: '654321' });

    const sinCodigo = await postear({
      user: { email: 'a@b.mx' },
      email_data: { email_action_type: 'reauthentication' },
    });
    expect(sinCodigo.status).toBe(400);
  });

  it('un cuerpo gigante se corta antes del HMAC', async () => {
    const r = await postear(null, { cuerpo: 'x'.repeat(33 * 1024) });
    expect(r.status).toBe(413);
  });
});
