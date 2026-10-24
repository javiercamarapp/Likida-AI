import { describe, it, expect, beforeEach, vi } from 'vitest';

// A37-S07-07 — `setItem` sin try/catch lanzaba al marcar leído con el
// almacenamiento bloqueado/lleno, y las claves crecían sin tope.
class Almacen {
  private mapa = new Map<string, string>();
  falla = false;
  getItem(k: string) { return this.mapa.has(k) ? this.mapa.get(k)! : null; }
  setItem(k: string, v: string) { if (this.falla) throw new Error('QuotaExceededError'); this.mapa.set(k, v); }
  clear() { this.mapa.clear(); this.falla = false; }
}
const emisor = new EventTarget();
const ventana = {
  localStorage: new Almacen(),
  addEventListener: emisor.addEventListener.bind(emisor),
  removeEventListener: emisor.removeEventListener.bind(emisor),
  dispatchEvent: emisor.dispatchEvent.bind(emisor),
};
vi.stubGlobal('window', ventana);
const { leerLeidas, marcarLeida, marcarTodasLeidas } = await import('./notificaciones-leidas');

beforeEach(() => { ventana.localStorage.clear(); });

describe('A37-S07-07: notificaciones-leidas (admin)', () => {
  it('marcarLeida no lanza si localStorage.setItem falla (cuota o modo privado)', () => {
    ventana.localStorage.falla = true;
    expect(() => marcarLeida('atencion::x')).not.toThrow();
    expect(() => marcarTodasLeidas(['a', 'b'])).not.toThrow();
  });

  it('avisa a la campana aunque el guardado falle (el evento propio se emite)', () => {
    ventana.localStorage.falla = true;
    const cb = vi.fn();
    window.addEventListener('likida:notificaciones:cambio', cb);
    marcarLeida('atencion::y');
    expect(cb).toHaveBeenCalled();
  });

  it('las claves se podan a un tope y sobreviven las más recientes', () => {
    marcarTodasLeidas(Array.from({ length: 700 }, (_, i) => `k:${i}`));
    const l = leerLeidas();
    expect(l.size).toBeLessThanOrEqual(500);
    expect(l.has('k:699')).toBe(true);
    expect(l.has('k:0')).toBe(false);
  });
});
