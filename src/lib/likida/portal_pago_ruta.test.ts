import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA RUTA PÚBLICA: EL ORDEN DE LOS CANDADOS Y EL CÓDIGO QUE CONTESTA.
//
// Se mockean los módulos de datos y NO Supabase: lo que esta prueba tiene que
// demostrar son las decisiones de la ruta, y son cinco que se rompen solas si
// alguien reordena el archivo:
//
//   · el honeypot contesta 200 y NO escribe (un 400 le enseña al bot);
//   · un token muerto contesta 404 con el MISMO texto que uno inventado;
//   · «no se pudo preguntar» es 503, no 404 — la misma distinción que la
//     página, por la misma razón;
//   · el segundo envío idéntico NO vuelve a avisarle al contralor: el índice
//     único lo absorbió, y no hay hecho nuevo que anunciar;
//   · el aviso que falla NO cambia la respuesta: el pago del cliente YA quedó.
// ═══════════════════════════════════════════════════════════════════════════

const rateLimit = vi.fn(async () => true);
const resolverLiga = vi.fn();
const vistaDelPortal = vi.fn();
const anotarAcceso = vi.fn(async () => undefined);
const registrarPropuesta = vi.fn();
const avisar = vi.fn(async () => ({ enviado: true, porque: 'ok', destinatarios: 2 }));

vi.mock('@/lib/ratelimit', () => ({
  rateLimit: (...a: unknown[]) => rateLimit(...(a as [])),
  clientIp: () => '203.0.113.7',
  bodyExcede: (req: Request, max: number) => Number(req.headers.get('content-length') ?? 0) > max,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  redactarTexto: (s: string) => s,
}));
vi.mock('@/lib/likida/portal_pago_lectura', () => ({
  resolverLiga: (...a: unknown[]) => resolverLiga(...(a as [])),
  vistaDelPortal: (...a: unknown[]) => vistaDelPortal(...(a as [])),
  anotarAcceso: (...a: unknown[]) => anotarAcceso(...(a as [])),
}));
vi.mock('@/lib/likida/portal_pago_propuesta', () => ({
  registrarPropuesta: (...a: unknown[]) => registrarPropuesta(...(a as [])),
}));
vi.mock('@/lib/likida/portal_pago_aviso', () => ({
  avisarPropuestaAlContralor: (...a: unknown[]) => avisar(...(a as [])),
}));

import { POST } from '@/app/api/pago/registrar/route';
import { TEXTO_LIGA_NO_VALIDA } from './portal_pago';

const LIGA = { ligaId: 'liga-1', tenantId: 't-1', facturaId: 'f-1', estado: 'vigente' as const };

const VISTA = {
  ok: true as const,
  vista: {
    ligaId: 'liga-1', tenantId: 't-1', facturaId: 'f-1',
    flota: 'Transportes del Bajío', cliente: 'Cementos del Norte',
    factura: {
      serie: 'A', folio: '1042', cfdiUuid: null, fecha: '2026-08-14', venceEn: null,
      estatus: 'emitida', total: 11600, moneda: 'MXN', saldo: 11600, pagado: 0,
    },
    propuestas: [], rep: null,
  },
};

const CUERPO_OK = {
  token: 'pgo_abcdefghijklmnop',
  fecha: '2026-08-20',
  monto: '11600',
  referencia: 'REF-8891',
  metodo: 'transferencia',
};

function peticion(cuerpo: unknown, contentLength?: number): Request {
  const body = JSON.stringify(cuerpo);
  return new Request('https://app.likida.ai/api/pago/registrar', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': String(contentLength ?? body.length) },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimit.mockResolvedValue(true);
  resolverLiga.mockResolvedValue({ ok: true, liga: LIGA });
  vistaDelPortal.mockResolvedValue(VISTA);
  registrarPropuesta.mockResolvedValue({ ok: true, id: 'p-1', repetida: false });
  avisar.mockResolvedValue({ enviado: true, porque: 'ok', destinatarios: 2 });
});

describe('los candados, en orden', () => {
  it('un cuerpo enorme se corta ANTES de leerlo (413)', async () => {
    const r = await POST(peticion(CUERPO_OK, 999_999));
    expect(r.status).toBe(413);
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it('el límite de tasa contesta 429 sin tocar la base', async () => {
    rateLimit.mockResolvedValue(false);
    const r = await POST(peticion(CUERPO_OK));
    expect(r.status).toBe(429);
    expect(resolverLiga).not.toHaveBeenCalled();
  });

  it('el límite va por IP, no global', async () => {
    await POST(peticion(CUERPO_OK));
    expect(rateLimit).toHaveBeenCalledWith('portal-pago:203.0.113.7', 10, 600_000);
  });

  it('un JSON roto es 400 y no consulta nada', async () => {
    const req = new Request('https://app.likida.ai/api/pago/registrar', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{no',
    });
    const r = await POST(req);
    expect(r.status).toBe(400);
    expect(resolverLiga).not.toHaveBeenCalled();
  });

  it('EL HONEYPOT: 200, y NI SE ESCRIBE NI SE RESUELVE EL TOKEN', async () => {
    // Contestarle 400 al bot es enseñarle a esquivar el campo la próxima vez.
    const r = await POST(peticion({ ...CUERPO_OK, sitioWeb: 'https://spam.example' }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true });
    expect(registrarPropuesta).not.toHaveBeenCalled();
    expect(resolverLiga).not.toHaveBeenCalled();
    expect(avisar).not.toHaveBeenCalled();
  });
});

describe('el token muerto y el que no se pudo comprobar', () => {
  it('token inválido: 404 con el texto único', async () => {
    resolverLiga.mockResolvedValue({ ok: false, motivo: 'no_valida' });
    const r = await POST(peticion(CUERPO_OK));
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe(TEXTO_LIGA_NO_VALIDA);
  });

  it('lectura caída: 503, JAMÁS 404', async () => {
    resolverLiga.mockResolvedValue({ ok: false, motivo: 'no_disponible' });
    const r = await POST(peticion(CUERPO_OK));
    expect(r.status).toBe(503);
    expect((await r.json()).error).toMatch(/unos minutos/);
  });

  it('la vista caída también es 503', async () => {
    vistaDelPortal.mockResolvedValue({ ok: false, motivo: 'no_disponible' });
    expect((await POST(peticion(CUERPO_OK))).status).toBe(503);
  });

  it('la vista sin factura es 404 con el texto único', async () => {
    vistaDelPortal.mockResolvedValue({ ok: false, motivo: 'no_valida' });
    const r = await POST(peticion(CUERPO_OK));
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe(TEXTO_LIGA_NO_VALIDA);
  });
});

describe('la validación se hace contra la factura REAL', () => {
  it('un monto por encima del saldo es 400, con el saldo en el mensaje', async () => {
    const r = await POST(peticion({ ...CUERPO_OK, monto: '99999' }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain('$11,600.00');
    expect(registrarPropuesta).not.toHaveBeenCalled();
  });

  it('con saldo desconocido NO se acepta nada — fail-closed', async () => {
    vistaDelPortal.mockResolvedValue({
      ...VISTA, vista: { ...VISTA.vista, factura: { ...VISTA.vista.factura, saldo: null } },
    });
    const r = await POST(peticion(CUERPO_OK));
    expect(r.status).toBe(400);
    expect(registrarPropuesta).not.toHaveBeenCalled();
  });

  it('una fecha anterior a la factura es 400', async () => {
    const r = await POST(peticion({ ...CUERPO_OK, fecha: '2026-01-01' }));
    expect(r.status).toBe(400);
  });
});

describe('el registro y el aviso', () => {
  it('el camino feliz: 200, bitácora, aviso y mensaje que NO promete aplicación', async () => {
    const r = await POST(peticion(CUERPO_OK));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true);
    // El cliente NO puede salir creyendo que su factura quedó saldada.
    expect(j.mensaje).toMatch(/confirmarlo/);
    expect(anotarAcceso).toHaveBeenCalledWith(LIGA, 'pago_propuesto', expect.anything());
    expect(avisar).toHaveBeenCalledTimes(1);
    // El aviso lleva la llave de idempotencia de Resend: el id de la propuesta.
    expect(avisar).toHaveBeenCalledWith('t-1', expect.objectContaining({
      cliente: 'Cementos del Norte', identificaFactura: 'A-1042', referencia: 'REF-8891',
    }), 'p-1');
  });

  it('el segundo envío idéntico NO avisa de nuevo: no hay hecho nuevo', async () => {
    registrarPropuesta.mockResolvedValue({ ok: true, id: null, repetida: true });
    const r = await POST(peticion(CUERPO_OK));
    expect(r.status).toBe(200);
    expect((await r.json()).mensaje).toMatch(/ya estaba registrado/i);
    expect(avisar).not.toHaveBeenCalled();
    expect(anotarAcceso).not.toHaveBeenCalled();
  });

  it('si el registro falla, 503 y NO se avisa de un pago que no existe', async () => {
    registrarPropuesta.mockResolvedValue({ ok: false, motivo: 'no se pudo' });
    const r = await POST(peticion(CUERPO_OK));
    expect(r.status).toBe(503);
    expect(avisar).not.toHaveBeenCalled();
  });

  it('un aviso que NO sale no cambia la respuesta al cliente', async () => {
    // Su pago ya quedó registrado: decirle que falló sería mentirle sobre lo
    // único que vino a hacer.
    avisar.mockResolvedValue({ enviado: false, porque: 'sin correos', destinatarios: 0 });
    const r = await POST(peticion(CUERPO_OK));
    expect(r.status).toBe(200);
    expect((await r.json()).ok).toBe(true);
  });
});
