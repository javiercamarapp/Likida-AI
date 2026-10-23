import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LiquidacionExterna } from './repo';
import type { EntregaWhatsApp } from './entrega';
import type { LectorDesglosesPuerto } from './desglose_puerto';
import type { ResultadoPull } from './pull_desglose';
import type { ResumenEntregasCorreo } from './entrega_correo';

// Fases de la pasada del cron (T-A1-19): (1) pull, (2) entregas por correo, (3) WhatsApp de siempre. Cada fase aislada.

const orden: string[] = [];
vi.mock('./repo', async (orig) => ({
  ...(await orig<typeof import('./repo')>()),
  transicionar: vi.fn(async () => true),
  registrarEvento: vi.fn(async () => undefined),
  leerPorId: vi.fn(async () => null),
  firmarPdfExterno: vi.fn(async () => 'https://firmada'),
}));
vi.mock('./trabajo', () => ({
  trabajoPendiente: vi.fn(async () => { orden.push('whatsapp'); return trabajo; }),
  avisosPendientes: vi.fn(async () => []),
  candidatasHuerfanaCorreo: vi.fn(async () => []),
  flotasConEnvioActivo: vi.fn(async () => []),
}));
vi.mock('../presupuesto', async (orig) => ({ ...(await orig<typeof import('../presupuesto')>()), acotada: (q: unknown) => q }));
const logError = vi.fn();
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: (...a: unknown[]) => logError(...a) } }));

const { procesarLiquidacionesExternas, dependenciasPorOmision, LOTE_CORREO } = await import('./servicio');
const { LIMITE_POR_PASADA } = await import('./entrega_correo');

let trabajo: LiquidacionExterna[] = [];
const enviar = vi.fn(async (..._a: unknown[]) => ({ estado: 'en_cola' as const, via: 'sesion' as const }));
const entrega = { enviarConFallback: (...a: unknown[]) => enviar(...a) } as unknown as EntregaWhatsApp;
const lector = {} as LectorDesglosesPuerto;
const correoOk: ResumenEntregasCorreo = { reclamadas: 2, enviadas: 2, reintentar: 0, fallidas: 0, sinConfigurar: 0, fueraDeVentana: 0, apagada: 0, sinConfirmar: 0, errores: 0 };
const pullOk = (p: Partial<ResultadoPull> = {}): ResultadoPull => ({
  estado: 'ok', paginas: 1, leidas: 3, importadas: 2, excepciones: 1, resueltas: 0, marcadas: 0, marcasFallidas: 0, hayMas: false, cursor: null, ...p,
});
const base = {
  entrega, ahora: () => new Date('2026-09-08T12:00:00.000Z'), razonSocial: async () => 'Flota SA',
  firmarPdf: async () => 'https://firmada.example/x.pdf',
  avisarNoCoincide: vi.fn(async () => ({ destinatarios: [], aceptados: [] })),
  formato: async () => null, subirArchivo: async () => undefined,
  copiarAJefe: vi.fn(async () => ({ estado: 'sin_destinatarios' as const })),
};

beforeEach(() => { orden.length = 0; trabajo = []; enviar.mockClear(); logError.mockClear(); });

describe('procesarLiquidacionesExternas: fases de pull y correo', () => {
  it('orden: pull, luego correo, luego WhatsApp; el resumen trae los contadores `pull` y `correo`', async () => {
    const r = await procesarLiquidacionesExternas({
      ...base,
      lectoresPull: async () => [{ tenantId: 't-1', lector }, { tenantId: 't-2', lector }],
      pullDeFlota: vi.fn(async (t: string) => { orden.push(`pull:${t}`); return pullOk(); }),
      entregasCorreo: vi.fn(async () => { orden.push('correo'); return correoOk; }),
    }, 10);
    expect(orden).toEqual(['pull:t-1', 'pull:t-2', 'correo', 'whatsapp']);
    expect(r.pull).toEqual({ flotas: 2, leidas: 6, importadas: 4, excepciones: 2, errores: 0 });
    expect(r.correo).toEqual(correoOk);
  });

  it('una fase de pull que lanza NO tumba el correo ni WhatsApp, y queda contada como error sin datos personales', async () => {
    const entregasCorreo = vi.fn(async () => correoOk);
    const r = await procesarLiquidacionesExternas({
      ...base,
      lectoresPull: async () => [{ tenantId: 't-1', lector }, { tenantId: 't-2', lector }],
      pullDeFlota: vi.fn(async (t: string) => { if (t === 't-1') throw new Error('operador@ejemplo.test'); return pullOk(); }),
      entregasCorreo,
    }, 10);
    expect(entregasCorreo).toHaveBeenCalledTimes(1);
    expect(orden).toContain('whatsapp');
    expect(r.pull).toMatchObject({ flotas: 2, importadas: 2, errores: 1, error: 'Error' });
    expect(JSON.stringify(r)).not.toContain('@');
  });

  it('el pull con estado `error` de una flota cuenta como error; `no_disponible` no', async () => {
    const r = await procesarLiquidacionesExternas({
      ...base,
      lectoresPull: async () => [{ tenantId: 't-1', lector }, { tenantId: 't-2', lector }],
      pullDeFlota: vi.fn(async (t: string) => (t === 't-1' ? pullOk({ estado: 'error', error: 'TmsNoDisponible: x' }) : pullOk({ estado: 'no_disponible', leidas: 0, importadas: 0, excepciones: 0 }))),
      entregasCorreo: async () => correoOk,
    }, 10);
    expect(r.pull).toMatchObject({ errores: 1, error: 'TmsNoDisponible: x' });
  });

  it('si no se pueden obtener los lectores, es error de pull y lo demás sigue', async () => {
    const r = await procesarLiquidacionesExternas({
      ...base, lectoresPull: async () => { throw new Error('base caída'); }, entregasCorreo: async () => correoOk,
    }, 10);
    expect(r.pull).toMatchObject({ flotas: 0, errores: 1 });
    expect(r.correo).toEqual(correoOk);
    expect(orden).toContain('whatsapp');
  });

  it('una fase de correo que lanza NO tumba WhatsApp y deja `errores: 1` para que el cron diga parcial', async () => {
    trabajo = [];
    const r = await procesarLiquidacionesExternas({
      ...base, entregasCorreo: async () => { throw new Error('resend caído'); },
    }, 10);
    expect(r.correo).toMatchObject({ errores: 1, enviadas: 0 });
    expect(orden).toEqual(['whatsapp']);
    expect(logError).toHaveBeenCalled();
  });

  it('el resumen de correo conserva `sinConfigurar` (el cron lo trata como parcial)', async () => {
    const r = await procesarLiquidacionesExternas({
      ...base, entregasCorreo: async () => ({ ...correoOk, sinConfigurar: 3 }),
    }, 10);
    expect(r.correo?.sinConfigurar).toBe(3);
  });

  it('el lote de correo se acota a LIMITE_POR_PASADA (25) aunque el lote de WhatsApp sea de 50', async () => {
    const entregasCorreo = vi.fn(async (_l: number) => correoOk);
    await procesarLiquidacionesExternas({ ...base, entregasCorreo }, 50);
    expect(entregasCorreo).toHaveBeenCalledWith(LOTE_CORREO);
    expect(LOTE_CORREO).toBe(LIMITE_POR_PASADA);
    expect(LOTE_CORREO).toBeLessThanOrEqual(25);
  });

  it('sin las fases en deps, el resumen queda como siempre (sin `pull` ni `correo`)', async () => {
    const r = await procesarLiquidacionesExternas(base, 10);
    expect(r).not.toHaveProperty('pull');
    expect(r).not.toHaveProperty('correo');
  });

  it('por omisión: las fases están cableadas y el pull sin conector no lee a nadie', async () => {
    expect(dependenciasPorOmision.entregasCorreo).toBeTypeOf('function');
    expect(await dependenciasPorOmision.lectoresPull()).toEqual([]);
  });
});
