// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO 3 — Generador de PDF de liquidación (determinístico, SIN LLM).
//
// Los datos ya vienen estructurados del cuadre; un LLM aquí solo agrega costo,
// latencia y riesgo de alucinar cifras. Estilo: macOS/Apple premium — neutro,
// hairlines, montos tabulares, diferencias en rojo sutil (ver DESIGN.md).
// ═══════════════════════════════════════════════════════════════════════════

import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { resumenOmitidos, filasImprimibles } from './omitidos';
import { filasDeducibilidad } from './deducibilidad';
import { filasAcreditables } from './acreditable';
import { resumenLaboral } from '../laboral/pagadero';
import { cubetaDe, copiasDeComprobante, etiquetaConcepto } from '../cuadre/engine';
import { fechaMx, mxn } from '@/lib/formato';
import { SOLO_CONTRALOR, type Destinatario } from '../cuadre/resumen';

import { leyendaPdf } from '../cuadre/leyendas';
import type { Liquidacion, Viaje, Operador } from '@/types/likida';

// Paleta (Apple) en 0–1 para pdf-lib
const INK = rgb(0.06, 0.06, 0.09);
const MUTED = rgb(0.45, 0.47, 0.52);
const HAIRLINE = rgb(0.88, 0.89, 0.91);
const GREEN = rgb(0.2, 0.78, 0.35);
const RED = rgb(1.0, 0.23, 0.19);
const AMBER = rgb(1.0, 0.62, 0.04);

// (Aquí vivía CONCEPTO_LABEL, un mapa gemelo del que tiene el motor. Se borró
// al pasar a `etiquetaConcepto`: dos mapas que alguien tiene que mantener
// sincronizados ya se desincronizaron dos veces en este repo. Una función
// importada no puede desincronizarse.)

/** Parte un texto en renglones de a lo más `ancho` caracteres. pdf-lib no
 *  envuelve texto solo, y el descargo no cabe en una línea. */
function envolver(texto: string, ancho: number): string[] {
  const out: string[] = [];
  let linea = '';
  for (const palabra of texto.split(' ')) {
    if (linea && (linea + ' ' + palabra).length > ancho) { out.push(linea); linea = palabra; }
    else linea = linea ? `${linea} ${palabra}` : palabra;
  }
  if (linea) out.push(linea);
  return out;
}

// LA MISMA que el panel, con `timeZone: America/Mexico_City`. Antes era una
// copia sin zona horaria —o sea, la del servidor: UTC en Vercel—, así que una
// liquidación cerrada a las 19:00 de México salía fechada al día siguiente EN EL
// PAPEL mientras la pantalla la fechaba bien (auditoría 6, arquitectura).
const fecha = (iso?: string) => fechaMx(iso);

/**
 * Genera el PDF de liquidación. Devuelve los bytes listos para enviar por
 * WhatsApp o guardar en storage.
 */
export async function generarLiquidacionPDF(
  liq: Liquidacion,
  viaje: Viaje,
  operador: Operador,
  /** Razón social del cliente, para el descargo del pie. Sin ella dice
   *  "el contribuyente" — nunca se inventa un nombre. */
  razonSocial?: string,
  /**
   * A QUIÉN se le entrega ESTE ejemplar. `resumen.ts` ya filtra del mensaje al
   * operador los veredictos que él no puede arreglar y que además lo señalan
   * (EFOS, CFDI cancelado, RFC receptor…), y `processor.ts` pasa 'operador' con
   * cuidado en los tres sitios. Y acto seguido se le mandaba, al mismo teléfono,
   * un PDF que los imprimía todos. La defensa del texto no valía nada: el mismo
   * destinatario recibía todo, en un documento que además puede reenviar.
   */
  destinatario: Destinatario = 'contralor',
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Liquidación ${viaje.folio ?? liq.id.slice(0, 8)}`);
  doc.setProducer('Likida');

  const A4: [number, number] = [595.28, 841.89];
  // `page` es MUTABLE: el documento ya no cabe forzosamente en una hoja. Un
  // viaje de una semana trae 40 comprobantes; apretándolos en A4, la sección de
  // diferencias —lo único accionable— se quedaba sin renglones e imprimía
  // "y 2 observaciones más en el panel" habiendo 2 en total. Visto en el render.
  let page = doc.addPage(A4);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const M = 48;
  let y = 800;

  // Zona reservada al pie y al descargo. Se respeta en TODAS las hojas aunque el
  // pie solo se dibuje en la última: así el salto de página no tiene que saber
  // cuál es la última.
  const PISO_PIE = 90;

  // La fuente estándar Helvetica usa WinAnsi, que NO codifica varios Unicode
  // (→, ●, …). Se sanea TODO texto a equivalentes seguros; cualquier char fuera
  // de Latin-1 sin mapeo → '?' para que el PDF NUNCA truene por datos de OCR.
  //
  // El rango empieza en el ESPACIO (0x20), no antes: así los caracteres de
  // CONTROL caen fuera y se reemplazan por '?'. Aquí había un byte NUL literal
  // en lugar del espacio —invisible en el editor— y el rango quedaba \x00-ÿ,
  // dejando pasar los controles enteros. Un \x1b de una impresora térmica mal
  // leído tumbaba la generación con "WinAnsi cannot encode". Justo lo que este
  // saneador existe para evitar, y los datos vienen de fotos de tickets.
  const wa = (s: string): string =>
    s
      .replace(/→/g, '-')
      .replace(/[●○]/g, '•')            // círculos → bullet (WinAnsi sí lo tiene)
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/…/g, '...')
      .replace(/[^ -ÿ–—•€]/g, '?');

  const text = (s: string, x: number, yy: number, size: number, f: PDFFont, color = INK) =>
    page.drawText(wa(s), { x, y: yy, size, font: f, color });
  const right = (s: string, xRight: number, yy: number, size: number, f: PDFFont, color = INK) => {
    const sv = wa(s);
    page.drawText(sv, { x: xRight - f.widthOfTextAtSize(sv, size), y: yy, size, font: f, color });
  };
  /** Recorta un texto para que quepa en `ancho` puntos, midiendo con la fuente
   *  real. A ojo no funciona: una nota de diferencia larga se montaba encima de
   *  la columna del monto y quedaban dos cifras ilegibles una sobre otra. */
  const cortar = (s2: string, ancho: number, f: PDFFont, size: number): string => {
    const v = wa(s2);
    if (f.widthOfTextAtSize(v, size) <= ancho) return v;
    let lo = 0, hi = v.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (f.widthOfTextAtSize(v.slice(0, mid) + '...', size) <= ancho) lo = mid; else hi = mid - 1;
    }
    return v.slice(0, lo) + '...';
  };
  /**
   * Parte un texto en las líneas que caben en `ancho`, midiendo con la fuente
   * real.
   *
   * Existe porque `cortar` estaba mintiendo justo donde más duele: la nota de
   * cada diferencia se recortaba a UNA línea y lo que se perdía era el final,
   * que es donde vive el fundamento. En el PDF del 1-ago salía «LISR 2...» y
   * «LISR ...» — la cita legal partida a la mitad, en el único documento que el
   * contralor archiva y por el que juzga si esto es serio.
   *
   * El comentario de ese bloque ya decía «nunca se truncan», y hablaba de la
   * LISTA (todas se imprimen, paginando). El TEXTO sí se truncaba.
   *
   * NO es el `envolver` de arriba, y la diferencia importa: aquél cuenta
   * CARACTERES, que basta para el descargo del pie —texto corrido, sin nada al
   * lado—. Éste MIDE con la fuente, que es lo único que sirve cuando a la
   * derecha hay una columna de dinero contra la que no se puede chocar.
   */
  const envolverMedido = (s2: string, ancho: number, f: PDFFont, size: number): string[] => {
    const palabras = wa(s2).split(/\s+/).filter(Boolean);
    const lineas: string[] = [];
    let actual = '';
    for (const p of palabras) {
      const tentativa = actual ? `${actual} ${p}` : p;
      if (f.widthOfTextAtSize(tentativa, size) <= ancho) { actual = tentativa; continue; }
      if (actual) lineas.push(actual);
      // Una palabra sola más ancha que la columna (una URL de portal, un folio
      // largo) sí se corta: salirse de la caja se monta encima del monto, que
      // es el fallo que `cortar` existía para evitar.
      if (f.widthOfTextAtSize(p, size) <= ancho) { actual = p; }
      else { lineas.push(cortar(p, ancho, f, size)); actual = ''; }
    }
    if (actual) lineas.push(actual);
    return lineas.length ? lineas : [''];
  };
  const rule = (yy: number, color = HAIRLINE) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: 595.28 - M, y: yy }, thickness: 0.75, color });
  const circulo = (x: number, yy: number, color: ReturnType<typeof rgb>) =>
    page.drawCircle({ x, y: yy, size: 2.5, color });

  /**
   * Garantiza `alto` puntos libres por encima de la zona del pie. Si no caben,
   * abre hoja nueva y devuelve `true` para que el llamador repinte lo que haga
   * falta (los encabezados de una tabla partida, por ejemplo).
   */
  const asegurar = (alto: number): boolean => {
    if (y - alto >= PISO_PIE) return false;
    page = doc.addPage(A4);
    y = 800;
    return true;
  };

  // ─── Encabezado ───────────────────────────────────────────────────────────
  // EL TÍTULO DEL PAPEL. Decía 'Cuadra' en 20pt mientras el pie —tres párrafos
  // más abajo, en la misma hoja— decía "Generado por Likida · likida.ai". Los
  // dos nombres del producto en el documento que el contralor archiva y que
  // puede ver un tercero.
  text('Likida', M, y, 20, bold, INK);
  right('LIQUIDACIÓN DE VIAJE', 595.28 - M, y + 3, 9, bold, MUTED);
  right(`Folio ${viaje.folio ?? liq.id.slice(0, 8).toUpperCase()}`, 595.28 - M, y - 10, 9, font, MUTED);
  y -= 28;
  rule(y);
  y -= 26;

  // ─── Datos del viaje / operador (dos columnas) ──────────────────────────────
  const col2 = 320;
  // El ancho de columna es ~230pt: "Mérida → Ciudad de México" cabe, pero una ruta
  // larga se montaba sobre la columna de al lado. Se recorta midiendo con la fuente.
  const kv = (label: string, value: string, x: number, yy: number) => {
    text(label.toUpperCase(), x, yy, 7.5, bold, MUTED);
    text(cortar(value, 230, font, 11), x, yy - 13, 11, font, INK);
  };
  kv('Operador', operador.nombre, M, y);
  kv('Ruta', `${viaje.origen ?? '—'} → ${viaje.destino ?? '—'}`, col2, y);
  y -= 34;
  kv('Terminal', operador.terminal ?? '—', M, y);
  kv('Periodo', `${fecha(viaje.fechaInicio)} – ${fecha(viaje.fechaFin)}`, col2, y);
  y -= 40;

  // ─── Tabla de gastos comprobados ────────────────────────────────────────────
  text('COMPROBANTES', M, y, 8, bold, MUTED);
  y -= 6;
  rule(y);
  y -= 18;
  const cFolio = M, cConcepto = 150, cFecha = 300, cEstado = 400, cMonto = 595.28 - M;
  const cabeceraTabla = () => {
    text('Concepto', cConcepto, y, 8, bold, MUTED);
    text('Folio', cFolio, y, 8, bold, MUTED);
    text('Fecha', cFecha, y, 8, bold, MUTED);
    text('Estado', cEstado, y, 8, bold, MUTED);
    right('Monto', cMonto, y, 8, bold, MUTED);
    y -= 14;
  };
  cabeceraTabla();

  const gastoConDif = new Set(liq.diferencias.map((d) => d.gastoId).filter(Boolean));
  // Los duplicados y los montos inválidos NO se imprimen: el motor los excluye del
  // total, así que imprimirlos hacía que los renglones no sumaran el total. La
  // invariante vive probada en omitidos.ts.
  const { filas, duplicados: nDup } = filasImprimibles(liq);
  let impresos = 0;
  for (const g of filas) {
    // Antes esto era `if (y < PISO_TABLA) break`: los comprobantes que no
    // cabían se resumían en una línea. Con el desglose de deducibilidad ya no
    // cabía casi nada. Ahora la tabla continúa en la hoja siguiente, con su
    // encabezado repetido para que las columnas no queden huérfanas.
    if (asegurar(18)) { text('COMPROBANTES (cont.)', M, y, 8, bold, MUTED); y -= 6; rule(y); y -= 18; cabeceraTabla(); }
    const flagged = gastoConDif.has(g.id);
    // El producto impreso manda: un ticket de PLUS no puede decir "Diésel".
    text(cortar(etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown> | undefined), 140, font, 10), cConcepto, y, 10, font, INK);
    text(g.folio ?? '—', cFolio, y, 9, font, MUTED);
    text(fecha(g.fecha), cFecha, y, 9, font, MUTED);
    if (flagged) text('● revisar', cEstado, y, 9, font, RED);
    else text('● ok', cEstado, y, 9, font, GREEN);
    right(mxn(g.monto), cMonto, y, 10, font, flagged ? RED : INK);
    impresos++;
    y -= 18;
  }
  // Red de seguridad: hoy la tabla nunca trunca (pagina), así que esto no se
  // dispara. Se queda porque la invariante que protege —los renglones impresos
  // suman el total impreso— es la que hace que el papel no se contradiga, y
  // vive probada en omitidos.ts.
  const omitidos = resumenOmitidos(filas, impresos);
  if (omitidos) {
    text(omitidos.texto, cConcepto, y, 9, font, MUTED);
    right(mxn(omitidos.monto), cMonto, y, 9, font, MUTED);
    y -= 18;
  }
  // Los duplicados se DECLARAN, no se esconden: el operador mandó esa foto y
  // merece saber por qué no cuenta.
  if (nDup > 0) {
    text(`${nDup} ${nDup === 1 ? 'comprobante duplicado, excluido' : 'comprobantes duplicados, excluidos'} del total`, cConcepto, y, 8.5, font, MUTED);
    y -= 16;
  }
  y -= 4;
  rule(y);
  y -= 22;

  // ─── Totales ────────────────────────────────────────────────────────────────
  // El bloque de totales + desglose no se parte: o cabe entero o se va a la
  // hoja siguiente. Un "Total comprobado" huérfano al pie de una hoja, con su
  // desglose en la otra, es justo el tipo de cosa que se lee mal y cuesta caro.
  asegurar(120);
  const totalRow = (label: string, value: string, f: PDFFont, color = INK, size = 11) => {
    // Anclada a la izquierda: en negritas a 13pt, "Diferencia a favor de la
    // empresa" alcanzaba la columna del monto y quedaban pegados.
    text(label, M, y, size, f, color);
    right(value, cMonto, y, size, f, color);
    y -= 20;
  };
  totalRow('Total comprobado', mxn(liq.totalComprobado), font);

  // ─── De lo comprobado, cuánto sobrevive una revisión ────────────────────────
  // Indentado bajo el total porque es su desglose: los tres renglones suman
  // exactamente el total comprobado (probado en deducibilidad.test.ts).
  const deduc = filasDeducibilidad(liq);
  if (deduc) {
    for (const f of deduc) {
      // `condicionado` en INK, no AMBER: mismo criterio que `acreditable.ts`
      // (línea de peaje) para el mismo concepto — no es "falta algo del
      // operador" (eso es AMBER/`pendiente`), es "el sistema no verifica un
      // requisito legal". Confundir los dos tonos le pide al operador resolver
      // algo que no puede.
      const color = f.tono === 'bueno' ? GREEN : f.tono === 'malo' ? RED : f.tono === 'condicionado' ? INK : AMBER;
      text(f.label, M + 14, y, 9.5, font, MUTED);
      right(mxn(f.monto), cMonto, y, 9.5, font, color);
      y -= 15;
      // El pie va PEGADO a su renglón. Juntando todos los pies al final del
      // bloque, "Se puede recuperar" quedaba debajo de "No deducible" y se leía
      // como si lo perdido fuera recuperable — el mensaje contrario. Visto en
      // el render, invisible para los tests.
      //
      // Se pinta el de "por confirmar" (el único accionable por el operador) y
      // el de "condicionado" (AUDITORÍA 9: es la afirmación que el renglón
      // verde no puede sostener entera — el mismo requisito legal, junto al
      // número, no tres párrafos abajo donde nadie lo cruza). El de "no
      // deducible" repetiría lo que ya dice la sección de diferencias.
      if ((f.tono === 'pendiente' || f.tono === 'condicionado') && f.pie) { text(f.pie, M + 22, y + 2, 7, font, MUTED); y -= 11; }
    }
    y -= 3;
  }

  totalRow('Anticipo entregado', mxn(liq.totalAnticipo), font);
  rule(y + 6);
  y -= 4;
  const difColor = liq.diferencia === 0 ? GREEN : liq.diferencia > 0 ? INK : AMBER;
  const difLabel = liq.diferencia > 0 ? 'Diferencia a favor de la empresa'
    : liq.diferencia < 0 ? 'Diferencia a favor del operador' : 'Cuadra exacto';
  totalRow(difLabel, mxn(Math.abs(liq.diferencia)), bold, difColor, 13);

  // ─── Estímulos acreditables (IEPS diésel + IVA + peaje) — "lo que vende" ────
  //
  // Los renglones y sus pies los decide `filasAcreditables`, no este archivo.
  // Lo que se imprime aquí es una AFIRMACIÓN con un artículo citado al lado, y
  // una afirmación tiene que poder probarse sin abrir un PDF.
  //
  // Lo que cambió: el estímulo de peaje salía en VERDE y en negritas, con "LIF
  // 2026 art. 20, ap. A" al lado y ni una palabra sobre las cuatro condiciones
  // de elegibilidad —que el motor no conoce, porque dispara con
  // `concepto === 'caseta'` a secas— ni sobre cuál de las dos bases posibles
  // usó. Una flota con ingresos ≥ $300M, o parte relacionada, se llevaba
  // impreso un estímulo al que no tiene derecho.
  const acreditable = filasAcreditables(liq);
  if (acreditable) {
    y -= 10;
    asegurar(90);
    text('ACREDITABLE / RECUPERABLE', M, y, 8, bold, MUTED);
    y -= 6;
    rule(y);
    y -= 16;
    // VERDE solo para lo que el motor sostiene entero. Lo condicionado va en
    // tinta neutra: el color es parte de la afirmación, y pintar de verde una
    // cifra que depende de cuatro condiciones sin verificar es prometer con el
    // formato lo que el texto matiza.
    for (const f of acreditable.filas) {
      text(f.label, M + 14, y, 9.5, font, INK);
      right(f.valor, cMonto, y, 9.5, bold, f.tono === 'bueno' ? GREEN : INK);
      y -= 16;
      for (const pie of f.pies) {
        for (const linea of envolver(pie, 135)) {
          text(linea, M + 22, y + 2, 7, font, MUTED);
          y -= 9;
        }
      }
    }
    y -= 2;
    for (const pie of acreditable.piesGenerales) {
      for (const linea of envolver(pie, 135)) {
        text(linea, M + 14, y, 7, font, MUTED);
        y -= 9;
      }
    }
    y -= 5;
  }

  // ─── Lo que se le debe al operador aunque no sea deducible ──────────────────
  // DEDUCIBLE ≠ PAGADERO. Sin esta sección, quien lee "no deducible" en el papel
  // puede concluir que se le descuenta al operador, y la ley no lo permite: es un
  // problema de papeleo entre la flota y el SAT, no una deuda del chofer.
  // La clasificación la decide el MOTOR (`cubetaDe`), no este archivo. Antes se
  // reconstruía aquí desde `diferencias` con un criterio menos, y la sección se
  // activaba o no según un flag de la política de la flota en vez de según la ley.
  const cubetas = new Map(liq.gastos.map((g) => [g.id, cubetaDe(g, liq.diferencias.filter((d) => d.gastoId === g.id))]));
  const idsEnCubeta = (c: string) => new Set([...cubetas].filter(([, v]) => v === c).map(([id]) => id));
  const lab = resumenLaboral({
    gastos: liq.gastos,
    idsNoDeducibles: idsEnCubeta('no_deducible'),
    idsPorConfirmar: idsEnCubeta('por_confirmar'),
    sobrePolitica: new Set(liq.diferencias.filter((d) => d.tipo === 'sobre_politica').map((d) => d.gastoId!).filter(Boolean)),
    // De la MISMA función que usa el cuadre, no reconstruido aquí. La diferencia
    // `duplicado` ya no sirve para esto: apunta al ORIGINAL —que es lo que el
    // contralor tiene que abrir— y no a las copias que hay que descontar.
    idsDuplicados: new Set(copiasDeComprobante(liq.gastos).keys()),
    demoraNoImputable: viaje.demoraNoImputable,
  });
  if (lab) {
    asegurar(64);
    text('LO QUE SE LE REEMBOLSA AL OPERADOR', M, y, 8, bold, MUTED);
    y -= 6;
    rule(y);
    y -= 16;
    for (const linea of envolver(lab.texto, 105)) {
      if (asegurar(13)) { text('LO QUE SE LE REEMBOLSA AL OPERADOR (cont.)', M, y, 8, bold, MUTED); y -= 6; rule(y); y -= 16; }
      text(linea, M + 14, y, 8.5, font, INK);
      y -= 11;
    }
    y -= 6;
  }

  // ─── Diferencias detectadas ─────────────────────────────────────────────────
  // El 'anticipo' ya se imprime arriba en Totales: repetirlo aquí lo mostraba dos
  // veces con distinto formato. Se filtra ANTES de decidir si hay sección.
  const obsPdf = liq.diferencias
    .filter((d) => d.tipo !== 'anticipo')
    .filter((d) => destinatario === 'contralor' || !SOLO_CONTRALOR.includes(d.tipo));
  if (obsPdf.length) {
    y -= 12;
    // El encabezado no se queda solo al pie de una hoja: se lleva su primera
    // observación consigo.
    asegurar(48);
    text('DIFERENCIAS DETECTADAS', M, y, 8, bold, MUTED);
    y -= 6;
    rule(y);
    y -= 16;
    let difImpresas = 0;
    for (const d of obsPdf) {
      // Las diferencias son lo ÚNICO accionable del papel: nunca se truncan —
      // ni la lista NI el texto. 70pt de aire antes de la columna del monto,
      // para que nunca se toquen.
      const lineas = envolverMedido(d.nota, cMonto - (M + 14) - 70, font, 9.5);
      const alto = 16 + (lineas.length - 1) * 11;
      // El bloque entero cabe o se va completo a la hoja siguiente: una
      // observación partida por la mitad se lee como dos cosas distintas.
      if (asegurar(alto)) { text('DIFERENCIAS DETECTADAS (cont.)', M, y, 8, bold, MUTED); y -= 6; rule(y); y -= 16; }
      circulo(M + 3, y + 3, d.tipo === 'sin_comprobante' ? RED : AMBER);
      lineas.forEach((ln, i) => text(ln, M + 14, y - i * 11, 9.5, font, INK));
      // El monto se ancla a la PRIMERA línea, junto a la viñeta.
      right(mxn(d.monto), cMonto, y, 9.5, bold, d.monto >= 0 ? INK : AMBER);
      difImpresas++;
      y -= alto;
    }
    const difFuera = obsPdf.length - difImpresas;
    if (difFuera > 0) {
      text(`… y ${difFuera} ${difFuera === 1 ? 'observación más' : 'observaciones más'} en el panel`, M + 14, y, 9, font, MUTED);
      y -= 16;
    }
  }

  // ─── Pie ────────────────────────────────────────────────────────────────────
  // Posiciones FIJAS al fondo: el contenido de arriba se corta en PISO_PIE, así
  // que esta zona siempre está libre.
  rule(PISO_PIE - 12);
  text(`Generado por Likida · ${fecha(liq.creadaEn)}`, M, PISO_PIE - 26, 8, font, MUTED);
  // `cuadra.mx` NO ES NUESTRO. Es un dominio parkeado: devuelve un redirect a
  // `/lander`, o sea la página de "en venta". Estuvo impreso en el pie de cada
  // liquidación —el papel que el contralor archiva y que puede ver un tercero—
  // apuntando a un anuncio de un desconocido. Se detectó el 31-jul comprobando
  // dominios con curl, no leyendo el código: en el fuente se ve como una marca.
  right('likida.ai', 595.28 - M, PISO_PIE - 26, 8, font, MUTED);

  // Descargo del art. 52 del CFF. NO es adorno: los criterios del Anexo 3 de la
  // RMF alcanzan a "quien asesore, aconseje, PRESTE SERVICIOS o participe", y
  // ese es Likida. Este papel se archiva y lo puede ver un tercero. Se parte en
  // renglones porque pdf-lib no envuelve texto solo.
  let ly = PISO_PIE - 44;
  for (const linea of envolver(leyendaPdf(fecha(liq.creadaEn), razonSocial), 150)) {
    text(linea, M, ly, 6, font, MUTED);
    ly -= 7.5;
  }

  return doc.save();
}
