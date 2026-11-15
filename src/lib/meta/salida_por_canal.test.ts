import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// SALIDA POR CANAL (líneas de WhatsApp por tenant, paquete O). Con `opts.canal` el
// envío usa la URL (phone_number_id) y el Authorization de ESA línea; sin canal usa
// el entorno global, idéntico a siempre. Todo con fetch mockeado: nada toca Meta.
// ═══════════════════════════════════════════════════════════════════════════

const { logger } = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const encolar = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => {}));
const encolarDedupe = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ id: 'o1', estado: 'pending', providerMessageId: null })));
const alertar = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => true));
const marcarVencida = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => {}));
const resolver = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/likida/wa_outbox', () => ({
  encolarSalidaWhatsApp: encolar, encolarSalidaWhatsAppDedupe: encolarDedupe, leerSalidasPorLlave: vi.fn(async () => new Map()),
  RETRASO_AMBIGUO_SEGUNDOS: 300,
}));
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: alertar }));
vi.mock('@/lib/saas/salidas_flota', () => ({ veredictoSalidasHaciaTelefono: async () => ({ salen: true }) }));
vi.mock('@/lib/likida/wa_ventana', () => ({
  ventanaDeContacto: async () => ({ estado: 'abierta' }), registrarDecisionEnvio: vi.fn(async () => {}),
}));
// El setup global fija «sin línea propia» para el selector; aquí se mide la línea propia, así que se usa el real.
vi.unmock('@/lib/meta/canal_envio');
// El módulo real del canal lo escribe otro paquete: aquí se mockea según el contrato.
vi.mock('@/lib/meta/canal', () => ({ resolverCanal: resolver, marcarLineaTokenVencido: marcarVencida }));

const {
  enviarTexto, enviarBotones, enviarSolicitudUbicacion, sendTemplate, sendDocument, enviarRespuestaArco,
  sondearTokenWhatsApp, olvidarSondeoToken, metadatosMedia, downloadMediaAsText, encolarBotonesWhatsApp,
} = await import('./client');
const { enviarConFallback } = await import('./enviar_con_fallback');

const TEL = '5219993700779';
const LINEA_A = { phoneNumberId: 'PNID_A', token: 'TOKEN_A', origen: 'tenant' as const, lineaId: 'linea-a' };
const LINEA_B = { phoneNumberId: 'PNID_B', token: 'TOKEN_B', origen: 'tenant' as const, lineaId: 'linea-b' };
const ok = () => new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] }), { status: 200 });
const err = (status: number, code: number) => new Response(JSON.stringify({ error: { code, message: 'm' } }), { status });
let f: ReturnType<typeof vi.fn>;
const url = (i = 0) => String(f.mock.calls[i][0]);
const auth = (i = 0) => (f.mock.calls[i][1] as { headers: Record<string, string> }).headers.Authorization;

beforeEach(() => {
  vi.clearAllMocks();
  olvidarSondeoToken();
  process.env.WHATSAPP_ACCESS_TOKEN = 'TOKEN_ENV';
  process.env.WHATSAPP_PHONE_NUMBER_ID = 'PNID_ENV';
  f = vi.fn(async () => ok());
  vi.stubGlobal('fetch', f);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('cada función de salida usa la URL y el Authorization de la línea', () => {
  it('enviarTexto / enviarBotones / ubicación / plantilla / documento / ARCO', async () => {
    await enviarTexto(TEL, 'hola', { canal: LINEA_A });
    await enviarBotones(TEL, 'cuerpo', [{ id: 'a', titulo: 'Sí' }], undefined, { canal: LINEA_A });
    await enviarSolicitudUbicacion(TEL, 'dónde', { canal: LINEA_A });
    await sendTemplate(TEL, 'plantilla_x', { parametros: ['a'], canal: LINEA_A });
    await sendDocument(TEL, 'https://x/y.pdf', 'y.pdf', undefined, { canal: LINEA_A });
    await enviarRespuestaArco(TEL, 'respuesta', { canal: LINEA_A });
    expect(f).toHaveBeenCalledTimes(6);
    for (let i = 0; i < 6; i++) {
      expect(url(i)).toBe('https://graph.facebook.com/v21.0/PNID_A/messages');
      expect(auth(i)).toBe('Bearer TOKEN_A');
    }
  });

  it('la plantilla no filtra `canal` al armado de componentes ni al cuerpo que va a Meta', async () => {
    await sendTemplate(TEL, 'plantilla_x', { parametros: ['a'], canal: LINEA_A });
    const cuerpo = JSON.parse(String((f.mock.calls[0][1] as RequestInit).body));
    expect(JSON.stringify(cuerpo)).not.toMatch(/TOKEN_A|_canal|lineaId/);
  });

  it('las descargas de media usan el token de la línea (metadatos y texto)', async () => {
    f.mockResolvedValueOnce(new Response(JSON.stringify({ mime_type: 'image/jpeg', file_size: 10, url: 'https://lookaside.fbsbx.com/x' }), { status: 200 }));
    await metadatosMedia('media1', { canal: LINEA_A });
    expect(auth(0)).toBe('Bearer TOKEN_A');
    f.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    await downloadMediaAsText('media2', { canal: LINEA_B });
    expect(auth(1)).toBe('Bearer TOKEN_B');
  });

  it('dos tenants con líneas distintas no se mezclan, ni en paralelo', async () => {
    await Promise.all([enviarTexto(TEL, 'a', { canal: LINEA_A }), enviarTexto(TEL, 'b', { canal: LINEA_B })]);
    const por = new Map(f.mock.calls.map((c) => [String(c[0]), (c[1] as { headers: Record<string, string> }).headers.Authorization]));
    expect(por.get('https://graph.facebook.com/v21.0/PNID_A/messages')).toBe('Bearer TOKEN_A');
    expect(por.get('https://graph.facebook.com/v21.0/PNID_B/messages')).toBe('Bearer TOKEN_B');
  });

  it('SIN canal usa el entorno global, igual que hoy', async () => {
    await enviarTexto(TEL, 'hola');
    await sendTemplate(TEL, 'plantilla_x', { parametros: ['a'] });
    for (let i = 0; i < 2; i++) {
      expect(url(i)).toBe('https://graph.facebook.com/v21.0/PNID_ENV/messages');
      expect(auth(i)).toBe('Bearer TOKEN_ENV');
    }
  });

  it('un canal de plataforma explícito (origen plataforma) tampoco marca nada en el payload encolado', async () => {
    f.mockResolvedValue(err(429, 130429));
    await enviarTexto(TEL, 'hola', { canal: { phoneNumberId: 'PNID_ENV', token: 'TOKEN_ENV', origen: 'plataforma', lineaId: null } });
    expect(encolar.mock.calls[0][0]).not.toHaveProperty('_canal');
  });
});

describe('la línea queda fijada en lo que se encola (el reintento no se re-rutea)', () => {
  it('un 429 en una línea de tenant encola con `_canal`, sin token', async () => {
    f.mockResolvedValue(err(429, 130429));
    await enviarTexto(TEL, 'hola', { canal: LINEA_A });
    const payload = encolar.mock.calls[0][0] as Record<string, unknown>;
    expect(payload._canal).toEqual({ phoneNumberId: 'PNID_A', lineaId: 'linea-a' });
    expect(JSON.stringify(payload)).not.toContain('TOKEN_A');
  });

  it('sin línea propia el payload encolado es el de siempre', async () => {
    f.mockResolvedValue(err(429, 130429));
    await enviarTexto(TEL, 'hola');
    expect(encolar.mock.calls[0][0]).not.toHaveProperty('_canal');
  });

  it('la llave de idempotencia de las alertas encoladas incluye la línea; sin línea queda igual', async () => {
    await encolarBotonesWhatsApp(TEL, 'alerta', [{ id: 'a', titulo: 'Sí' }], 'gps:v1', { canal: LINEA_A });
    await encolarBotonesWhatsApp(TEL, 'alerta', [{ id: 'a', titulo: 'Sí' }], 'gps:v1', { canal: LINEA_B });
    await encolarBotonesWhatsApp(TEL, 'alerta', [{ id: 'a', titulo: 'Sí' }], 'gps:v1');
    const llaves = encolarDedupe.mock.calls.map((c) => c[0]);
    expect(llaves).toEqual(['gps:v1:llinea-a', 'gps:v1:llinea-b', 'gps:v1']);
    expect((encolarDedupe.mock.calls[0][1] as Record<string, unknown>)._canal).toEqual({ phoneNumberId: 'PNID_A', lineaId: 'linea-a' });
  });
});

describe('token vencido por línea', () => {
  it('190 en la línea de un tenant marca ESA línea y alerta por línea, no por el token de plataforma', async () => {
    f.mockResolvedValue(err(400, 190));
    const r = await enviarTexto(TEL, 'hola', { canal: LINEA_A });
    expect(r).toMatchObject({ ok: false, codigo: 190 });
    expect(marcarVencida).toHaveBeenCalledWith('linea-a');
    expect(alertar).toHaveBeenCalledWith('whatsapp.token_vencido_linea', expect.objectContaining({ linea: 'linea-a' }));
    expect(alertar).not.toHaveBeenCalledWith('whatsapp.token_vencido', expect.anything());
    expect(JSON.stringify([...alertar.mock.calls, ...logger.error.mock.calls])).not.toContain('TOKEN_A');
    expect((encolar.mock.calls[0][0] as Record<string, unknown>)._canal).toBeDefined();
  });

  it('190 SIN canal sigue siendo el aviso de plataforma y no marca ninguna línea', async () => {
    f.mockResolvedValue(err(400, 190));
    await enviarTexto(TEL, 'hola');
    expect(alertar).toHaveBeenCalledWith('whatsapp.token_vencido', expect.anything());
    expect(marcarVencida).not.toHaveBeenCalled();
  });

  it('el sondeo es por línea: A vencida no marca a B ni a la plataforma', async () => {
    f.mockImplementation(async (u: string) => (String(u).includes('PNID_A') ? err(400, 190) : ok()));
    expect((await sondearTokenWhatsApp(1000, LINEA_A)).estado).toBe('vencido');
    expect((await sondearTokenWhatsApp(1000, LINEA_B)).estado).toBe('ok');
    expect((await sondearTokenWhatsApp(1000)).estado).toBe('ok');
    // cada veredicto se cachea en su clave: el de A no pisa al de plataforma
    expect((await sondearTokenWhatsApp(2000, LINEA_A)).estado).toBe('vencido');
    expect(f).toHaveBeenCalledTimes(3);
    expect(String(f.mock.calls[2][0])).toContain('PNID_ENV');
    expect((f.mock.calls[0][1] as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer TOKEN_A');
  });
});

describe('enviarConFallback resuelve la línea por tenantId', () => {
  const PLANTILLA = { nombre: 'p', idioma: 'es_MX', parametros: ['a'] };

  it('con línea propia, el texto sale por ella', async () => {
    resolver.mockResolvedValue(LINEA_A);
    const r = await enviarConFallback(TEL, { texto: 'hola', plantilla: PLANTILLA, contexto: 't', tenantId: 'tenant-a' });
    expect(r.ok).toBe(true);
    expect(resolver).toHaveBeenCalledWith('tenant-a');
    expect(url()).toContain('/PNID_A/messages');
    expect(auth()).toBe('Bearer TOKEN_A');
  });

  it('sin línea propia (origen plataforma) sale por el entorno', async () => {
    resolver.mockResolvedValue({ phoneNumberId: 'PNID_ENV', token: 'TOKEN_ENV', origen: 'plataforma', lineaId: null });
    await enviarConFallback(TEL, { texto: 'hola', plantilla: PLANTILLA, contexto: 't', tenantId: 'tenant-x' });
    expect(url()).toContain('/PNID_ENV/messages');
  });

  it('sin tenantId no consulta el canal', async () => {
    await enviarConFallback(TEL, { texto: 'hola', plantilla: PLANTILLA, contexto: 't' });
    expect(resolver).not.toHaveBeenCalled();
    expect(url()).toContain('/PNID_ENV/messages');
  });

  it('línea pausada o con token vencido: falla CERRADO, no llama a Meta y NO cae a plataforma', async () => {
    resolver.mockRejectedValue(Object.assign(new Error('x'), { motivo: 'token_vencido' }));
    const r = await enviarConFallback(TEL, { texto: 'hola', plantilla: PLANTILLA, contexto: 't', tenantId: 'tenant-a' });
    expect(r).toMatchObject({ ok: false, reintentable: true });
    expect(f).not.toHaveBeenCalled();
  });

  it('error al leer la línea: también falla cerrado', async () => {
    resolver.mockRejectedValue(new Error('base caída'));
    const r = await enviarConFallback(TEL, { texto: 'hola', plantilla: PLANTILLA, contexto: 't', tenantId: 'tenant-a' });
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('el token vencido de un tenant no frena el envío de otro', async () => {
    resolver.mockImplementation(async (t: string) => {
      if (t === 'tenant-a') throw Object.assign(new Error('x'), { motivo: 'token_vencido' });
      return LINEA_B;
    });
    const a = await enviarConFallback(TEL, { texto: 'a', plantilla: PLANTILLA, contexto: 't', tenantId: 'tenant-a' });
    const b = await enviarConFallback(TEL, { texto: 'b', plantilla: PLANTILLA, contexto: 't', tenantId: 'tenant-b' });
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    expect(url()).toContain('/PNID_B/messages');
  });
});
