import { describe, it, expect } from 'vitest';
import { destinosMovil, MAX_DESTINOS } from './barra-inferior-destinos';
import { menuPorPerfil, hrefsDelMenu } from './menu-por-perfil';
import { puedeVerRuta } from '@/lib/auth/visibilidad';

// La barra inferior móvil sale del MISMO menú filtrado que el sidebar: nunca ofrece una ruta que el rol o el perfil no abren.

const ROLES = ['superadmin', 'flota_admin', 'contador', 'encargado', 'vendedor', 'nomina'] as const;

describe('destinos de la barra inferior móvil', () => {
  for (const perfil of ['cinco_agentes', null] as const) {
    for (const rol of ROLES) {
      it(`${rol} / perfil ${perfil ?? 'sin perfil'}: ≤ ${MAX_DESTINOS} destinos, todos visibles para el rol, sin repetir`, () => {
        const menu = menuPorPerfil(rol, perfil);
        const d = destinosMovil(rol, menu);
        expect(d.length).toBeLessThanOrEqual(MAX_DESTINOS);
        expect(new Set(d.map((x) => x.href)).size).toBe(d.length);
        for (const x of d) {
          expect(puedeVerRuta(rol, x.href, perfil), `${rol} no debería ver ${x.href}`).toBe(true);
          expect(hrefsDelMenu(menu)).toContain(x.href);
          expect(x.etiqueta.length).toBeGreaterThan(0);
        }
        expect(d.map((x) => x.href)).not.toContain('/dashboard/notificaciones');
      });
    }
  }

  it('el dueño con el perfil de cinco agentes ve Resumen, Liquidación, Despacho y Viajes (más «Más»)', () => {
    const d = destinosMovil('flota_admin', menuPorPerfil('flota_admin', 'cinco_agentes'));
    expect(d.map((x) => x.href)).toEqual(['/dashboard', '/dashboard/agentes/liquidacion', '/dashboard/despacho', '/dashboard/viajes']);
    expect(d.map((x) => x.etiqueta)).toEqual(['Resumen', 'Liquidación', 'Despacho', 'Viajes']);
  });

  it('el contador nunca recibe el Resumen del dueño: con perfil entra por Liquidación y sin perfil por su propio Resumen', () => {
    const con = destinosMovil('contador', menuPorPerfil('contador', 'cinco_agentes'));
    expect(con[0].href).toBe('/dashboard/agentes/liquidacion');
    expect(con.map((x) => x.href)).not.toContain('/dashboard');
    const sin = destinosMovil('contador', menuPorPerfil('contador', null));
    expect(sin[0].href).toBe('/dashboard/contador');
    expect(sin[0].etiqueta).toBe('Resumen');
    expect(sin.map((x) => x.href)).not.toContain('/dashboard');
  });

  it('Mi perfil y Centro de ayuda (el pie) no ocupan lugar de la barra mientras el rol tenga rutas de trabajo', () => {
    for (const rol of ['flota_admin', 'contador', 'encargado'] as const) {
      const d = destinosMovil(rol, menuPorPerfil(rol, 'cinco_agentes')).map((x) => x.href);
      expect(d).not.toContain('/dashboard/mi-perfil');
      expect(d).not.toContain('/dashboard/soporte');
    }
  });

  it('nómina ve SOLO Liquidación (más «Más»): ni dinero ni nada fuera de sus 3 rutas', () => {
    for (const perfil of ['cinco_agentes', null] as const) {
      const menu = menuPorPerfil('nomina', perfil);
      expect(destinosMovil('nomina', menu).map((x) => x.href)).toEqual(['/dashboard/agentes/liquidacion']);
      expect(hrefsDelMenu(menu).sort()).toEqual(['/dashboard/agentes/liquidacion', '/dashboard/mi-perfil', '/dashboard/notificaciones'].sort());
    }
  });

  it('un rol sin ninguna ruta en este panel (el vendedor tiene el suyo) no recibe barra', () => {
    expect(destinosMovil('vendedor', menuPorPerfil('vendedor', 'cinco_agentes'))).toEqual([]);
  });

  it('un rol desconocido cae al orden del menú y nunca inventa rutas', () => {
    const menu = menuPorPerfil('rol_futuro', 'cinco_agentes');
    expect(destinosMovil('rol_futuro', menu)).toEqual([]);
  });
});
