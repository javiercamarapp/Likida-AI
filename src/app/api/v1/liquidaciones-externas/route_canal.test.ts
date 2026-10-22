import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LiquidacionExterna } from '@/lib/likida/liquidacion_externa/repo';

// POST /v1/liquidaciones-externas con el gate por canal (T-A1-17 + hallazgo MEDIO oct-2026): si la flota recibe el
// desglose por correo, el POST YA NO recibe nada — se rechaza con 400 ANTES de guardar (ver `route_correo_huerfana.test.ts`
// para el porqué: aceptarla dejaba la liquidación huérfana para siempre, sin WhatsApp y sin fila de correo). Sin config,
// `whatsapp` o `ambos`: el camino de siempre (se recibe y se intenta la entrega por WhatsApp).

vi.mock('@/app/api/v1/_comun', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, abrir: async () => ({ ok: true, tenantId: 't-1', rol: 'llave:administracion' }) };
});
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => { throw new Error('sin base en pruebas'); } }) }));

const fila = (): LiquidacionExterna => ({
  id: '11111111-1111-4111-8111-111111111111', tenantId: 't-1', claveExterna: 'SAP-1', huella: 'x'.repeat(64),
  sistemaOrigen: 'SAP', operadorId: 'o-1', operadorNombre: 'Operador Uno', operadorTelefono: '525512345678', // grep-limpio:ok
  foliosViaje: ['VJ-1'], viajeIds: ['v-1'], periodoDesde: '2026-09-01', periodoHasta: '2026-09-07',
  conceptos: [{ clave: null, descripcion: 'Sueldo', tipo: 'percepcion', monto: 100 }], total: 100, moneda: 'MXN',
  pdfRuta: 't-1/externas/SECRETA.pdf', pdfOrigen: 'generado', estado: 'pendiente', via: null, generacion: 1, intentos: 0,
  proximoIntentoEn: 'x', ultimoError: null, wamid: null, enviadaEn: null, acuseTipo: null, acuseEn: null, acuseConfirmadoEn: null,
  creadaEn: '2026-09-08T09:00:00.000Z',
});

const recibir = vi.fn(async (_t: string, _d: unknown, _h: string) => ({ liquidacion: fila() }));
const intentar = vi.fn(async (..._a: unknown[]) => 'en_cola');
let config: { ok: true; valor: { canal: string } } | { ok: false; motivo: string } | Error = { ok: true, valor: { canal: 'whatsapp' } };

vi.mock('@/lib/likida/liquidacion_externa/servicio', () => ({
  recibirLiquidacionExterna: (...a: [string, unknown, string]) => recibir(...a),
  intentarEntrega: (...a: unknown[]) => intentar(...a),
  // El guardia del endpoint general (hallazgo MEDIO, oct-2026) lee `dependenciasPorOmision.canalDeEntrega` antes de
  // crear: en esta prueba se simula con el MISMO `config` que ya controla `leerConfigCorreo` — no es la resolución
  // real (perfil + config; eso lo prueba `route_correo_huerfana.test.ts`), solo necesita devolver el canal del caso.
  dependenciasPorOmision: { canalDeEntrega: async () => (config instanceof Error ? 'whatsapp' : config.ok ? config.valor.canal : 'whatsapp') },
}));
vi.mock('@/lib/likida/liquidacion_externa/repo', async (orig) => ({
  ...(await orig<typeof import('@/lib/likida/liquidacion_externa/repo')>()),
  buscarPorClave: async () => null,
  leerPorId: async () => fila(),
}));
vi.mock('@/lib/likida/liquidacion_externa/repo_correo', async (orig) => ({
  ...(await orig<typeof import('@/lib/likida/liquidacion_externa/repo_correo')>()),
  leerConfigCorreo: async () => { if (config instanceof Error) throw config; return config; },
}));

const { POST } = await import('./route');
const { reiniciarIdempotencia } = await import('../_escritura');

const CUERPO = () => ({
  claveExterna: 'SAP-1', sistemaOrigen: 'SAP', operador: { telefono: '5512345678' }, viajes: ['VJ-1'], // grep-limpio:ok
  periodo: { desde: '2026-09-01', hasta: '2026-09-07' },
  conceptos: [{ descripcion: 'Sueldo', tipo: 'percepcion', monto: 100 }], total: 100, moneda: 'MXN',
});
const postear = () => POST(new Request('https://app.likida.ai/api/v1/liquidaciones-externas', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(CUERPO()),
}));

beforeEach(() => {
  recibir.mockClear(); intentar.mockClear(); reiniciarIdempotencia();
  config = { ok: true, valor: { canal: 'whatsapp' } };
});

describe('POST liquidaciones-externas: gate por canal', () => {
  it('canal correo ⇒ 400, NADA se recibió ni se intentó (el camino correcto es /desgloses)', async () => {
    config = { ok: true, valor: { canal: 'correo' } };
    const r = await postear();
    expect(r.status).toBe(400);
    const cuerpo = await r.json();
    expect(cuerpo.error.codigo).toBe('parametro_invalido');
    expect(recibir).not.toHaveBeenCalled();
    expect(intentar).not.toHaveBeenCalled();
  });

  it.each(['whatsapp', 'ambos'])('canal %s ⇒ se intenta la entrega como siempre', async (canal) => {
    config = { ok: true, valor: { canal } };
    expect((await postear()).status).toBe(201);
    expect(intentar).toHaveBeenCalledTimes(1);
  });

  it('sin la migración de config (no_disponible) ⇒ el camino de siempre', async () => {
    config = { ok: false, motivo: 'no_disponible' };
    expect((await postear()).status).toBe(201);
    expect(intentar).toHaveBeenCalledTimes(1);
  });

  it('si la lectura del canal falla, el POST no se cae: 201 y la entrega la decide `intentarEntrega`', async () => {
    config = new Error('base caída');
    expect((await postear()).status).toBe(201);
    expect(intentar).toHaveBeenCalledTimes(1);
  });
});
