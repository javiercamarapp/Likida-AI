import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BITACORA_MUESTRA, PADRON_MUESTRA } from '@/lib/likida/liquidacion_externa/desglose_muestra_tms.fixture';

// Simulación del 14-nov-2026: 70 bitácoras reales tardaban ~40 s con 40 ms de latencia por consulta porque la ruta procesaba EN SERIE
// (una bitácora hace ~12 consultas). Ahora se procesan unas cuantas a la vez. Contrato que se prueba aquí:
//   1. Hay paralelismo acotado (más de 1 y nunca más del tope) y el tiempo de un lote de 70 deja de ser la suma de las partes.
//   2. La respuesta conserva el orden del lote (resultados y excepciones) aunque las bitácoras terminen desordenadas.
//   3. Una falla de infraestructura sigue siendo 500 y deja de repartir trabajo nuevo.
//   4. La configuración de la flota se lee UNA vez por petición, no una por bitácora.

const abrir = vi.fn(async (): Promise<Record<string, unknown>> => ({ ok: true, tenantId: 't-1', rol: 'llave:administracion' }));
vi.mock('@/app/api/v1/_comun', async (orig) => ({ ...((await orig()) as Record<string, unknown>), abrir: () => abrir() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => { throw new Error('sin base en pruebas'); } }) }));

let vuelo = 0; let maximo = 0; let llamadas = 0;
const recibir = vi.fn(async (_t: string, d: { bitacora: string }, ..._r: unknown[]) => {
  llamadas++; vuelo++; maximo = Math.max(maximo, vuelo);
  // Las primeras terminan DESPUÉS de las últimas: desordena la finalización.
  await new Promise((r) => setTimeout(r, 25 - Math.min(24, Number(d.bitacora) % 25)));
  vuelo--;
  return { estado: 'sin_poliza', claveExterna: `BIT-${d.bitacora}` };
});
vi.mock('@/lib/likida/liquidacion_externa/desglose_recibir', async (orig) => ({
  ...((await orig()) as Record<string, unknown>), recibirDesglose: (...a: [string, { bitacora: string }, ...unknown[]]) => recibir(...a),
}));
vi.mock('@/lib/likida/liquidacion_externa/repo', async (orig) => ({ ...((await orig()) as Record<string, unknown>), leerPadronOperadores: async () => PADRON_MUESTRA }));
vi.mock('@/lib/likida/liquidacion_externa/repo_correo', async (orig) => ({ ...((await orig()) as Record<string, unknown>), abrirExcepcion: async () => ({ id: 1, nueva: true }) }));
vi.mock('@/lib/likida/liquidacion_externa/desglose_muestra_recepcion', async (orig) => ({
  ...((await orig()) as Record<string, unknown>), muestraTmsHabilitada: async () => ({ ok: true }),
  cerrarRevisionesResueltas: async () => 0,
}));

const { POST } = await import('./route');
const { CONCURRENCIA_DESGLOSES } = await import('@/lib/likida/liquidacion_externa/concurrencia');
const lote = (n: number) => Array.from({ length: n }, (_, i) => ({ ...BITACORA_MUESTRA, BitacoraID: 900001 + i }));
const postear = (bitacoras: unknown[]) => POST(new Request('https://app.likida.ai/api/v1/liquidaciones-externas/desgloses',
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ formato: 'muestra-tms', version: 1, bitacoras }) }));

beforeEach(() => { vuelo = 0; maximo = 0; llamadas = 0; recibir.mockClear(); });

describe('desgloses · procesamiento del lote', () => {
  it('procesa varias bitácoras a la vez, sin pasar del tope, y 70 no tardan lo que la suma', async () => {
    const t0 = Date.now();
    const r = await postear(lote(70));
    const ms = Date.now() - t0;
    expect(r.status).toBe(200);
    expect(maximo).toBeGreaterThan(1);
    expect(maximo).toBeLessThanOrEqual(CONCURRENCIA_DESGLOSES);
    // En serie serían ≥ 70 × ~13 ms ≈ 900 ms; con 6 a la vez ronda la sexta parte.
    expect(ms).toBeLessThan(700);
  });
  it('conserva el orden del lote en resultados y excepciones aunque terminen desordenadas', async () => {
    const d = (await (await postear(lote(30))).json()).datos;
    expect(d.resultados.map((x: { indice: number }) => x.indice)).toEqual(Array.from({ length: 30 }, (_, i) => i));
    expect(d.excepciones.map((x: { clave: string }) => x.clave)).toEqual(Array.from({ length: 30 }, (_, i) => `BIT-${900001 + i}`));
  });
  it('la misma lectura de configuración se comparte entre las bitácoras de la petición (una sola por petición)', async () => {
    await postear(lote(12));
    const caches = new Set(recibir.mock.calls.map((c) => (c[3] as { cacheConfig?: unknown }).cacheConfig));
    expect(caches.size).toBe(1);
    expect([...caches][0]).toBeInstanceOf(Map);
    await postear(lote(2));
    expect(new Set(recibir.mock.calls.map((c) => (c[3] as { cacheConfig?: unknown }).cacheConfig)).size).toBe(2); // otra petición, otra lectura
  });
  it('una falla de infraestructura sigue siendo 500 y deja de repartir trabajo nuevo', async () => {
    recibir.mockImplementationOnce(async () => { throw new Error('Storage caído'); });
    const r = await postear(lote(70));
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(llamadas).toBeLessThan(70);
  });
});
