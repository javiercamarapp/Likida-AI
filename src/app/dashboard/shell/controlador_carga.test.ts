import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { crearControlador, type EstadoCarga, TOPE_MS } from './controlador-carga';

// ESTILO-LIKIDA §9, medido con reloj falso: aparece a >250 ms, ≥400 ms visible, la carga inicial se libera tras 600 ms estables,
// seguro de 20 s. Sin DOM: el «puerto» simula la pantalla de carga de página.

function armar() {
  const est = { pendiente: false, cargandoDoc: false };
  const historia: Array<[number, EstadoCarga]> = [];
  const t0 = Date.now();
  const ctl = crearControlador({
    hayPendiente: () => est.cargandoDoc || est.pendiente,
    documentoCargando: () => est.cargandoDoc,
    poner: (e) => historia.push([Date.now() - t0, e]),
    ahora: () => Date.now(),
    esperar: (f, ms) => setTimeout(f, ms) as unknown as number,
    cancelar: (id) => clearTimeout(id),
  });
  return { est, historia, ctl, t0 };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('carga inicial', () => {
  it('con todo listo desde el inicio, la capa se mantiene 600 ms y se suelta', () => {
    const { ctl, historia } = armar();
    ctl.evaluar();
    vi.advanceTimersByTime(599);
    expect(ctl.estado()).toBe('inicial');
    vi.advanceTimersByTime(2);
    expect(ctl.estado()).toBe('oculta');
    expect(historia.at(-1)?.[0]).toBeGreaterThanOrEqual(600);
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

describe('navegación interna', () => {
  function listoOculta() {
    const a = armar();
    a.ctl.evaluar();
    vi.advanceTimersByTime(700);
    expect(a.ctl.estado()).toBe('oculta');
    return a;
  }

  it('una navegación rápida (<250 ms) NUNCA muestra la capa', () => {
    const { est, ctl } = listoOculta();
    est.pendiente = true; ctl.evaluar();
    vi.advanceTimersByTime(249);
    est.pendiente = false; ctl.evaluar();
    vi.advanceTimersByTime(2000);
    expect(ctl.estado()).toBe('oculta');
  });

  it('una navegación lenta muestra la capa a los 250 ms y la mantiene ≥400 ms visible', () => {
    const { est, ctl, historia } = listoOculta();
    est.pendiente = true; ctl.evaluar();
    vi.advanceTimersByTime(251);
    expect(ctl.estado()).toBe('nav');
    const aparece = Date.now();
    vi.advanceTimersByTime(50);
    est.pendiente = false; ctl.evaluar(); // el contenido llega 50 ms después de aparecer
    vi.advanceTimersByTime(340);
    expect(ctl.estado()).toBe('nav'); // aún no cumple 400 ms
    vi.advanceTimersByTime(20);
    expect(ctl.estado()).toBe('oculta');
    expect(Date.now() - aparece).toBeGreaterThanOrEqual(400);
    expect(historia.filter(([, e]) => e === 'nav')).toHaveLength(1);
  });

  it('si la pantalla ya llevaba >400 ms visible, se suelta tras la ventana de navegación de 150 ms', () => {
    const { est, ctl } = listoOculta();
    est.pendiente = true; ctl.evaluar();
    vi.advanceTimersByTime(251 + 1000);
    est.pendiente = false; ctl.evaluar();
    vi.advanceTimersByTime(149);
    expect(ctl.estado()).toBe('nav');
    vi.advanceTimersByTime(2);
    expect(ctl.estado()).toBe('oculta');
  });

  it('no levanta la capa mientras el documento aún está llegando (eso lo cubre la carga inicial)', () => {
    const { est, ctl } = listoOculta();
    est.cargandoDoc = true; est.pendiente = true; ctl.evaluar();
    vi.advanceTimersByTime(1000);
    expect(ctl.estado()).toBe('oculta');
  });

  it('seguro de 20 s también en navegación', () => {
    const { est, ctl } = listoOculta();
    est.pendiente = true; ctl.evaluar();
    vi.advanceTimersByTime(251);
    expect(ctl.estado()).toBe('nav');
    vi.advanceTimersByTime(TOPE_MS + 1);
    expect(ctl.estado()).toBe('tope');
  });
});
