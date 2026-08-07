import { describe, it, expect } from 'vitest';
import { generarLiquidacionPDF } from './pdf';
import type { Liquidacion, Viaje, Operador } from '@/types/likida';

// ═══════════════════════════════════════════════════════════════════════════
// EL SANEADO A WinAnsi TENÍA UN HUECO EN LO QUE DICE PROTEGER.
//
// pdf-lib con la fuente estándar Helvetica codifica WinAnsi, que no mapea todo
// Unicode. Por eso hay un saneador: "cualquier char fuera de Latin-1 sin mapeo →
// '?' para que el PDF NUNCA truene por datos de OCR".
//
// Pero el rango del regex empezaba en un byte NUL literal —invisible en el
// editor, donde parecía un espacio— en vez de en el espacio 0x20. Con `\x00-ÿ`
// los caracteres de CONTROL quedan DENTRO del rango permitido y pasan enteros a
// drawText.
//
// Y los datos de aquí vienen de OCR de fotos de tickets térmicos: exactamente de
// donde salen los bytes raros.
//
// El NUL además hacía que `file` clasificara pdf.ts como binario, así que git no
// mostraba sus diffs y las búsquedas que saltan binarios no lo encontraban.
// ═══════════════════════════════════════════════════════════════════════════
const liq = (extra: Partial<Liquidacion> = {}): Liquidacion => ({
  id: 'l1', viajeId: 'v1', creadaEn: '2026-05-02T10:00:00Z',
  totalComprobado: 1000, totalAnticipo: 1000, diferencia: 0, estatus: 'cuadrada',
  totalDeducible: 1000, totalNoDeducible: 0, totalPorConfirmar: 0,
  iepsAcreditable: 0, litrosDieselAcreditables: 0, ivaAcreditable: 0, peajeAcreditable: 0,
  diferencias: [], gastos: [{ id: 'g1', concepto: 'diesel', monto: 1000, folio: 'A1', fecha: '2026-05-01' }],
  ...extra,
});
const viaje: Viaje = { id: 'v1', folio: 'VJ-1', origen: 'Mérida', destino: 'Cancún', anticipo: 1000 };
const operador: Operador = { id: 'o1', nombre: 'Juan Pérez', telefono: '+52', terminal: 'Mérida' };

describe('generarLiquidacionPDF — saneado de texto', () => {
  it('aguanta caracteres de CONTROL en datos de OCR', async () => {
    // Un ticket térmico mal leído puede meter \x01, \x1b (escape de impresora),
    // \t o \r en cualquier campo de texto.
    const sucio: Operador = { ...operador, nombre: 'Juan\x01P\x1bérez\r\tGómez' };
    const bytes = await generarLiquidacionPDF(liq(), { ...viaje, origen: 'Mé\x00rida', destino: 'Can\x07cún' }, sucio);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('aguanta un carácter de control en la NOTA de una diferencia', async () => {
    const l = liq({ diferencias: [{ tipo: 'sin_cfdi', concepto: 'diesel', monto: 0, nota: 'Falta CFDI\x1b[0m del diésel', gastoId: 'g1' }] });
    const bytes = await generarLiquidacionPDF(l, viaje, operador);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('sigue generando bien el caso normal', async () => {
    const bytes = await generarLiquidacionPDF(liq(), viaje, operador, 'TRANSPORTES DEL SURESTE SA DE CV');
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('no deja bytes de control en el fuente del propio módulo', async () => {
    // El NUL de la línea 91 hacía que `file` clasificara pdf.ts como binario:
    // git no mostraba sus diffs y las búsquedas que saltan binarios lo ignoraban
    // entero. Un archivo de código no puede tener bytes de control.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./pdf.ts', import.meta.url));
    const malos = [...src].filter((b) => b < 0x09 || (b > 0x0d && b < 0x20));
    expect(malos, 'hay bytes de control en pdf.ts').toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 4 · ALTO — la sección que protege al operador desaparecía según un
// flag de configuración de la flota, no según la ley.
//
// `pdf.ts` reconstruía las cubetas del motor desde `diferencias` con UN criterio
// (el tipo) y se saltaba el segundo (la ausencia de UUID). Como `sin_cfdi` solo
// se emite si la política del tenant trae `requiereCfdi` —y DEMO_CONFIG solo lo
// pone en `factura`— un hospedaje sin timbrar no entraba en ninguna cubeta del
// PDF, y "LO QUE SE LE REEMBOLSA AL OPERADOR" no se imprimía.
//
// Esa sección existe para impedir la lectura "no deducible ⇒ se lo descuento",
// que la LFT no permite. Con la configuración por defecto del demo, faltaba.
// ═══════════════════════════════════════════════════════════════════════════

/** Texto imprimible del PDF: infla los streams y junta lo que va a `Tj`. */
async function textoDelPdf(bytes: Uint8Array): Promise<string> {
  const { inflateSync } = await import('node:zlib');
  const buf = Buffer.from(bytes);
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x73 && buf.subarray(i, i + 6).toString('latin1') === 'stream') {
      let ini = i + 6;
      while (buf[ini] === 0x0d || buf[ini] === 0x0a) ini++;
      const fin = buf.indexOf(Buffer.from('endstream'), ini);
      if (fin < 0) continue;
      try { out += inflateSync(buf.subarray(ini, fin)).toString('latin1'); } catch { /* no comprimido */ }
      i = fin;
    }
  }
  // pdf-lib escribe las cadenas en HEX (`<466F6C696F> Tj`), no entre paréntesis.
  return out.replace(/<([0-9A-Fa-f]+)>\s*Tj/g, (_m, hex: string) =>
    Buffer.from(hex, 'hex').toString('latin1'));
}

describe('el PDF clasifica con el motor, no por su cuenta', () => {
  // Hospedaje de $2,000 SIN timbrar. Con la política del demo (tope, sin
  // requiereCfdi) el motor lo manda a POR CONFIRMAR y no emite `sin_cfdi`.
  const sinTimbrar = liq({
    totalComprobado: 2000, totalAnticipo: 2000, totalDeducible: 0, totalPorConfirmar: 2000,
    diferencias: [],
    gastos: [{ id: 'g1', concepto: 'hospedaje', monto: 2000, fecha: '2026-05-01' }],
  });

  it('imprime la sección de reembolso al operador aunque no exista la diferencia `sin_cfdi`', async () => {
    const bytes = await generarLiquidacionPDF(sinTimbrar, viaje, { ...operador, terminal: 'Mérida' });
    expect(await textoDelPdf(bytes)).toMatch(/REEMBOLSA AL OPERADOR/);
  });

  it('el extractor de texto de esta prueba de verdad lee el PDF (si no, la de arriba no prueba nada)', async () => {
    const bytes = await generarLiquidacionPDF(sinTimbrar, viaje, operador);
    expect(await textoDelPdf(bytes)).toMatch(/Juan/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 4 · ALTO — el PDF le entregaba al chofer lo que el mensaje le ocultaba.
//
// `resumen.ts` filtra del texto al operador los veredictos que él no puede
// arreglar y que además lo señalan (EFOS, CFDI cancelado, RFC receptor), con el
// argumento escrito de que "al operador se le pide lo que falta; no se le juzga".
// `processor.ts` pasa 'operador' con cuidado en los tres sitios.
//
// Y acto seguido `sendDocument(msg.from, ...)` —el MISMO teléfono del chofer—
// mandaba el PDF, que imprimía `liq.diferencias` completo. La defensa del texto
// no valía nada, y encima en un documento que se puede reenviar.
// ═══════════════════════════════════════════════════════════════════════════
describe('el PDF respeta el mismo destinatario que el mensaje', () => {
  const conEfos = liq({
    diferencias: [
      { tipo: 'cfdi_efos', concepto: 'diesel', monto: 8000, nota: 'El emisor del CFDI de Diésel está en lista negra del SAT (EFOS) — no deducible.', gastoId: 'g1' },
      { tipo: 'complemento_no_verificable', concepto: 'diesel', monto: 0, nota: 'La factura de Diésel es de combustible: reenvía el XML para verificar el complemento.', gastoId: 'g1' },
    ],
  });

  it('el ejemplar del CONTRALOR trae el veredicto completo', async () => {
    const t = await textoDelPdf(await generarLiquidacionPDF(conEfos, viaje, operador, undefined, 'contralor'));
    expect(t).toMatch(/lista negra|EFOS/);
  });

  it('el ejemplar del OPERADOR no lo trae', async () => {
    const t = await textoDelPdf(await generarLiquidacionPDF(conEfos, viaje, operador, undefined, 'operador'));
    expect(t).not.toMatch(/lista negra|EFOS/);
  });

  it('pero sí trae lo que él SÍ puede arreglar: el XML que se le pide', async () => {
    const t = await textoDelPdf(await generarLiquidacionPDF(conEfos, viaje, operador, undefined, 'operador'));
    expect(t).toMatch(/XML/);
  });

  it('sin destinatario explícito se comporta como contralor: enseñar de más a quien ya podía ver, nunca ocultar', async () => {
    const t = await textoDelPdf(await generarLiquidacionPDF(conEfos, viaje, operador));
    expect(t).toMatch(/lista negra|EFOS/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENSAYO DEL 1-ago · el PDF cortaba la CITA LEGAL a media palabra.
//
// La nota de cada diferencia se recortaba a UNA línea con `cortar`, y lo que se
// perdía era el final — que es justo donde vive el fundamento. En el PDF real
// salían «… del mismo viaje: LISR 2...» y «… del mismo viaje: LISR ...».
//
// El comentario de ese bloque ya decía «nunca se truncan» y era verdad a medias:
// hablaba de la LISTA (todas se imprimen, paginando). El TEXTO sí se truncaba.
//
// Duele en el único documento que el contralor archiva, y en la parte por la que
// juzga si esto es serio: sin el artículo, la observación es una opinión.
// ═══════════════════════════════════════════════════════════════════════════
describe('las observaciones se envuelven; el fundamento nunca se corta', () => {
  const NOTA = 'Alimentación de $154.00 sin comprobante de hospedaje ni de transporte del mismo viaje: LISR 28-V condiciona la deducción a que uno de los dos la ampare. Adjúntalo o confírmalo con tu contador.';
  const largo = liq({
    diferencias: [{ tipo: 'sin_soporte', concepto: 'alimentacion', monto: 0, nota: NOTA }] as never,
  });

  it('la cita del artículo llega entera al papel', async () => {
    const t = await textoDelPdf(await generarLiquidacionPDF(largo, viaje, operador));
    // Se comprueban por separado a propósito: al envolverse, `LISR` cierra un
    // renglón y `28-V` abre el siguiente, así que en el stream del PDF quedan
    // separados por los operadores de posición. Lo que importa es que los DOS
    // estén, y que el cierre de la nota también — eso solo pasa si se imprimió
    // entera.
    expect(t).toContain('LISR');
    expect(t, 'la fracción del artículo se perdía en el recorte').toContain('28-V');
    expect(t, 'el cierre de la nota también').toMatch(/contador/);
  });

  it('y no quedan puntos suspensivos de recorte en la observación', async () => {
    // `...` es lo que dejaba `cortar`. Si vuelve, la nota volvió a truncarse.
    const t = await textoDelPdf(await generarLiquidacionPDF(largo, viaje, operador));
    expect(t).not.toMatch(/LISR 2\.\.\.|viaje: LISR \.\.\./);
  });

  it('con varias observaciones largas siguen saliendo TODAS', async () => {
    // Envolver gasta más alto por observación; si el salto de página no lo
    // contempla, las últimas se caen del papel en silencio.
    const seis = liq({
      diferencias: Array.from({ length: 6 }, (_, i) => ({
        tipo: 'sin_soporte', concepto: 'alimentacion', monto: 0,
        nota: `Observación número ${i + 1}: ${NOTA}`,
      })) as never,
    });
    const t = await textoDelPdf(await generarLiquidacionPDF(seis, viaje, operador));
    for (const n of [1, 2, 3, 4, 5, 6]) expect(t, `falta la observación ${n}`).toContain(`Observación número ${n}`);
  });
});
