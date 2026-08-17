import { describe, expect, it } from 'vitest';
import { generarInformePDF, type Informe } from './pdf';

/** Texto imprimible del PDF: infla los streams y junta lo que va a `Tj`.
 *  OJO: el `stream` que vive dentro de `endstream` hay que descartarlo y hay
 *  que brincar el `endstream` completo — sin eso el barrido se come un stream
 *  sí y otro no (el extractor del canon en liquidacion/pdf.test.ts arrastra
 *  ese defecto y pasa de chiripa). */
async function textoDelPdf(bytes: Uint8Array): Promise<string> {
  const { inflateSync } = await import('node:zlib');
  const buf = Buffer.from(bytes);
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x73 && buf.subarray(i, i + 6).toString('latin1') === 'stream'
        && buf.subarray(i - 3, i).toString('latin1') !== 'end') {
      let ini = i + 6;
      while (buf[ini] === 0x0d || buf[ini] === 0x0a) ini++;
      const fin = buf.indexOf(Buffer.from('endstream'), ini);
      if (fin < 0) continue;
      try { out += inflateSync(buf.subarray(ini, fin)).toString('latin1'); } catch { /* no comprimido */ }
      i = fin + 8;
    }
  }
  return out.replace(/<([0-9A-Fa-f]+)>\s*Tj/g, (_m, hex: string) =>
    Buffer.from(hex, 'hex').toString('latin1'));
}

const textoDe = async (inf: Informe) => textoDelPdf(await generarInformePDF(inf));

const BASE: Informe = {
  titulo: 'Informe de casetas',
  razonSocial: 'Transportes Prueba SA de CV',
  periodo: 'Julio 2026',
  kpis: [{ etiqueta: 'Viajes', valor: '18' }, { etiqueta: 'Total casetas', valor: '$42,310.00', nota: 'IVA incluido' }],
  secciones: [
    { titulo: 'Resumen', filas: [['Viajes liquidados', '18'], ['Diferencia total', '$0.00']] },
    { titulo: 'Por operador', tabla: { columnas: ['Operador', 'Viajes', 'Monto'], filas: [['Juan Pérez', '7', '$18,200.00'], ['María López', '11', '$24,110.00']] } },
    { titulo: 'Lectura', parrafos: ['El gasto en casetas se concentra en el corredor Guadalajara-Manzanillo; ninguna liquidación quedó con diferencia.'] },
  ],
  notas: ['Cifras tomadas de liquidaciones cerradas; nada se estima.'],
  generadoEn: '2026-08-17T12:00:00Z',
};

describe('generarInformePDF — el motor genérico con el lenguaje del canon', () => {
  it('pinta encabezado, periodo, KPIs, las tres formas de sección y las notas', async () => {
    const t = await textoDe(BASE);
    expect(t).toContain('Transportes Prueba SA de CV');
    expect(t).toContain('INFORME DE CASETAS');
    expect(t).toContain('Julio 2026');
    expect(t).toContain('TOTAL CASETAS');       // KPI en versalitas
    expect(t).toContain('$42,310.00');
    expect(t).toContain('Viajes liquidados');   // filas etiqueta→valor
    expect(t).toContain('María López');         // tabla de columnas
    expect(t).toContain('nada se estima');      // nota
    expect(t).toContain('Generado por Likida');
  });

  it('sin razón social encabeza Likida (informe interno) y jamás inventa un nombre', async () => {
    const t = await textoDe({ ...BASE, razonSocial: null });
    expect(t).toContain('Likida');
    expect(t).not.toContain('Procesado por Likida');
    expect(t).not.toContain('Transportes Prueba');
  });

  it('una tabla larga pagina con título (cont.), re-pinta cabecera y NO trunca', async () => {
    const filas = Array.from({ length: 60 }, (_, i) => [`Empresa ${i + 1}`, `${i}`, `$${i}.00`]);
    const bytes = await generarInformePDF({ ...BASE, secciones: [{ titulo: 'Censo', tabla: { columnas: ['Empresa', 'Viajes', 'Monto'], filas } }] });
    const t = await textoDelPdf(bytes);
    const { PDFDocument } = await import('pdf-lib');
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
    // Los paréntesis van escapados dentro del literal del stream: \(CONT.\)
    expect(t.replace(/\\([()])/g, '$1')).toContain('CENSO (CONT.)');
    expect(t).toContain('Empresa 60'); // la última fila SÍ llegó — nada se trunca en silencio
  });
});
