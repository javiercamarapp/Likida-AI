import { describe, it, expect } from 'vitest';
import { puedeExportar, puedeAsignar, puedeAdministrar, puedeTimbrar } from './permisos';

// Matriz de docs/superpowers/plans/2026-08-02-roles-flota.md. Son funciones
// puras a propósito: la misma tabla decide qué botón se pinta en el panel Y
// qué le permite hacer la API — un solo lugar, no dos copias que se
// desincronicen (el mismo error que 0025 cerró para los CHECK de la base).
describe('puedeExportar', () => {
  it('superadmin, flota_admin, encargado y contador sí', () => {
    for (const rol of ['superadmin', 'flota_admin', 'encargado', 'contador']) {
      expect(puedeExportar(rol), rol).toBe(true);
    }
  });
  it('operador no — su interfaz es WhatsApp, no exporta nada desde la web', () => {
    expect(puedeExportar('operador')).toBe(false);
  });
  it('un rol desconocido no exporta — fail closed', () => {
    expect(puedeExportar('quien-sabe')).toBe(false);
  });
});

describe('puedeAsignar', () => {
  it('superadmin, flota_admin y encargado sí', () => {
    for (const rol of ['superadmin', 'flota_admin', 'encargado']) {
      expect(puedeAsignar(rol), rol).toBe(true);
    }
  });
  it('contador y operador no', () => {
    expect(puedeAsignar('contador')).toBe(false);
    expect(puedeAsignar('operador')).toBe(false);
  });
});

describe('puedeAdministrar', () => {
  it('solo superadmin y flota_admin — encargado no llega a facturación ni a invitar usuarios', () => {
    expect(puedeAdministrar('superadmin')).toBe(true);
    expect(puedeAdministrar('flota_admin')).toBe(true);
    expect(puedeAdministrar('encargado')).toBe(false);
    expect(puedeAdministrar('contador')).toBe(false);
    expect(puedeAdministrar('operador')).toBe(false);
  });
});

describe('puedeTimbrar (0227, auditoría Fable c6-3)', () => {
  it('el DUEÑO y el CONTADOR timbran: son quienes responden por el CFDI', () => {
    expect(puedeTimbrar('flota_admin')).toBe(true);
    expect(puedeTimbrar('contador')).toBe(true);
    expect(puedeTimbrar('superadmin')).toBe(true);
  });

  it('el ENCARGADO no — es EL hallazgo: el jefe de tráfico emitía CFDIs reales', () => {
    expect(puedeTimbrar('encargado')).toBe(false);
  });

  it('fail closed: un rol desconocido o retirado tampoco', () => {
    expect(puedeTimbrar('operador')).toBe(false);
    expect(puedeTimbrar('vendedor')).toBe(false);
    expect(puedeTimbrar('')).toBe(false);
  });

  it('timbrar NO se deduce de exportar ni de asignar: es un verbo propio', () => {
    // El encargado exporta y asigna; ninguna de las dos le da el CFDI.
    expect(puedeExportar('encargado')).toBe(true);
    expect(puedeAsignar('encargado')).toBe(true);
    expect(puedeTimbrar('encargado')).toBe(false);
    // Y el contador timbra sin poder asignar un viaje a un chofer.
    expect(puedeAsignar('contador')).toBe(false);
    expect(puedeTimbrar('contador')).toBe(true);
  });
});
