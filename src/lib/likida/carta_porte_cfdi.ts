// ═══════════════════════════════════════════════════════════════════════════
// EL CFDI TIMBRABLE (0226) — la segunda vía de la Fase D, decidida el
// 27-ago-2026: "sí al PAC".
//
// La vía export (carta_porte_xml.ts) arma un PRE-CFDI con huecos declarados
// para que el facturador de la flota los complete. Esta vía los completa EN
// LIKIDA — con datos CAPTURADOS, jamás supuestos — y produce el CFDI de
// ingreso completo y SIN sellar que el PAC sella (con el CSD de su bóveda) y
// timbra. El complemento Carta Porte es EL MISMO nodo en ambas vías
// (nodoComplementoCcp): un solo constructor, una sola verdad.
//
// LO QUE ESTE MÓDULO CALCULA Y POR QUÉ ES DETERMINISTA:
//   · SubTotal = `viaje.ingreso_flete` — el precio PACTADO capturado en el
//     viaje (0048). Sin ingreso capturado no hay CFDI: el precio del flete
//     jamás se inventa.
//   · IVA trasladado 16% — tasa general vigente (LIVA 1). El autotransporte
//     de carga NO es tasa 0 ni exento.
//   · Retención de IVA del 4% SOLO cuando el receptor es persona MORAL:
//     LIVA 1-A fracción II inciso c) obliga a las morales que reciben
//     servicios de autotransporte terrestre de bienes a retener; la regla
//     3.1.2 de la RMF fija el 4%. Persona moral = RFC de 12 caracteres
//     (las físicas tienen 13) — es estructura del RFC, no una suposición.
//   · Fecha = ahora en hora de México MENOS 2 minutos: el SAT rechaza fechas
//     futuras y los relojes de servidor difieren en segundos; dos minutos
//     atrás siguen dentro de las 72 h que el timbre admite y nunca caen "en
//     el futuro" del PAC.
//   · MetodoPago PPD obliga FormaPago 99 ("Por definir") — regla dura del
//     Anexo 20; con PUE la forma es la real capturada.
//
// PURO: recibe todo leído (perfil del emisor, receptor fiscal, ingreso) y no
// toca red ni base. Quien lee y quien llama al PAC es carta_porte_timbre.ts.
// ═══════════════════════════════════════════════════════════════════════════

import type { ViajeCcp } from './carta_porte_datos';
import { nodoComplementoCcp, escaparXml } from './carta_porte_xml';
import { fechaHoraSat } from '@/lib/formato';

/** Clave del catálogo c_ClaveProdServ para el flete: «Servicio de transporte
 *  de carga por carretera». Es la clave del SERVICIO facturado (no confundir
 *  con c_ClaveProdServCP de las mercancías, que da el cliente). */
const CLAVE_PROD_SERV_FLETE = '78101800';
/** c_ClaveUnidad E48: «Unidad de servicio». */
const CLAVE_UNIDAD_SERVICIO = 'E48';

export interface EmisorFiscal {
  rfc: string | null;
  razonSocial: string | null;
  regimenFiscal: string | null;
  lugarExpedicion: string | null;
  serie: string | null;
  modo: 'sandbox' | 'produccion';
}

export interface ReceptorFiscal {
  rfc: string | null;
  razonSocial: string | null;
  regimenFiscal: string | null;
  usoCfdi: string | null;
  cpFiscal: string | null;
}

export interface ParametrosEmision {
  metodoPago: 'PUE' | 'PPD';
  /** Clave c_FormaPago (01, 03, 99…). Con PPD se fuerza a 99 — regla del
   *  Anexo 20, no una preferencia. */
  formaPago: string;
}

export type ResultadoCfdi =
  | {
      ok: true;
      xml: string;
      subTotal: number;
      iva: number;
      /** null = receptor persona física: no hay obligación de retener. */
      retencionIva: number | null;
      total: number;
    }
  | { ok: false; faltantes: string[] };

const dinero = (n: number): number => Math.round(n * 100) / 100;
const attr = (n: number): string => n.toFixed(2);

/**
 * El CFDI de ingreso COMPLETO y sin sellar, listo para el `issue` del PAC.
 * Fail-closed: cada dato que falte es un renglón de `faltantes` con dónde se
 * captura — jamás un default silencioso.
 */
export function armarCfdiTimbrable(
  v: ViajeCcp,
  idCcp: string,
  emisor: EmisorFiscal,
  receptor: ReceptorFiscal,
  ingresoFlete: number | null,
  emision: ParametrosEmision,
  ahora: Date = new Date(),
): ResultadoCfdi {
  const faltantes: string[] = [];

  // ── El emisor (flota_fiscal) ─────────────────────────────────────────────
  if (emisor.rfc === null) faltantes.push('RFC del emisor — captúralo en el perfil de timbrado (panel del contador).');
  if (emisor.razonSocial === null) faltantes.push('Razón social del emisor (exacta a tu constancia) — perfil de timbrado.');
  if (emisor.regimenFiscal === null) faltantes.push('Régimen fiscal del emisor (clave de 3 dígitos, p. ej. 601) — perfil de timbrado.');
  if (emisor.lugarExpedicion === null) faltantes.push('CP de expedición (LugarExpedicion) — perfil de timbrado.');

  // ── El receptor (cliente) ────────────────────────────────────────────────
  if (receptor.rfc === null) faltantes.push('RFC del cliente — captúralo en el cliente del viaje.');
  if (receptor.razonSocial === null) faltantes.push('Razón social fiscal del cliente (exacta a SU constancia — el nombre comercial no sirve para timbrar).');
  if (receptor.regimenFiscal === null) faltantes.push('Régimen fiscal del cliente (clave de 3 dígitos).');
  if (receptor.usoCfdi === null) faltantes.push('Uso CFDI que pide el cliente (S01, G03…).');
  if (receptor.cpFiscal === null) faltantes.push('CP del domicilio fiscal del cliente.');

  // ── El precio ────────────────────────────────────────────────────────────
  if (ingresoFlete === null || !Number.isFinite(ingresoFlete) || ingresoFlete <= 0) {
    faltantes.push('El ingreso del flete del viaje (el precio pactado) — captúralo en el viaje; el precio jamás se inventa.');
  }

  // ── La emisión ───────────────────────────────────────────────────────────
  if (emision.metodoPago === 'PPD' && emision.formaPago !== '99') {
    faltantes.push('Con método de pago PPD la forma de pago debe ser 99 «Por definir» (Anexo 20).');
  }
  if (emision.metodoPago === 'PUE' && !/^[0-9]{2}$/.test(emision.formaPago)) {
    faltantes.push('Con PUE la forma de pago es la clave real de 2 dígitos (01 efectivo, 03 transferencia…).');
  }

  // ── Lo que el TIMBRE exige y el pre-CFDI dejaba como comentario ──────────
  // El PAC rebotaría cada uno con su código; decirlos ANTES ahorra el viaje.
  const d = v.datos;
  const cc = v.datosCliente;
  if (cc.transpInternac === null) faltantes.push('TranspInternac sin declarar en el viaje — decláralo (el timbre lo exige).');
  if (cc.origenCp === null) faltantes.push('CP del origen (dato del cliente) — sin él, la Ubicación de origen rebota.');
  if (cc.destinoCp === null) faltantes.push('CP del destino (dato del cliente).');
  if (d.unidad?.permisoSictTipo == null || d.unidad?.permisoSictNumero == null) {
    faltantes.push('Permiso SICT de la unidad (tipo y número) — captúralo en Unidades; jamás se inventa.');
  }
  if (d.unidad?.aseguradoraRc == null || d.unidad?.polizaRcNumero == null) {
    faltantes.push('Seguro de responsabilidad civil de la unidad (aseguradora y póliza) — captúralo en Unidades.');
  }
  if (d.unidad?.configVehicular == null) faltantes.push('Configuración vehicular de la unidad (C2, T3S2…) — captúralo en Unidades.');

  // El complemento con sus propios candados (borrador validado, etc.).
  const comp = nodoComplementoCcp(v, idCcp);
  if (!comp.ok) return { ok: false, faltantes: [...faltantes, ...comp.motivos] };

  if (faltantes.length > 0) return { ok: false, faltantes };
  // Tras el gate, los campos son no-nulos; el cast es la afirmación de arriba.
  const em = emisor as { rfc: string; razonSocial: string; regimenFiscal: string; lugarExpedicion: string; serie: string | null };
  const re = receptor as { rfc: string; razonSocial: string; regimenFiscal: string; usoCfdi: string; cpFiscal: string };
  const sub = dinero(ingresoFlete as number);
  const iva = dinero(sub * 0.16);
  const esMoral = re.rfc.length === 12;
  const ret = esMoral ? dinero(sub * 0.04) : null;
  const total = dinero(sub + iva - (ret ?? 0));

  const fecha = fechaHoraSat(new Date(ahora.getTime() - 120_000).toISOString());
  if (fecha === null) return { ok: false, faltantes: ['El reloj del sistema no produjo una fecha legible — reintenta.'] };

  const rotulo = v.folio ?? v.viajeId.slice(0, 8);
  const ruta = v.origen !== null && v.destino !== null ? ` (${v.origen} → ${v.destino})` : '';
  const descripcion = `Servicio de autotransporte federal de carga, viaje ${rotulo}${ruta}`;

  const lineas: string[] = [];
  const abre = (s: string) => lineas.push(s);

  abre('<?xml version="1.0" encoding="UTF-8"?>');
  abre('<cfdi:Comprobante');
  abre('  xmlns:cfdi="http://www.sat.gob.mx/cfd/4"');
  abre('  xmlns:cartaporte31="http://www.sat.gob.mx/CartaPorte31"');
  abre('  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
  abre('  xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd http://www.sat.gob.mx/CartaPorte31 http://www.sat.gob.mx/sitio_internet/cfd/CartaPorte/CartaPorte31.xsd"');
  const serie = em.serie === null ? '' : ` Serie="${escaparXml(em.serie)}"`;
  const folio = v.folio === null ? '' : ` Folio="${escaparXml(v.folio)}"`;
  // Sello, NoCertificado y Certificado AUSENTES a propósito: el servicio
  // `issue` del PAC exige el CFDI sin sellar y sella con el CSD de su bóveda.
  abre(`  Version="4.0"${serie}${folio} Fecha="${fecha}" FormaPago="${escaparXml(emision.formaPago)}" SubTotal="${attr(sub)}" Moneda="MXN" Total="${attr(total)}" TipoDeComprobante="I" Exportacion="01" MetodoPago="${emision.metodoPago}" LugarExpedicion="${escaparXml(em.lugarExpedicion)}">`);
  abre(`  <cfdi:Emisor Rfc="${escaparXml(em.rfc)}" Nombre="${escaparXml(em.razonSocial)}" RegimenFiscal="${escaparXml(em.regimenFiscal)}"/>`);
  abre(`  <cfdi:Receptor Rfc="${escaparXml(re.rfc)}" Nombre="${escaparXml(re.razonSocial)}" DomicilioFiscalReceptor="${escaparXml(re.cpFiscal)}" RegimenFiscalReceptor="${escaparXml(re.regimenFiscal)}" UsoCFDI="${escaparXml(re.usoCfdi)}"/>`);
  abre('  <cfdi:Conceptos>');
  abre(`    <cfdi:Concepto ClaveProdServ="${CLAVE_PROD_SERV_FLETE}" Cantidad="1" ClaveUnidad="${CLAVE_UNIDAD_SERVICIO}" Descripcion="${escaparXml(descripcion)}" ValorUnitario="${attr(sub)}" Importe="${attr(sub)}" ObjetoImp="02">`);
  abre('      <cfdi:Impuestos>');
  abre('        <cfdi:Traslados>');
  abre(`          <cfdi:Traslado Base="${attr(sub)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${attr(iva)}"/>`);
  abre('        </cfdi:Traslados>');
  if (ret !== null) {
    abre('        <cfdi:Retenciones>');
    abre(`          <cfdi:Retencion Base="${attr(sub)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.040000" Importe="${attr(ret)}"/>`);
    abre('        </cfdi:Retenciones>');
  }
  abre('      </cfdi:Impuestos>');
  abre('    </cfdi:Concepto>');
  abre('  </cfdi:Conceptos>');
  // Orden del XSD en el resumen global: Retenciones antes que Traslados.
  const totRet = ret === null ? '' : ` TotalImpuestosRetenidos="${attr(ret)}"`;
  abre(`  <cfdi:Impuestos${totRet} TotalImpuestosTrasladados="${attr(iva)}">`);
  if (ret !== null) {
    abre('    <cfdi:Retenciones>');
    abre(`      <cfdi:Retencion Impuesto="002" Importe="${attr(ret)}"/>`);
    abre('    </cfdi:Retenciones>');
  }
  abre('    <cfdi:Traslados>');
  abre(`      <cfdi:Traslado Base="${attr(sub)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${attr(iva)}"/>`);
  abre('    </cfdi:Traslados>');
  abre('  </cfdi:Impuestos>');
  lineas.push(...comp.lineas);
  abre('</cfdi:Comprobante>');

  return { ok: true, xml: lineas.join('\n') + '\n', subTotal: sub, iva, retencionIva: ret, total };
}
