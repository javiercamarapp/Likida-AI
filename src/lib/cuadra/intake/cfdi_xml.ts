// ═══════════════════════════════════════════════════════════════════════════
// PARSER DEL XML DEL CFDI — NIVEL 2 de validación (Bloque 1, complemento
// hidrocarburos). El QR NO trae el complemento ni las claves de producto; solo
// el XML. El operador/oficina reenvía por WhatsApp el XML que la gasolinera le
// manda por correo. NO requiere e.firma ni portales.
//
// Extrae, a nivel concepto: ClaveProdServ, ClaveUnidad, y la PRESENCIA del nodo
// raíz `HidroYPetro` v1.0 (estándar CC_HYP_10, ns hidrocarburospetroliferos) del
// "Complemento Concepto para la facturación de Hidrocarburos y Petrolíferos",
// vigente 24-abr-2026 (regla 2.7.1.48 RMF; CFF 29 y 29-A). La DECISIÓN de
// deducibilidad la toma el motor determinístico, no este parser.
// ═══════════════════════════════════════════════════════════════════════════

import { XMLParser } from 'fast-xml-parser';

export interface CfdiConceptoXml {
  claveProdServ?: string;
  claveUnidad?: string;
  complemento: boolean; // el concepto trae hidrocarburosPetroliferos
}

export interface CfdiXmlData {
  version?: string;
  tipoComprobante?: string; // I | E | P | N | T
  fecha?: string;           // ISO del atributo Fecha del Comprobante
  rfcEmisor?: string;
  rfcReceptor?: string;
  total?: number;
  uuid?: string;
  conceptos: CfdiConceptoXml[];
  // Concepto REPRESENTATIVO (el de combustible si existe, si no el primero):
  claveProdServ?: string;
  claveUnidad?: string;
  complementoHidrocarburos: boolean; // el representativo trae el complemento
  // Esquema ALTERNO (monedero electrónico ECC o Carta Porte): la regla 2.7.1.48
  // NO aplica a estos; el motor NO debe declararlos no deducibles por complemento.
  esquemaAlterno: boolean;
}

// Familia SAT de petrolíferos (pista del parser para elegir el concepto de
// combustible; la DECISIÓN usa las claves de config, no este prefijo).
const PREFIJO_COMBUSTIBLE = '15101';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true, // cfdi:Comprobante → Comprobante, etc.
  isArray: (name) => name === 'Concepto',
  parseAttributeValue: false, // conservar strings (claves con ceros a la izq.)
});

function toArr<T>(v: T | T[] | undefined): T[] {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

/** Parsea el XML de un CFDI 4.0. Demo-safe: devuelve null ante cualquier error. */
export function parseCfdiXml(xml: string): CfdiXmlData | null {
  try {
    const doc = parser.parse(xml) as Record<string, unknown>;
    // Sin nodo Comprobante no es un CFDI → null (no un objeto vacío).
    if (!doc || !doc.Comprobante || typeof doc.Comprobante !== 'object') return null;
    const comp = doc.Comprobante as Record<string, unknown>;

    const emisor = (comp.Emisor ?? {}) as Record<string, string>;
    const receptor = (comp.Receptor ?? {}) as Record<string, string>;
    const conceptosNode = (comp.Conceptos ?? {}) as Record<string, unknown>;
    const conceptosRaw = toArr(conceptosNode.Concepto as Record<string, unknown>[] | undefined);

    const conceptos: CfdiConceptoXml[] = conceptosRaw.map((c) => {
      const cc = (c.ComplementoConcepto ?? {}) as Record<string, unknown>;
      // El nodo raíz del complemento es `HidroYPetro` (estándar CC_HYP_10,
      // ns hidrocarburospetroliferos). Detección TOLERANTE al nombre (con
      // removeNSPrefix el prefijo se va): cualquier hijo cuyo local-name aluda a
      // hidrocarburos/petrolíferos. Un nombre mal asumido = falso positivo de
      // "no deducible" sobre CFDIs válidos, así que se prefiere tolerar.
      const tieneComplemento =
        cc != null && typeof cc === 'object' && Object.keys(cc).some((k) => /hidro|petro/i.test(k));
      return {
        claveProdServ: (c['@_ClaveProdServ'] as string) || undefined,
        claveUnidad: (c['@_ClaveUnidad'] as string) || undefined,
        complemento: tieneComplemento,
      };
    });

    // UUID del Timbre Fiscal Digital (dentro de Complemento del comprobante).
    const complemento = (comp.Complemento ?? {}) as Record<string, unknown>;
    const tfd = toArr(complemento.TimbreFiscalDigital as Record<string, string>[] | undefined)[0]
      ?? (complemento.TimbreFiscalDigital as Record<string, string> | undefined);
    const uuidRaw = tfd?.['@_UUID'];

    // Esquemas alternos que la regla 2.7.1.48 excluye: Carta Porte (transporte)
    // y Estado de Cuenta de Combustibles / monedero electrónico (ECC).
    const compKeys = complemento && typeof complemento === 'object' ? Object.keys(complemento) : [];
    const esquemaAlterno = compKeys.some((k) => /cartaporte|estadodecuentacombustible|consumodecombustibles/i.test(k));

    // Representativo: el primer concepto de combustible; si no hay, el primero.
    const rep = conceptos.find((c) => c.claveProdServ?.startsWith(PREFIJO_COMBUSTIBLE)) ?? conceptos[0];

    const totalRaw = comp['@_Total'] as string | undefined;
    const total = totalRaw != null ? parseFloat(totalRaw) : undefined;

    return {
      version: (comp['@_Version'] as string) || undefined,
      tipoComprobante: (comp['@_TipoDeComprobante'] as string) || undefined,
      fecha: (comp['@_Fecha'] as string) || undefined,
      rfcEmisor: (emisor['@_Rfc'] as string)?.toUpperCase() || undefined,
      rfcReceptor: (receptor['@_Rfc'] as string)?.toUpperCase() || undefined,
      total: total != null && !Number.isNaN(total) ? total : undefined,
      uuid: uuidRaw ? uuidRaw.toLowerCase() : undefined,
      conceptos,
      claveProdServ: rep?.claveProdServ,
      claveUnidad: rep?.claveUnidad,
      complementoHidrocarburos: rep?.complemento ?? false,
      esquemaAlterno,
    };
  } catch {
    return null;
  }
}

/** ¿La clave de producto es de combustible según el catálogo (config)? */
export function esClaveCombustible(clave: string | undefined, claves: string[]): boolean {
  return !!clave && claves.includes(clave);
}
