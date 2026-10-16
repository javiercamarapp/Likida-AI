import { describe, it, expect } from 'vitest';
import {
  CONECTORES_PERFIL_CINCO_AGENTES, INTEGRACIONES_PERFIL_CINCO_AGENTES,
  conectorPermitidoEnPerfil, integracionPermitidaEnPerfil,
} from './visibilidad';
import { CONECTORES } from '@/lib/likida/conectores/registro';
import { catalogoParaCaptura } from '@/app/dashboard/conexiones/seccion-credenciales';
import { catalogoIntegraciones } from '@/lib/likida/integraciones';

// ═══════════════════════════════════════════════════════════════════════════
// T-TMS-16 — Visibilidad del conector bajo el perfil `cinco_agentes`.
// Lista cerrada de conectores (junto a la lista de rutas): el TMS del cliente,
// su tabla propia y el GPS. Todo lo demás es stand-by (oculto, no borrado).
// Sin perfil, la pantalla es idéntica a la de siempre.
// ═══════════════════════════════════════════════════════════════════════════

const idsDe = (g: ReturnType<typeof catalogoParaCaptura>) => g.flatMap((x) => x.conectores.map((c) => c.id));
const capturables = CONECTORES.filter((c) => c.credenciales.length > 0);

describe('lista cerrada de conectores del perfil', () => {
  it('cada id de la lista existe en el registro (no hay fichas fantasma)', () => {
    const ids = new Set(CONECTORES.map((c) => c.id));
    for (const id of CONECTORES_PERFIL_CINCO_AGENTES) expect(ids.has(id), id).toBe(true);
  });

  it('incluye el TMS (lectura y genérico), la tabla propia y TODOS los GPS del registro', () => {
    for (const id of ['tms_api_lectura', 'tms_generico', 'tabla_propia']) {
      expect(CONECTORES_PERFIL_CINCO_AGENTES).toContain(id);
    }
    for (const c of CONECTORES.filter((x) => x.categoria === 'Rastreo GPS')) {
      expect(CONECTORES_PERFIL_CINCO_AGENTES, c.id).toContain(c.id);
    }
  });

  it('deja fuera SAP, Oracle, Odoo, contabilidad, monederos/peajes y portales de facturación', () => {
    for (const id of ['sap_b1', 'oracle_fusion', 'oracle_ebs', 'odoo', 'contpaqi', 'aspel_coi', 'archivo_contable',
      'iave', 'pase', 'televia', 'monedero_diesel', 'powergas', 'peaje_generico']) {
      expect(CONECTORES_PERFIL_CINCO_AGENTES, id).not.toContain(id);
    }
    for (const c of CONECTORES.filter((x) => x.categoria === 'Portal de facturación')) {
      expect(conectorPermitidoEnPerfil('cinco_agentes', c.id), c.id).toBe(false);
    }
  });

  it('falla cerrado: perfil desconocido o conector nuevo sin declarar → no', () => {
    expect(conectorPermitidoEnPerfil('otro_perfil', 'tms_api_lectura')).toBe(false);
    expect(conectorPermitidoEnPerfil('cinco_agentes', 'conector_nuevo_de_manana')).toBe(false);
    expect(conectorPermitidoEnPerfil('cinco_agentes', 'tms_api_lectura')).toBe(true);
  });
});

describe('catálogo de captura de /conexiones', () => {
  it('bajo el perfil solo ofrece conectores de la lista cerrada, y ofrece todos los capturables de ella', () => {
    const ids = idsDe(catalogoParaCaptura('cinco_agentes'));
    for (const id of ids) expect(CONECTORES_PERFIL_CINCO_AGENTES, id).toContain(id);
    const esperados = capturables.filter((c) => CONECTORES_PERFIL_CINCO_AGENTES.includes(c.id)).map((c) => c.id);
    expect([...ids].sort()).toEqual([...esperados].sort());
    expect(ids).toContain('tms_api_lectura');
    expect(ids).not.toContain('sap_b1');
    expect(ids).not.toContain('odoo');
  });

  it('REGRESIÓN: sin perfil el catálogo es el completo de siempre, idéntico con o sin argumento', () => {
    const sinPerfil = catalogoParaCaptura();
    expect(catalogoParaCaptura(null)).toEqual(sinPerfil);
    expect([...idsDe(sinPerfil)].sort()).toEqual(capturables.map((c) => c.id).sort());
    expect(sinPerfil.map((g) => g.categoria)).toContain('Portal de facturación');
  });

  it('no se borró ninguna ficha: el registro conserva todos los conectores', () => {
    expect(CONECTORES.length).toBeGreaterThan(CONECTORES_PERFIL_CINCO_AGENTES.length);
    for (const id of ['sap_b1', 'oracle_fusion', 'odoo', 'iave', 'monedero_diesel']) {
      expect(CONECTORES.some((c) => c.id === id), id).toBe(true);
    }
  });
});

describe('catálogo de sistemas (integraciones)', () => {
  const todo = catalogoIntegraciones({ credencialesRastreo: 0 });

  it('la lista del perfil solo nombra renglones que existen', () => {
    const ids = new Set(todo.map((i) => i.id));
    for (const id of INTEGRACIONES_PERFIL_CINCO_AGENTES) expect(ids.has(id), id).toBe(true);
  });

  it('bajo el perfil se oculta SAP/CONTPAQi, monedero y buzón de proveedores; sin perfil sigue todo', () => {
    const visibles = todo.filter((i) => integracionPermitidaEnPerfil('cinco_agentes', i.id)).map((i) => i.id);
    expect(visibles).toEqual(expect.arrayContaining(['gps', 'export_csv', 'whatsapp_docs']));
    for (const id of ['sap_b1', 'contpaqi_aspel', 'tag_monedero', 'intake_correo']) expect(visibles).not.toContain(id);
    expect(todo.map((i) => i.id)).toEqual(expect.arrayContaining(['sap_b1', 'contpaqi_aspel', 'tag_monedero', 'intake_correo']));
  });
});
