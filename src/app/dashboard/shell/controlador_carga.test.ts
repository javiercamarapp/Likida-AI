import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { crearControlador, type EstadoCarga, MINIMO_VISIBLE_MS, RETARDO_NAVEGACION_MS, TOPE_MS, VENTANA_NAVEGACION_MS } from './controlador-carga';

// ESTILO-LIKIDA §9 + decisión del dueño del 10-nov (reemplaza la de Javier del 31-oct): el telón es IGUAL A ROVAQ. Medido con reloj falso:
// la primera carga se libera tras 600 ms estables y ≥400 ms visible; una recarga de la misma sesión, en cuanto el contenido está
// listo; una NAVEGACIÓN lenta (pantalla de carga pendiente > 250 ms) levanta el telón, que dura ≥400 ms; seguro de 45 s.
// Sin DOM: el «puerto» simula la pantalla de carga.

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

  it('seguro de 45 s: si nunca termina se retira y queda el estado «tope» (No disponible ahora)', () => {
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

describe('navegación interna: el telón vuelve si la carga tarda más de 250 ms', () => {
  function listoOculta() {
    const a = armar();
    a.ctl.evaluar();
    vi.advanceTimersByTime(700);
    expect(a.ctl.estado()).toBe('oculta');
    return a;
  }

  it('una navegación rápida (la pantalla de carga se va antes de 250 ms) NO levanta el telón', () => {
    const { est, ctl, historia } = listoOculta();
    est.pendiente = true; ctl.evaluar();
    vi.advanceTimersByTime(RETARDO_NAVEGACION_MS - 1);
    est.pendiente = false; ctl.evaluar();
    vi.advanceTimersByTime(2000);
    expect(ctl.estado()).toBe('oculta');
    expect(historia.filter(([, e]) => e === 'nav')).toHaveLength(0);
  });

  it('una navegación lenta levanta el telón a los 250 ms y lo suelta al terminar, tras el mínimo de 400 ms visible', () => {
    const { est, ctl } = listoOculta();
    est.pendiente = true; ctl.evaluar();
    vi.advanceTimersByTime(RETARDO_NAVEGACION_MS - 1);
    expect(ctl.estado()).toBe('oculta');
    vi.advanceTimersByTime(2);
    expect(ctl.estado()).toBe('nav');
    vi.advanceTimersByTime(5000);
    expect(ctl.estado()).toBe('nav'); // sigue pendiente: no se suelta
    est.pendiente = false; ctl.evaluar();
    vi.advanceTimersByTime(VENTANA_NAVEGACION_MS - 1);
    expect(ctl.estado()).toBe('nav');
    vi.advanceTimersByTime(2);
    expect(ctl.estado()).toBe('oculta');
  });

  it('si termina apenas aparece, el telón se mantiene hasta cumplir 400 ms visible (sin destello)', () => {
    const { est, ctl } = listoOculta();
    est.pendiente = true; ctl.evaluar();
    vi.advanceTimersByTime(RETARDO_NAVEGACION_MS + 1);
    expect(ctl.estado()).toBe('nav');
    est.pendiente = false; ctl.evaluar();
    vi.advanceTimersByTime(MINIMO_VISIBLE_MS - 20);
    expect(ctl.estado()).toBe('nav');
    vi.advanceTimersByTime(40);
    expect(ctl.estado()).toBe('oculta');
  });

  it('el seguro de 45 s corre también en una navegación: queda «tope» y no vuelve a levantarse mientras siga pendiente', () => {
    const { est, ctl } = listoOculta();
    est.pendiente = true; ctl.evaluar();
    vi.advanceTimersByTime(RETARDO_NAVEGACION_MS + 1);
    vi.advanceTimersByTime(TOPE_MS + 1);
    expect(ctl.estado()).toBe('tope');
    ctl.evaluar();
    vi.advanceTimersByTime(5000);
    expect(ctl.estado()).toBe('tope');
    est.pendiente = false; ctl.evaluar();
    expect(ctl.estado()).toBe('oculta');
  });

  it('puede repetirse: una segunda navegación lenta vuelve a levantar el telón', () => {
    const { est, ctl } = listoOculta();
    for (let i = 0; i < 2; i++) {
      est.pendiente = true; ctl.evaluar();
      vi.advanceTimersByTime(RETARDO_NAVEGACION_MS + 1);
      expect(ctl.estado()).toBe('nav');
      est.pendiente = false; ctl.evaluar();
      vi.advanceTimersByTime(MINIMO_VISIBLE_MS + 10);
      expect(ctl.estado()).toBe('oculta');
    }
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
