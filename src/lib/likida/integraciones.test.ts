import { describe, it, expect } from 'vitest';
import {
  catalogoIntegraciones, porCategoria, ESTADO_INTEGRACION,
} from './integraciones';

const SIN_GPS = { credencialesRastreo: 0 };
const CON_GPS = { credencialesRastreo: 3 };

describe('el catálogo dice CÓMO conecta cada cosa hoy', () => {
  it('cada renglón declara su forma de conectar — el campo que evita la venta mal entendida', () => {
    for (const i of catalogoIntegraciones(SIN_GPS)) {
      expect(i.comoConectaHoy.trim().length, i.id).toBeGreaterThan(0);
    }
  });

  it('todo estado usado tiene su rótulo y su tono', () => {
    for (const i of catalogoIntegraciones(SIN_GPS)) {
      expect(ESTADO_INTEGRACION[i.estado], i.id).toBeDefined();
    }
  });

  it('WhatsApp no se pinta conectado sin una comprobación por flota', () => {
    const wa = catalogoIntegraciones(SIN_GPS).find((i) => i.id === 'whatsapp_docs')!;
    expect(wa.estado).toBe('por_credencial');
    expect(wa.paraSubirDeEscalon).toMatch(/prueba/i);
  });
});

describe('el GPS no confunde credencial con posición', () => {
  it('con credenciales guardadas sigue pendiente de una sincronización comprobada', () => {
    const gps = catalogoIntegraciones(CON_GPS).find((i) => i.id === 'gps')!;
    expect(gps.estado).toBe('por_credencial');
    expect(gps.comoConectaHoy).toMatch(/no puede comprobar/i);
  });

  it('sin credenciales dice que el mapa es ILUSTRATIVO, no posición actual', () => {
    const gps = catalogoIntegraciones(SIN_GPS).find((i) => i.id === 'gps')!;
    expect(gps.estado).toBe('por_credencial');
    expect(gps.comoConectaHoy).toContain('ilustrativo');
    expect(gps.comoConectaHoy).toContain('nunca');
  });

  it('si NO se pudo leer, NO se pinta conectada', () => {
    // Un error de consulta que se leyera como "conectado" haría que el dueño
    // creyera que tiene rastreo en vivo cuando el mapa está dibujando líneas.
    const gps = catalogoIntegraciones({ credencialesRastreo: null }).find((i) => i.id === 'gps')!;
    expect(gps.estado).not.toBe('conectada');
  });
});

describe('ERP y correo no se prometen antes de una prueba real', () => {
  it('SAP va como piloto y exige una plantilla por flota', () => {
    const sap = catalogoIntegraciones(SIN_GPS).find((i) => i.id === 'sap_b1')!;
    expect(sap.estado).toBe('por_piloto');
    expect(sap.comoConectaHoy).toMatch(/plantilla/i);
    expect(sap.paraSubirDeEscalon).toMatch(/accesos/i);
  });

  it('CONTPAQi no se declara listo sin perfil confirmado', () => {
    const c = catalogoIntegraciones(SIN_GPS).find((i) => i.id === 'contpaqi_aspel')!;
    expect(c.estado).toBe('por_piloto');
    expect(c.comoConectaHoy).toMatch(/no listo/i);
  });

  it('el intake por correo se declara pendiente de su buzón y una prueba', () => {
    const i = catalogoIntegraciones(SIN_GPS).find((x) => x.id === 'intake_correo')!;
    expect(i.estado).toBe('por_credencial');
    expect(i.comoConectaHoy).toMatch(/ESTA flota/i);
  });
});

describe('porCategoria', () => {
  it('agrupa conservando el orden de declaración', () => {
    const grupos = porCategoria(catalogoIntegraciones(SIN_GPS));
    expect(grupos.map(([c]) => c)).toEqual([
      'Contabilidad y ERP', 'Rastreo', 'Combustible y casetas', 'Documentos',
    ]);
  });

  it('ninguna categoría queda vacía', () => {
    for (const [cat, items] of porCategoria(catalogoIntegraciones(SIN_GPS))) {
      expect(items.length, cat).toBeGreaterThan(0);
    }
  });
});
