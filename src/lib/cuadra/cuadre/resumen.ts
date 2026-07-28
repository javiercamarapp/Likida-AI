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
export const SOLO_CONTRALOR: TipoDiferencia[] = [
  'cfdi_efos', 'cfdi_efos_indeterminado', 'cfdi_cancelado', 'cfdi_no_encontrado',
  'cfdi_pendiente', 'rfc_receptor', 'complemento_hidrocarburos',
  'ieps_no_desglosado', 'texto_sospechoso',
];

// `complemento_no_verificable` NO va en esa lista, y estuvo. Su propia nota le
// dice al operador "reenvía el XML (el que te manda la gasolinera por correo)":
// filtrarla hacía que la petición nunca llegara a quien tiene el correo, y sin
// ese XML la flota pierde el acreditamiento de IVA y el estímulo de diésel.
//
// La regla de SOLO_CONTRALOR es "veredictos que el operador no puede arreglar y
// que además lo señalan". Este es justo lo contrario: es lo único que él sí
// puede arreglar.

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
    // Truncar en silencio hace que quien lo lee crea que vio todo. El conteo va
    // sobre `obs` YA filtrada por destinatario, no sobre la lista completa.
    if (obs.length > 6) lines.push(`• …y ${obs.length - 6} observación(es) más en el panel.`);
  }

  // LITROS, NO PESOS. `engine.ts` fija `iepsAcreditable = 0` a propósito: el
  // estímulo del LIF 20-A es cuota semanal del DOF × litros y el motor no puede
  // calcularlo. Entregar los litros es honesto; inventar los pesos, no. La línea
  // del IEPS que vivía aquí era código muerto —ninguna ruta puede producir
  // `iepsAcreditable > 0`, porque `desde_db.ts` recalcula con `cuadrarViaje` en
  // vez de leer la columna— y los litros, que son el beneficio más grande que
  // Likida le enseña a una flota, no aparecían en el canal por el que se vende.
  if (liq.litrosDieselAcreditables > 0 || liq.ivaAcreditable > 0 || liq.peajeAcreditable > 0) {
    lines.push('', 'Acreditable (recuperable):');
    if (liq.litrosDieselAcreditables > 0) lines.push(`• Diésel elegible para el estímulo de IEPS: ${liq.litrosDieselAcreditables} L`);
    if (liq.ivaAcreditable > 0) lines.push(`• IVA: ${mxn(liq.ivaAcreditable)}`);
    if (liq.peajeAcreditable > 0) lines.push(`• Peaje 50%: ${mxn(liq.peajeAcreditable)}`);
  }

  // El descargo va SOLO al contralor: es quien toma decisiones fiscales con
  // esto. Meterle un aviso legal a un mensaje que le dice al operador "mándame
  // la factura" no protege de nada y sí estorba.
  if (destinatario === 'contralor') lines.push('', LEYENDA_CORTA);

  return lines.join('\n');
}
