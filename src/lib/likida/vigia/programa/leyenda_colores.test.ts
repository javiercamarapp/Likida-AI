import { describe, expect, it } from 'vitest';
import {
  TOLERANCIA_MAXIMA,
  avisosLeyenda,
  distanciaColor,
  ErrorLeyendaColores,
  estadoReglaColor,
  LEYENDA_VACIA,
  mapasAplicables,
  normalizarHex,
  resolverColor,
  SIGNIFICADOS_COLOR,
  validarConfigLeyenda,
  type ConfigLeyendaColores,
  type ContextoLeyenda,
} from './leyenda_colores';

const EXPO: ContextoLeyenda = { flota: 'flota-a', terminal: 'GDL', seccion: 'EXPORTACION' };
const IMPO: ContextoLeyenda = { ...EXPO, seccion: 'IMPORTACION' };

// Colores y significados de PRUEBA: no son la leyenda del cliente.
const configDos: ConfigLeyendaColores = {
  tolerancia: 0,
  mapas: [
    { seccion: 'EXPORTACION', colores: { '#FF99CC': 'patio', '#D9D9D9': 'no_patio' } },
    { seccion: 'IMPORTACION', colores: { '#FF99CC': 'carga_en_patio' } },
  ],
};

describe('leyenda de colores · sin valores cableados', () => {
  it('la configuración vacía no decide: «sin leyenda» para cualquier color', () => {
    for (const c of ['#FF99CC', '#D9D9D9', null]) {
      const r = resolverColor(LEYENDA_VACIA, EXPO, c);
      expect(r.estado).toBe('sin_leyenda');
      expect(r.significado).toBeNull();
    }
    expect(estadoReglaColor(LEYENDA_VACIA, EXPO)).toBe('no_disponible');
  });

  it('un mapa sin colores tampoco cuenta como leyenda', () => {
    const cfg: ConfigLeyendaColores = { tolerancia: 0, mapas: [{ colores: {} }] };
    expect(resolverColor(cfg, EXPO, '#FF0000').estado).toBe('sin_leyenda');
    expect(estadoReglaColor(cfg, EXPO)).toBe('no_disponible');
  });

  it('el único significado propio es sin_significado: lo que no está en el mapa cae ahí', () => {
    const r = resolverColor(configDos, EXPO, '#00FF00');
    expect(r).toMatchObject({ estado: 'sin_coincidencia', significado: 'sin_significado' });
    expect(SIGNIFICADOS_COLOR).toContain('sin_significado');
  });

  it('una celda sin color no se interpreta aunque haya leyenda', () => {
    expect(resolverColor(configDos, EXPO, null).estado).toBe('sin_color');
    expect(resolverColor(configDos, EXPO, 'rojo').estado).toBe('sin_color');
  });
});

describe('leyenda de colores · por sección, terminal y flota', () => {
  it('el mismo color significa cosas distintas según la sección', () => {
    expect(resolverColor(configDos, EXPO, '#FF99CC')).toMatchObject({ estado: 'resuelto', significado: 'patio' });
    expect(resolverColor(configDos, IMPO, '#FF99CC')).toMatchObject({ estado: 'resuelto', significado: 'carga_en_patio' });
    // En una sección sin mapa propio la regla no decide.
    expect(resolverColor(configDos, { ...EXPO, seccion: 'DOMESTICO' }, '#FF99CC').estado).toBe('sin_leyenda');
  });

  it('el mapa de la terminal gana al general, pero el general completa lo que no define', () => {
    const cfg: ConfigLeyendaColores = {
      tolerancia: 0,
      mapas: [
        { colores: { '#FF99CC': 'patio', '#FFFF00': 'sin_significado' } },
        { terminal: 'GDL', colores: { '#FF99CC': 'despachando' } },
      ],
    };
    expect(resolverColor(cfg, EXPO, '#FF99CC').significado).toBe('despachando');
    expect(resolverColor(cfg, { ...EXPO, terminal: 'MTY' }, '#FF99CC').significado).toBe('patio');
    expect(resolverColor(cfg, EXPO, '#FFFF00').significado).toBe('sin_significado');
    expect(mapasAplicables(cfg, EXPO)).toHaveLength(2);
    expect(mapasAplicables(cfg, { ...EXPO, terminal: 'MTY' })).toHaveLength(1);
  });

  it('el mapa de la flota gana al de la terminal y al de la sección', () => {
    const cfg: ConfigLeyendaColores = {
      tolerancia: 0,
      mapas: [
        { seccion: 'EXPORTACION', colores: { '#FF99CC': 'patio' } },
        { terminal: 'GDL', colores: { '#FF99CC': 'despachando' } },
        { flota: 'flota-a', colores: { '#FF99CC': 'documentos_listos' } },
      ],
    };
    expect(resolverColor(cfg, EXPO, '#FF99CC').significado).toBe('documentos_listos');
    expect(resolverColor(cfg, { ...EXPO, flota: 'flota-b' }, '#FF99CC').significado).toBe('despachando');
  });
});

describe('leyenda de colores · tolerancia', () => {
  it('con tolerancia 0 solo cuenta el color exacto', () => {
    expect(resolverColor(configDos, EXPO, '#FF99CD').estado).toBe('sin_coincidencia');
  });

  it('con tolerancia mayor acepta un tono cercano y elige el más cercano', () => {
    const cfg: ConfigLeyendaColores = {
      tolerancia: 20,
      mapas: [{ colores: { '#FF99CC': 'patio', '#FF99E0': 'no_patio' } }],
    };
    const cerca = resolverColor(cfg, EXPO, '#FF99D8');
    expect(cerca).toMatchObject({ estado: 'resuelto', significado: 'no_patio', colorMapa: '#FF99E0' });
    expect(resolverColor(cfg, EXPO, '#00FF00').estado).toBe('sin_coincidencia');
  });

  it('la distancia es euclidiana en RGB', () => {
    expect(distanciaColor('#000000', '#000000')).toBe(0);
    expect(distanciaColor('#000000', '#030400')).toBe(5);
  });
});

describe('leyenda de colores · validación de la configuración', () => {
  it('normaliza colores y completa los campos de alcance', () => {
    const v = validarConfigLeyenda({ tolerancia: 5, mapas: [{ colores: { 'ff99cc': 'patio' } }] });
    expect(v.mapas[0]).toEqual({ flota: null, terminal: null, seccion: null, colores: { '#FF99CC': 'patio' } });
    expect(normalizarHex(' #ff99cc ')).toBe('#FF99CC');
    expect(normalizarHex('rosa')).toBeNull();
  });

  it('rechaza con mensaje llano un color, un significado o una tolerancia inválidos', () => {
    expect(() => validarConfigLeyenda({ tolerancia: 0, mapas: [{ colores: { rosa: 'patio' } }] }))
      .toThrowError(ErrorLeyendaColores);
    expect(() => validarConfigLeyenda({ tolerancia: 0, mapas: [{ colores: { '#FF99CC': 'inventado' as never } }] }))
      .toThrowError(/significado/);
    expect(() => validarConfigLeyenda({ tolerancia: -1, mapas: [] })).toThrowError(/tolerancia/);
    expect(() => validarConfigLeyenda({ tolerancia: Number.NaN, mapas: [] })).toThrowError(/tolerancia/);
  });

  it('el mismo color con dos significados en un mismo mapa es contradicción', () => {
    expect(() => validarConfigLeyenda({
      tolerancia: 0,
      mapas: [{ colores: { '#ff99cc': 'patio', '#FF99CC': 'no_patio' } }],
    })).toThrowError(/dos veces/);
  });
});

describe('A37-S59-10 · tope de la tolerancia y colores solapados', () => {
  it('rechaza una tolerancia que haría coincidir cualquier color (442)', () => {
    expect(() => validarConfigLeyenda({ tolerancia: 442, mapas: [] })).toThrowError(/tolerancia/);
    expect(() => validarConfigLeyenda({ tolerancia: TOLERANCIA_MAXIMA + 1, mapas: [] })).toThrowError(/tolerancia/);
    expect(validarConfigLeyenda({ tolerancia: TOLERANCIA_MAXIMA, mapas: [] }).tolerancia).toBe(TOLERANCIA_MAXIMA);
  });

  it('avisa cuando dos colores del mismo mapa caen dentro de la tolerancia entre sí', () => {
    const cfg: ConfigLeyendaColores = {
      tolerancia: 20,
      mapas: [{ colores: { '#FF99CC': 'patio', '#FF99E0': 'no_patio', '#00FF00': 'despachando' } }],
    };
    const avisos = avisosLeyenda(cfg);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatch(/#FF99CC/);
    expect(avisos[0]).toMatch(/#FF99E0/);
    expect(avisosLeyenda({ ...cfg, tolerancia: 5 })).toEqual([]);
  });
});
