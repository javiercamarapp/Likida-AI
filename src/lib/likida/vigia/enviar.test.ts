import { describe, it, expect, vi, beforeEach } from 'vitest';

// La salida hacia un cliente final con el selector REAL de canal (enviarConFallback)
// y los envíos/ventana simulados con sus contratos de client.ts / wa_ventana.ts.
const enviarTexto = vi.hoisted(() => vi.fn());
const enviarBotones = vi.hoisted(() => vi.fn());
const sendTemplate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/meta/client', async () => {
  const real = await vi.importActual<typeof import('@/lib/meta/client')>('@/lib/meta/client');
  return { ...real, enviarTexto, enviarBotones, sendTemplate };
});
const ventanaDeContacto = vi.hoisted(() => vi.fn());
const registrarDecisionEnvio = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => {}));
vi.mock('@/lib/likida/wa_ventana', () => ({ ventanaDeContacto, registrarDecisionEnvio }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { enviarAlCliente, puedeEscribirseA, MAX_TEXTO_AL_CLIENTE } = await import('./enviar');
const { T1, T2 } = await import('./datos.fixture');

const ventana = (estado: 'abierta' | 'cerrada' | 'desconocida') => ventanaDeContacto.mockResolvedValue({ estado, ultimoEntranteEn: null, expiraEn: null });
const OK = (id: string) => ({ ok: true as const, id });
const contacto = (c: Record<string, unknown> = {}) => ({
  id: 'ct-1', tenantId: T1, telefono: '525511110001', estado: 'activo' as const,
  consentimientoEn: '2026-09-01T00:00:00Z', optoutEn: null, ...c,
});
const base = (c: Record<string, unknown> = {}) => ({
  tenantId: T1, contacto: contacto(), texto: 'Tu viaje F-1042 va en curso.', nombreFlota: 'Transportes del Norte', agenteHabilitado: true, ...c,
});

beforeEach(() => {
  [enviarTexto, enviarBotones, sendTemplate, ventanaDeContacto, registrarDecisionEnvio].forEach((f) => f.mockReset());
  enviarTexto.mockResolvedValue(OK('wamid.TXT')); sendTemplate.mockResolvedValue(OK('wamid.TPL'));
  registrarDecisionEnvio.mockResolvedValue(undefined);
});

describe('límites ANTES de tocar a Meta', () => {
  const casos: Array<[string, Record<string, unknown>, string]> = [
    ['agente apagado', { agenteHabilitado: false }, 'agente_apagado'],
    ['contacto con baja (estado)', { contacto: contacto({ estado: 'baja' }) }, 'con_baja'],
    ['contacto con opt-out (aunque su estado diga activo)', { contacto: contacto({ optoutEn: '2026-09-30T00:00:00Z' }) }, 'con_baja'],
    ['contacto suprimido (ARCO)', { contacto: contacto({ estado: 'suprimido' }) }, 'contacto_no_activo'],
    ['sin consentimiento', { contacto: contacto({ consentimientoEn: null }) }, 'sin_consentimiento'],
    ['contacto de OTRA flota', { contacto: contacto({ tenantId: T2 }) }, 'contacto_no_activo'],
    ['texto vacío', { texto: '   ' }, 'texto_vacio'],
    ['texto enorme', { texto: 'x'.repeat(MAX_TEXTO_AL_CLIENTE + 1) }, 'texto_demasiado_largo'],
  ];
  for (const [nombre, cambio, motivo] of casos) {
    it(`${nombre}: no se envía NADA`, async () => {
      ventana('abierta');
      const r = await enviarAlCliente(base(cambio));
      expect(r).toMatchObject({ ok: false, motivo });
      expect(enviarTexto).not.toHaveBeenCalled();
      expect(enviarBotones).not.toHaveBeenCalled();
      expect(sendTemplate).not.toHaveBeenCalled();
      expect(ventanaDeContacto).not.toHaveBeenCalled();
    });
  }

  it('la ÚNICA excepción a la baja es el acuse de la baja misma', async () => {
    ventana('abierta');
    const baja = contacto({ estado: 'baja', optoutEn: '2026-10-01T00:00:00Z' });
    expect(await enviarAlCliente(base({ contacto: baja, texto: 'Listo, ya no te escribiremos.' }), undefined, { confirmacionDeBaja: true })).toMatchObject({ ok: true });
    expect(enviarTexto).toHaveBeenCalledTimes(1);
    // …pero no vale para un contacto activo, suprimido ni de otra flota, ni para el agente apagado
    expect(puedeEscribirseA(contacto(), T1, true, { confirmacionDeBaja: true })).toBe('contacto_no_activo');
    expect(puedeEscribirseA(contacto({ estado: 'suprimido' }), T1, true, { confirmacionDeBaja: true })).toBe('contacto_no_activo');
    expect(puedeEscribirseA(contacto({ estado: 'baja', tenantId: T2 }), T1, true, { confirmacionDeBaja: true })).toBe('contacto_no_activo');
    expect(puedeEscribirseA(baja, T1, false, { confirmacionDeBaja: true })).toBe('agente_apagado');
  });

  it('puedeEscribirseA es la misma regla, pura', () => {
    expect(puedeEscribirseA(contacto(), T1, true)).toBeNull();
    expect(puedeEscribirseA(contacto(), T1, false)).toBe('agente_apagado');
    expect(puedeEscribirseA(contacto({ tenantId: T2 }), T1, true)).toBe('contacto_no_activo');
  });
});

describe('la ventana de 24 h', () => {
  it('abierta: texto libre', async () => {
    ventana('abierta');
    const r = await enviarAlCliente(base());
    expect(r).toMatchObject({ ok: true, via: 'texto', id: 'wamid.TXT' });
    expect(enviarTexto).toHaveBeenCalledWith('525511110001', 'Tu viaje F-1042 va en curso.');
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('CERRADA: SOLO la plantilla del catálogo — jamás un texto libre', async () => {
    ventana('cerrada');
    const r = await enviarAlCliente(base());
    expect(r).toMatchObject({ ok: true, via: 'plantilla', id: 'wamid.TPL', ventana: 'cerrada' });
    expect(enviarTexto).not.toHaveBeenCalled();
    expect(sendTemplate).toHaveBeenCalledTimes(1);
    const [tel, nombre, opciones] = sendTemplate.mock.calls[0];
    expect(tel).toBe('525511110001');
    expect(nombre).toBe('vigia_respuesta_cliente_v1');
    expect(opciones).toMatchObject({ idioma: 'es_MX', parametros: ['Transportes del Norte', 'Tu viaje F-1042 va en curso.'] });
  });

  it('el texto en la plantilla va sin saltos de línea (Meta los rechaza) y acotado', async () => {
    ventana('cerrada');
    await enviarAlCliente(base({ texto: `Línea uno\n\nLínea dos\t${'y'.repeat(600)}` }));
    const parametro = sendTemplate.mock.calls[0][2].parametros[1] as string;
    expect(parametro).not.toMatch(/[\n\t]/);
    expect(parametro.length).toBeLessThanOrEqual(300);
  });

  it('cerrada y plantilla sin aprobar (132001): NO se cae a texto libre fuera de ventana como entrega; se reporta el rechazo', async () => {
    ventana('cerrada');
    sendTemplate.mockResolvedValue({ ok: false, error: 'template not approved', codigo: 132001, status: 400 });
    // El selector hace un último intento de texto que Meta rechazará (131047); aquí lo simulamos.
    enviarTexto.mockResolvedValue({ ok: false, error: 'outside window', codigo: 131047, status: 400 });
    const r = await enviarAlCliente(base());
    expect(r).toMatchObject({ ok: false, motivo: 'rechazado_por_meta' });
  });

  it('un rechazo reintentable (429) se reporta como reintentable', async () => {
    ventana('abierta');
    enviarTexto.mockResolvedValue({ ok: false, error: 'rate', codigo: 130429, status: 429 });
    const r = await enviarAlCliente(base());
    expect(r).toMatchObject({ ok: false, motivo: 'rechazado_por_meta' });
  });
});
