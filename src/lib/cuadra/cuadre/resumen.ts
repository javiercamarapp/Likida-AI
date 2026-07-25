// Resumen DETERMINÍSTICO del cuadre para WhatsApp (sin LLM). Es la respuesta
// autoritativa cuando la guardia detecta que el agente reportó cifras sin haber
// llamado la tool. Los números salen del motor, nunca del modelo.

import type { Liquidacion } from '@/types/cuadra';

const mxn = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

export function resumenCuadre(liq: Omit<Liquidacion, 'id' | 'creadaEn'>, cerrado = true): string {
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
  const obs = liq.diferencias.filter((d) => d.tipo !== 'anticipo');
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
  return lines.join('\n');
}
