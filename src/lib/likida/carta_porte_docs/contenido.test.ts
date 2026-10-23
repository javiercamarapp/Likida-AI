import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { detectarFormato, prepararContenido, MAX_BYTES_DOC, MAX_FILAS_HOJA, MAX_HOJAS } from './contenido';
import { extraerCartaPorteXml } from './xml_ccp';
import {
  csvAtlas, correoTexto, defectuosos, emlConAsunto, excelAtlas, fotoRemision, pdfBoreal, pdfEscaneado, xmlCartaPorte, xmlPropio, RFC,
} from './documentos_sinteticos.fixture';

async function leer(bytes: Uint8Array) {
  const d = detectarFormato(bytes);
  if (!d.ok) throw new Error(`rechazado: ${d.motivo}`);
  return { d, c: await prepararContenido(bytes, d.clase) };
}

describe('detectarFormato: por los bytes, no por la extensión', () => {
  it('reconoce los siete formatos', async () => {
    expect(detectarFormato(await pdfBoreal())).toMatchObject({ ok: true, clase: 'pdf' });
    expect(detectarFormato(await fotoRemision())).toMatchObject({ ok: true, clase: 'imagen', mime: 'image/png' });
    expect(detectarFormato(excelAtlas())).toMatchObject({ ok: true, clase: 'excel' });
    expect(detectarFormato(csvAtlas())).toMatchObject({ ok: true, clase: 'csv' });
    expect(detectarFormato(Buffer.from(xmlCartaPorte()))).toMatchObject({ ok: true, clase: 'xml' });
    expect(detectarFormato(Buffer.from(emlConAsunto(correoTexto())))).toMatchObject({ ok: true, clase: 'correo' });
    expect(detectarFormato(Buffer.from(correoTexto()))).toMatchObject({ ok: true, clase: 'correo' });
  });

  it('el cuerpo HTML de un correo es correo, no XML', () => {
    expect(detectarFormato(Buffer.from('<html><body><p>Folio: 1</p><p>Peso: 1000 kg</p></body></html>'))).toMatchObject({ ok: true, clase: 'correo', mime: 'text/html' });
  });

  it.each([
    ['archivo vacío', defectuosos.vacio, /vacío/],
    ['ejecutable renombrado', defectuosos.ejecutable, /no es un documento de embarque/],
    ['binario desconocido', defectuosos.binarioRaro, /No reconocí el formato/],
  ])('rechaza: %s', (_n, bytes, re) => {
    const d = detectarFormato(bytes);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.motivo).toMatch(re);
  });

  it('un zip que NO es Excel (docx, zip genérico) se rechaza con un motivo claro', () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('word/document.xml'), Buffer.alloc(100, 1)]);
    const d = detectarFormato(zip);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.motivo).toMatch(/no es Excel/);
  });

  it('HEIC se rechaza diciendo cómo mandarlo', () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(40)]);
    const d = detectarFormato(heic);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.motivo).toMatch(/HEIC/);
  });

  it('el tope de tamaño se aplica antes de leer nada', () => {
    const d = detectarFormato(new Uint8Array(MAX_BYTES_DOC + 1));
    expect(d.ok).toBe(false);
  });

  it('un PDF llamado .png sigue siendo PDF (se decide por los bytes)', async () => {
    expect(detectarFormato(await pdfBoreal())).toMatchObject({ clase: 'pdf' });
  });
});

describe('prepararContenido', () => {
  it('PDF con texto → pdf_texto, con el texto legible y sin el ruido de páginas', async () => {
    const { c } = await leer(await pdfBoreal());
    expect(c.formato).toBe('pdf_texto');
    expect(c.texto).toMatch(/RFC remitente: GBO/);
    expect(c.texto).not.toMatch(/-- 1 of 1 --/);
    expect(c.imagenes).toEqual([]);
  });

  it('PDF escaneado (sin capa de texto) → pdf_escaneado, rendido a imagen para visión', async () => {
    const { c } = await leer(await pdfEscaneado());
    expect(c.formato).toBe('pdf_escaneado');
    expect(c.texto).toBeNull();
    expect(c.imagenes.length).toBe(1);
    expect(c.imagenes[0]).toMatch(/^data:image\/png;base64,/);
  });

  it('foto → imagen JPEG orientada y acotada', async () => {
    const { c } = await leer(await fotoRemision());
    expect(c.formato).toBe('imagen');
    expect(c.imagenes[0]).toMatch(/^data:image\/jpeg;base64,/);
    expect(c.avisos.join(' ')).toMatch(/1800 px/);
  });

  it('Excel → tabla con todas las hojas leídas y texto para el modelo', async () => {
    const { c } = await leer(excelAtlas());
    expect(c.formato).toBe('excel');
    expect(c.tabla?.[0].nombre).toBe('Embarques');
    expect(c.texto).toMatch(/Folio Embarque \| Fecha Salida/);
    expect(c.texto).toMatch(/ATL-20481/);
  });

  it('Excel: las fórmulas NO se evalúan y llegan como texto/valor, nunca como acción', async () => {
    const ws = XLSX.utils.aoa_to_sheet([['Folio', 'Peso', 'Nota'], ['F1', 100, '=HYPERLINK("http://x.test","a")']]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'H');
    const { c } = await leer(Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })));
    expect(c.texto).toContain('HYPERLINK');
  });

  it('Excel: topes de hojas y filas, y lo dice', async () => {
    const wb = XLSX.utils.book_new();
    for (let i = 0; i < MAX_HOJAS + 2; i++) {
      const filas = [['A', 'B', 'C']];
      for (let r = 0; r < (i === 0 ? MAX_FILAS_HOJA + 50 : 3); r++) filas.push([String(r), 'x', 'y']);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), `H${i}`);
    }
    const { c } = await leer(Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })));
    expect(c.tabla!.length).toBe(MAX_HOJAS);
    expect(c.tabla![0].filas.length).toBeLessThanOrEqual(MAX_FILAS_HOJA);
    expect(c.avisos.join(' ')).toMatch(/hojas/);
  });

  it('CSV: se lee como TEXTO (el cero inicial del CP no se pierde)', async () => {
    const { c } = await leer(csvAtlas([['F1', '15/10/2026', 'X', 'AAA010101AAA', '06600', 'CDMX', 'Y', 'BBB010101BBB', '64000', 'NL', 'P', '30111500', '1', 'Pza', '10', 'Op', 'AAA111', 'No']]));
    expect(c.formato).toBe('csv');
    const fila = c.tabla![0].filas[1];
    expect(fila).toContain('06600');
    expect(fila).toContain('15/10/2026');
  });

  it('CSV con coma dentro de comillas', async () => {
    const { c } = await leer(csvAtlas([['F1', '15/10/2026', 'Plásticos, S.A.', 'AAA010101AAA', '06600', 'CDMX', 'Y', 'BBB010101BBB', '64000', 'NL', 'P', '30111500', '1', 'Pza', '10', 'Op', 'AAA111', 'No']]));
    expect(c.tabla![0].filas[1][2]).toBe('Plásticos, S.A.');
  });

  it('XML CCP → árbol sin namespaces', async () => {
    const { c } = await leer(Buffer.from(xmlCartaPorte()));
    expect(c.formato).toBe('xml');
    expect(extraerCartaPorteXml(c.xml)).not.toBeNull();
  });

  it('XML con entidades (billion laughs / XXE) se rechaza SIN expandirlas', async () => {
    const bomba = '<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><l>&b;&b;&b;&b;</l>';
    const t0 = Date.now();
    await expect(prepararContenido(Buffer.from(bomba), 'xml')).rejects.toThrow(/entidades/);
    expect(Date.now() - t0).toBeLessThan(2000);
    const xxe = '<?xml version="1.0"?><!DOCTYPE f [<!ENTITY x SYSTEM "file:///etc/passwd">]><f>&x;</f>';
    await expect(prepararContenido(Buffer.from(xxe), 'xml')).rejects.toThrow(/entidades/);
  });

  it('correo .eml → texto con De/Asunto, multipart y quoted-printable', async () => {
    const { c } = await leer(Buffer.from(emlConAsunto(correoTexto())));
    expect(c.formato).toBe('correo');
    expect(c.correo?.asunto).toBe('Embarque CG-5521');
    expect(c.texto).toMatch(/Folio: CG-5521/);
    const multi = [
      'From: a@b.test', 'To: c@d.test', 'Subject: Hola', 'MIME-Version: 1.0', 'Content-Type: multipart/alternative; boundary="XX"', '',
      '--XX', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '', 'Mercanc=C3=ADa: Cemento 24 toneladas =', 'y m=C3=A1s', '--XX',
      'Content-Type: text/html', '', '<p>otro</p>', '--XX--', '',
    ].join('\r\n');
    const r = await leer(Buffer.from(multi));
    expect(r.c.texto).toMatch(/Mercancía: Cemento 24 toneladas y más/);
  });

  it('correo HTML → texto sin etiquetas ni scripts', async () => {
    const { c } = await leer(Buffer.from('<html><body><script>alert(1)</script><p>Folio: HX-1</p><table><tr><td>Peso</td><td>1000 kg</td></tr></table></body></html>'));
    expect(c.texto).toMatch(/Folio: HX-1/);
    expect(c.texto).not.toMatch(/alert|<p>/);
  });

  it('correo HTML: las entidades se decodifican UNA vez (&amp;lt; queda como &lt;, no como <)', async () => {
    const { c } = await leer(Buffer.from('<html><body><p>Folio: HX-2 &amp;lt;b&amp;gt; Tom &amp; Jerry &lt;x&gt;</p></body></html>'));
    expect(c.texto).toContain('&lt;b&gt;');
    expect(c.texto).toContain('Tom & Jerry <x>');
  });

  describe('documentos defectuosos: fallan con una frase, no con un stack', () => {
    it('PDF truncado', async () => {
      const pdf = await defectuosos.pdfTruncado();
      const d = detectarFormato(pdf);
      expect(d.ok).toBe(true);
      await expect(prepararContenido(pdf, 'pdf')).rejects.toThrow(/PDF está dañado/);
    });
    it('xlsx corrupto', async () => {
      const x = defectuosos.xlsxCorrupto();
      expect(detectarFormato(x)).toMatchObject({ ok: true, clase: 'excel' });
      await expect(prepararContenido(x, 'excel')).rejects.toThrow(/dañado|no trae filas/);
    });
    it('XML mal formado', async () => {
      await expect(prepararContenido(defectuosos.xmlMalFormado, 'xml')).rejects.toThrow(/mal formado/);
    });
    it('imagen corrupta', async () => {
      await expect(prepararContenido(defectuosos.imagenCorrupta, 'imagen')).rejects.toThrow(/imagen está dañada/);
    });
    it('hoja sin filas', async () => {
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Vacia');
      await expect(prepararContenido(Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })), 'excel')).rejects.toThrow(/no trae filas/);
    });
    it('correo sin texto', async () => {
      await expect(prepararContenido(Buffer.from('From: a@b.test\r\nSubject: x\r\n\r\n.'), 'correo')).rejects.toThrow(/no trae texto/);
    });
  });
});

describe('extraerCartaPorteXml (sin modelo)', () => {
  it('lee origen, destino, mercancía, operador, placas y distancia del CCP 3.1', async () => {
    const { c } = await leer(Buffer.from(xmlCartaPorte()));
    const e = extraerCartaPorteXml(c.xml)!;
    expect(e.campos.origen_rfc.valor).toBe(RFC.golfo);
    expect(e.campos.origen_cp.valor).toBe('91700');
    expect(e.campos.origen_estado.valor).toBe('VER');
    expect(e.campos.destino_cp.valor).toBe('64000');
    expect(e.campos.folio_cliente.valor).toBe('T9001');
    expect(e.campos.fecha_salida.valor).toBe('2026-10-17T06:00:00');
    expect(e.campos.distancia_km.valor).toBe('920');
    expect(e.campos.unidad_placas.valor).toBe('GHI4567');
    expect(e.campos.operador_licencia.valor).toBe('LIC123456');
    expect(e.campos.origen_rfc.origen).toBe('xml');
    expect(e.campos.origen_rfc.confianza).toBeGreaterThanOrEqual(0.98);
    expect(e.mercancias).toHaveLength(1);
    expect(e.mercancias[0].bienes_transp.valor).toBe('30111500');
    expect(e.mercancias[0].peso_kg.valor).toBe('24000');
    expect(e.mercancias[0].material_peligroso.valor).toBe('false');
  });

  it('un XML que no es Carta Porte devuelve null (sigue por perfil/modelo)', async () => {
    const { c } = await leer(Buffer.from(xmlPropio()));
    expect(extraerCartaPorteXml(c.xml)).toBeNull();
  });
});


describe('JSON estructurado (T-A3-12)', () => {
  const enc = (t: string): Uint8Array => new TextEncoder().encode(t);
  const anidado = (n: number): string => '{"a":'.repeat(n) + '1' + '}'.repeat(n);

  it('{"a":1} es JSON, y también un arreglo de objetos', () => {
    expect(detectarFormato(enc('{"a":1}'))).toEqual({ ok: true, clase: 'json', mime: 'application/json' });
    expect(detectarFormato(enc('  \n[{"a":1},{"a":2}]'))).toMatchObject({ ok: true, clase: 'json' });
    expect(detectarFormato(Buffer.from('\ufeff{"a":1}', 'utf8'))).toMatchObject({ ok: true, clase: 'json' });
  });

  it('JSON inválido con llaves, texto libre y objetos vacíos siguen el camino de siempre', () => {
    expect(detectarFormato(enc('{"folio": 12, "peso": }'))).toMatchObject({ ok: true, clase: 'correo', mime: 'text/plain' });
    expect(detectarFormato(enc('[pendiente] Folio: 123\nPeso: 400 kg'))).toMatchObject({ ok: true, clase: 'correo', mime: 'text/plain' });
    expect(detectarFormato(enc('Folio: 123\nPeso: 400 kg'))).toMatchObject({ ok: true, clase: 'correo' });
    expect(detectarFormato(enc('{}'))).toMatchObject({ ok: false });
    expect(detectarFormato(enc('"un texto entre comillas"'))).toMatchObject({ ok: true, clase: 'correo' });
  });

  it('el cuerpo de un correo declarado como correo no se vuelve JSON', async () => {
    // formatoForzado ni siquiera pasa por detectarFormato; aquí se comprueba que un .eml con JSON en el cuerpo sigue siendo correo.
    expect(detectarFormato(Buffer.from(emlConAsunto('{"a":1}')))).toMatchObject({ ok: true, clase: 'correo' });
  });

  it('3 000 niveles se rechaza con un motivo llano; 20 pasa y 21 no', () => {
    expect(detectarFormato(enc(anidado(3000)))).toMatchObject({ ok: false, motivo: expect.stringMatching(/anidado a más de 20 niveles/) });
    expect(detectarFormato(enc(anidado(20)))).toMatchObject({ ok: true, clase: 'json' });
    expect(detectarFormato(enc(anidado(21)))).toMatchObject({ ok: false });
  });

  it('un anidamiento que revienta el parser también se rechaza (no queda como texto)', () => {
    expect(detectarFormato(enc('['.repeat(2_000_000) + ']'.repeat(2_000_000)))).toMatchObject({ ok: false });
  });

  it('2 MB de JSON se rechaza por tamaño; justo debajo del tope pasa', () => {
    const grande = `{"a":"${'x'.repeat(2 * 1024 * 1024)}"}`;
    expect(detectarFormato(enc(grande))).toMatchObject({ ok: false, motivo: expect.stringMatching(/más de 1 MB/) });
    const cabe = `{"a":"${'x'.repeat(1024 * 1024 - 20)}"}`;
    expect(detectarFormato(enc(cabe))).toMatchObject({ ok: true, clase: 'json' });
  });

  it('prepararContenido: árbol limpio, texto re-serializado y formato json', async () => {
    const { d, c } = await leer(enc('{"Embarque":{"Folio":"A-1","Peso":120.5},"Mercancias":[{"d":"x"},{"d":"y"}]}'));
    expect(d).toMatchObject({ clase: 'json' });
    expect(c.formato).toBe('json');
    expect(c.tabla).toBeNull();
    expect(c.imagenes).toEqual([]);
    expect(c.xml).toEqual({ Embarque: { Folio: 'A-1', Peso: 120.5 }, Mercancias: [{ d: 'x' }, { d: 'y' }] });
    expect(JSON.parse(c.texto as string)).toEqual(c.xml);
    expect(c.texto).toContain('"Folio": "A-1"');
  });

  it('las claves __proto__, constructor y prototype se descartan y no contaminan', async () => {
    const { c } = await leer(enc('{"a":1,"__proto__":{"polluted":"si"},"x":{"constructor":{"prototype":{"polluted2":1}},"b":2},"l":[{"__proto__":5,"k":1}]}'));
    expect(c.xml).toEqual({ a: 1, x: { b: 2 }, l: [{ k: 1 }] });
    expect(c.texto).not.toMatch(/polluted|__proto__|constructor/);
    expect(c.avisos.join(' ')).toMatch(/Se ignoraron 3 clave/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(c.xml, '__proto__')).toBe(false);
  });

  it('prepararContenido también se defiende solo (sin pasar por detectarFormato)', async () => {
    await expect(prepararContenido(enc(anidado(25)), 'json')).rejects.toThrow(/anidado a más de 20 niveles/);
    await expect(prepararContenido(enc('{"a":'), 'json')).rejects.toThrow(/mal formado/);
    await expect(prepararContenido(enc(`{"a":"${'x'.repeat(2 * 1024 * 1024)}"}`), 'json')).rejects.toThrow(/más de 1 MB/);
  });

  it('un JSON largo recorta el texto pero conserva el árbol completo', async () => {
    const filas = Array.from({ length: 4000 }, (_, i) => ({ renglon: i, descripcion: `Mercancía sintética número ${i}` }));
    const { c } = await leer(enc(JSON.stringify({ Mercancias: filas })));
    expect((c.texto as string).length).toBeLessThanOrEqual(60_000);
    expect((c.xml as { Mercancias: unknown[] }).Mercancias).toHaveLength(4000);
    expect(c.avisos.join(' ')).toMatch(/JSON es largo/);
  });
});
