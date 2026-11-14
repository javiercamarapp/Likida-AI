// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 48 · FIS-48-01 — EL DESCARGO DEL ESTÍMULO SE IMPRIMÍA ENCIMA DEL PIE.
//
// La sección ACREDITABLE / RECUPERABLE abre con `asegurar(90)`, que solo
// garantiza 90 pt sobre `PISO_PIE`. El bloque completo (litros + su pie + IVA +
// peaje + `BASE_ESTIMULO_PEAJE` + `CONDICIONES_ESTIMULO_PEAJE` + los pies
// generales) necesita más del doble, y el bucle que dibuja `f.pies` NO vuelve a
// llamar `asegurar` — la sección vecina, «LO QUE SE LE REEMBOLSA AL OPERADOR»,
// sí lo hace dentro de su bucle (`pdf.ts:459`).
//
// El resultado no es un texto cortado: es un texto SUPERPUESTO. La cifra
// —«Estímulo de peaje 50% … $6,200.00»— cae arriba del piso y sale impecable;
// su condición («…y no ser parte relacionada (LISR art. 179)») sigue bajando y
// se dibuja ENCIMA de «Generado por Likida · <fecha>» y de la leyenda del art.
// 52 del CFF. pdf-lib no detecta colisión: las dos quedan ilegibles.
//
// Por qué es CRÍTICO y no cosmético: el único freno a que «$6,200.00 · Estímulo
// de peaje 50%» se lea como un derecho ganado es ese texto. El motor NO conoce
// ninguna de las cuatro condiciones de la LIF (hallazgos H5/H6 de
// `normas/lif-2026-20-A.yaml`), y el criterio 1/LIF/PI del Anexo 3 alcanza a
// «quien preste servicios»: o sea a Likida. Es el papel que el contralor
// archiva.
//
// La invariante que fija este archivo es la que el propio `pdf.ts:536-538`
// declara por escrito: «Posiciones FIJAS al fondo: el contenido de arriba se
// corta en PISO_PIE, así que esta zona siempre está libre».
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { generarLiquidacionPDF } from './pdf';
import type { Liquidacion, Viaje, Operador } from '@/types/likida';

/** Igual que en `pdf_cifras.test.ts`: renglones DIBUJADOS con su posición. */
async function renglones(bytes: Uint8Array): Promise<Array<{ x: number; y: number; texto: string }>> {
  const { inflateSync } = await import('node:zlib');
  const buf = Buffer.from(bytes);
  let raw = '';
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x73 && buf.subarray(i, i + 6).toString('latin1') === 'stream') {
      let ini = i + 6;
      while (buf[ini] === 0x0d || buf[ini] === 0x0a) ini++;
      const fin = buf.indexOf(Buffer.from('endstream'), ini);
      if (fin < 0) continue;
      try { raw += inflateSync(buf.subarray(ini, fin)).toString('latin1'); } catch { /* no comprimido */ }
      i = fin;
    }
  }
  raw = raw.replace(/<([0-9A-Fa-f]+)>\s*Tj/g, (_m, hex: string) => Buffer.from(hex, 'hex').toString('latin1'));
  const out: Array<{ x: number; y: number; texto: string }> = [];
  for (const m of raw.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm\n([^\n]*)\n/g)) {
    out.push({ x: Number(m[1]), y: Number(m[2]), texto: m[3] });
  }
  return out;
}

/** `PISO_PIE - 12`: la regla del pie. Debajo SOLO va el pie y la leyenda. */
const TECHO_DEL_PIE = 78;

const VIAJE: Viaje = { id: 'v1', folio: 'VJ-1', origen: 'Mérida', destino: 'Ciudad de México', anticipo: 30000 };
const OPERADOR: Operador = { id: 'o1', nombre: 'Juan Pérez', telefono: '+52', terminal: 'Mérida' };

/** Un viaje real de una semana: `n` comprobantes, mitad diésel mitad caseta. */
function liqCon(n: number): Liquidacion {
  const gastos = Array.from({ length: n }, (_, i) => ({
    id: `g${i + 1}`,
    concepto: i % 2 === 0 ? 'diesel' : 'caseta',
    monto: 1000,
    folio: `F${i + 1}`,
    fecha: '2026-10-31',
    cfdiUuid: `u${i + 1}`,
  }));
  return {
    id: 'l-48', viajeId: 'v1', creadaEn: '2026-10-31T10:00:00Z',
    totalComprobado: n * 1000, totalAnticipo: 30000, diferencia: 30000 - n * 1000, estatus: 'con_diferencias',
    totalDeducible: n * 1000, totalNoDeducible: 0, totalPorConfirmar: 0,
    // Las tres cifras acreditables presentes: es el bloque completo, con el
    // descargo de peaje, que es el que se desborda.
    iepsAcreditable: 0, litrosDieselAcreditables: 420, ivaAcreditable: 1984, peajeAcreditable: 6200,
    diferencias: [],
    gastos,
  } as Liquidacion;
}

const bandaDelPie = (rs: Array<{ y: number; texto: string }>) =>
  rs.filter((r) => r.y < TECHO_DEL_PIE).map((r) => r.texto);

const render = async (n: number) => bandaDelPie(await renglones(await generarLiquidacionPDF(liqCon(n), VIAJE, OPERADOR)));

/**
 * Lo que LEGÍTIMAMENTE vive debajo del techo del pie se CALIBRA con un render
 * corto, no con una lista a mano: el pie, `likida.ai`, los renglones de la
 * leyenda del art. 52 y el sello de revisión pendiente. Así la prueba no se
 * rompe cuando esos textos cambien de redacción, y sigue cazando cualquier
 * renglón del CUERPO que baje hasta ahí.
 */
async function intrusosEn(n: number): Promise<string[]> {
  const permitido = new Set(await render(2));
  return (await render(n)).filter((t) => !permitido.has(t));
}

describe('FIS-48-01 · el descargo del estímulo no se imprime encima del pie ni de la leyenda del art. 52', () => {
  // CONTROL. Si el extractor no leyera la banda del pie, todo lo de abajo
  // pasaría por vacío. Esta prueba tiene que fallar si el extractor se rompe.
  it('la banda del pie, en un viaje corto, trae el pie y la leyenda', async () => {
    const banda = await render(2);
    expect(banda.length, 'la banda del pie salió vacía: el extractor no está leyendo').toBeGreaterThan(2);
    expect(banda.some((t) => /^Generado por Likida/.test(t))).toBe(true);
    expect(banda.some((t) => /likida\.ai/.test(t))).toBe(true);
    expect(banda.some((t) => /art[íi]culo 52 del C[óo]digo Fiscal/.test(t))).toBe(true);
    // Y nada del cuerpo: ni una condición del estímulo, ni un monto.
    expect(banda.filter((t) => /parte relacionada|Red Nacional|^\$/.test(t))).toEqual([]);
  });

  // EL HALLAZGO. 18 comprobantes —un viaje Mérida–CDMX de una semana, 9 diésel
  // y 9 casetas— y el descargo del estímulo baja hasta la zona del pie.
  it('con 18 comprobantes el descargo del estímulo NO invade la banda del pie', async () => {
    const intrusos = await intrusosEn(18);
    expect(intrusos, `texto del cuerpo dibujado encima del pie: ${JSON.stringify(intrusos)}`).toEqual([]);
  });

  // El barrido: el defecto aparece a partir de cierto número de comprobantes y
  // desaparece al saltar de hoja, así que un solo `n` no lo fija.
  it('ningún número de comprobantes entre 13 y 22 invade la banda del pie', async () => {
    const malos: Array<{ n: number; intrusos: string[] }> = [];
    for (let n = 13; n <= 22; n++) {
      const intrusos = await intrusosEn(n);
      if (intrusos.length) malos.push({ n, intrusos });
    }
    expect(malos, `hojas con el pie invadido: ${JSON.stringify(malos.map((m) => m.n))}`).toEqual([]);
  });
});
