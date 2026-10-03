import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// /estado — los datos: lo que la guardia dejó, sin inventar un «operativo».
// ═══════════════════════════════════════════════════════════════════════════

let latido: { ultimoLatido: string; estado: string; detalle: Record<string, unknown> } | null | 'roto' = null;
let historial: unknown[] | 'roto' = [];
const leerLatido = vi.fn(async () => { if (latido === 'roto') throw new Error('x'); return latido; });
const leerEstado30Dias = vi.fn(async () => { if (historial === 'roto') throw new Error('x'); return historial; });
vi.mock('@/lib/admin/salud', () => ({
  COMPONENTES_ESTADO: ['app', 'base', 'crons', 'whatsapp', 'correo'],
  CADENCIA_MS: { guardia: 300_000 },
  leerLatido: () => leerLatido(),
  leerEstado30Dias: () => leerEstado30Dias(),
}));

const { armarEstadoPublico, componentesDeDetalle, cargarEstadoPublico, estadoMemoizado, olvidarEstadoMemoizado, VIGENCIA_MEDICION_MS, TTL_FALLO_MS } = await import('./datos');

const AHORA = Date.parse('2026-10-03T12:00:00Z');
const hace = (ms: number) => new Date(AHORA - ms).toISOString();

beforeEach(() => { latido = null; historial = []; leerLatido.mockClear(); leerEstado30Dias.mockClear(); olvidarEstadoMemoizado(); });

describe('armarEstadoPublico', () => {
  it('con un latido reciente, el estado actual sale de `detalle.componentes`', () => {
    const e = armarEstadoPublico({ ultimoLatido: hace(60_000), detalle: { componentes: { app: 'ok', base: 'caido', crons: null, whatsapp: 'degradado', correo: 'raro' } } }, [], AHORA);
    expect(e.reciente).toBe(true);
    expect(e.actual).toEqual({ app: 'ok', base: 'caido', crons: null, whatsapp: 'degradado', correo: null });
  });

  it('un latido VIEJO no se enseña como estado actual (tres cadencias de vigencia)', () => {
    expect(VIGENCIA_MEDICION_MS).toBe(900_000);
    const e = armarEstadoPublico({ ultimoLatido: hace(VIGENCIA_MEDICION_MS + 1000), detalle: { componentes: { app: 'ok' } } }, [], AHORA);
    expect(e.reciente).toBe(false);
    expect(Object.values(e.actual).every((v) => v === null)).toBe(true);
    expect(e.ultimaMedicion).not.toBeNull();
  });

  it('sin latido (nunca latió): sin medición, y NO es lo mismo que ilegible', () => {
    const e = armarEstadoPublico(null, [], AHORA);
    expect(e).toMatchObject({ reciente: false, ultimaMedicion: null, latidoIlegible: false, historialIlegible: false });
    expect(armarEstadoPublico(undefined, null, AHORA)).toMatchObject({ latidoIlegible: true, historialIlegible: true });
  });

  it('el historial entra por componente y los días sin medición no son verdes', () => {
    const e = armarEstadoPublico(null, [{ componente: 'app', dia: '2026-10-03', muestras: 10, ok: 10, degradadas: 0, caidas: 0 }], AHORA);
    const app = e.resumen.find((r) => r.componente === 'app')!;
    expect(app.dias[29].celda).toBe('ok');
    expect(app.dias.filter((d) => d.celda === 'sin_medicion')).toHaveLength(29);
    expect(e.resumen.find((r) => r.componente === 'correo')!.disponibilidadPct).toBeNull();
  });
});

describe('componentesDeDetalle', () => {
  it('basura → todo null', () => {
    for (const x of [null, undefined, 'x', 3, {}, { componentes: 'x' }, { componentes: { app: 7, base: {} } }]) {
      expect(Object.values(componentesDeDetalle(x)).every((v) => v === null)).toBe(true);
    }
  });
});

describe('cargarEstadoPublico', () => {
  it('memoiza 60 s (una página pública no es un amplificador de consultas)', async () => {
    latido = { ultimoLatido: hace(1000), estado: 'ok', detalle: {} };
    await cargarEstadoPublico(AHORA);
    await cargarEstadoPublico(AHORA + 30_000);
    expect(leerLatido).toHaveBeenCalledTimes(1);
    await cargarEstadoPublico(AHORA + 61_000);
    expect(leerLatido).toHaveBeenCalledTimes(2);
  });

  it('M3 (ronda 19): una lectura rota se DICE y se memoiza poco (12 s): la base caída no recibe 2 consultas por visita', async () => {
    latido = 'roto'; historial = 'roto';
    const e = await cargarEstadoPublico(AHORA);
    expect(e).toMatchObject({ latidoIlegible: true, historialIlegible: true });
    for (let i = 1; i <= 20; i++) await cargarEstadoPublico(AHORA + i * 100); // 20 visitas en 2 s
    expect(leerLatido).toHaveBeenCalledTimes(1);
    expect(leerEstado30Dias).toHaveBeenCalledTimes(1);
    expect(estadoMemoizado()).toMatchObject({ latidoIlegible: true });
    // pasada la ventana corta se reintenta y, si la base volvió, la página se recupera sola
    latido = null; historial = [];
    const e2 = await cargarEstadoPublico(AHORA + TTL_FALLO_MS + 1);
    expect(e2.latidoIlegible).toBe(false);
    expect(leerLatido).toHaveBeenCalledTimes(2);
  });

  it('estadoMemoizado no toca la base: sin lectura previa es null', () => {
    expect(estadoMemoizado()).toBeNull();
    expect(leerLatido).not.toHaveBeenCalled();
  });
});
