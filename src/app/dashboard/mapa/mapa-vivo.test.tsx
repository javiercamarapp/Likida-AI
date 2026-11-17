import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MapaVivo, agruparPines, type PinUnidad, type ViajeEnMapa } from './mapa-vivo';

const pin = (i: number, o: Partial<PinUnidad> = {}): PinUnidad => ({
  unidadId: `u${i}`, etiqueta: `DEMO-24${String(i).padStart(3, '0')}`, placas: null, estadoUnidad: 'en_ruta',
  x: 300 + (i % 7), y: 200 + (i % 5), lat: 20, lng: -100, medidaEn: '2026-10-01T15:00:00Z', minutos: 5, velocidadKmh: 40, proveedor: 'wialon', ...o,
});
const viaje = (i: number, o: Partial<ViajeEnMapa> = {}): ViajeEnMapa => ({
  id: `v${i}`, folio: `V-${i}`, operadorNombre: 'Op', origenNombre: 'Guadalajara', destinoNombre: 'Monterrey',
  ox: 280, oy: 230, dx: 330, dy: 170, dias: 1, fotos: 0, escalado: false, kmRecta: 700, ...o,
});

describe('MapaVivo con muchos viajes', () => {
  it('agrupa posiciones cercanas con contador y las separa al achicar la celda', () => {
    const ps = Array.from({ length: 140 }, (_, i) => pin(i));
    const g = agruparPines(ps, 16);
    expect(g.length).toBeLessThan(5);
    expect(g.reduce((a, x) => a + x.pines.length, 0)).toBe(140);
    expect(agruparPines(ps, 1).length).toBeGreaterThan(g.length);
  });

  it('el grupo toma el nivel de frescura más grave', () => {
    const g = agruparPines([pin(1), pin(2, { minutos: 5000 })], 16);
    expect(g[0].nivel).toBe('obsoleta');
  });

  it('no rotula los 140 pines: solo contadores; los folios de viaje no se montan', () => {
    const html = renderToStaticMarkup(<MapaVivo viajes={Array.from({ length: 140 }, (_, i) => viaje(i))} pines={Array.from({ length: 140 }, (_, i) => pin(i))} />);
    expect(html).not.toMatch(/<text[^>]*>DEMO-24/);
    expect(html).toContain('rv-mp__grupo');
    expect(html).toContain('>140<');
    expect(html).not.toContain('style=');
  });

  it('cada fila de la lista lleva folio, estado, ruta y pie con title y sin solaparse (una sola fila por elemento)', () => {
    const html = renderToStaticMarkup(<MapaVivo viajes={[viaje(1, { escalado: true })]} />);
    expect(html).toContain('id="rv-mp-v-v1"');
    expect(html).toContain('title="Guadalajara → Monterrey"');
    expect(html).toContain('Escalado');
    expect(html).toContain('data-escalado="true"');
  });

  it('los escalados llevan pulso y la verdad del arco ilustrativo sigue en la leyenda', () => {
    const html = renderToStaticMarkup(<MapaVivo viajes={[viaje(1), viaje(2, { escalado: true })]} />);
    expect(html).toContain('rv-mp__esc-pulso');
    expect(html).toContain('Trayecto ilustrativo');
  });
});
