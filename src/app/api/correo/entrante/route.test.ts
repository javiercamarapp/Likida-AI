import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

// ── Dobles ─────────────────────────────────────────────────────────────────
// El de supabase es una cadena mínima: lo único que importa aquí es QUÉ pide la
// ruta y en qué ORDEN, no cómo responde PostgREST.
let flotaDevuelta: { id: string; rfc: string | null } | null = { id: 't-1', rfc: 'AAA010101AAA' };
let errorFlota: { message: string } | null = null;
let errorDedup: { code?: string; message: string } | null = null;
const tablasTocadas: string[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from(tabla: string) {
      tablasTocadas.push(tabla);
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: flotaDevuelta, error: errorFlota }) }),
        }),
        insert: async () => ({ error: errorDedup }),
      };
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/proveedores', () => ({ guardarFacturaProveedor: async () => ({ ok: true }) }));
vi.mock('@/lib/likida/intake/cfdi_xml', () => ({ parseCfdiXml: (t: string) => (t.includes('Comprobante') ? { uuid: 'U-1', total: 100 } : null) }));

const { POST } = await import('./route');

const SECRETO = 'whsec_' + Buffer.from('secreto-de-webhook-para-pruebas').toString('base64');
const TOKEN = 'abcdefghjkmnpqrstvwxyz23';

function pedir(cuerpo: object, opts: { firmar?: boolean; ts?: number } = {}): Request {
  const texto = JSON.stringify(cuerpo);
  const id = 'msg_1';
  const ts = String(Math.floor((opts.ts ?? Date.now()) / 1000));
  const h = new Headers({ 'content-type': 'application/json' });
  if (opts.firmar !== false) {
    const llave = Buffer.from(SECRETO.slice(6), 'base64');
    const f = createHmac('sha256', llave).update(`${id}.${ts}.${texto}`, 'utf8').digest('base64');
    h.set('svix-id', id); h.set('svix-timestamp', ts); h.set('svix-signature', `v1,${f}`);
  }
  return new Request('https://app.likida.ai/api/correo/entrante', { method: 'POST', headers: h, body: texto });
}

const evento = (extra: Record<string, unknown> = {}) => ({
  type: 'email.received',
  data: {
    email_id: 'em_1',
    from: 'taller@proveedor.mx',
    to: [`f-${TOKEN}@mail.likida.ai`],
    attachments: [{ id: 'att_1', filename: 'factura.xml', content_type: 'application/xml' }],
    ...extra,
  },
});

beforeEach(() => {
  process.env.RESEND_WEBHOOK_SECRET = SECRETO;
  process.env.RESEND_EMAIL_DOMAIN = 'mail.likida.ai';
  process.env.RESEND_API_KEY = 'llave';
  flotaDevuelta = { id: 't-1', rfc: 'AAA010101AAA' };
  errorFlota = null; errorDedup = null;
  tablasTocadas.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/attachments/')) {
      return new Response(JSON.stringify({ download_url: 'https://x/y' }), { status: 200 });
    }
    return new Response('<Comprobante/>', { status: 200 });
  }));
});

describe('la firma se verifica ANTES de leer nada del cuerpo', () => {
  it('sin firma, 401', async () => {
    // Este endpoint es un POST sin autenticar y lo que dispara mete una factura
    // con su RFC y su monto a la contabilidad de un cliente.
    const r = await POST(pedir(evento(), { firmar: false }));
    expect(r.status).toBe(401);
    expect(tablasTocadas, 'no debió tocar la base').toEqual([]);
  });

  it('sin secreto configurado, 401 — no se confía por omisión', async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const r = await POST(pedir(evento()));
    expect(r.status).toBe(401);
    expect(tablasTocadas).toEqual([]);
  });

  it('el cuerpo del rechazo NO dice qué falló', async () => {
    // Distinguir "firma inválida" de "fuera de tiempo" le enseñaría a quien lo
    // intenta cómo ajustar su siguiente prueba.
    const t = await (await POST(pedir(evento(), { firmar: false }))).text();
    expect(t).not.toMatch(/tiempo|timestamp|secreto/i);
  });

  it('una firma vieja se rechaza', async () => {
    const r = await POST(pedir(evento(), { ts: Date.now() - 60 * 60_000 }));
    expect(r.status).toBe(401);
  });
});

describe('la flota sale del DESTINATARIO, nunca del remitente', () => {
  it('con buzón válido resuelve y procesa', async () => {
    const r = await POST(pedir(evento()));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, guardadas: 1 });
  });

  it('un remitente que se hace pasar por otra flota NO cambia nada', async () => {
    // El `from` se falsifica en dos líneas; el token del destinatario no.
    const r = await POST(pedir(evento({ from: `f-${TOKEN}@mail.likida.ai`, to: ['otro@ajeno.com'] })));
    expect(await r.json()).toMatchObject({ ignorado: 'sin_buzon' });
  });

  it('encuentra el buzón cuando va en COPIA (un reenvío)', async () => {
    const r = await POST(pedir(evento({ to: ['contador@flota.com'], cc: [`f-${TOKEN}@mail.likida.ai`] })));
    expect(await r.json()).toMatchObject({ ok: true });
  });

  it('un token que no corresponde a nadie se ignora sin reintentar', async () => {
    flotaDevuelta = null;
    const r = await POST(pedir(evento()));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ignorado: 'buzon_desconocido' });
  });

  it('si NO SE PUDO LEER la flota, 503 para que Resend reintente', async () => {
    // Aquí el correo era válido y se perdería: este sí es un fallo nuestro.
    errorFlota = { message: 'red caída' };
    const r = await POST(pedir(evento()));
    expect(r.status).toBe(503);
  });
});

describe('idempotencia: un reintento no duplica la factura', () => {
  it('el segundo intento del MISMO correo se ignora con 200', async () => {
    errorDedup = { code: '23505', message: 'duplicate key' };
    const r = await POST(pedir(evento()));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ignorado: 'ya_procesado' });
  });

  it('si no se pudo REGISTRAR el correo, 503 — procesar sin marcar duplica', async () => {
    errorDedup = { code: '08006', message: 'conexión perdida' };
    const r = await POST(pedir(evento()));
    expect(r.status).toBe(503);
  });

  it('se registra ANTES de procesar', async () => {
    await POST(pedir(evento()));
    expect(tablasTocadas.indexOf('correo_procesado')).toBeGreaterThan(-1);
    expect(tablasTocadas.indexOf('correo_procesado')).toBeGreaterThan(tablasTocadas.indexOf('tenant'));
  });
});

describe('los adjuntos', () => {
  it('un correo SIN adjuntos no es un error — es un humano diciendo gracias', async () => {
    const r = await POST(pedir(evento({ attachments: [] })));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ignorado: 'sin_adjuntos' });
  });

  it('ignora tipos que no sabemos leer', async () => {
    const r = await POST(pedir(evento({ attachments: [{ id: 'a', filename: 'foto.jpg' }] })));
    expect(await r.json()).toMatchObject({ ignorado: 'sin_adjuntos' });
  });

  it('un adjunto que truena NO tumba a los demás', async () => {
    // Un correo con varias facturas donde una viene corrupta debe guardar el
    // resto.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('att_malo')) throw new Error('se cayó');
      if (String(url).includes('/attachments/')) return new Response(JSON.stringify({ download_url: 'https://x/y' }), { status: 200 });
      return new Response('<Comprobante/>', { status: 200 });
    }));
    const r = await POST(pedir(evento({
      attachments: [
        { id: 'att_malo', filename: 'a.xml' },
        { id: 'att_bueno', filename: 'b.xml' },
      ],
    })));
    expect(await r.json()).toMatchObject({ guardadas: 1, ignoradas: 1 });
  });

  it('un XML que no es CFDI se cuenta como ignorado, no como guardado', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/attachments/')) return new Response(JSON.stringify({ download_url: 'https://x/y' }), { status: 200 });
      return new Response('<otraCosa/>', { status: 200 });
    }));
    const r = await POST(pedir(evento()));
    expect(await r.json()).toMatchObject({ guardadas: 0, ignoradas: 1 });
  });
});

describe('eventos que no son nuestros', () => {
  it('otro tipo de evento se ignora', async () => {
    const r = await POST(pedir({ type: 'email.delivered', data: {} }));
    expect(await r.json()).toMatchObject({ ignorado: 'otro_evento' });
  });

  it('un evento sin email_id se ignora', async () => {
    const r = await POST(pedir({ type: 'email.received', data: {} }));
    expect(await r.json()).toMatchObject({ ignorado: 'sin_id' });
  });
});
