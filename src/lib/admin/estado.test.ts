import { describe, it, expect, vi } from 'vitest';
import {
  leerCuerpoHealth, componentesDesdeHealth, componentesDesdeLatidos, sondearHealth,
  esVentanaDeMantenimiento, resumirEstado, ultimosDias, diaMx, medicionVacia,
} from './estado';
import type { DiaEstado } from './salud';

// ═══════════════════════════════════════════════════════════════════════════
// /estado — la lógica pura: de lo medido a un estado, SIN inventar verdes.
// ═══════════════════════════════════════════════════════════════════════════

const cuerpoOk = { ok: true, status: 'ok', checks: { db: 'ok', crons: 'ok' }, migracion: { atras: 0, adelante: 0 } };

describe('leerCuerpoHealth / componentesDesdeHealth', () => {
  it('un health sano deja app, base y crons en ok', () => {
    expect(componentesDesdeHealth(leerCuerpoHealth(200, cuerpoOk))).toEqual({ app: 'ok', base: 'ok', crons: 'ok' });
  });

  it('base caída: la app SIRVIÓ (ok) y la base es la que cae', () => {
    const h = leerCuerpoHealth(503, { status: 'fail', checks: { db: 'fallo', crons: 'unknown' } });
    expect(componentesDesdeHealth(h)).toEqual({ app: 'ok', base: 'caido', crons: 'degradado' });
  });

  it('un cron muerto degrada «crons», no tumba la app ni la base', () => {
    const h = leerCuerpoHealth(503, { status: 'degraded', checks: { db: 'ok', crons: 'degraded' }, migracion: { atras: 0, adelante: 0 } });
    expect(componentesDesdeHealth(h)).toEqual({ app: 'ok', base: 'ok', crons: 'degradado' });
  });

  it('un hueco de configuración DECLARADO (config_ausente) no cuenta como cron caído', () => {
    const h = leerCuerpoHealth(200, { ...cuerpoOk, checks: { db: 'ok', crons: 'config_ausente' } });
    expect(componentesDesdeHealth(h).crons).toBe('ok');
  });

  it('esquema desfasado del código (migración atrás o adelante): la app queda degradada', () => {
    for (const mig of [{ atras: 2, adelante: 0 }, { atras: 0, adelante: 1 }]) {
      expect(componentesDesdeHealth(leerCuerpoHealth(503, { ...cuerpoOk, status: 'degraded', migracion: mig })).app).toBe('degradado');
    }
  });

  it('sin respuesta (red, DNS, timeout): la app está caída y NO se inventa nada de base ni crons', () => {
    const h = { respondio: false, httpStatus: null, status: null, db: null, crons: null, migracionAlDia: null } as const;
    expect(componentesDesdeHealth(h)).toEqual({ app: 'caido', base: null, crons: null });
  });

  it('un 502 sin cuerpo legible es app caída; un 429 (rate limit) NO es una medición', () => {
    expect(componentesDesdeHealth(leerCuerpoHealth(502, null)).app).toBe('caido');
    expect(componentesDesdeHealth(leerCuerpoHealth(429, { ok: false, status: 'fail', error: 'demasiadas peticiones' }))).toEqual({ app: null, base: null, crons: null });
  });

  it('un cuerpo con forma rara no revienta ni inventa: lo que no se lee queda null', () => {
    const h = leerCuerpoHealth(200, { status: 7, checks: 'x', migracion: [] });
    expect(h).toMatchObject({ status: null, db: null, crons: null, migracionAlDia: null });
    expect(componentesDesdeHealth(h)).toEqual({ app: 'ok', base: null, crons: null });
  });
});

describe('sondearHealth', () => {
  it('lee el JSON de la respuesta y manda el timeout y cache: no-store', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(cuerpoOk), { status: 200 }));
    const s = await sondearHealth('https://app.likida.ai/api/health', f as unknown as typeof fetch);
    expect(s).toMatchObject({ respondio: true, httpStatus: 200, db: 'ok', crons: 'ok', migracionAlDia: true });
    expect(f).toHaveBeenCalledWith('https://app.likida.ai/api/health', expect.objectContaining({ cache: 'no-store', signal: expect.anything() }));
  });
  it('un fetch que lanza NO lanza: es un dato (respondio false)', async () => {
    const f = vi.fn(async () => { throw new Error('ETIMEDOUT'); });
    expect((await sondearHealth('https://x', f as unknown as typeof fetch)).respondio).toBe(false);
  });
  it('una respuesta que no es JSON se juzga por su status', async () => {
    const f = vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 }));
    const s = await sondearHealth('https://x', f as unknown as typeof fetch);
    expect(s).toMatchObject({ respondio: true, httpStatus: 502, status: null });
    expect(componentesDesdeHealth(s).app).toBe('caido');
  });
});

describe('componentesDesdeLatidos', () => {
  const ok = { estado: 'ok', ultimoEstado: 'ok' } as const;
  it('whatsapp: los dos latidos al día = ok; uno vencido = caído; uno en fallo = degradado', () => {
    expect(componentesDesdeLatidos({ 'wa-pendientes': ok, 'wa-outbox': ok }, true).whatsapp).toBe('ok');
    expect(componentesDesdeLatidos({ 'wa-pendientes': ok, 'wa-outbox': { estado: 'vencido', ultimoEstado: 'ok' } }, true).whatsapp).toBe('caido');
    expect(componentesDesdeLatidos({ 'wa-pendientes': { estado: 'ok', ultimoEstado: 'fallo' }, 'wa-outbox': ok }, true).whatsapp).toBe('degradado');
  });
  it('un latido que falta o nunca latió NO se mide (null), no se llama ok', () => {
    expect(componentesDesdeLatidos({ 'wa-pendientes': ok }, true).whatsapp).toBeNull();
    expect(componentesDesdeLatidos({ 'wa-pendientes': ok, 'wa-outbox': { estado: 'sin_latido', ultimoEstado: null } }, true).whatsapp).toBeNull();
  });
  it('apagado a propósito (saltado) no es una medición', () => {
    expect(componentesDesdeLatidos({ 'wa-pendientes': ok, 'wa-outbox': { estado: 'ok', ultimoEstado: 'saltado' } }, true).whatsapp).toBeNull();
  });
  it('correo: sin canal configurado NO se mide (no se juzga lo que no existe); con canal, por el latido de buzon-entrega', () => {
    expect(componentesDesdeLatidos({ 'buzon-entrega': ok }, false).correo).toBeNull();
    expect(componentesDesdeLatidos({ 'buzon-entrega': ok }, true).correo).toBe('ok');
    expect(componentesDesdeLatidos({ 'buzon-entrega': { estado: 'vencido', ultimoEstado: 'ok' } }, true).correo).toBe('caido');
  });
  it('medicionVacia: todo null (la guardia solo escribe lo que midió)', () => {
    expect(Object.values(medicionVacia()).every((v) => v === null)).toBe(true);
  });
});

describe('esVentanaDeMantenimiento (3:00–3:04 hora de la Ciudad de México)', () => {
  it('cae una sola vez al día', () => {
    // 3:02 MX = 09:02 UTC (CST, UTC-6; México no usa horario de verano desde 2022)
    expect(esVentanaDeMantenimiento(Date.parse('2026-10-03T09:02:00Z'))).toBe(true);
    expect(esVentanaDeMantenimiento(Date.parse('2026-10-03T09:05:00Z'))).toBe(false);
    expect(esVentanaDeMantenimiento(Date.parse('2026-10-03T10:02:00Z'))).toBe(false);
    expect(esVentanaDeMantenimiento(Date.parse('2026-10-03T08:59:00Z'))).toBe(false);
  });
});

describe('la vista de 30 días', () => {
  const f = (componente: DiaEstado['componente'], dia: string, muestras: number, degradadas = 0, caidas = 0): DiaEstado =>
    ({ componente, dia, muestras, ok: muestras - degradadas - caidas, degradadas, caidas });

  it('ultimosDias: 30 días corridos terminando hoy, del más antiguo al más nuevo (cruza fin de mes)', () => {
    const d = ultimosDias('2026-10-03');
    expect(d).toHaveLength(30);
    expect(d[0]).toBe('2026-09-04');
    expect(d[29]).toBe('2026-10-03');
  });

  it('diaMx usa la fecha de México (a las 02:00 UTC todavía es el día anterior)', () => {
    expect(diaMx(Date.parse('2026-10-03T02:00:00Z'))).toBe('2026-10-02');
    expect(diaMx(Date.parse('2026-10-03T07:00:00Z'))).toBe('2026-10-03');
  });

  it('los días sin fila son «sin medición» — NUNCA verde', () => {
    const [app] = resumirEstado([f('app', '2026-10-03', 288)], ['app'], '2026-10-03');
    expect(app.dias[29].celda).toBe('ok');
    expect(app.dias.slice(0, 29).every((d) => d.celda === 'sin_medicion')).toBe(true);
    expect(app.diasMedidos).toBe(1);
  });

  it('la disponibilidad es (mediciones − caídas) ÷ mediciones; degradado NO cuenta como caída; una caída pinta el día', () => {
    const [app] = resumirEstado([f('app', '2026-10-01', 100, 10, 0), f('app', '2026-10-02', 100, 0, 5)], ['app'], '2026-10-03');
    expect(app.muestras).toBe(200);
    expect(app.disponibilidadPct).toBe(97.5);
    expect(app.dias.find((d) => d.dia === '2026-10-01')?.celda).toBe('degradado');
    expect(app.dias.find((d) => d.dia === '2026-10-02')?.celda).toBe('caido');
  });

  it('un componente sin una sola medición: disponibilidad null (no 100 %, no 0 %)', () => {
    const [c] = resumirEstado([f('app', '2026-10-03', 10)], ['correo'], '2026-10-03');
    expect(c.disponibilidadPct).toBeNull();
    expect(c.muestras).toBe(0);
  });

  it('ignora los días fuera de la ventana de 30', () => {
    const [app] = resumirEstado([f('app', '2026-08-01', 100, 0, 100)], ['app'], '2026-10-03');
    expect(app.muestras).toBe(0);
  });
});
