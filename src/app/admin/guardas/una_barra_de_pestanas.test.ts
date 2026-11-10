import { describe, expect, it } from 'vitest';
import { barrasDePestanas, leer, medirPestanas, problemasDeTrinquete, ADMIN } from './medir';
import { BASE_PESTANAS_PROPIAS } from './base';
import { join } from 'node:path';

// Guarda `una_barra_de_pestanas` (Fase 0, K3). Una pantalla de /admin tiene UNA sola barra de pestañas: la automática de
// `pestanas-admin.tsx`, que el chrome monta y que sale de `rutas.ts`. Una barra pintada a mano en la pantalla duplicaría la del grupo.
// La base solo BAJA (hoy está vacía): una pantalla nueva con su propio <TabsLinea>/<Tabs>/role="tablist" falla.
describe('una_barra_de_pestanas', () => {
  it('el detector ve las barras propias y no cuenta la automática', () => {
    expect(barrasDePestanas('<TabsLinea etiqueta="x" />')).toBe(1);
    expect(barrasDePestanas('<Tabs etiqueta="x" pestanas={p} />')).toBe(1);
    expect(barrasDePestanas('<div role="tablist">')).toBe(1);
    expect(barrasDePestanas('<PestanasAdmin />')).toBe(0);
    expect(barrasDePestanas('// <TabsLinea /> en un comentario')).toBe(0);
  });
  it('ninguna pantalla pinta una barra de pestañas propia más allá de la base', () => {
    expect(problemasDeTrinquete(medirPestanas(), BASE_PESTANAS_PROPIAS)).toEqual([]);
  });
  it('el chrome monta el marco con la barra automática exactamente una vez', () => {
    const chrome = leer(join(ADMIN, 'chrome.tsx'));
    expect(chrome.match(/<ProveedorMarcoAdmin(?=[\s/>])/g)).toHaveLength(1);
  });
});
