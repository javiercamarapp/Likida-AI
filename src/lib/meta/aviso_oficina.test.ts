import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · AGEN-5 / WA-4 (ALTO) — lo que Likida INICIA hacia el jefe
// salía por `sendText`; fuera de 24 h Meta contesta 131047, no es
// reintentable, no había plantilla, y el chofer leía «ya se la pasé».
//
// El único borde es la Graph API: se cuenta qué POSTs salieron y de qué tipo.
// ═══════════════════════════════════════════════════════════════════════════

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));
const encolar = vi.fn(async () => {});
vi.mock('@/lib/likida/wa_outbox', () => ({
  encolarSalidaWhatsApp: (...a: unknown[]) => encolar(...(a as [])),
  RETRASO_AMBIGUO_SEGUNDOS: 300,
}));

type Salida = { type: string; template?: { name: string; components?: Array<{ parameters: Array<{ text: string }> }> } };
const salientes: Salida[] = [];
/** Respuestas de Meta en orden, una por POST. */
let respuestas: Array<{ status: number; body: unknown }> = [];
const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
  salientes.push(JSON.parse(String(init?.body ?? '{}')));
  const r = respuestas.shift() ?? { status: 200, body: { messages: [{ id: 'wamid.OK' }] } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
});
const rechazo = (code: number) => ({ status: 400, body: { error: { code, message: `(#${code}) rechazado` } } });

const { avisarOficina, parametrosAvisoOficina, esFueraDeVentana } = await import('./aviso_oficina');

beforeEach(() => {
  salientes.length = 0; respuestas = [];
  encolar.mockClear(); logger.error.mockReset(); logger.info.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok'; process.env.WHATSAPP_PHONE_NUMBER_ID = '1';
  delete process.env.WHATSAPP_PLANTILLA_AVISO_OFICINA;
});

const params = parametrosAvisoOficina('Juan Pérez', 'compartió su ubicación en ruta', 'https://maps.google.com/?q=1,2');

describe('avisarOficina — texto, y plantilla cuando la ventana de 24 h está cerrada', () => {
  it('dentro de la ventana: un solo POST de texto y ok por «texto»', async () => {
    const r = await avisarOficina('5219991110001', 'hola jefe', { parametros: params });
    expect(r).toEqual({ ok: true, via: 'texto', id: 'wamid.OK' });
    expect(salientes.map((s) => s.type)).toEqual(['text']);
  });

  it('131047: el segundo POST es la PLANTILLA con los tres parámetros, y ok por «plantilla»', async () => {
    respuestas = [rechazo(131047)];
    const r = await avisarOficina('5219991110001', 'hola jefe', { parametros: params, contexto: { viaje: 'v1' } });
    expect(r).toMatchObject({ ok: true, via: 'plantilla' });
    expect(salientes.map((s) => s.type)).toEqual(['text', 'template']);
    expect(salientes[1].template?.name).toBe('aviso_operacion_v1');
    expect(salientes[1].template?.components?.[0].parameters.map((p) => p.text)).toEqual(params);
    // El texto rechazado por ventana NO se encola: reintentarlo falla igual.
    expect(encolar).not.toHaveBeenCalled();
  });

  it.each([131026, 131042])('%s también cuenta como fuera de ventana', async (code) => {
    respuestas = [rechazo(code)];
    const r = await avisarOficina('5219991110001', 'x', { parametros: params });
    expect(r.ok).toBe(true);
    expect(salientes.map((s) => s.type)).toEqual(['text', 'template']);
  });

  it('si la plantilla tampoco sale (132001, no aprobada), ok:false CON motivo y fueraDeVentana: nadie afirma «ya se la pasé»', async () => {
    respuestas = [rechazo(131047), rechazo(132001)];
    const r = await avisarOficina('5219991110001', 'x', { parametros: params });
    expect(r).toMatchObject({ ok: false, fueraDeVentana: true, codigo: 132001 });
    expect(r.ok === false && r.motivo).toMatch(/plantilla no está aprobada/);
    expect(logger.error).toHaveBeenCalledWith('aviso_oficina.no_entregado', expect.objectContaining({ codigoTexto: 131047, codigoPlantilla: 132001 }));
  });

  it('la plantilla rechazada por un motivo REINTENTABLE (429) queda en el outbox con su payload de plantilla', async () => {
    respuestas = [rechazo(131047), { status: 429, body: { error: { code: 130429, message: 'rate' } } }];
    const r = await avisarOficina('5219991110001', 'x', { parametros: params });
    expect(r.ok).toBe(false);
    expect(encolar).toHaveBeenCalledTimes(1);
    expect((encolar.mock.calls[0] as unknown[])[0]).toMatchObject({ type: 'template' });
  });

  it('un rechazo que NO es de ventana (número inválido) no dispara plantilla', async () => {
    respuestas = [rechazo(131030)];
    const r = await avisarOficina('5219991110001', 'x', { parametros: params });
    expect(r).toMatchObject({ ok: false, fueraDeVentana: false, codigo: 131030 });
    expect(salientes.map((s) => s.type)).toEqual(['text']);
  });

  it('WHATSAPP_PLANTILLA_AVISO_OFICINA cambia el nombre de la plantilla', async () => {
    process.env.WHATSAPP_PLANTILLA_AVISO_OFICINA = 'aviso_flota_x';
    respuestas = [rechazo(131047)];
    await avisarOficina('5219991110001', 'x', { parametros: params });
    expect(salientes[1].template?.name).toBe('aviso_flota_x');
  });
});

describe('parametrosAvisoOficina', () => {
  it('recorta el resumen a 60 y nunca deja un parámetro vacío', () => {
    const [chofer, resumen, liga] = parametrosAvisoOficina('  ', 'x'.repeat(200), 'https://app');
    expect(chofer).toBe('Tu chofer');
    expect(resumen.length).toBe(60);
    expect(resumen.endsWith('…')).toBe(true);
    expect(liga).toBe('https://app');
  });
  it('esFueraDeVentana reconoce el trío y nada más', () => {
    expect(esFueraDeVentana(131047)).toBe(true);
    expect(esFueraDeVentana(130429)).toBe(false);
    expect(esFueraDeVentana(undefined)).toBe(false);
  });
});
