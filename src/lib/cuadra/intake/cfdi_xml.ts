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
  formaPago?: string;       // c_FormaPago (01=efectivo, 03=transferencia, 04/28=tarjeta…)
  subTotal?: number;        // @SubTotal (sin impuestos) — base del estímulo de peaje
  rfcEmisor?: string;
  rfcReceptor?: string;
  total?: number;
  iepsTraslado: number;     // Σ Traslado[Impuesto=003] Importe → IEPS acreditable
  ivaTraslado: number;      // Σ Traslado[Impuesto=002] Importe → IVA acreditable
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
  isArray: (name) => name === 'Concepto' || name === 'Traslado',
  parseAttributeValue: false, // conservar strings (claves con ceros a la izq.)
});

function toArr<T>(v: T | T[] | undefined): T[] {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

/** Parsea el XML de un CFDI 4.0. Demo-safe: devuelve null ante cualquier error. */
/**
 * La `FormaPago` del CFDI, normalizada al catálogo `c_FormaPago` del SAT (dos
 * dígitos) o descartada.
 *
 * ── POR QUÉ NO SE PASA EL ATRIBUTO TAL CUAL (auditoría 6, modelo de datos) ──
 *
 * La migración 0025 puso `gasto_forma_pago_formato` —`forma_pago is null or
 * forma_pago ~ '^[0-9]{2}$'`— para cazar un fallo del mapeo de OCR. Ese camino
 * ya estaba blindado con zod. Pero hay un SEGUNDO escritor que la migración no
 * contempló: este parser, que leía `@_FormaPago` sin validar nada, y cuyo valor
 * llega a `gasto` por los dos únicos caminos de escritura que existen.
 *
 * Un CFDI bien timbrado —UUID válido, RFC, total y fecha correctos— emitido por
 * software de facturación de una gasolinera independiente puede traer
 * `FormaPago="1"` en vez de `"01"`. Un solo dígito. Con eso, el `insert`
 * violaba el CHECK (23514), `pg_errores.ts` no sabe traducir ese código,
 * `processor.ts` solo reconoce los dos índices únicos y el resto cae en
 * `throw e`, y el comprobante se perdía ENTERO — sin guardar siquiera el XML
 * crudo que el CFF art. 30 obliga a conservar cinco años.
 *
 * Perder un dato accesorio es incomparablemente mejor que perder el CFDI. Un
 * dígito suelto se rellena (el catálogo del SAT va de `01` a `99`, así que "1"
 * solo puede querer decir "01"); cualquier otra cosa se descarta a `undefined`,
 * que el CHECK acepta como `null`. La verdad de referencia sigue completa en el
 * XML crudo.
 */
export function formaPagoSat(bruto: string | undefined | null): string | undefined {
  const v = String(bruto ?? '').trim();
  if (!/^\d{1,2}$/.test(v)) return undefined;
  return v.padStart(2, '0');
}

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

    const num = (v: unknown): number | undefined => {
      if (v == null) return undefined;
      const n = parseFloat(v as string);
      return Number.isNaN(n) ? undefined : n;
    };

    // Impuestos trasladados a nivel comprobante: 002=IVA, 003=IEPS.
    const impuestos = (comp.Impuestos ?? {}) as Record<string, unknown>;
    const traslados = toArr(
      (impuestos.Traslados as Record<string, unknown> | undefined)?.Traslado as Record<string, string>[] | undefined,
    );
    let iepsTraslado = 0;
    let ivaTraslado = 0;
    for (const t of traslados) {
      const imp = t['@_Impuesto'];
      const importe = num(t['@_Importe']) ?? 0;
      if (imp === '003') iepsTraslado += importe;
      else if (imp === '002') ivaTraslado += importe;
    }

    return {
      version: (comp['@_Version'] as string) || undefined,
      tipoComprobante: (comp['@_TipoDeComprobante'] as string) || undefined,
      fecha: (comp['@_Fecha'] as string) || undefined,
      formaPago: formaPagoSat(comp['@_FormaPago'] as string | undefined),
      subTotal: num(comp['@_SubTotal']),
      rfcEmisor: (emisor['@_Rfc'] as string)?.toUpperCase() || undefined,
      rfcReceptor: (receptor['@_Rfc'] as string)?.toUpperCase() || undefined,
      total: num(comp['@_Total']),
      iepsTraslado,
      ivaTraslado,
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
