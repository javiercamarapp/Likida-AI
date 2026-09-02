import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · OP-P5 / OP-A3 / PRU-A3 — el canal del operador a las 3 a.m.
//
//   · OP-A3 (reincidente): la huella de dedup miraba llaves que ningún
//     llamador emite. Doce viajes que fallan al timbrar en la misma hora eran
//     UN correo. Ahora la huella lee los UUIDs que viajan dentro de `error`.
//   · PRU-A3 (reincidente): `timbre.uuid_huerfano` redactaba el folio fiscal
//     que decía preservar (`id:33ab7e19c0d1`). En eventos `timbre.*` el UUID
//     que el texto nombra como «uuid» se conserva; viaje, RFC y teléfonos no.
//   · OP-P5: `ALERTA_WA` opcional — los eventos de dinero salen también por
//     WhatsApp, bajo el mismo piso; los demás no; nunca lanza.
// ═══════════════════════════════════════════════════════════════════════════

const enviarCorreo = vi.fn();
const enviarTexto = vi.fn();
vi.mock('@/lib/correo/enviar', () => ({
  enviarCorreo: (...a: unknown[]) => enviarCorreo(...a),
  correoConfigurado: () => true,
}));
vi.mock('@/lib/meta/client', () => ({ enviarTexto: (...a: unknown[]) => enviarTexto(...a) }));
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
// Redactor con la forma real: UUID → huella, RFC → [RFC], teléfono → [TEL].
vi.mock('@/lib/logger', () => ({
  logger,
  redactarTexto: (s: string) => s
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (m) => `id:${m.slice(0, 12).replace(/-/g, '')}`)
    .replace(/\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/g, '[RFC]')
    .replace(/\b\d{10}\b/g, '[TEL]'),
}));

type Correo = { asunto: string; datos?: Array<[string, string]> };
const VIAJE_A = 'a1b2c3d4-0000-4000-8000-000000000001';
const VIAJE_B = 'a1b2c3d4-0000-4000-8000-000000000002';
const FOLIO = '33ab7e19-c0d1-4c3e-9f8a-1b2c3d4e5f60';

async function cargar() {
  vi.resetModules();
  return import('./alerta');
}

beforeEach(() => {
  enviarCorreo.mockReset().mockResolvedValue({ ok: true, id: 'correo-1' });
  enviarTexto.mockReset().mockResolvedValue({ ok: true, id: 'wamid.1' });
  logger.warn.mockClear();
  vi.stubEnv('ALERTA_EMAIL', 'javier@likida.ai');
  vi.stubEnv('ALERTA_WA', '');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('OP-A3: dos viajes distintos en la misma hora son dos alarmas', () => {
  it('el uuid dentro de `error` distingue los incidentes (el llamador real no manda viajeId)', async () => {
    const { alertarOperador } = await cargar();
    await alertarOperador('timbre.uuid_huerfano', { error: `Viaje ${VIAJE_A}: el PAC timbró el uuid ${FOLIO} y la consolidación no cerró.`, codigo: 'timbre_uuid_huerfano' });
    await alertarOperador('timbre.uuid_huerfano', { error: `Viaje ${VIAJE_B}: el PAC timbró el uuid ${FOLIO} y la consolidación no cerró.`, codigo: 'timbre_uuid_huerfano' });
    expect(enviarCorreo).toHaveBeenCalledTimes(2);
  });

  it('el mismo viaje repitiéndose sigue siendo UNA alarma por hora, aunque cambien los milisegundos del texto', async () => {
    const { alertarOperador } = await cargar();
    await alertarOperador('cron.gps', { error: `Viaje ${VIAJE_A}: timeout tras 1234 ms`, codigo: 'timeout' });
    await alertarOperador('cron.gps', { error: `Viaje ${VIAJE_A}: timeout tras 5678 ms`, codigo: 'timeout' });
    expect(enviarCorreo).toHaveBeenCalledTimes(1);
  });

  it('la huella es estable ante el orden de las llaves y toma las que los llamadores sí emiten', async () => {
    const { huellaDeDetalle } = await cargar();
    expect(huellaDeDetalle({ codigo: 'x', prospectoId: 'p1' })).toBe(huellaDeDetalle({ prospectoId: 'p1', codigo: 'x' }));
    expect(huellaDeDetalle({ interruptor: 'facturacion', codigo: 'ilegible' })).toContain('interruptor=facturacion');
    expect(huellaDeDetalle({ error: 'sin identidad' })).toBe('_');
  });
});

describe('PRU-A3: el folio fiscal huérfano sale ÍNTEGRO en el correo', () => {
  it('timbre.uuid_huerfano conserva el folio que el texto nombra como «uuid» y sigue tapando viaje, RFC y teléfono', async () => {
    const { alertarOperador } = await cargar();
    await alertarOperador('timbre.uuid_huerfano', {
      error: `Viaje ${VIAJE_A}: el PAC timbró el uuid ${FOLIO} para GMX0902279I1, tel 5512345678.`,
      codigo: 'timbre_uuid_huerfano',
    });
    const correo = enviarCorreo.mock.calls[0][1] as Correo;
    const error = correo.datos?.find(([k]) => k === 'error')?.[1] ?? '';
    expect(error).toContain(FOLIO);
    // El viaje no es el folio: se sigue redactando (OP-A2, aud22: «lo que NO
    // es folio fiscal se sigue redactando»).
    expect(error).not.toContain(VIAJE_A);
    expect(error).toContain('[RFC]');
    expect(error).toContain('[TEL]');
    expect(error).not.toContain('GMX0902279I1');
  });

  it('fuera de timbre.* los UUIDs del texto se siguen redactando (no es una puerta general)', async () => {
    const { alertarOperador } = await cargar();
    await alertarOperador('cron.gps', { error: `Viaje ${VIAJE_A} sin posición`, codigo: 'sin_posicion' });
    const correo = enviarCorreo.mock.calls[0][1] as Correo;
    const error = correo.datos?.find(([k]) => k === 'error')?.[1] ?? '';
    expect(error).not.toContain(VIAJE_A);
    expect(error).toContain('id:');
  });
});

describe('OP-P5: el canal de WhatsApp para el dinero', () => {
  it('sin ALERTA_WA no se manda nada por WhatsApp', async () => {
    const { alertarOperador } = await cargar();
    await alertarOperador('timbre.ambiguo', { error: 'x', codigo: 'timbre_ambiguo' });
    expect(enviarTexto).not.toHaveBeenCalled();
    expect(enviarCorreo).toHaveBeenCalledTimes(1);
  });

  it('con ALERTA_WA, un evento de dinero sale por correo Y por WhatsApp con el texto ya redactado; uno que no es de dinero, solo por correo', async () => {
    vi.stubEnv('ALERTA_WA', '5215512345678');
    const { alertarOperador, esEventoDeDinero } = await cargar();
    await alertarOperador('cron.facturar', { error: 'QStash no aceptó 3 de 10 lotes, tel 5512345678', codigo: 'encolado_parcial' });
    expect(enviarTexto).toHaveBeenCalledTimes(1);
    const [para, cuerpo] = enviarTexto.mock.calls[0] as [string, string];
    expect(para).toBe('5215512345678');
    expect(cuerpo).toContain('cron.facturar');
    expect(cuerpo).toContain('encolado_parcial');
    expect(cuerpo).toContain('[TEL]');
    expect(cuerpo).not.toContain('5512345678');

    await alertarOperador('cron.gps', { error: 'sin posición', codigo: 'gps' });
    expect(enviarTexto).toHaveBeenCalledTimes(1);
    expect(esEventoDeDinero('finanzas.tesoreria')).toBe(true);
    expect(esEventoDeDinero('cron.purgar')).toBe(false);
  });

  it('con ALERTA_WA y SIN ALERTA_EMAIL, el dinero igual suena en el teléfono', async () => {
    vi.stubEnv('ALERTA_EMAIL', '');
    vi.stubEnv('ALERTA_WA', '5215512345678');
    const { alertarOperador, alertaWhatsAppConfigurada } = await cargar();
    expect(alertaWhatsAppConfigurada()).toBe(true);
    await alertarOperador('timbre.uuid_huerfano', { error: `uuid ${FOLIO}`, codigo: 'timbre_uuid_huerfano' });
    expect(enviarCorreo).not.toHaveBeenCalled();
    expect(enviarTexto).toHaveBeenCalledTimes(1);
    expect((enviarTexto.mock.calls[0] as [string, string])[1]).toContain(FOLIO);
  });

  it('el mismo piso: el segundo incidente idéntico en la hora no sale por ningún canal', async () => {
    vi.stubEnv('ALERTA_WA', '5215512345678');
    const { alertarOperador } = await cargar();
    await alertarOperador('cron.cobranza', { error: 'x', codigo: 'c' });
    await alertarOperador('cron.cobranza', { error: 'x', codigo: 'c' });
    expect(enviarCorreo).toHaveBeenCalledTimes(1);
    expect(enviarTexto).toHaveBeenCalledTimes(1);
  });

  it('si WhatsApp truena, no propaga: queda un warn y el correo ya salió', async () => {
    vi.stubEnv('ALERTA_WA', '5215512345678');
    enviarTexto.mockRejectedValue(new Error('Meta caída'));
    const { alertarOperador } = await cargar();
    await expect(alertarOperador('stripe.webhook', { error: 'x', codigo: 's' })).resolves.toBeUndefined();
    expect(enviarCorreo).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('alerta.wa_fallo', expect.objectContaining({ evento: 'stripe.webhook' }));
  });
});
