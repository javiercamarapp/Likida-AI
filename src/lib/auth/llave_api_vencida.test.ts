// ═══════════════════════════════════════════════════════════════════════════
// SEG-8 (auditoría 24) — EL CAMINO CALIENTE RECHAZA UNA LLAVE VENCIDA.
//
// `resolverLlave` corre en CADA petición de /v1 y era la mitad que faltaba de
// la caducidad: la columna `expira_en` (0294) y el select de la pantalla no
// valen nada si quien autentica no la mira. Lo que se fija:
//   · una llave vencida da el MISMO 401 y el MISMO texto que una revocada o
//     inexistente — distinguirlas le diría a quien prueba llaves cuál acertó;
//   · `expira_en` null (toda llave anterior a la 0294) sigue entrando;
//   · el instante exacto de caducidad ya está vencido.
//
// El archivo va aparte de `llave-api.test.ts` porque aquel prueba funciones
// puras sin mockear Supabase, y meterle el mock cambiaría sus reglas.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach } from 'vitest';

let filas: Array<Record<string, unknown>> = [];
let errorLectura: { message: string } | null = null;

function builder() {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = () => b;
  b.is = () => b;
  b.update = () => b;
  b.limit = async () => ({ data: filas, error: errorLectura });
  // El sello de último uso es un `.update().eq().then()` suelto.
  b.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res);
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => builder() }) }));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { resolverLlave, generarLlave } = await import('./llave-api');

const LLAVE = generarLlave();
const fila = (expiraEn: string | null) => ({
  id: 'l-1', tenant_id: 't-1', area: 'administracion', hash: LLAVE.hash, expira_en: expiraEn,
});

beforeEach(() => { filas = []; errorLectura = null; logger.warn.mockClear(); });

describe('resolverLlave y la caducidad', () => {
  it('una llave VIGENTE entra', async () => {
    filas = [fila(new Date(Date.now() + 86_400_000).toISOString())];
    expect(await resolverLlave(LLAVE.enClaro)).toMatchObject({ ok: true, tenantId: 't-1', area: 'administracion' });
  });

  it('sin `expira_en` (llave anterior a la 0294) entra igual: la columna nueva no invalida el parque', async () => {
    filas = [fila(null)];
    expect(await resolverLlave(LLAVE.enClaro)).toMatchObject({ ok: true, tenantId: 't-1' });
  });

  it('una llave VENCIDA da 401 con el MISMO texto que una inexistente', async () => {
    filas = [fila(new Date(Date.now() - 1_000).toISOString())];
    const vencida = await resolverLlave(LLAVE.enClaro);
    filas = [];
    const inexistente = await resolverLlave(LLAVE.enClaro);
    expect(vencida).toEqual({ ok: false, status: 401, motivo: 'Llave inválida.' });
    expect(vencida).toEqual(inexistente);
    // Y queda en el log de Likida, que es quien sí puede saber la diferencia.
    expect(logger.warn).toHaveBeenCalledWith('llave_api.vencida', expect.objectContaining({ llave: 'l-1' }));
  });

  it('el instante exacto de caducidad ya cuenta como vencida', async () => {
    const ahora = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(ahora);
    filas = [fila(new Date(ahora).toISOString())];
    expect(await resolverLlave(LLAVE.enClaro)).toMatchObject({ ok: false, status: 401 });
    vi.restoreAllMocks();
  });

  it('un error de lectura sigue siendo 503, no 401: un bache de red no invalida la llave del cliente', async () => {
    errorLectura = { message: 'fetch failed' };
    expect(await resolverLlave(LLAVE.enClaro)).toMatchObject({ ok: false, status: 503 });
  });
});
