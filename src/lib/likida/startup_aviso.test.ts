import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 6 · CRÍTICO del rubro legal — EL DETECTOR SIN CABLE.
//
// El commit de la ronda 5 diagnosticó bien y escribió DOS funciones:
//
//   · `revisarAvisoIntegral`  — revisión de FORMA, sin red. Un dominio bien
//     escrito y SIN REGISTRAR la pasa.
//   · `sondearAvisoIntegral`  — la única que prueba existencia.
//
// El comentario de la segunda dice dónde va: "en un arranque, en un preflight
// de despliegue o en un cron, donde un fallo se puede mirar". Ese arranque no
// existía. La función solo la llamaban sus propias pruebas.
//
// Mientras tanto el tenant real de producción cita `flotademo.mx`,
// que responde NXDOMAIN, y el aviso simplificado se la manda al operador igual
// — junto con la respuesta ARCO, que apunta al mismo sitio.
//
// Es el mismo modo de falla que el flush de Sentry en operabilidad: mecanismo
// correcto, probado en aislamiento, sin cable. Por eso esta prueba mira EL
// CABLE.
// ═══════════════════════════════════════════════════════════════════════════

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const getDatosResponsable = vi.fn();
vi.mock('./repo', () => ({ getDatosResponsable }));

const sondearAvisoIntegral = vi.fn();
vi.mock('./privacidad', () => ({ sondearAvisoIntegral }));

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));

const { verificarAvisoDePrivacidad } = await import('./startup');

const RESPONSABLE = {
  razonSocial: 'Flota Demo SA de CV',
  domicilio: 'Av. Vallarta 1234, Guadalajara, Jalisco',
  urlAvisoIntegral: 'https://flotademo.mx/aviso-de-privacidad',
};

beforeEach(() => {
  logger.info.mockReset(); logger.warn.mockReset(); logger.error.mockReset();
  getDatosResponsable.mockReset(); sondearAvisoIntegral.mockReset();
  process.env.DEMO_TENANT_ID = '11111111-1111-1111-1111-111111111111';
});
afterEach(() => { delete process.env.DEMO_TENANT_ID; });

describe('el arranque comprueba que la liga del aviso EXISTE, no solo que esté bien escrita', () => {
  it('sonda la URL del tenant — antes esto no lo llamaba nadie', async () => {
    getDatosResponsable.mockResolvedValue(RESPONSABLE);
    sondearAvisoIntegral.mockResolvedValue({ abre: true });
    await verificarAvisoDePrivacidad();
    expect(sondearAvisoIntegral).toHaveBeenCalledWith(RESPONSABLE.urlAvisoIntegral);
  });

  it('con NXDOMAIN grita, en vez de dejar que el operador se tope con el error', async () => {
    // El caso REAL de producción el 28-jul-2026.
    getDatosResponsable.mockResolvedValue(RESPONSABLE);
    sondearAvisoIntegral.mockResolvedValue({ abre: false, motivo: 'fetch failed' });
    await verificarAvisoDePrivacidad();
    expect(logger.error).toHaveBeenCalledWith('startup.aviso_privacidad', expect.objectContaining({ motivo: 'fetch failed' }));
  });

  it('el aviso nombra el artículo y qué columna hay que corregir', async () => {
    getDatosResponsable.mockResolvedValue(RESPONSABLE);
    sondearAvisoIntegral.mockResolvedValue({ abre: false, motivo: 'http 404' });
    await verificarAvisoDePrivacidad();
    const msg = String(logger.error.mock.calls.at(-1)?.[1]?.msg ?? '');
    // Un diagnóstico que no dice qué tocar manda a alguien a buscar.
    expect(msg).toContain('url_aviso_privacidad');
    expect(msg).toMatch(/art\. 15|art\. 16|ARCO/);
  });

  it('si abre, lo dice y no ensucia el arranque', async () => {
    getDatosResponsable.mockResolvedValue(RESPONSABLE);
    sondearAvisoIntegral.mockResolvedValue({ abre: true });
    await verificarAvisoDePrivacidad();
    expect(logger.info).toHaveBeenCalledWith('startup.aviso_privacidad', { ok: true });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('sin razón social ni domicilio avisa de lo que de verdad bloquea', async () => {
    // `getDatosResponsable` devuelve null y el tratamiento se detiene en el
    // primer mensaje: eso es más grave que una liga rota y merece su propio texto.
    getDatosResponsable.mockResolvedValue(null);
    await verificarAvisoDePrivacidad();
    expect(sondearAvisoIntegral).not.toHaveBeenCalled();
    expect(String(logger.error.mock.calls.at(-1)?.[1]?.msg ?? '')).toContain('razon_social');
  });
});

describe('no puede tumbar el arranque', () => {
  it('un fallo de la consulta se degrada a warn, no a excepción', async () => {
    getDatosResponsable.mockImplementation(() => { throw new Error('fetch failed'); });
    await expect(verificarAvisoDePrivacidad()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('startup.aviso_privacidad_skip', expect.anything());
  });

  it('sin DEMO_TENANT_ID no hace nada: de esa ausencia ya avisa arranque.ts', async () => {
    delete process.env.DEMO_TENANT_ID;
    await verificarAvisoDePrivacidad();
    expect(getDatosResponsable).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
