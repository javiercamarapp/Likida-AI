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
const { leerLeidas, marcarLeida, marcarTodasLeidas, claveAlerta, esSilenciable, alertasPendientes, hayAtencionPendiente } = await import('./notificaciones-leidas');

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

describe('"leída" no silencia ARCO, vencidos ni fuentes ciegas', () => {
  const arco = { tipo: 'atencion' as const, texto: '2 solicitudes ARCO esperan respuesta (plazo legal de 20 días hábiles).', href: '/admin/escalaciones' };
  const vencido = { tipo: 'atencion' as const, texto: '1 ticket de soporte tiene el SLA vencido (3 abiertos en total).' };
  const ciega = { tipo: 'atencion' as const, texto: 'No se pudo leer: Solicitudes ARCO — ahí puede haber pendientes.' };
  const costo = { tipo: 'atencion' as const, texto: 'El costo de IA subió 40% esta semana vs la anterior.' };

  it('las críticas no son silenciables y las demás sí', () => {
    expect(esSilenciable(arco)).toBe(false);
    expect(esSilenciable(vencido)).toBe(false);
    expect(esSilenciable(ciega)).toBe(false);
    expect(esSilenciable(costo)).toBe(true);
  });
  it('marcarlas leídas no las saca de pendientes ni apaga la señal', () => {
    const leidas = new Set([arco, vencido, ciega, costo].map(claveAlerta));
    expect(alertasPendientes([arco, vencido, ciega, costo], leidas)).toEqual([arco, vencido, ciega]);
    expect(hayAtencionPendiente([arco], leidas)).toBe(true);
    expect(hayAtencionPendiente([costo], leidas)).toBe(false);
    expect(hayAtencionPendiente([costo], new Set())).toBe(true);
  });
});
