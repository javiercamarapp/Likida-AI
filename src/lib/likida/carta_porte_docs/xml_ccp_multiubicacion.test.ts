// A37-S33-01: el lector de XML tomaba solo el primer Origen y el ÚLTIMO Destino y dejaba el resto en silencio con 0.99.
import { describe, expect, it } from 'vitest';
import { extraerCartaPorteXml, leerCartaPorteXml } from './xml_ccp';

const ub = (tipo: 'Origen' | 'Destino', id: string, cp: string, extra: Record<string, string> = {}) => ({
  '@_TipoUbicacion': tipo, '@_IDUbicacion': id, '@_NombreRemitenteDestinatario': `Sitio ${id}`, '@_RFCRemitenteDestinatario': 'XAXX010101000',
  Domicilio: { '@_CodigoPostal': cp, '@_Estado': 'NLE' }, ...extra,
});
const arbol = (ubicaciones: unknown[], mercancia: unknown[] = []) => ({
  Comprobante: { '@_Folio': '1', Complemento: { CartaPorte: {
    '@_TranspInternac': 'No', '@_TotalDistRec': '500',
    Ubicaciones: { Ubicacion: ubicaciones },
    Mercancias: { '@_PesoBrutoTotal': '1000', Mercancia: mercancia },
  } } },
});

describe('A37-S33-01: XML de Carta Porte con varias ubicaciones', () => {
  it('Origen + 3 Destinos: los TRES destinos se leen (destino_1..3), no solo el último', () => {
    const e = extraerCartaPorteXml(arbol([ub('Origen', 'OR000001', '66600'), ub('Destino', 'DE000001', '64000'), ub('Destino', 'DE000002', '06600'), ub('Destino', 'DE000003', '44100')]))!;
    expect(e.campos.destino_cp.valor).toBe('64000');
    expect(e.campos.destino_2_cp.valor).toBe('06600');
    expect(e.campos.destino_3_cp.valor).toBe('44100');
    expect(e.campos.destino_2_nombre.valor).toBe('Sitio DE000002');
  });

  it('dos Orígenes: el segundo se lee como origen_2_*', () => {
    const e = extraerCartaPorteXml(arbol([ub('Origen', 'OR000001', '66600'), ub('Origen', 'OR000002', '66000'), ub('Destino', 'DE000001', '64000')]))!;
    expect(e.campos.origen_cp.valor).toBe('66600');
    expect(e.campos.origen_2_cp.valor).toBe('66000');
  });

  it('la mercancía con CantidadTransporta a UN destino recibe id_destino (posición); a varios se avisa', () => {
    const r = leerCartaPorteXml(arbol(
      [ub('Origen', 'OR000001', '66600'), ub('Destino', 'DE000001', '64000'), ub('Destino', 'DE000002', '06600')],
      [
        { '@_Descripcion': 'A', CantidadTransporta: { '@_IDOrigen': 'OR000001', '@_IDDestino': 'DE000002' } },
        { '@_Descripcion': 'B', CantidadTransporta: [{ '@_IDOrigen': 'OR000001', '@_IDDestino': 'DE000001' }, { '@_IDOrigen': 'OR000001', '@_IDDestino': 'DE000002' }] },
      ],
    ))!;
    expect(r.extraccion.mercancias[0].id_destino.valor).toBe('2');
    expect(r.extraccion.mercancias[1].id_destino).toBeUndefined();
    expect(r.avisos.join(' ')).toMatch(/Mercancía 2.*varios destinos/);
  });

  it('un XML con un solo Origen y un solo Destino no cambia: sin avisos y confianza 0.99', () => {
    const r = leerCartaPorteXml(arbol([ub('Origen', 'OR000001', '66600'), ub('Destino', 'DE000001', '64000')]))!;
    expect(r.avisos).toEqual([]);
    expect(r.extraccion.campos.destino_cp.confianza).toBe(0.99);
    expect(r.extraccion.campos.destino_2_cp).toBeUndefined();
  });

  it('con más ubicaciones de las que caben: aviso explícito y la confianza de las ubicaciones baja para que una persona revise', () => {
    const muchos = Array.from({ length: 52 }, (_, i) => ub('Destino', `DE${String(i + 1).padStart(6, '0')}`, '64000'));
    const r = leerCartaPorteXml(arbol([ub('Origen', 'OR000001', '66600'), ...muchos]))!;
    expect(r.avisos.join(' ')).toMatch(/52 destinos.*solo se leyeron 50/);
    expect(r.extraccion.campos.destino_cp.confianza).toBeLessThanOrEqual(0.5);
  });
});

describe('A37-A3-20: la clave del material peligroso del XML se lee', () => {
  it('MaterialPeligroso Sí con CveMaterialPeligroso: la clave llega a la mercancía', () => {
    const r = leerCartaPorteXml(arbol([ub('Origen', 'OR000001', '66600'), ub('Destino', 'DE000001', '64000')],
      [{ '@_Descripcion': 'A', '@_MaterialPeligroso': 'Sí', '@_CveMaterialPeligroso': '1203' }]))!;
    expect(r.extraccion.mercancias[0].clave_material_peligroso?.valor).toBe('1203');
  });
});

