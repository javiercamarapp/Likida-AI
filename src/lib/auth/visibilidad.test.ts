import { describe, it, expect } from 'vitest';
import { areasDe, puedeVerArea, puedeVerRuta, areaDeRuta, inicioDe } from './visibilidad';
import { INICIO, NEGOCIO, OPERACION, DOCUMENTOS_DINERO, GESTION } from '@/app/dashboard/rutas';

// ═══════════════════════════════════════════════════════════════════════════
// El encargado entraba al mismo panel que el dueño y veía TODO: rentabilidad,
// cobranza, facturación, clientes. Estas pruebas fijan que ya no.
// ═══════════════════════════════════════════════════════════════════════════

describe('quién ve qué área', () => {
  it('el dueño y el superadmin ven las tres', () => {
    expect(areasDe('flota_admin')).toEqual(['operacion', 'dinero', 'administracion']);
    expect(areasDe('superadmin')).toEqual(['operacion', 'dinero', 'administracion']);
  });

  it('el encargado ve operación y NADA de dinero', () => {
    expect(puedeVerArea('encargado', 'operacion')).toBe(true);
    expect(puedeVerArea('encargado', 'dinero')).toBe(false);
    expect(puedeVerArea('encargado', 'administracion')).toBe(false);
  });

  it('el contador ve dinero y NO despacha', () => {
    expect(puedeVerArea('contador', 'dinero')).toBe(true);
    expect(puedeVerArea('contador', 'operacion')).toBe(false);
  });

  it('un rol desconocido no ve nada — fail closed, no fail open', () => {
    expect(areasDe('gerente_regional')).toEqual([]);
    expect(puedeVerRuta('gerente_regional', '/dashboard/despacho')).toBe(false);
  });

  it('el chofer no entra a este panel: su vista es /mis-viajes con RLS propia', () => {
    expect(areasDe('operador')).toEqual([]);
  });
});

describe('las rutas que el encargado NO puede abrir aunque teclee la URL', () => {
  const PROHIBIDAS = [
    '/dashboard/rentabilidad', '/dashboard/cobranza', '/dashboard/facturacion',
    '/dashboard/clientes', '/dashboard/cotizador', '/dashboard/cuadre',
    '/dashboard/valor-ahorro', '/dashboard/combustible-casetas',
    '/dashboard/usuarios', '/dashboard/configuracion', '/dashboard/politicas',
  ];
  it.each(PROHIBIDAS)('%s le está negada al encargado', (href) => {
    expect(puedeVerRuta('encargado', href)).toBe(false);
  });

  const SUYAS = [
    '/dashboard', '/dashboard/despacho', '/dashboard/viajes', '/dashboard/pod',
    '/dashboard/incidencias', '/dashboard/unidades', '/dashboard/operadores',
    '/dashboard/mapa', '/dashboard/documentos',
  ];
  it.each(SUYAS)('%s sí es suya', (href) => {
    expect(puedeVerRuta('encargado', href)).toBe(true);
  });
});

describe('el mapa de rutas no se queda atrás del sidebar', () => {
  // Es la prueba que importa a futuro: una pantalla nueva que alguien agregue
  // al sidebar y olvide clasificar quedaría SIN área, y `puedeVerRuta` la
  // negaría a todos — incluido el dueño. Falla aquí, no en producción.
  const todas = [...INICIO, ...NEGOCIO, ...OPERACION, ...DOCUMENTOS_DINERO, ...GESTION];
  it('toda ruta del sidebar tiene área declarada', () => {
    const huerfanas = todas.filter((i) => areaDeRuta(i.href) === undefined).map((i) => i.href);
    expect(
      huerfanas,
      `estas rutas están en el sidebar pero no en AREA_POR_RUTA (visibilidad.ts):\n  ${huerfanas.join('\n  ')}`,
    ).toEqual([]);
  });

  it('el dueño ve todas las del sidebar', () => {
    const invisibles = todas.filter((i) => !puedeVerRuta('flota_admin', i.href)).map((i) => i.href);
    expect(invisibles).toEqual([]);
  });
});

describe('a dónde se rebota a cada quien', () => {
  it('al encargado a /dashboard, que sí es suyo', () => {
    expect(inicioDe('encargado')).toBe('/dashboard');
  });

  it('al contador NO a /dashboard — lo rebotaría otra vez y sería un bucle', () => {
    expect(inicioDe('contador')).toBe('/dashboard/cuadre');
    expect(puedeVerRuta('contador', inicioDe('contador'))).toBe(true);
  });

  it('un rol sin áreas va a /sin-acceso, no a un bucle', () => {
    expect(inicioDe('desconocido')).toBe('/sin-acceso');
  });
});
