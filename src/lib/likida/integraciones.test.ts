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

  it('lo que ya está en su tope no promete un escalón siguiente', () => {
    const wa = catalogoIntegraciones(SIN_GPS).find((i) => i.id === 'whatsapp_docs')!;
    expect(wa.estado).toBe('conectada');
    expect(wa.paraSubirDeEscalon).toBeNull();
  });
});

describe('el GPS es el estado que SÍ se mide por flota', () => {
  it('con credenciales guardadas sale conectada y sin siguiente escalón', () => {
    const gps = catalogoIntegraciones(CON_GPS).find((i) => i.id === 'gps')!;
    expect(gps.estado).toBe('conectada');
    expect(gps.paraSubirDeEscalon).toBeNull();
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

describe('SAP no se promete antes de tener accesos', () => {
  it('va como piloto y explica que el escalón del archivo YA funciona', () => {
    const sap = catalogoIntegraciones(SIN_GPS).find((i) => i.id === 'sap_b1')!;
    expect(sap.estado).toBe('por_piloto');
    expect(sap.comoConectaHoy).toMatch(/archivo/i);
    expect(sap.paraSubirDeEscalon).toMatch(/credenciales/i);
  });

  it('CONTPAQi y Aspel se declaran NO construidas — coherente con el export', () => {
    // `validarAjustes` rechaza esos formatos; si aquí dijeran "disponible", la
    // página de integraciones contradiría a la de configuración.
    const c = catalogoIntegraciones(SIN_GPS).find((i) => i.id === 'contpaqi_aspel')!;
    expect(c.estado).toBe('no_construida');
  });

  it('el intake por correo se declara pendiente, no se esconde', () => {
    const i = catalogoIntegraciones(SIN_GPS).find((x) => x.id === 'intake_correo')!;
    expect(i.estado).toBe('no_construida');
    expect(i.comoConectaHoy).toMatch(/a mano/i);
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
