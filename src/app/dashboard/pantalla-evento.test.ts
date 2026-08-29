import { describe, it, expect } from 'vitest';
import { pantallaDesdeRuta } from './pantalla-evento';
import { TODAS_LAS_RUTAS } from './rutas';

// La función que decide qué llega a `producto_evento` (0251). El riesgo que
// estas pruebas cierran: una fila de basura en el tablero de cohortes (ruta
// inventada que pasa), o lo contrario — una pantalla real del catálogo que se
// descarta y desaparece de la adopción sin que nadie vea un error.

describe('pantallaDesdeRuta', () => {
  it('la raíz del panel es «resumen», con y sin diagonal final', () => {
    expect(pantallaDesdeRuta('/dashboard')).toBe('resumen');
    expect(pantallaDesdeRuta('/dashboard/')).toBe('resumen');
  });

  it('TODA entrada del catálogo se reconoce a sí misma (si el sidebar gana una página, el pulso la mide solo)', () => {
    for (const r of TODAS_LAS_RUTAS) {
      const esperada = r.href === '/dashboard' ? 'resumen' : r.href.slice('/dashboard/'.length);
      expect(pantallaDesdeRuta(r.href), r.href).toBe(esperada);
    }
  });

  it('la subruta cuenta como su pantalla: /viajes/<id> es «viajes»', () => {
    expect(pantallaDesdeRuta('/dashboard/viajes/9c1b2f00-aaaa-bbbb-cccc-000000000001')).toBe('viajes');
    expect(pantallaDesdeRuta('/dashboard/agentes/liquidacion')).toBe('agentes/liquidacion');
  });

  it('el href anidado le gana al padre: la bandeja del SAT no se cuenta como descarga-sat', () => {
    expect(pantallaDesdeRuta('/dashboard/descarga-sat/bandeja')).toBe('descarga-sat/bandeja');
    expect(pantallaDesdeRuta('/dashboard/descarga-sat')).toBe('descarga-sat');
  });

  it('el detalle de liquidación ([id]) se cuenta como pantalla SIN guardar el uuid', () => {
    expect(pantallaDesdeRuta('/dashboard/9c1b2f00-aaaa-bbbb-cccc-000000000001')).toBe('liquidacion');
  });

  it('el panel del contador (sin entrada de sidebar) no se pierde', () => {
    expect(pantallaDesdeRuta('/dashboard/contador')).toBe('contador');
  });

  it('lo que no es del catálogo se DESCARTA, nunca se guarda crudo', () => {
    expect(pantallaDesdeRuta('/dashboard/lo-que-sea')).toBeNull();
    expect(pantallaDesdeRuta('/admin/flotas')).toBeNull();
    expect(pantallaDesdeRuta('/dashboardx/viajes')).toBeNull();
    expect(pantallaDesdeRuta('')).toBeNull();
    expect(pantallaDesdeRuta(null)).toBeNull();
    expect(pantallaDesdeRuta(42)).toBeNull();
    expect(pantallaDesdeRuta(`/dashboard/${'a'.repeat(300)}`)).toBeNull();
  });

  it('query y hash de un POST a mano no cambian la pantalla', () => {
    expect(pantallaDesdeRuta('/dashboard/viajes?tenant=x#abajo')).toBe('viajes');
  });

  it('toda pantalla que sale cabe en el CHECK de forma de la 0251 (1..80)', () => {
    for (const r of TODAS_LAS_RUTAS) {
      const p = pantallaDesdeRuta(r.href);
      expect(p, r.href).not.toBeNull();
      expect((p as string).length, r.href).toBeGreaterThanOrEqual(1);
      expect((p as string).length, r.href).toBeLessThanOrEqual(80);
    }
  });
});
