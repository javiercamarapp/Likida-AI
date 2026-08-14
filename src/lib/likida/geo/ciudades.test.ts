import { describe, it, expect } from 'vitest';
import { resolverCiudad } from './ciudades';
import { proyectar, VIEWBOX, PUNTOS_MEXICO } from '@/app/dashboard/mapa/mexico-geo';

describe('resolverCiudad — el texto libre del despachador', () => {
  it('resuelve el nombre limpio, con y sin acentos', () => {
    expect(resolverCiudad('Monterrey')?.nombre).toBe('Monterrey');
    expect(resolverCiudad('CULIACAN')?.nombre).toBe('Culiacán');
    expect(resolverCiudad('Mérida')?.nombre).toBe('Mérida');
  });

  it('los apodos del gremio: CDMX, GDL, MTY, SLP', () => {
    expect(resolverCiudad('CDMX')?.nombre).toBe('Ciudad de México');
    expect(resolverCiudad('México D.F.')?.nombre).toBe('Ciudad de México');
    expect(resolverCiudad('gdl')?.nombre).toBe('Guadalajara');
    expect(resolverCiudad('MTY')?.nombre).toBe('Monterrey');
    expect(resolverCiudad('S.L.P.')?.nombre).toBe('San Luis Potosí');
  });

  it('las variantes de "Cd./Ciudad" apuntan a la misma ciudad', () => {
    expect(resolverCiudad('Cd. Juárez')?.nombre).toBe('Ciudad Juárez');
    expect(resolverCiudad('Ciudad Juarez')?.nombre).toBe('Ciudad Juárez');
    expect(resolverCiudad('Cd Victoria')?.nombre).toBe('Ciudad Victoria');
  });

  it('el estado tras la coma no estorba', () => {
    expect(resolverCiudad('Guadalajara, Jal.')?.nombre).toBe('Guadalajara');
    expect(resolverCiudad('Nuevo Laredo, Tamps')?.nombre).toBe('Nuevo Laredo');
  });

  it('lo que no está en la tabla devuelve null — se dice, no se inventa', () => {
    expect(resolverCiudad('Bodega Central Norte')).toBeNull();
    expect(resolverCiudad('')).toBeNull();
    expect(resolverCiudad(null)).toBeNull();
    expect(resolverCiudad(undefined)).toBeNull();
  });
});

describe('la proyección y el trazo generado se hablan', () => {
  // Si alguien regenera mexico-geo.ts con otra proyección y las ciudades se
  // quedan con la vieja, TODOS los puntos caen chueco. Estas aserciones de
  // geometría relativa lo atrapan sin depender de píxeles exactos.
  it('las ciudades conocidas caen DENTRO del viewBox', () => {
    for (const nombre of ['Tijuana', 'Cancún', 'Tapachula', 'Ciudad Juárez', 'Ciudad de México']) {
      const c = resolverCiudad(nombre);
      expect(c, nombre).not.toBeNull();
      const p = proyectar(c!.lat, c!.lng);
      expect(p.x, `${nombre} x`).toBeGreaterThan(0);
      expect(p.x, `${nombre} x`).toBeLessThan(VIEWBOX.w);
      expect(p.y, `${nombre} y`).toBeGreaterThan(0);
      expect(p.y, `${nombre} y`).toBeLessThan(VIEWBOX.h);
    }
  });

  it('la geografía relativa es la de México: oeste<este, norte<sur', () => {
    const tij = proyectar(32.52, -117.04);   // Tijuana (NO)
    const cun = proyectar(21.16, -86.85);    // Cancún (E)
    const cdmx = proyectar(19.43, -99.13);   // centro
    const tap = proyectar(14.9, -92.26);     // Tapachula (S)
    expect(tij.x).toBeLessThan(cdmx.x);
    expect(cdmx.x).toBeLessThan(cun.x);
    expect(tij.y).toBeLessThan(cdmx.y);      // y crece hacia el sur
    expect(cdmx.y).toBeLessThan(tap.y);
  });

  it('la matriz de puntos existe y vive dentro del viewBox', () => {
    expect(PUNTOS_MEXICO.length).toBeGreaterThan(500);
    for (const [x, y] of PUNTOS_MEXICO) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(VIEWBOX.w);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(VIEWBOX.h);
    }
  });
});
