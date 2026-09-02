import { describe, it, expect, beforeEach, vi } from 'vitest';

// Este repo no trae jsdom (sin entorno de navegador por defecto en Vitest);
// `notificaciones-leidas.ts` gatea con `typeof window === 'undefined'`, así
// que se le da un `window` mínimo — un localStorage de verdad respaldado en
// un Map y un emisor de eventos real, nada de mocks a medias que fingirían
// probar algo que no corre.
class LocalStorageDeMentiras {
  private mapa = new Map<string, string>();
  getItem(k: string) { return this.mapa.has(k) ? this.mapa.get(k)! : null; }
  setItem(k: string, v: string) { this.mapa.set(k, v); }
  removeItem(k: string) { this.mapa.delete(k); }
  clear() { this.mapa.clear(); }
}
const emisor = new EventTarget();
const ventana = {
  localStorage: new LocalStorageDeMentiras(),
  addEventListener: emisor.addEventListener.bind(emisor),
  removeEventListener: emisor.removeEventListener.bind(emisor),
  dispatchEvent: emisor.dispatchEvent.bind(emisor),
};
vi.stubGlobal('window', ventana);

const {
  leerLeidas, marcarLeida, marcarTodasLeidas, SIN_LEIDAS, _limpiarCache,
} = await import('./notificaciones-leidas');

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · H47 — el set de "leídas" en localStorage crecía sin límite.
//
// Cada id de alerta carga su conteo (`huerfanos:3`): cuando el conteo
// cambia, el id VIEJO nunca se borraba de `leidas`, solo se sumaba el
// nuevo. A 500 viajes/día, meses de uso real acumulan miles de ids muertos
// — cada clic los vuelve a parsear/serializar completos. El tope poda los
// MÁS VIEJOS (orden de inserción de `Set`) y conserva los recientes.
// ═══════════════════════════════════════════════════════════════════════════

beforeEach(() => {
  ventana.localStorage.clear();
  _limpiarCache();
});

describe('el set de "leídas" no crece sin límite', () => {
  it('por debajo del tope: todo se conserva, nada se poda', () => {
    for (let i = 0; i < 10; i++) marcarLeida(`huerfanos:${i}`);
    const leidas = leerLeidas();
    expect(leidas.size).toBe(10);
    expect(leidas.has('huerfanos:0')).toBe(true);
    expect(leidas.has('huerfanos:9')).toBe(true);
  });

  it('por encima del tope: se poda a un tamaño acotado, y sobreviven las MÁS RECIENTES', () => {
    for (let i = 0; i < 600; i++) marcarLeida(`huerfanos:${i}`);
    const leidas = leerLeidas();
    expect(leidas.size).toBeLessThanOrEqual(500);
    // Las últimas marcadas (las más recientes) tienen que sobrevivir.
    expect(leidas.has('huerfanos:599')).toBe(true);
    expect(leidas.has('huerfanos:598')).toBe(true);
    // Las primeras (las más viejas) son las que se podan.
    expect(leidas.has('huerfanos:0')).toBe(false);
  });

  it('una alerta marcada justo ahora no puede reaparecer por la poda, aunque el set ya esté lleno', () => {
    for (let i = 0; i < 550; i++) marcarLeida(`huerfanos:${i}`);
    marcarLeida('huerfanos:reciente');
    const leidas = leerLeidas();
    expect(leidas.has('huerfanos:reciente')).toBe(true);
  });

  it('marcarTodasLeidas también respeta el tope', () => {
    const muchos = Array.from({ length: 700 }, (_, i) => `alerta:${i}`);
    marcarTodasLeidas(muchos);
    const leidas = leerLeidas();
    expect(leidas.size).toBeLessThanOrEqual(500);
    expect(leidas.has('alerta:699')).toBe(true);
  });

  it('lo escrito en localStorage está podado — no solo la copia en memoria', () => {
    for (let i = 0; i < 600; i++) marcarLeida(`huerfanos:${i}`);
    const crudo = ventana.localStorage.getItem('likida:alertas-flota:leidas');
    const parsed = JSON.parse(crudo ?? '[]') as string[];
    expect(parsed.length).toBeLessThanOrEqual(500);
  });
});

describe('SIN_LEIDAS — referencia estable', () => {
  it('es un set vacío, siempre el mismo objeto (useSyncExternalStore no entra en bucle)', () => {
    expect(SIN_LEIDAS.size).toBe(0);
  });
});
