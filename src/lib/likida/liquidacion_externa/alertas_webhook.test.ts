import { describe, expect, it, vi } from 'vitest';
import {
  correrAlertasWebhookLiq, evaluarFallosWebhook, evaluarSilencioWebhook, evaluarTokenWebhook, horasHabilesEntre,
  resumenWebhookParaHealth, webhookLiqDeDetalle, type DetalleWebhookLiq,
} from './alertas_webhook';
import type { SenalesWebhookLiq } from '../repo';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// Series SINTÉTICAS. México = UTC-6: 14:00 UTC = 08:00 local.
const lunes8 = Date.UTC(2026, 10, 9, 14, 0, 0); // lunes 9-nov-2026, 08:00 MX
const AHORA = lunes8 + 3 * 86_400_000 + 4 * 3_600_000; // jueves 12:00 MX
const ENV = {} as unknown as NodeJS.ProcessEnv;
const senales = (o: Partial<SenalesWebhookLiq> = {}): SenalesWebhookLiq => ({
  ultimaPorTenant: [{ tenantId: '9f62ddca-0000-0000-0000-000000000000', ultima: new Date(AHORA - 3_600_000).toISOString() }],
  rechazos: { cincoxx: 0, otros: 0 }, llavesInvalidas: 0, ...o,
});

describe('horasHabilesEntre', () => {
  it('cuenta solo lun-vie 8-18 hora de México', () => {
    expect(horasHabilesEntre(lunes8, lunes8 + 4 * 3_600_000)).toBe(4);
    expect(horasHabilesEntre(lunes8, lunes8 + 86_400_000)).toBe(10); // un día entero = 10 h
  });
  it('el fin de semana y la noche no cuentan', () => {
    const viernes17 = Date.UTC(2026, 10, 13, 23, 0, 0); // vie 17:00 MX
    const lunes9 = Date.UTC(2026, 10, 16, 15, 0, 0); // lun 09:00 MX
    expect(horasHabilesEntre(viernes17, lunes9)).toBe(2); // 1 h del viernes + 1 h del lunes
  });
  it('rango invertido o vacío es 0', () => {
    expect(horasHabilesEntre(AHORA, AHORA)).toBe(0);
    expect(horasHabilesEntre(AHORA, AHORA - 1)).toBe(0);
  });
});

describe('reglas puras', () => {
  it('fallos: 3 respuestas 5xx o 10 rechazos alertan; menos no; sin lectura es sin_medir', () => {
    expect(evaluarFallosWebhook({ cincoxx: 3, otros: 0 }).estado).toBe('alerta');
    expect(evaluarFallosWebhook({ cincoxx: 0, otros: 10 }).estado).toBe('alerta');
    expect(evaluarFallosWebhook({ cincoxx: 2, otros: 9 }).estado).toBe('ok');
    expect(evaluarFallosWebhook(null).estado).toBe('sin_medir');
  });
  it('token: 5 llaves inválidas alertan', () => {
    expect(evaluarTokenWebhook(5).estado).toBe('alerta');
    expect(evaluarTokenWebhook(4).estado).toBe('ok');
    expect(evaluarTokenWebhook(null).estado).toBe('sin_medir');
  });
  it('silencio: nunca ha recibido (llave sin uso) NO alerta', () => {
    expect(evaluarSilencioWebhook([], AHORA)).toMatchObject({ estado: 'sin_uso', flotas: [] });
  });
  it('silencio: 20 horas hábiles sin recepción alertan; menos no', () => {
    const hace = (h: number) => new Date(AHORA - h * 3_600_000).toISOString();
    expect(evaluarSilencioWebhook([{ tenantId: 'aaaaaaaa-1', ultima: hace(2) }], AHORA).estado).toBe('ok');
    // lunes 8:00 → jueves 12:00 = 3 días hábiles completos + 4 h = 34 h hábiles
    const r = evaluarSilencioWebhook([{ tenantId: 'aaaaaaaa-1', ultima: new Date(lunes8).toISOString() }], AHORA);
    expect(r).toMatchObject({ estado: 'alerta', flotas: [{ flota: 'aaaaaaaa', horasHabiles: 34 }] });
  });
  it('silencio: sin lectura es sin_medir', () => {
    expect(evaluarSilencioWebhook(null, AHORA).estado).toBe('sin_medir');
  });
});

describe('correrAlertasWebhookLiq', () => {
  const corre = (s: SenalesWebhookLiq, previo: DetalleWebhookLiq | null = null, avisar = vi.fn(async (..._a: unknown[]) => true), env = ENV) =>
    correrAlertasWebhookLiq(AHORA, previo, { leer: async () => s, avisar, toca: () => true, env }).then((r) => ({ r, avisar }));

  it('apagado por bandera y omitido fuera de turno no leen nada', async () => {
    const leer = vi.fn();
    expect((await correrAlertasWebhookLiq(AHORA, null, { leer, env: { ALERTAS_WEBHOOK_LIQ: 'apagado' } as unknown as NodeJS.ProcessEnv })).estado).toBe('apagado');
    expect((await correrAlertasWebhookLiq(AHORA, null, { leer, toca: () => false, env: ENV })).estado).toBe('omitido');
    expect(leer).not.toHaveBeenCalled();
  });
  it('todo sano no avisa', async () => {
    const { r, avisar } = await corre(senales());
    expect(r.estado).toBe('ok');
    expect(avisar).not.toHaveBeenCalled();
  });
  it('5xx repetidos avisan una vez y no repiten mientras siga y ya avisó', async () => {
    const { r, avisar } = await corre(senales({ rechazos: { cincoxx: 4, otros: 0 } }));
    expect(avisar).toHaveBeenCalledTimes(1);
    expect(avisar.mock.calls[0]![0]).toBe('guardia.webhook_liq_fallos');
    expect(r.detalle!.avisado.fallos).toBe(true);
    const otra = await corre(senales({ rechazos: { cincoxx: 6, otros: 0 } }), r.detalle!);
    expect(otra.avisar).not.toHaveBeenCalled();
  });
  it('sin canal (avisar=false) la alerta queda sin avisar y se reintenta en la siguiente pasada', async () => {
    const sinCanal = vi.fn(async (..._a: unknown[]) => false);
    const { r } = await corre(senales({ llavesInvalidas: 9 }), null, sinCanal);
    expect(r.detalle!.avisado.token).toBe(false);
    expect(resumenWebhookParaHealth({ webhookLiq: r.detalle }, ENV)).toMatchObject({ estado: 'alerta', alertas: ['token'], sinAvisar: true });
    const luego = await corre(senales({ llavesInvalidas: 9 }), r.detalle!, vi.fn(async (..._a: unknown[]) => true));
    expect(luego.avisar).toHaveBeenCalledTimes(1);
    expect(luego.r.detalle!.avisado.token).toBe(true);
  });
  it('el silencio avisa con las horas hábiles y sin el uuid completo de la flota', async () => {
    const { avisar } = await corre(senales({ ultimaPorTenant: [{ tenantId: '9f62ddca-53bd-4f00-9da5-452ad9cb4bf6', ultima: new Date(lunes8).toISOString() }] }));
    const [evento, d] = avisar.mock.calls[0]! as unknown as [string, Record<string, string>];
    expect(evento).toBe('guardia.webhook_liq_silencio');
    expect(d.error).toContain('flota 9f62ddca lleva 34 h hábiles');
    expect(d.error).not.toContain('53bd');
  });
  it('una lectura caída es sin_medir y no avisa', async () => {
    const { r, avisar } = await corre(senales({ rechazos: null, llavesInvalidas: null, ultimaPorTenant: null }));
    expect(r.detalle).toMatchObject({ fallos: { estado: 'sin_medir' }, token: { estado: 'sin_medir' }, silencio: { estado: 'sin_medir' } });
    expect(avisar).not.toHaveBeenCalled();
  });
  it('si la lectura lanza, devuelve error y no lanza', async () => {
    const r = await correrAlertasWebhookLiq(AHORA, null, { leer: async () => { throw new Error('caída'); }, toca: () => true, env: ENV });
    expect(r).toMatchObject({ estado: 'error' });
  });
});

describe('resumenWebhookParaHealth', () => {
  it('sin detalle es sin_datos y refleja los canales', () => {
    expect(resumenWebhookParaHealth(null, { ALERTA_EMAIL: 'x@y.z' } as unknown as NodeJS.ProcessEnv))
      .toMatchObject({ estado: 'sin_datos', canal: { correo: true, whatsapp: false } });
  });
  it('sin_uso mientras la llave no se haya usado', async () => {
    const { r } = await (async () => ({ r: await correrAlertasWebhookLiq(AHORA, null, { leer: async () => senales({ ultimaPorTenant: [] }), toca: () => true, env: ENV, avisar: async () => true }) }))();
    expect(resumenWebhookParaHealth({ webhookLiq: r.detalle }, ENV).estado).toBe('sin_uso');
  });
  it('webhookLiqDeDetalle rechaza formas ajenas', () => {
    expect(webhookLiqDeDetalle({ webhookLiq: { fallos: { estado: 'x' } } })).toBeNull();
    expect(webhookLiqDeDetalle(null)).toBeNull();
  });
});
