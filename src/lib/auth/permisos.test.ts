import { describe, it, expect } from 'vitest';
import { puedeExportar, puedeAsignar, puedeAdministrar } from './permisos';

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
