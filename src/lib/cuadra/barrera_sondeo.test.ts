// ═══════════════════════════════════════════════════════════════════════════
// LA BARRERA SONDEABA CON UNA **ESCRITURA**, CADA 500 ms.
//
// `esperarIntake` preguntaba con `intakeDelta(viajeId, 0)`, y `intake_delta` es
// un UPDATE aunque el delta sea 0: la 0011/0031 reescriben la fila entera para
// poder aplicar el `greatest(0, …)` de forma atómica. O sea que la barrera hacía
// un UPDATE cada medio segundo sobre la MISMA fila de `viaje` que las 22 fotos
// de la ráfaga están actualizando con sus `+1`/`-1`. Es la RPC más llamada del
// sistema y cada sondeo compite por el row lock del trabajo de verdad.
//
// Lo que NO se puede perder al cambiarlo: la 0031 dice, con todas sus letras,
// que el olvido del contador muerto ocurre TAMBIÉN en el sondeo. Sin eso, el
// primer "listo" después de una invocación muerta ve un `+1` huérfano, espera
// la barrera completa y le avisa al operador que su liquidación salió corta
// estando completa — el peor sitio para un aviso falso, porque es el que enseña
// a ignorarlos. Ese olvido lo hacía la escritura; ahora lo hace este SELECT.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
const rpc = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from, rpc }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { intakePendientes, esperarIntake } = await import('./conv');

const hace = (ms: number) => new Date(Date.now() - ms).toISOString();

beforeEach(() => {
  maybeSingle.mockReset(); from.mockClear(); select.mockClear(); rpc.mockReset();
  delete process.env.CUADRA_INTAKE_GRACE_MS;
});

describe('intakePendientes — el sondeo es una LECTURA', () => {
  it('no llama a ninguna RPC: lee la fila del viaje', async () => {
    maybeSingle.mockResolvedValue({ data: { intake_pendientes: 3, intake_pendientes_en: hace(1_000) }, error: null });
    expect(await intakePendientes('v1')).toBe(3);
    expect(rpc, 'el sondeo volvió a escribir').not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith('viaje');
    // Las DOS columnas: sin el sello no se puede aplicar la regla de la 0031.
    expect(select).toHaveBeenCalledWith('intake_pendientes, intake_pendientes_en');
  });

  it('un contador con el sello VENCIDO vale 0 (es basura de un proceso que no volvió)', async () => {
    maybeSingle.mockResolvedValue({ data: { intake_pendientes: 1, intake_pendientes_en: hace(11 * 60_000) }, error: null });
    expect(await intakePendientes('v1')).toBe(0);
  });

  it('un contador SIN sello también vale 0 (filas anteriores a la 0031)', async () => {
    maybeSingle.mockResolvedValue({ data: { intake_pendientes: 2, intake_pendientes_en: null }, error: null });
    expect(await intakePendientes('v1')).toBe(0);
  });

  it('un contador VIVO con sello fresco NO se olvida: la barrera tiene que esperarlo', async () => {
    maybeSingle.mockResolvedValue({ data: { intake_pendientes: 2, intake_pendientes_en: hace(9 * 60_000) }, error: null });
    expect(await intakePendientes('v1')).toBe(2);
  });

  it('un error devuelve null, NO cero: "no sé" no puede abrir la barrera', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom', code: '500' } });
    expect(await intakePendientes('v1')).toBeNull();
  });

  it('viaje inexistente = 0: colgar al operador esperando una fila que no está es peor', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await intakePendientes('v1')).toBe(0);
  });
});

describe('esperarIntake usa ese sondeo por default', () => {
  it('la barrera entera corre SIN escribir una sola vez', async () => {
    // Dos vueltas: primero 1 en vuelo, luego vacío.
    maybeSingle
      .mockResolvedValueOnce({ data: { intake_pendientes: 1, intake_pendientes_en: hace(500) }, error: null })
      .mockResolvedValue({ data: { intake_pendientes: 0, intake_pendientes_en: hace(500) }, error: null });

    const ok = await esperarIntake('v1', 5_000);
    expect(ok).toBe(true);
    expect(rpc, 'la barrera volvió a sondear con un UPDATE').not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith('viaje');
  });

  it('y sigue siendo fail-closed: si la lectura falla, NO cuadra sobre parciales', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'caída', code: '503' } });
    // `null` no vacía la barrera → se agota el tope y devuelve false, que es lo
    // que hace que el operador reciba el aviso de "cuadré con los que alcancé".
    expect(await esperarIntake('v1', 80)).toBe(false);
  });
});
