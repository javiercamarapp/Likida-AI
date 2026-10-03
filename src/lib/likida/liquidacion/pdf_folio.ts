// El PDF «SOLO FOLIO» del cierre (E1-B, P0-7, decisión de Javier: default sí).
//
// El encargado opera el día a día pero NO ve dinero (`visibilidad.ts`: solo
// `operacion`), así que el ejemplar completo —anticipo, comprobado, diferencia,
// veredictos fiscales— no es para él (auditoría 18, A28: el canal no puede ser
// la puerta trasera de la matriz de visibilidad). Pero sí tiene que saber que el
// viaje quedó cerrado y bajo qué folio, para archivarlo contra su bitácora.
//
// Este papel es ese acuse: el folio, el operador, la fecha de cierre y si la
// oficina todavía tiene algo que resolver. NINGUNA cifra: la función ni siquiera
// recibe importes, así que no hay forma de que se cuele uno. Determinístico,
// sin LLM.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { fechaMx } from '@/lib/formato';
import { sanearWinAnsi } from './winansi';

export interface DatosFolio {
  folio: string;
  operador: string;
  /** ISO del cierre. */
  cerradaEn: string;
  /** `true` = hay algo que la oficina debe decidir (la misma señal que el
   *  aviso de decisión). Es un hecho, no una cifra. */
  requiereRevisionDeOficina: boolean;
}

/** Los renglones que se imprimen, separados del dibujo para poder probar —sin
 *  abrir el PDF— que no hay una sola cifra de dinero. */
export function lineasSoloFolio(d: DatosFolio): string[] {
  return [
    'Acuse de cierre de liquidación',
    `Folio: ${sanearWinAnsi(d.folio)}`,
    `Operador: ${sanearWinAnsi(d.operador)}`,
    `Cierre: ${fechaMx(d.cerradaEn)}`,
    d.requiereRevisionDeOficina
      ? 'Estado: cerrada; la oficina tiene una decisión pendiente sobre este viaje.'
      : 'Estado: cerrada y cuadrada; no hay nada pendiente.',
    'Este acuse no incluye cifras. El detalle de la liquidación lo tiene la oficina.',
  ];
}

export async function generarPdfSoloFolio(d: DatosFolio): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // B1: Helvetica estándar (WinAnsi): un nombre de operador con un carácter fuera de WinAnsi (CJK,
  // emoji, controles) hacía lanzar `drawText` y el acuse no salía. Todo texto de datos se sanea.
  doc.setTitle(`Cierre ${sanearWinAnsi(d.folio)}`);
  doc.setProducer('Likida');
  const page = doc.addPage([595.28, 841.89]);
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.06, 0.06, 0.09);
  const muted = rgb(0.45, 0.47, 0.52);
  const [titulo, ...resto] = lineasSoloFolio(d);
  let y = 770;
  page.drawText(sanearWinAnsi(titulo), { x: 48, y, size: 18, font: negrita, color: ink });
  y -= 40;
  for (const l of resto) {
    const esPie = l.startsWith('Este acuse');
    page.drawText(sanearWinAnsi(l), { x: 48, y, size: esPie ? 9 : 12, font: normal, color: esPie ? muted : ink });
    y -= esPie ? 20 : 26;
  }
  return doc.save();
}
