import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { crearControlador, type EstadoCarga, TOPE_MS } from './controlador-carga';

// ESTILO-LIKIDA §9 + decisión de Javier del 31-oct: el telón es SOLO de la primera carga de la sesión. Medido con reloj falso: la
// primera carga se libera tras 600 ms estables y ≥400 ms visible; una recarga de la misma sesión, en cuanto el contenido está
// listo; las navegaciones NUNCA levantan el telón (ahí van esqueletos); seguro de 20 s. Sin DOM: el «puerto» simula la pantalla de carga.

function armar(primeraVez = true) {
  const est = { pendiente: false };
  const historia: Array<[number, EstadoCarga]> = [];
  const t0 = Date.now();
  const vistas = { n: 0 };
  const ctl = crearControlador({
    hayPendiente: () => est.pendiente,
    poner: (e) => historia.push([Date.now() - t0, e]),
    ahora: () => Date.now(),
    esperar: (f, ms) => setTimeout(f, ms) as unknown as number,
    cancelar: (id) => clearTimeout(id),
    primeraVez,
    marcarVista: () => { vistas.n++; },
  });
  return { est, historia, ctl, t0, vistas };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('primera carga de la sesión', () => {
  it('con todo listo desde el inicio, el telón se mantiene 600 ms y se suelta; la sesión queda marcada', () => {
    const { ctl, historia, vistas } = armar();
    ctl.evaluar();
    vi.advanceTimersByTime(599);
    expect(ctl.estado()).toBe('inicial');
    expect(vistas.n).toBe(0);
    vi.advanceTimersByTime(2);
    expect(ctl.estado()).toBe('oculta');
    expect(historia.at(-1)?.[0]).toBeGreaterThanOrEqual(600);
    expect(vistas.n).toBe(1);
  });

  it('mientras haya pantalla de carga de página pendiente no se suelta; se libera 600 ms después de que desaparece', () => {
    const { est, ctl } = armar();
    est.pendiente = true;
    ctl.evaluar();
    vi.advanceTimersByTime(3000);
    expect(ctl.estado()).toBe('inicial');
    est.pendiente = false;
    ctl.evaluar();
    vi.advanceTimersByTime(599);
    expect(ctl.estado()).toBe('inicial');
    vi.advanceTimersByTime(2);
    expect(ctl.estado()).toBe('oculta');
  });

  it('una ráfaga intermitente reinicia la ventana estable (no se suelta entre parpadeos)', () => {
    const { est, ctl } = armar();
    ctl.evaluar();
    vi.advanceTimersByTime(500);
    est.pendiente = true; ctl.evaluar();
    vi.advanceTimersByTime(100);
    est.pendiente = false; ctl.evaluar();
    vi.advanceTimersByTime(599);
    expect(ctl.estado()).toBe('inicial');
    vi.advanceTimersByTime(2);
    expect(ctl.estado()).toBe('oculta');
  });

  it('seguro de 20 s: si nunca termina se retira y queda el estado «tope» (No disponible ahora)', () => {
    const { est, ctl } = armar();
    est.pendiente = true;
    ctl.evaluar();
    vi.advanceTimersByTime(TOPE_MS - 1);
    expect(ctl.estado()).toBe('inicial');
    vi.advanceTimersByTime(2);
    expect(ctl.estado()).toBe('tope');
    est.pendiente = false; ctl.evaluar();
    expect(ctl.estado()).toBe('oculta');
  });
});

describe('recarga dentro de la misma sesión', () => {
  it('se suelta en cuanto el contenido está listo, sin ventana ni mínimo de 400 ms', () => {
    const { ctl, vistas } = armar(false);
    ctl.evaluar();
    expect(ctl.estado()).toBe('inicial');
    vi.advanceTimersByTime(1);
    expect(ctl.estado()).toBe('oculta');
    expect(vistas.n).toBe(1);
  });

  it('con contenido pendiente espera, y sale apenas termina', () => {
    const { est, ctl } = armar(false);
    est.pendiente = true; ctl.evaluar();
    vi.advanceTimersByTime(2000);
    expect(ctl.estado()).toBe('inicial');
    est.pendiente = false; ctl.evaluar();
    vi.advanceTimersByTime(1);
    expect(ctl.estado()).toBe('oculta');
  });
});

describe('navegación interna: el telón NO vuelve', () => {
  function listoOculta() {
    const a = armar();
    a.ctl.evaluar();
    vi.advanceTimersByTime(700);
    expect(a.ctl.estado()).toBe('oculta');
    return a;
  }

  it('una navegación lenta (más de 250 ms, incluso 10 s) no levanta el telón: la pantalla muestra su esqueleto', () => {
    const { est, ctl, historia } = listoOculta();
    est.pendiente = true; ctl.evaluar();
    vi.advanceTimersByTime(10_000);
    est.pendiente = false; ctl.evaluar();
    vi.advanceTimersByTime(2000);
    expect(ctl.estado()).toBe('oculta');
    expect(historia.filter(([, e]) => e !== 'oculta' && e !== 'inicial')).toHaveLength(0);
    expect(historia.filter(([, e]) => e === 'inicial')).toHaveLength(0);
  });

  it('el seguro de 20 s ya no corre una vez soltado el telón', () => {
    const { est, ctl } = listoOculta();
    est.pendiente = true; ctl.evaluar();
    vi.advanceTimersByTime(TOPE_MS + 1000);
    expect(ctl.estado()).toBe('oculta');
  });
});

describe('mutaciones del DOM sin cambio de estado: evaluar() repetido NO reinicia los temporizadores', () => {
  it('primera carga: evaluar() cada 100 ms sin pendiente libera a los 600 ms (no hasta el seguro)', () => {
    const { ctl } = armar();
    for (let t = 0; t < 590; t += 100) { ctl.evaluar(); vi.advanceTimersByTime(100); }
    ctl.evaluar();
    vi.advanceTimersByTime(20);
    expect(ctl.estado()).toBe('oculta');
  });

  it('primera carga: ráfaga continua durante 5 s con el mismo estado no dispara el «No disponible» falso', () => {
    const { ctl, est } = armar();
    est.pendiente = true;
    for (let t = 0; t < 5000; t += 50) { ctl.evaluar(); vi.advanceTimersByTime(50); }
    est.pendiente = false;
    for (let t = 0; t < 1200; t += 50) { ctl.evaluar(); vi.advanceTimersByTime(50); }
    expect(ctl.estado()).toBe('oculta');
  });
});
