import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/correo/enviar', () => ({ enviarCorreo: vi.fn() }));
vi.mock('../liquidacion_externa/entrega_correo', () => ({ enmascararCorreo: (c: string) => `${c[0]}***@${c.split('@')[1]}` }));

const M = await import('./aviso_correo');
const { enviarPorCanales, canalesAvisoPeajes } = await import('./aviso_canal');
import type { AvisoPeajes } from './aviso_canal';
import type { ConfigCorreoAvisos } from './aviso_correo';

const aviso: AvisoPeajes = {
  tenantId: 't1', tipo: 'plazo', resumen: 'cobros por vencer', liga: 'https://app.likida.ai/dashboard/agentes/peajes', clave: 'd1:30:2026-10-25',
  texto: '⏰ Peajes: 2 cobros sin reclamar ($500.00 en total) vence en 10 días. Es una señal para revisar, no afirma que el cobro sea indebido. Revísalo: https://app.likida.ai/dashboard/agentes/peajes',
};
const ENCENDIDO: ConfigCorreoAvisos = { activo: true, destinatarios: ['ana@flota.mx', 'beto@flota.mx'], asunto: null, noEnviarAntes: '2026-10-01' };
const sinEspera = async () => {};

const armar = (cfg: ConfigCorreoAvisos | null, respuestas: Array<Record<string, unknown>> = []) => {
  const enviar = vi.fn(async () => (respuestas.shift() ?? { ok: true, id: 'r1' }) as never);
  const canal = M.canalCorreoPeajes({ leerConfig: async () => cfg ?? M.CONFIG_CORREO_AVISOS_DEFAULT, enviar, esperar: sinEspera });
  return { canal, enviar };
};

beforeEach(() => vi.clearAllMocks());

describe('canalCorreoPeajes', () => {
  it('éxito: un correo sobrio por destinatario con llave de idempotencia estable y distinta por destinatario', async () => {
    const { canal, enviar } = armar(ENCENDIDO);
    expect(await enviarPorCanales([canal], aviso)).toBe('enviado');
    expect(enviar).toHaveBeenCalledTimes(2);
    const [[p1, c1, o1], [p2, , o2]] = enviar.mock.calls as unknown as Array<[string, { asunto: string; parrafos: string[] }, { sobrio: boolean; idempotencyKey: string }]>;
    expect([p1, p2]).toEqual(['ana@flota.mx', 'beto@flota.mx']);
    expect(o1.sobrio).toBe(true);
    expect(o1.idempotencyKey).toMatch(/^peajes:plazo:t1:d1:30:2026-10-25:[0-9a-f]{12}$/);
    expect(o1.idempotencyKey).not.toBe(o2.idempotencyKey);
    expect(c1.asunto).not.toMatch(/\$|\d{3}/); // el asunto no lleva importes
    expect(c1.parrafos[0]).not.toContain('⏰');
    expect(c1.parrafos[0]).not.toContain('https://');
    expect(c1.parrafos[0]).toContain('no afirma que el cobro sea indebido');
  });
  it('sin configuración (fail-cerrado): sin_destinatario y no se envía nada', async () => {
    const { canal, enviar } = armar(null);
    expect(await enviarPorCanales([canal], aviso)).toBe('sin_destinatario');
    expect(enviar).not.toHaveBeenCalled();
  });
  it('canal apagado aunque tenga destinatarios: no envía', async () => {
    const { canal, enviar } = armar({ ...ENCENDIDO, activo: false });
    expect(await enviarPorCanales([canal], aviso)).toBe('sin_destinatario');
    expect(enviar).not.toHaveBeenCalled();
  });
  it('encendido sin destinatarios: no envía', async () => {
    const { canal, enviar } = armar({ ...ENCENDIDO, destinatarios: [] });
    expect(await enviarPorCanales([canal], aviso)).toBe('sin_destinatario');
    expect(enviar).not.toHaveBeenCalled();
  });
  it('Resend sin configurar: fallido (jamás «enviado») y sin reintentos', async () => {
    const { canal, enviar } = armar(ENCENDIDO, [{ ok: false, motivo: 'sin_configurar' }, { ok: false, motivo: 'sin_configurar' }]);
    expect(await enviarPorCanales([canal], aviso)).toBe('fallido');
    expect(enviar).toHaveBeenCalledTimes(2); // un intento por destinatario
  });
  it('error transitorio del proveedor: reintento acotado y luego éxito', async () => {
    const { canal, enviar } = armar({ ...ENCENDIDO, destinatarios: ['ana@flota.mx'] }, [{ ok: false, motivo: 'rechazado', detalle: 'x', status: 503 }, { ok: false, motivo: 'rechazado', detalle: 'x', status: 429 }]);
    expect(await enviarPorCanales([canal], aviso)).toBe('enviado');
    expect(enviar).toHaveBeenCalledTimes(3);
  });
  it('error persistente: se detiene en el tope de intentos y es fallido', async () => {
    const fallo = () => ({ ok: false, motivo: 'rechazado', detalle: 'x', status: 500 });
    const { canal, enviar } = armar({ ...ENCENDIDO, destinatarios: ['ana@flota.mx'] }, [fallo(), fallo(), fallo(), fallo(), fallo()]);
    expect(await enviarPorCanales([canal], aviso)).toBe('fallido');
    expect(enviar).toHaveBeenCalledTimes(M.MAX_INTENTOS_CORREO_AVISO);
  });
  it('rechazo del destinatario (422): no se reintenta', async () => {
    const { canal, enviar } = armar({ ...ENCENDIDO, destinatarios: ['ana@flota.mx'] }, [{ ok: false, motivo: 'rechazado', detalle: 'x', status: 422 }]);
    expect(await enviarPorCanales([canal], aviso)).toBe('fallido');
    expect(enviar).toHaveBeenCalledTimes(1);
  });
  it('corte de red ambiguo sin llave de idempotencia: no se reintenta (podría duplicar)', async () => {
    const { canal, enviar } = armar({ ...ENCENDIDO, destinatarios: ['ana@flota.mx'] }, [{ ok: false, motivo: 'red', detalle: 'timeout' }]);
    expect(await enviarPorCanales([canal], { ...aviso, clave: undefined })).toBe('fallido');
    expect(enviar).toHaveBeenCalledTimes(1);
  });
  it('duplicado: el reintento de una pasada repite la MISMA llave (Resend no duplica) y no reenvía a quien ya aceptó con otra', async () => {
    const { canal, enviar } = armar(ENCENDIDO, [{ ok: true, id: 'a' }, { ok: false, motivo: 'rechazado', detalle: 'x', status: 422 }]);
    expect(await enviarPorCanales([canal], aviso)).toBe('fallido'); // uno salió, otro no: no se sella
    const llaves1 = (enviar.mock.calls as unknown as Array<[string, unknown, { idempotencyKey: string }]>).map((c) => c[2].idempotencyKey);
    const { canal: c2, enviar: e2 } = armar(ENCENDIDO);
    await enviarPorCanales([c2], aviso);
    const llaves2 = (e2.mock.calls as unknown as Array<[string, unknown, { idempotencyKey: string }]>).map((c) => c[2].idempotencyKey);
    expect(llaves2[0]).toBe(llaves1[0]);
    expect(llaves2[1]).toBe(llaves1[1]);
  });
  it('usa el asunto de la flota si lo configuró', async () => {
    const { canal, enviar } = armar({ ...ENCENDIDO, destinatarios: ['ana@flota.mx'], asunto: 'Avisos de peajes' });
    await enviarPorCanales([canal], aviso);
    expect((enviar.mock.calls[0] as unknown as [string, { asunto: string }])[1].asunto).toBe('Avisos de peajes');
  });
});

describe('presupuesto de tiempo y ruido', () => {
  it('con el presupuesto agotado no se siguen enviando intentos ni destinatarios (queda fallido y el sello se suelta)', async () => {
    let t = 0;
    const enviar = vi.fn(async () => { t += 20_000; return { ok: false, motivo: 'rechazado', status: 503 } as never; });
    const canal = M.canalCorreoPeajes({ leerConfig: async () => ENCENDIDO, enviar, esperar: sinEspera, reloj: () => t, presupuestoMs: 25_000 });
    expect(await enviarPorCanales([canal], aviso)).toBe('fallido');
    // 1.er intento (t=20 s) + espera de 1 s aún cabe; el 2.º llega a 40 s y corta: nunca los 3 intentos x 2 destinatarios.
    expect(enviar.mock.calls.length).toBeLessThan(6);
    expect(enviar.mock.calls.length).toBeLessThanOrEqual(2);
  });
  it('Resend sin configurar: un solo warn por proceso aunque pasen varios avisos', async () => {
    const { logger } = await import('@/lib/logger');
    const { canal } = armar(ENCENDIDO, Array.from({ length: 6 }, () => ({ ok: false, motivo: 'sin_configurar' })));
    await enviarPorCanales([canal], aviso);
    await enviarPorCanales([canal], aviso);
    const sinConf = (logger.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => c[0] === 'peajes.aviso_correo_sin_configurar');
    expect(sinConf).toHaveLength(1);
  });
  it('WhatsApp acepta y el correo falla: cuenta «enviado» (semántica «alguno», documentada) y el correo no se reintenta', async () => {
    const wa = { nombre: 'whatsapp', destinatario: async () => '5215500000000', enviar: vi.fn(async () => true) };
    const { canal, enviar } = armar(ENCENDIDO, Array.from({ length: 8 }, () => ({ ok: false, motivo: 'rechazado', status: 422 })));
    expect(await enviarPorCanales(canalesAvisoPeajes({ whatsapp: wa, correo: canal }), aviso)).toBe('enviado');
    expect(wa.enviar).toHaveBeenCalledTimes(1);
    expect(enviar).toHaveBeenCalledTimes(2); // un intento por destinatario, sin reintentos (422)
  });
});

describe('armarCorreoAviso', () => {
  it('datos parciales (solo emoji/puntuación o texto trunco): «sin datos», no un correo a medias', () => {
    expect(M.armarCorreoAviso({ ...aviso, texto: `⏰ Peajes: ${aviso.liga}` }, 'A').parrafos[0]).toMatch(/Sin datos/);
    expect(M.armarCorreoAviso({ ...aviso, texto: '⏰ 123 ...' }, 'A').parrafos[0]).toMatch(/Sin datos/);
  });
  it('sin datos: dice «sin datos», no acusa ni inventa', () => {
    const c = M.armarCorreoAviso({ ...aviso, texto: '  ' }, 'Asunto');
    expect(c.parrafos[0]).toMatch(/Sin datos/);
    expect(c.boton?.href).toBe(aviso.liga);
  });
  it('el recordatorio de archivo conserva su texto sin emoji ni liga', () => {
    const texto = '📎 Peajes: todavía no recibimos el archivo de cobros del 1 al 10 (2026-10-01 a 2026-10-10, mes 10). Mándalo por correo o súbelo directamente aquí, como te quede más fácil: https://x/p. Es un recordatorio; si ya lo enviaste, ignóralo.';
    const c = M.armarCorreoAviso({ ...aviso, tipo: 'recordatorio_archivo', texto, liga: 'https://x/p' }, 'A');
    expect(c.parrafos[0]).toMatch(/^Peajes: todavía no recibimos/);
    expect(c.parrafos[0]).not.toContain('https://');
    expect(c.parrafos[0]).toContain('ignóralo');
  });
});

describe('validarCorreoAvisos / correoAvisosEfectivo', () => {
  it('nace apagado y una fila corrupta no enciende nada', () => {
    expect(M.correoAvisosEfectivo(undefined)).toEqual(M.CONFIG_CORREO_AVISOS_DEFAULT);
    expect(M.correoAvisosEfectivo({ activo: true, destinatarios: ['no-es-correo'] }).activo).toBe(false);
    expect(M.correoAvisosEfectivo('basura').activo).toBe(false);
    // Una config encendida sin corte (guardada a mano) cae a apagado.
    expect(M.correoAvisosEfectivo({ activo: true, destinatarios: ['a@b.mx'] }).activo).toBe(false);
  });
  it('fila corrupta: el correo se apaga pero la fecha de corte válida se conserva (no se pierde el filtro de historial)', () => {
    expect(M.correoAvisosEfectivo({ activo: true, destinatarios: ['no-es-correo'], noEnviarAntes: '2026-10-01' })).toEqual({ ...M.CONFIG_CORREO_AVISOS_DEFAULT, noEnviarAntes: '2026-10-01' });
    expect(M.correoAvisosEfectivo({ activo: 'si', noEnviarAntes: 'mañana' }).noEnviarAntes).toBeNull();
  });
  it('rechaza lo inválido con mensaje llano y no encendido sin destinatarios', () => {
    expect(M.validarCorreoAvisos({ activo: true, destinatarios: [], noEnviarAntes: '2026-10-01' })).toMatchObject({ ok: false });
    // Encender sin fecha de corte reenviaría el historial: se rechaza (apagado sin corte sí se acepta).
    expect(M.validarCorreoAvisos({ activo: true, destinatarios: ['a@b.mx'] })).toMatchObject({ ok: false });
    expect(M.validarCorreoAvisos({ activo: true, destinatarios: ['a@b.mx'], noEnviarAntes: null })).toMatchObject({ ok: false });
    expect(M.validarCorreoAvisos({ activo: false, destinatarios: ['a@b.mx'] })).toMatchObject({ ok: true });
    expect(M.validarCorreoAvisos({ destinatarios: ['x'] })).toMatchObject({ ok: false });
    expect(M.validarCorreoAvisos({ destinatarios: ['a@b.mx'], noEnviarAntes: '15/10/2026' })).toMatchObject({ ok: false });
    expect(M.validarCorreoAvisos({ activo: true, destinatarios: Array.from({ length: 6 }, (_, i) => `u${i}@b.mx`) })).toMatchObject({ ok: false });
  });
  it('acepta, quita duplicados y sanea el asunto', () => {
    const v = M.validarCorreoAvisos({ activo: true, destinatarios: ['A@b.mx', 'a@B.mx'], asunto: 'Hola\nmundo', noEnviarAntes: '2026-10-01' });
    expect(v).toEqual({ ok: true, valor: { activo: true, destinatarios: ['A@b.mx'], asunto: 'Hola mundo', noEnviarAntes: '2026-10-01' } });
  });
});

describe('selección explícita de canales', () => {
  it('WhatsApp primero, correo después; cada flota recibe por los que tienen destinatario', async () => {
    const wa = { nombre: 'whatsapp', destinatario: async () => null, enviar: vi.fn(async () => true) };
    const { canal } = armar(ENCENDIDO);
    const canales = canalesAvisoPeajes({ whatsapp: wa, correo: canal });
    expect(canales.map((c) => c.nombre)).toEqual(['whatsapp', 'correo']);
    expect(await enviarPorCanales(canales, aviso)).toBe('enviado'); // solo correo tenía destinatario
    expect(wa.enviar).not.toHaveBeenCalled();
  });
});
