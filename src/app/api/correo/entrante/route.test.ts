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
let limitar: (clave: string) => boolean = () => true;
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async (clave: string) => limitar(clave), clientIp: () => '1.2.3.4' }));
// La INGESTA (xml/pdf/zip, `buzon/ingesta.ts`) tiene su propia prueba E2E con dobles; aquí se prueba el
// WEBHOOK (firma, flota por destinatario, descarga con topes, claim del correo). El doble clasifica por
// contenido, como lo haría la ingesta de verdad: un CFDI se guarda, un archivo desconocido se ignora, y
// un fallo transitorio (`caidas`) se programa por prueba.
let caidasDeIngesta = 0;
const recibidosPorIngesta: Array<{ nombre: string; bytes: number }> = [];
const descartesRegistrados: Array<{ nombre: string; motivo: string }> = [];
let fallaRegistroDescarte = false;
vi.mock('@/lib/likida/buzon/servicio', () => ({
  registrarAdjuntoDescartado: async (_t: string, _e: string, nombre: string, motivo: string) => {
    if (fallaRegistroDescarte) throw new Error('base caída');
    descartesRegistrados.push({ nombre, motivo });
  },
  atenderAdjuntosBuzon: async (_ctx: unknown, adjuntos: Array<{ nombre: string; bytes: Uint8Array }>) => {
    const r = { guardadas: 0, duplicadas: 0, revision: 0, rechazadas: 0, ignoradas: 0, caidas: caidasDeIngesta, documentos: [] };
    for (const a of adjuntos) {
      recibidosPorIngesta.push({ nombre: a.nombre, bytes: a.bytes.length });
      if (Buffer.from(a.bytes).toString('utf8').includes('Comprobante')) r.guardadas++; else r.ignoradas++;
    }
    return r;
  },
}));
// La bitácora se anota best-effort al final; el doble solo registra que se llamó.
vi.mock('@/lib/likida/agentes/corridas', () => ({ registrarCorrida: vi.fn(async () => {}) }));

// ── EL TRANSPORTE DE RED: `httpsPublico`, no `fetch` (AUDITORÍA ADVERSARIAL ───
// ALTO #1, A9-SSRF) ───────────────────────────────────────────────────────────
// La ruta ya no llama a `fetch()` directo para los dos adjuntos de Resend: pasa
// por `httpsPublico` (el mismo wrapper anti-SSRF de `peajes/pull.ts` y
// `conectores/tms/sesion.ts`). El doble de abajo imita el SUBCONJUNTO real que
// la ruta usa — `aceptar` y el tope (`maxBytes`/`maxBytesAbsoluto`) — para que
// las pruebas de tamaño sigan ejercitando la MISMA clasificación (tope de
// archivo vs. fallo de red) que corre en producción, no una reimplementación
// aparte.
vi.mock('@/lib/http/https_publico', () => ({ httpsPublico: vi.fn() }));
const { httpsPublico } = await import('@/lib/http/https_publico');

interface RespSim { estado?: number; headers?: Record<string, string>; cuerpo?: string; bytes?: Uint8Array; lanzar?: boolean }
type PeticionSim = {
  url: string;
  maxBytes?: number;
  maxBytesAbsoluto?: number;
  aceptar?: (estado: number, encabezados: Record<string, string>) => boolean;
};

function stubHttp(resolver: (url: string, timeoutMs: number) => RespSim) {
  vi.mocked(httpsPublico).mockImplementation(async (p: PeticionSim, timeoutMs: number) => {
    const r = resolver(p.url, timeoutMs);
    if (r.lanzar) throw new Error('simulado: la conexión se interrumpió');
    const estado = r.estado ?? 200;
    const encabezados = r.headers ?? {};
    if (p.aceptar && !p.aceptar(estado, encabezados)) {
      return { estado, cuerpo: '', bytes: new Uint8Array(0), encabezados };
    }
    const bytes = r.bytes ?? new TextEncoder().encode(r.cuerpo ?? '');
    const techo = Math.max(1, p.maxBytesAbsoluto ?? 8 * 1024 * 1024);
    const maxBytes = Math.min(p.maxBytes ?? techo, techo);
    const declarado = Number(encabezados['content-length'] ?? 0) || 0;
    if ((declarado > 0 && declarado > maxBytes) || bytes.length > maxBytes) {
      throw new Error(`La respuesta del proveedor supera el límite de ${maxBytes / (1024 * 1024)} MiB.`);
    }
    return { estado, cuerpo: r.cuerpo ?? Buffer.from(bytes).toString('utf8'), bytes, encabezados };
  });
}

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
  limitar = () => true;
  errorFlota = null; errorDedup = null; errorBorrado = null;
  interruptorResp = { data: null, error: null }; // sin fila = ENCENDIDO
  tablasTocadas.length = 0;
  caidasDeIngesta = 0;
  recibidosPorIngesta.length = 0;
  descartesRegistrados.length = 0; fallaRegistroDescarte = false;
  rpcs.length = 0;
  correosRegistrados.clear();
  borrados.length = 0;
  stubHttp((url) => {
    if (url.includes('/attachments/')) {
      return { cuerpo: JSON.stringify({ download_url: 'https://x/y' }) };
    }
    return { cuerpo: '<Comprobante/>' };
  });
});

describe('rate limit por IP, antes de leer el cuerpo o verificar el secreto', () => {
  it('pasado el límite → 429 sin tocar la base, aunque la firma sea válida', async () => {
    limitar = () => false;
    const r = await POST(pedir(evento()));
    expect(r.status).toBe(429);
    expect(tablasTocadas, 'no debió tocar la base').toEqual([]);
  });
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
    stubHttp((url) => {
      if (url.includes('att_malo')) return { cuerpo: JSON.stringify({ download_url: 'https://x/malo' }) };
      if (url.includes('/attachments/')) return { cuerpo: JSON.stringify({ download_url: 'https://x/y' }) };
      if (url.includes('/malo')) return { cuerpo: 'no soy un xml' };
      return { cuerpo: '<Comprobante/>' };
    });
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
    stubHttp((url) => {
      if (url.includes('/attachments/')) return { cuerpo: JSON.stringify({ download_url: 'https://x/y' }) };
      return { cuerpo: '<otraCosa/>' };
    });
    const r = await POST(pedir(evento()));
    expect(await r.json()).toMatchObject({ guardadas: 0, ignoradas: 1 });
  });
});

describe('0530 — PDF y zip entran al buzón, con su propio tope', () => {
  const adjuntos = (...n: string[]) => ({ attachments: n.map((filename, i) => ({ id: `att_${i}`, filename })) });
  const stub = (cuerpoDe: (url: string) => RespSim) => stubHttp((url) => {
    const m = url.match(/att_(\d)/);
    if (url.includes('/attachments/')) return { cuerpo: JSON.stringify({ download_url: `https://x/d${m ? m[1] : '0'}` }) };
    return cuerpoDe(url);
  });

  it('un PDF y un zip ya no se descartan por extensión: llegan a la ingesta como BYTES', async () => {
    stub(() => ({ bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0xfe]) }));
    const r = await POST(pedir(evento(adjuntos('a.pdf', 'b.zip'))));
    expect(r.status).toBe(200);
    expect(recibidosPorIngesta.map((x) => [x.nombre, x.bytes])).toEqual([['a.pdf', 6], ['b.zip', 6]]);
  });

  it('un PDF de 8 MB pasa (el tope de pdf/zip es 12 MB); un XML de 8 MB no (el suyo sigue en 4 MB)', async () => {
    stub(() => ({ bytes: new Uint8Array(8 * 1024 * 1024), headers: { 'content-length': String(8 * 1024 * 1024) } }));
    const r = await POST(pedir(evento(adjuntos('grande.pdf', 'grande.xml'))));
    expect(r.status).toBe(200);
    expect(recibidosPorIngesta.map((x) => x.nombre)).toEqual(['grande.pdf']);
    expect(await r.json()).toMatchObject({ ignoradas: 2 });
  });

  it('el total del correo está acotado (30 MB): el adjunto que lo pasa se ignora, no se materializa', async () => {
    stub(() => ({ bytes: new Uint8Array(11 * 1024 * 1024) }));
    await POST(pedir(evento(adjuntos('1.zip', '2.zip', '3.zip', '4.zip'))));
    expect(recibidosPorIngesta).toHaveLength(2);
    expect(logger.warn).toHaveBeenCalledWith('correo_entrante.correo_gigante', expect.anything());
  });

  it('un fallo TRANSITORIO de la ingesta (base, visión) = 503 y el correo se libera para reintentar', async () => {
    stub(() => ({ cuerpo: '<Comprobante/>' }));
    caidasDeIngesta = 1;
    const r = await POST(pedir(evento()));
    expect(r.status).toBe(503);
    expect(borrados).toEqual(['em_1']);
  });

  it('la respuesta trae el desglose nuevo (duplicadas, revisión, rechazadas) además de guardadas e ignoradas', async () => {
    const r = await POST(pedir(evento()));
    expect(await r.json()).toMatchObject({ ok: true, guardadas: 1, ignoradas: 0, duplicadas: 0, revision: 0, rechazadas: 0 });
  });
});

describe('el tope de tamaño del adjunto (4 MB, el mismo del panel)', () => {
  it('un adjunto que DECLARA más del tope se ignora por tamaño y los demás siguen', async () => {
    // El corte por `content-length` declarado evita materializar el cuerpo.
    stubHttp((url) => {
      if (url.includes('att_gordo')) return { cuerpo: JSON.stringify({ download_url: 'https://x/gordo' }) };
      if (url.includes('/attachments/')) return { cuerpo: JSON.stringify({ download_url: 'https://x/y' }) };
      if (url.includes('/gordo')) {
        return { cuerpo: '<Comprobante/>', headers: { 'content-length': String(5 * 1024 * 1024) } };
      }
      return { cuerpo: '<Comprobante/>' };
    });
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
    // Una transferencia chunked no trae content-length: `httpsPublico` corta la conexión en vuelo al pasarse
    // del tope (igual que antes hacía el doble chequeo de `leerCuerpo`, api/v1/_escritura.ts).
    stubHttp((url) => {
      if (url.includes('/attachments/')) return { cuerpo: JSON.stringify({ download_url: 'https://x/y' }) };
      return { cuerpo: '<Comprobante/>' + 'x'.repeat(4 * 1024 * 1024) };
    });
    const r = await POST(pedir(evento()));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ guardadas: 0, ignoradas: 1 });
    expect(logger.warn).toHaveBeenCalledWith('correo_entrante.adjunto_gigante', expect.anything());
  });
});

describe('una descarga caída NO consume el correo (F6)', () => {
  const fetchCaido = () => stubHttp((url) => {
    if (url.includes('/attachments/')) return { cuerpo: JSON.stringify({ download_url: 'https://x/y' }) };
    return { estado: 500, cuerpo: 'resend caído' };
  });

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
    stubHttp((url) => {
      if (url.includes('/attachments/')) return { cuerpo: JSON.stringify({ download_url: 'https://x/y' }) };
      return { cuerpo: '<Comprobante/>' };
    });
    const r = await POST(pedir(evento()));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, guardadas: 1 });
  });

  it('contenido basura → 200 ignorado y el correo SÍ queda consumido', async () => {
    // Reintentar un XML que no es CFDI trae el mismo XML: permanente.
    stubHttp((url) => {
      if (url.includes('/attachments/')) return { cuerpo: JSON.stringify({ download_url: 'https://x/y' }) };
      return { cuerpo: '<otraCosa/>' };
    });
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
    stubHttp((url) => {
      if (url.includes('att_caido')) return { cuerpo: JSON.stringify({ download_url: 'https://x/caido' }) };
      if (url.includes('/attachments/')) return { cuerpo: JSON.stringify({ download_url: 'https://x/y' }) };
      if (url.includes('/caido')) return { estado: 500, cuerpo: 'resend caído' };
      return { cuerpo: '<Comprobante/>' };
    });
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
// Las dos peticiones a Resend (ahora por `httpsPublico`, antes `fetch`) no
// tenían timeout. Un proveedor que acepta la conexión y CALLA dejaba la
// función esperando hasta que la mataba la plataforma — y ahí está el daño
// real: al morir no corre el `delete` que libera la fila de dedup, el correo
// queda marcado como procesado sin haberlo sido, y el reintento de Resend sale
// por "ya_procesado". El CFDI se pierde para siempre, en silencio.
//
// `httpsPublico` recibe un `timeoutMs` (el presupuesto que queda de la
// corrida, `restanteMs()`) y es el propio `httpsPublico` quien corta la
// conexión al vencer (ver `https_publico_tls.test.ts`); aquí solo se prueba
// que la ruta SÍ pasa un presupuesto finito —no infinito— y que una descarga
// que se interrumpe (red, timeout) no se lleva el CFDI por delante.
// ═══════════════════════════════════════════════════════════════════════════
describe('una descarga que se cuelga no se lleva el CFDI por delante', () => {
  it('se pasa un presupuesto de tiempo finito (no infinito) a la descarga de metadatos de Resend', async () => {
    let timeoutRecibido: number | undefined;
    stubHttp((url, timeoutMs) => {
      if (url.includes('/attachments/')) {
        timeoutRecibido = timeoutMs;
        return { cuerpo: JSON.stringify({ download_url: 'https://x/y' }) };
      }
      return { cuerpo: '<Comprobante/>' };
    });
    await POST(pedir(evento()));
    expect(timeoutRecibido).toBeGreaterThan(0);
    expect(timeoutRecibido).toBeLessThanOrEqual(8_000);
  });

  it('si la descarga se INTERRUMPE (red, timeout), el correo NO queda consumido: 503', async () => {
    // Simula lo que hace el timeout interno de `httpsPublico` al vencer.
    stubHttp((url) => {
      if (url.includes('/attachments/')) {
        return { cuerpo: JSON.stringify({ download_url: 'https://x/y' }) };
      }
      return { lanzar: true };
    });
    const r = await POST(pedir(evento()));
    // 503 y no 200: Resend tiene que volver a entregarlo.
    expect(r.status).toBe(503);
  });
});


describe('A37-S09-03/04 — adjuntos descartados con rastro, tope y descarga en pool', () => {
  const adjuntos = (...n: string[]) => ({ attachments: n.map((filename, i) => ({ id: `att_${i}`, filename })) });

  it('A37-S09-03: un adjunto gigante deja una recepción rechazada visible (no solo un warn)', async () => {
    stubHttp((url) => url.includes('/attachments/')
      ? { cuerpo: JSON.stringify({ download_url: 'https://x/g' }) }
      : { bytes: new Uint8Array(5 * 1024 * 1024), headers: { 'content-length': String(5 * 1024 * 1024) } });
    const r = await POST(pedir(evento(adjuntos('mensual.xml'))));
    expect(r.status).toBe(200);
    expect(descartesRegistrados).toHaveLength(1);
    expect(descartesRegistrados[0]).toMatchObject({ nombre: 'mensual.xml' });
    expect(descartesRegistrados[0].motivo).toMatch(/demasiado grande/);
  });

  it('A37-S09-03: un adjunto sin id deja rastro rechazado', async () => {
    const r = await POST(pedir(evento({ attachments: [{ filename: 'sin_id.xml' }] })));
    expect(r.status).toBe(200);
    expect(descartesRegistrados.map((d) => d.nombre)).toEqual(['sin_id.xml']);
  });

  it('A37-S09-03: si no se puede anotar el descarte, 503 (no se da por procesado un correo sin rastro)', async () => {
    fallaRegistroDescarte = true;
    const r = await POST(pedir(evento({ attachments: [{ filename: 'sin_id.xml' }] })));
    expect(r.status).toBe(503);
    expect(borrados).toEqual(['em_1']);
  });

  it('A37-S09-04: más adjuntos que el tope → se procesan los primeros 60 y el resto queda rechazado con rastro', async () => {
    stubHttp((url) => url.includes('/attachments/')
      ? { cuerpo: JSON.stringify({ download_url: 'https://x/d' }) } : { cuerpo: '<Comprobante/>' });
    const nombres = Array.from({ length: 70 }, (_, i) => `f${i}.xml`);
    const r = await POST(pedir(evento(adjuntos(...nombres))));
    expect(r.status).toBe(200);
    expect(recibidosPorIngesta).toHaveLength(60);
    expect(recibidosPorIngesta[0].nombre).toBe('f0.xml');
    expect(recibidosPorIngesta[59].nombre).toBe('f59.xml');
    expect(descartesRegistrados).toHaveLength(1);
    expect(descartesRegistrados[0].nombre).toBe('(+10 adjuntos omitidos)');
  });

  it('A37-S09-04: la descarga va en pool de 4 (no serial) y conserva el orden del correo', async () => {
    let enVuelo = 0; let maximo = 0;
    vi.mocked(httpsPublico).mockImplementation(async (p: PeticionSim) => {
      enVuelo++; maximo = Math.max(maximo, enVuelo);
      await new Promise((res) => setTimeout(res, 5));
      enVuelo--;
      if (p.url.includes('/attachments/')) {
        return { estado: 200, cuerpo: JSON.stringify({ download_url: 'https://x/d' }), bytes: new Uint8Array(0), encabezados: {} };
      }
      return { estado: 200, cuerpo: '<Comprobante/>', bytes: new TextEncoder().encode('<Comprobante/>'), encabezados: {} };
    });
    const nombres = Array.from({ length: 12 }, (_, i) => `p${i}.xml`);
    const r = await POST(pedir(evento(adjuntos(...nombres))));
    expect(r.status).toBe(200);
    expect(maximo).toBeGreaterThan(1);
    expect(maximo).toBeLessThanOrEqual(4);
    expect(recibidosPorIngesta.map((x) => x.nombre)).toEqual(nombres);
  });
});
