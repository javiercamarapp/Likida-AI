// Resumen DETERMINÍSTICO del cuadre para WhatsApp (sin LLM). Es la respuesta
// autoritativa cuando la guardia detecta que el agente reportó cifras sin haber
// llamado la tool. Los números salen del motor, nunca del modelo.

import { LEYENDA_CORTA } from './leyendas';
import type { Liquidacion, TipoDiferencia } from '@/types/cuadra';

const mxn = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

/** Quién va a leer esto. Cambia qué se dice, no los números. */
export type Destinatario = 'operador' | 'contralor';

/**
 * Veredictos que el OPERADOR no puede arreglar y que además lo señalan: que su
 * proveedor está en la lista negra del SAT, que el CFDI salió cancelado, que el
 * receptor no es el RFC de la empresa.
 *
 * Nada de eso depende de él —son problemas del EMISOR o del timbrado— y
 * mandárselo por WhatsApp no produce ninguna acción, solo la sensación de que se
 * le está auditando. Van al contralor, que sí puede hacer algo.
 *
 * Al operador se le pide lo que falta; no se le juzga.
 */
const SOLO_CONTRALOR: TipoDiferencia[] = [
  'cfdi_efos', 'cfdi_efos_indeterminado', 'cfdi_cancelado', 'cfdi_no_encontrado',
  'cfdi_pendiente', 'rfc_receptor', 'complemento_hidrocarburos',
  'complemento_no_verificable', 'ieps_no_desglosado',
];

export function resumenCuadre(
  liq: Omit<Liquidacion, 'id' | 'creadaEn'>,
  cerrado = true,
  // Default 'contralor': el destinatario que ve TODO. Si algún llamador se
  // olvida de pasarlo, el riesgo es enseñar de más a quien ya podía verlo,
  // nunca ocultarle algo a quien lo necesita.
  destinatario: Destinatario = 'contralor',
): string {
  const lines = [
    // Si el viaje quedó cerrado en este turno, se afirma el cierre; si la guardia
    // solo está mostrando el cuadre (sin cierre confirmado), encabezado neutral.
    cerrado ? 'Listo, cuadré tu viaje 👇' : 'Este es el cuadre de tu viaje 👇',
    `• Comprobado: ${mxn(liq.totalComprobado)}`,
    `• Anticipo: ${mxn(liq.totalAnticipo)}`,
    liq.diferencia > 0
      ? `• Sobró ${mxn(liq.diferencia)} del anticipo (a favor de la empresa)`
      : liq.diferencia < 0
      ? `• Pusiste ${mxn(-liq.diferencia)} de tu bolsa (a favor tuyo)`
      : '• Cuadra exacto ✅',
  ];

  const obs = liq.diferencias
    .filter((d) => d.tipo !== 'anticipo')
    .filter((d) => destinatario === 'contralor' || !SOLO_CONTRALOR.includes(d.tipo));
  if (obs.length) {
    lines.push('', 'Ojo con esto:');
    for (const d of obs.slice(0, 6)) lines.push(`• ${d.nota}`);
  }

  if (liq.iepsAcreditable > 0 || liq.ivaAcreditable > 0 || liq.peajeAcreditable > 0) {
    lines.push('', 'Acreditable (recuperable):');
    if (liq.iepsAcreditable > 0) lines.push(`• IEPS diésel: ${mxn(liq.iepsAcreditable)}`);
    if (liq.ivaAcreditable > 0) lines.push(`• IVA: ${mxn(liq.ivaAcreditable)}`);
    if (liq.peajeAcreditable > 0) lines.push(`• Peaje 50%: ${mxn(liq.peajeAcreditable)}`);
  }

  // El descargo va SOLO al contralor: es quien toma decisiones fiscales con
  // esto. Meterle un aviso legal a un mensaje que le dice al operador "mándame
  // la factura" no protege de nada y sí estorba.
  if (destinatario === 'contralor') lines.push('', LEYENDA_CORTA);

  return lines.join('\n');
}
