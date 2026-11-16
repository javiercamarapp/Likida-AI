import { describe, expect, it } from 'vitest';
import { validarRecorrido } from '@/app/ui-v2/movimiento/tour/validar';
import { PANTALLAS } from '../pantallas';
import { PISTAS_CONTEXTUALES } from '../pistas';
import { AGENTES } from '../agentes';
import { construirRecorrido } from '../tour';
import { PANTALLAS_EN } from './pantallas';
import { PISTAS_EN } from './pistas';
import { AGENTES_EN } from './agentes';

const ESPANOL = /[áéíóúñ¿¡«»]/;

describe('recorrido en inglés: paridad con el catálogo en español', () => {
  it('las pantallas tienen las mismas rutas, acciones y variantes', () => {
    expect(Object.keys(PANTALLAS_EN).sort()).toEqual(Object.keys(PANTALLAS).sort());
    for (const [href, es] of Object.entries(PANTALLAS)) {
      const en = PANTALLAS_EN[href];
      expect(Boolean(en.accion), href).toBe(Boolean(es.accion));
      expect(Object.keys(en.variantes ?? {}).sort(), href).toEqual(Object.keys(es.variantes ?? {}).sort());
      for (const [k, v] of Object.entries(es.variantes ?? {})) expect(Object.keys(en.variantes?.[k as 'contador'] ?? {}).sort(), `${href} ${k}`).toEqual(Object.keys(v ?? {}).sort());
    }
  });
  it('las pistas y los agentes también', () => {
    expect(Object.keys(PISTAS_EN).sort()).toEqual(Object.keys(PISTAS_CONTEXTUALES).sort());
    expect(Object.keys(AGENTES_EN).sort()).toEqual(AGENTES.map((a) => a.id).sort());
  });
  it('ningún texto inglés lleva acentos ni comillas españolas', () => {
    const textos = JSON.stringify([PANTALLAS_EN, PISTAS_EN, AGENTES_EN]);
    expect(ESPANOL.test(textos)).toBe(false);
  });
  it('el recorrido en inglés respeta los topes de título y texto de cada rol', () => {
    for (const rol of ['flota_admin', 'contador', 'encargado', 'nomina']) {
      for (const perfil of [null, 'cinco_agentes'] as const) {
        for (const modo of ['corto', 'completo'] as const) {
          const r = construirRecorrido(rol, perfil, modo, 'en');
          if (!r) continue;
          expect(validarRecorrido(r), `${rol} ${perfil} ${modo}`).toEqual([]);
        }
      }
    }
  });
});
