import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

// ── Dobles ─────────────────────────────────────────────────────────────────
// El de supabase es una cadena mínima: lo único que importa aquí es QUÉ pide la
// ruta y en qué ORDEN, no cómo responde PostgREST.
let flotaDevuelta: { id: string; rfc: string | null } | null = { id: 't-1', rfc: 'AAA010101AAA' };
let errorFlota: { message: string } | null = null;
let errorDedup: { code?: string; message: string } | null = null;
let errorBorrado: { message: string } | null = null;
const tablasTocadas: string[] = [];
// `correo_procesado` CON ESTADO: el RPC imita el lease durable. La entrega
// concurrente recibe `busy` (503), no el falso 200 que perdió el correo A/B.
const correosRegistrados = new Set<string>();
const borrados: string[] = [];
const rpcs: string[] = [];
/** El kill switch (0110), con el módulo `interruptores` REAL: la ruta lo
 *  consulta antes de consumir el correo, y este doble programa la fila —
 *  incluida la lectura reventada, que por fail-closed vale como apagado. */
let interruptorResp: { data: { apagado: boolean } | null; error: { message: string } | null } = { data: null, error: null };

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc(nombre: string, args: Record<string, unknown>) {
      rpcs.push(nombre);
      const emailId = String(args.p_email_id ?? '');
      if (nombre === 'reclamar_correo') {
        if (errorDedup) return Promise.resolve({ data: null, error: errorDedup });
        if (correosRegistrados.has(emailId)) {
          return Promise.resolve({ data: [{ resultado: 'applied', token: null }], error: null });
        }
        correosRegistrados.add(emailId);
        return Promise.resolve({ data: [{ resultado: 'claimed', token: `claim:${emailId}` }], error: null });
      }
      if (nombre === 'finalizar_correo') {
        if (errorBorrado) return Promise.resolve({ data: false, error: errorBorrado });
        if (!args.p_ok) { correosRegistrados.delete(emailId); borrados.push(emailId); }
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `rpc inesperada: ${nombre}` } });
    },
    from(tabla: string) {
      tablasTocadas.push(tabla);
      if (tabla === 'interruptor') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => interruptorResp }) }) };
      }
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: flotaDevuelta, error: errorFlota }) }),
        }),
      };
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// `estadoSatDeCfdi` devuelve null en el doble: aquí se prueba el ORDEN del
// webhook, no la consulta al SAT (esa vive en intake/sat y jamás lanza).
vi.mock('@/lib/likida/proveedores', () => ({
  guardarFacturaProveedor: async () => ({ ok: true }),
  estadoSatDeCfdi: async () => null,
}));
// La bitácora se anota best-effort al final; el doble solo registra que se llamó.
vi.mock('@/lib/likida/agentes/corridas', () => ({ registrarCorrida: vi.fn(async () => {}) }));
vi.mock('@/lib/likida/intake/cfdi_xml', () => ({ parseCfdiXml: (t: string) => (t.includes('Comprobante') ? { uuid: 'U-1', total: 100 } : null) }));

const { POST } = await import('./route');
const { logger } = await import('@/lib/logger');

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

beforeEach(async () => {
  // RES-19: `leerInterruptor` cachea 5 s por instancia y este archivo usa el
  // módulo REAL con una respuesta distinta por prueba — sin tirar la caché, la
  // lectura de una contestaría por la siguiente.
  (await import('@/lib/likida/interruptores')).olvidarInterruptores();
  vi.clearAllMocks();
  process.env.RESEND_WEBHOOK_SECRET = SECRETO;
  process.env.RESEND_EMAIL_DOMAIN = 'mail.likida.ai';
  process.env.RESEND_API_KEY = 'llave';
  flotaDevuelta = { id: 't-1', rfc: 'AAA010101AAA' };
  errorFlota = null; errorDedup = null; errorBorrado = null;
  interruptorResp = { data: null, error: null }; // sin fila = ENCENDIDO
  tablasTocadas.length = 0;
  rpcs.length = 0;
  correosRegistrados.clear();
  borrados.length = 0;
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
    correosRegistrados.add('em_1');
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
    expect(rpcs.indexOf('reclamar_correo')).toBeGreaterThan(-1);
    expect(tablasTocadas.indexOf('tenant')).toBeGreaterThan(-1);
  });

  it('sin llave del canal, 503 SIN consumir el correo', async () => {
    // Si se registrara antes de comprobar la llave, el reintento de Resend
    // chocaría con la llave primaria y saldría "ya_procesado" sin haber
    // guardado nada — el CFDI se perdería para siempre.
    delete process.env.RESEND_API_KEY;
    const r = await POST(pedir(evento()));
    expect(r.status).toBe(503);
    expect(rpcs).not.toContain('reclamar_correo');
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

  it('un adjunto CORRUPTO no tumba a los demás', async () => {
    // Un correo con varias facturas donde una viene ilegible debe guardar el
    // resto. (El caso "la descarga se cayó" ya no termina aquí: es transitorio
    // y sale por 503 — ver el bloque de la descarga caída, abajo.)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('att_malo')) return new Response(JSON.stringify({ download_url: 'https://x/malo' }), { status: 200 });
      if (String(url).includes('/attachments/')) return new Response(JSON.stringify({ download_url: 'https://x/y' }), { status: 200 });
      if (String(url).includes('/malo')) return new Response('no soy un xml', { status: 200 });
      return new Response('<Comprobante/>', { status: 200 });
    }));
    const r = await POST(pedir(evento({
      attachments: [
        { id: 'att_malo', filename: 'a.xml' },
        { id: 'att_bueno', filename: 'b.xml' },
      ],
    })));
    expect(r.status).toBe(200);
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

describe('el tope de tamaño del adjunto (4 MB, el mismo del panel)', () => {
  it('un adjunto que DECLARA más del tope se ignora por tamaño y los demás siguen', async () => {
    // El corte por `content-length` declarado evita materializar el cuerpo.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('att_gordo')) return new Response(JSON.stringify({ download_url: 'https://x/gordo' }), { status: 200 });
      if (String(url).includes('/attachments/')) return new Response(JSON.stringify({ download_url: 'https://x/y' }), { status: 200 });
      if (String(url).includes('/gordo')) {
        return new Response('<Comprobante/>', {
          status: 200,
          headers: { 'content-length': String(5 * 1024 * 1024) },
        });
      }
      return new Response('<Comprobante/>', { status: 200 });
    }));
    const r = await POST(pedir(evento({
      attachments: [
        { id: 'att_gordo', filename: 'estado enorme.xml' },
        { id: 'att_bueno', filename: 'factura.xml' },
      ],
    })));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ guardadas: 1, ignoradas: 1 });
    // Fallo PERMANENTE: el correo queda consumido, no se libera nada.
    expect(borrados).toEqual([]);
    // Y el descarte es VISIBLE en el log, con nombre saneado y tamaño.
    expect(logger.warn).toHaveBeenCalledWith('correo_entrante.adjunto_gigante', expect.objectContaining({
      archivo: 'estado enorme.xml',
      bytes: 5 * 1024 * 1024,
    }));
  });

  it('un chunked que no declara tamaño se corta por el largo real leído', async () => {
    // Una transferencia chunked no trae content-length: el doble chequeo de
    // `leerCuerpo` (api/v1/_escritura.ts) también mide lo que de verdad llegó.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/attachments/')) return new Response(JSON.stringify({ download_url: 'https://x/y' }), { status: 200 });
      return new Response('<Comprobante/>' + 'x'.repeat(4 * 1024 * 1024), { status: 200 });
    }));
    const r = await POST(pedir(evento()));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ guardadas: 0, ignoradas: 1 });
    expect(logger.warn).toHaveBeenCalledWith('correo_entrante.adjunto_gigante', expect.anything());
  });
});

describe('una descarga caída NO consume el correo (F6)', () => {
  const fetchCaido = () => vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/attachments/')) return new Response(JSON.stringify({ download_url: 'https://x/y' }), { status: 200 });
    return new Response('resend caído', { status: 500 });
  }));

  it('descarga caída → 503 y el claim de correo se libera', async () => {
    // Con la fila puesta, el reintento de Resend saldría "ya_procesado" sin
    // haber guardado nada y ese CFDI no volvería jamás.
    fetchCaido();
    const r = await POST(pedir(evento()));
    expect(r.status).toBe(503);
    expect(borrados).toEqual(['em_1']);
  });

  it('el reintento posterior procesa el correo completo', async () => {
    fetchCaido();
    expect((await POST(pedir(evento()))).status).toBe(503);
    // El reintento de Resend, ya con la red viva: la fila quedó liberada, así
    // que el insert de idempotencia entra de nuevo y el CFDI se guarda.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/attachments/')) return new Response(JSON.stringify({ download_url: 'https://x/y' }), { status: 200 });
      return new Response('<Comprobante/>', { status: 200 });
    }));
    const r = await POST(pedir(evento()));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, guardadas: 1 });
  });

  it('contenido basura → 200 ignorado y el correo SÍ queda consumido', async () => {
    // Reintentar un XML que no es CFDI trae el mismo XML: permanente.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/attachments/')) return new Response(JSON.stringify({ download_url: 'https://x/y' }), { status: 200 });
      return new Response('<otraCosa/>', { status: 200 });
    }));
    const r = await POST(pedir(evento()));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ guardadas: 0, ignoradas: 1 });
    expect(borrados).toEqual([]);
    // La prueba de que quedó consumido: el mismo correo otra vez es un repetido.
    const r2 = await POST(pedir(evento()));
    expect(await r2.json()).toMatchObject({ ignorado: 'ya_procesado' });
  });

  it('si unos entraron y otro se cayó, TAMBIÉN 503 — el unique por uuid vuelve inofensivo el reintento', async () => {
    // `factura_proveedor` tiene unique(tenant_id, cfdi_uuid) (mig. 0091) y
    // `guardarFacturaProveedor` convierte ese choque en `duplicada`: en el
    // reintento los ya guardados rebotan sin segunda fila y los caídos entran.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('att_caido')) return new Response(JSON.stringify({ download_url: 'https://x/caido' }), { status: 200 });
      if (String(url).includes('/attachments/')) return new Response(JSON.stringify({ download_url: 'https://x/y' }), { status: 200 });
      if (String(url).includes('/caido')) return new Response('resend caído', { status: 500 });
      return new Response('<Comprobante/>', { status: 200 });
    }));
    const r = await POST(pedir(evento({
      attachments: [
        { id: 'att_bueno', filename: 'a.xml' },
        { id: 'att_caido', filename: 'b.xml' },
      ],
    })));
    expect(r.status).toBe(503);
    expect(borrados).toEqual(['em_1']);
  });

  it('si finalizar el claim falla, 503 igual y log fuerte', async () => {
    fetchCaido();
    errorBorrado = { message: 'conexión perdida' };
    const r = await POST(pedir(evento()));
    expect(r.status).toBe(503);
    expect(borrados).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith('correo_entrante.finalizar_claim', expect.objectContaining({ emailId: 'em_1' }));
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

describe('el kill switch de agente:proveedores (0110) — Fase 1 del blueprint', () => {
  it('APAGADO: 503 sin consumir el correo — Resend reintenta y el CFDI vuelve al encender', async () => {
    // 503 y NO 200 a propósito (al revés que facturar/cola): un 200 le diría
    // a Resend que no reintente y ese CFDI se perdería para siempre.
    interruptorResp = { data: { apagado: true }, error: null };
    const r = await POST(pedir(evento()));

    expect(r.status).toBe(503);
    expect(tablasTocadas, 'el correo NO debe quedar consumido').not.toContain('correo_procesado');
    expect(correosRegistrados.size).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith('correo_entrante.saltado',
      expect.objectContaining({ emailId: 'em_1', interruptor: 'agente:proveedores' }));
  });

  it('FAIL-CLOSED de verdad: la LECTURA del interruptor falla y tampoco se procesa', async () => {
    // El módulo `interruptores` es el REAL: el error por valor se convierte en
    // apagado con grito en el log. Si alguien lo "normaliza" al patrón del
    // resto del repo (error = encendido), esta prueba cae.
    interruptorResp = { data: null, error: { message: 'fetch failed' } };
    const r = await POST(pedir(evento()));

    expect(r.status).toBe(503);
    expect(correosRegistrados.size).toBe(0);
    expect(logger.error).toHaveBeenCalledWith('interruptores.lectura_fallo',
      expect.objectContaining({ interruptor: 'agente:proveedores' }));
  });

  it('apagado, un correo SIN adjuntos procesables sigue saliendo 200: no hay nada que perder', async () => {
    interruptorResp = { data: { apagado: true }, error: null };
    const r = await POST(pedir(evento({ attachments: [] })));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ignorado: 'sin_adjuntos' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL PRESUPUESTO DE TIEMPO DE LAS DESCARGAS (23-ago-2026)
//
// Los dos `fetch` a Resend no tenían timeout. Un proveedor que acepta la
// conexión y CALLA dejaba la función esperando hasta que la mataba la
// plataforma — y ahí está el daño real: al morir no corre el `delete` que
// libera la fila de dedup, el correo queda marcado como procesado sin haberlo
// sido, y el reintento de Resend sale por "ya_procesado". El CFDI se pierde
// para siempre, en silencio.
//
// Con `AbortSignal.timeout` la descarga colgada se corta, cuenta como CAÍDA
// (transitorio) y el correo sale por 503 con su fila liberada — o sea, vuelve
// a la cola de Resend entero.
// ═══════════════════════════════════════════════════════════════════════════
describe('una descarga que se cuelga no se lleva el CFDI por delante', () => {
  it('el fetch lleva AbortSignal: un proveedor que calla no bloquea la función', async () => {
    let señalRecibida: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/attachments/')) {
        señalRecibida = init?.signal ?? undefined;
        return new Response(JSON.stringify({ download_url: 'https://x/y' }), { status: 200 });
      }
      return new Response('<Comprobante/>', { status: 200 });
    }));
    await POST(pedir(evento()));
    expect(señalRecibida).toBeInstanceOf(AbortSignal);
  });

  it('si la descarga se ABORTA, el correo NO queda consumido: 503', async () => {
    // Se simula lo que hace `AbortSignal.timeout` al vencer.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/attachments/')) {
        return new Response(JSON.stringify({ download_url: 'https://x/y' }), { status: 200 });
      }
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    }));
    const r = await POST(pedir(evento()));
    // 503 y no 200: Resend tiene que volver a entregarlo.
    expect(r.status).toBe(503);
  });
});
