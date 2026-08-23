// ═══════════════════════════════════════════════════════════════════════════
// FE-16 — LA PESTAÑA OCULTA NO PIDE NADA.
//
// El refresco del Cerebro era un `setInterval` a secas: la pestaña que se
// queda abierta en el segundo monitor seguía leyendo la cartera cada cinco
// minutos toda la noche. Estas pruebas fijan las dos reglas del latido, que
// son fáciles de romper al tocar el efecto y no se ven en pantalla: con la
// pestaña oculta NO se late, y al volver se late UNA vez (no la ráfaga de
// los que se saltaron).
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { arrancarLatido } from './latido';

const MIN = 60_000;

/** Una pestaña de mentiras: se puede ocultar y avisa como el navegador. */
function pestana() {
  let oculta = false;
  const oyentes = new Set<() => void>();
  return {
    oculto: () => oculta,
    alCambiarVisibilidad: (cb: () => void) => { oyentes.add(cb); return () => oyentes.delete(cb); },
    poner(v: boolean) { oculta = v; oyentes.forEach((cb) => cb()); },
    get oyentes() { return oyentes.size; },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('el latido del Cerebro', () => {
  it('con la pestaña a la vista late cada intervalo', async () => {
    const p = pestana();
    const latir = vi.fn();
    const parar = arrancarLatido({ intervaloMs: 5 * MIN, ...p, latir });
    await vi.advanceTimersByTimeAsync(15 * MIN);
    expect(latir).toHaveBeenCalledTimes(3);
    parar();
  });

  it('OCULTA no late — ni una vez, pasen las horas que pasen', async () => {
    const p = pestana();
    const latir = vi.fn();
    const parar = arrancarLatido({ intervaloMs: 5 * MIN, ...p, latir });
    p.poner(true);
    await vi.advanceTimersByTimeAsync(8 * 60 * MIN); // una noche entera
    expect(latir).not.toHaveBeenCalled();
    parar();
  });

  it('al volver, UNA sola actualización — no los 96 latidos que se saltó', async () => {
    const p = pestana();
    const latir = vi.fn();
    const parar = arrancarLatido({ intervaloMs: 5 * MIN, ...p, latir });
    p.poner(true);
    await vi.advanceTimersByTimeAsync(8 * 60 * MIN);
    p.poner(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(latir).toHaveBeenCalledTimes(1);
    parar();
  });

  it('entrar y salir de la pestaña SIN que pase el intervalo no dispara nada', async () => {
    const p = pestana();
    const latir = vi.fn();
    const parar = arrancarLatido({ intervaloMs: 5 * MIN, ...p, latir });
    p.poner(true);
    await vi.advanceTimersByTimeAsync(MIN); // menos de un intervalo
    p.poner(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(latir).not.toHaveBeenCalled();
    parar();
  });

  it('dos latidos no se enciman: con la red lenta, el siguiente espera', async () => {
    const p = pestana();
    let resolver: (() => void) | null = null;
    const latir = vi.fn(() => new Promise<void>((r) => { resolver = r; }));
    const parar = arrancarLatido({ intervaloMs: 5 * MIN, ...p, latir });
    await vi.advanceTimersByTimeAsync(15 * MIN);
    expect(latir).toHaveBeenCalledTimes(1);
    resolver!();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(latir).toHaveBeenCalledTimes(2);
    parar();
  });

  it('al parar se suelta el reloj Y el oyente de visibilidad', async () => {
    const p = pestana();
    const latir = vi.fn();
    const parar = arrancarLatido({ intervaloMs: 5 * MIN, ...p, latir });
    expect(p.oyentes).toBe(1);
    parar();
    expect(p.oyentes).toBe(0);
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(latir).not.toHaveBeenCalled();
  });
});
