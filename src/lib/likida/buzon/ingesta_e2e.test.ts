import { describe, it, expect } from 'vitest';
import { procesarCorreoBuzon, type DepsBuzon, type ContextoCorreo } from './ingesta';
import { crearZip } from './zip_escribir';
import { construirZipCrudo } from './zip_fixtures.test.util';
import type { PuertosPdf } from './pdf_factura';

// ═══════════════════════════════════════════════════════════════════════════
// E2E del buzón (Agente 9, criterio a–i): el correo entra con sus adjuntos YA
// descargados y sale la bandeja de facturas, con dobles de proveedor para lo
// externo (SAT, texto/visión del PDF, storage) y una base en memoria que respeta
// lo que las constraints de 0530 garantizan (unicidad por UUID y por correo+sha).
// ═══════════════════════════════════════════════════════════════════════════

const U1 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1';
const U2 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2';
const U3 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee3';
const TENANT = 't-1';

const cfdi = (uuid: string, total = '1160.00') => `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Fecha="2026-09-30T10:00:00" SubTotal="1000.00" Total="${total}" TipoDeComprobante="I">
  <cfdi:Emisor Rfc="AAA010101AAA" Nombre="Taller SA"/>
  <cfdi:Receptor Rfc="BBB010101BBB"/>
  <cfdi:Conceptos><cfdi:Concepto ClaveProdServ="78181500" ClaveUnidad="E48" Cantidad="1" Descripcion="Refacciones" Importe="1000.00"/></cfdi:Conceptos>
  <cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Impuesto="002" Importe="160.00"/></cfdi:Traslados></cfdi:Impuestos>
  <cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${uuid}"/></cfdi:Complemento>
</cfdi:Comprobante>`;

const xml = (uuid: string) => new Uint8Array(Buffer.from(cfdi(uuid)));
const pdf = (marca: string) => new Uint8Array(Buffer.from(`%PDF-1.4\n${marca}`));
const textoPdf = (uuid: string) => `FACTURA\nFolio fiscal: ${uuid}\nRFC Emisor: AAA010101AAA\nRFC Receptor: BBB010101BBB\nFecha de emisión: 2026-09-30T10:00:00\nSubtotal $1,000.00\nTotal $1,160.00`;

interface Factura { id: string; uuid: string; xml: boolean; pdf: boolean; revision: boolean; fuente: string }

function mundo(opciones: { textosPdf?: Record<string, string>; visionConfianza?: number } = {}) {
  const facturas: Factura[] = [];
  const recepciones: Array<{ nombre: string; estado: string; sha256: string; emailId: string; zipOrigen: string | null; motivo: string | null }> = [];
  const subidos: string[] = [];
  let visiones = 0;

  const pdfPuertos: PuertosPdf = {
    leerTexto: async (b) => ({ ok: true, texto: opciones.textosPdf?.[Buffer.from(b).toString('latin1').split('\n')[1] ?? ''] ?? '' }),
    imagenes: async () => ['data:image/jpeg;base64,AAAA'],
    vision: async () => {
      visiones++;
      return { legible: true, uuid: U3, monto: 1160, subTotal: 1000, rfcEmisor: 'AAA010101AAA', rfcReceptor: 'BBB010101BBB', fecha: '2026-09-30', confianza: opciones.visionConfianza ?? 0.55 };
    },
  };

  const deps: DepsBuzon = {
    repo: {
      registrarRecepcion: async (_t, r) => {
        const i = recepciones.findIndex((x) => x.emailId === r.emailId && x.sha256 === r.sha256);
        const fila = { nombre: r.nombre, estado: r.estado, sha256: r.sha256, emailId: r.emailId, zipOrigen: r.zipOrigen ?? null, motivo: r.motivo ?? null };
        if (i >= 0) recepciones[i] = fila; else recepciones.push(fila);
      },
      recepcionPrevia: async (_t, sha) => {
        const r = recepciones.find((x) => x.sha256 === sha && (x.estado === 'procesada' || x.estado === 'revision'));
        return r ? { estado: r.estado as 'procesada', cfdiUuid: null, facturaId: null } : null;
      },
      subirPdf: async (_t, sha) => { subidos.push(sha); return `${TENANT}/${sha}.pdf`; },
      facturaPorUuid: async (_t, uuid) => {
        const f = facturas.find((x) => x.uuid === uuid.toLowerCase());
        return f ? { id: f.id, estado: 'pendiente', tieneXml: f.xml, tienePdf: f.pdf } : null;
      },
      adjuntarPdfAFactura: async (_t, id) => {
        const f = facturas.find((x) => x.id === id);
        if (!f || f.pdf) return false;
        f.pdf = true; return true;
      },
      completarFacturaConXml: async (_t, uuid) => {
        const f = facturas.find((x) => x.uuid === uuid.toLowerCase());
        if (!f || f.xml) return false;
        f.xml = true; f.revision = false; f.fuente = 'xml'; return true;
      },
      guardarFacturaDePdf: async (_t, d, _rfc, o) => {
        if (facturas.some((x) => x.uuid === d.uuid.toLowerCase())) return { ok: false, motivo: 'duplicada' };
        const f = { id: `f${facturas.length + 1}`, uuid: d.uuid.toLowerCase(), xml: false, pdf: !!o.pdf, revision: o.requiereRevision, fuente: d.fuente };
        facturas.push(f);
        return { ok: true, facturaId: f.id, receptorEsFlota: null };
      },
    },
    pdf: pdfPuertos,
    estadoSat: async () => 'vigente',
    guardarFactura: async (_t, x) => {
      const uuid = (x.uuid ?? '').toLowerCase();
      if (facturas.some((f) => f.uuid === uuid)) return { ok: false, motivo: 'duplicada' };
      const f = { id: `f${facturas.length + 1}`, uuid, xml: true, pdf: false, revision: false, fuente: 'xml' };
      facturas.push(f);
      return { ok: true, facturaId: f.id, receptorEsFlota: null, ocrConfianza: null } as never;
    },
    parseRep: () => null,
    ingerirRep: async () => ({ pendientes: 0 }) as never,
    ahoraMs: () => 1_000,
  };
  return { deps, facturas, recepciones, subidos, visiones: () => visiones };
}

const ctx = (emailId = 'em-1'): ContextoCorreo => ({ tenantId: TENANT, emailId, rfcFlota: 'BBB010101BBB', finPresupuesto: 1_000_000 });

describe('E2E buzón — del correo a la bandeja', () => {
  it('un correo con un zip de dos facturas XML+PDF deja DOS facturas con su PDF y rastro por archivo', async () => {
    const m = mundo({ textosPdf: { 'p1': textoPdf(U1), 'p2': textoPdf(U2) } });
    const zip = crearZip([
      { nombre: 'a.xml', bytes: xml(U1) }, { nombre: 'a.pdf', bytes: pdf('p1') },
      { nombre: 'b.xml', bytes: xml(U2) }, { nombre: 'b.pdf', bytes: pdf('p2') },
    ]);
    const r = await procesarCorreoBuzon(ctx(), [{ nombre: 'facturas.zip', bytes: zip }], m.deps);
    expect(m.facturas.map((f) => [f.uuid, f.xml, f.pdf, f.revision])).toEqual([[U1, true, true, false], [U2, true, true, false]]);
    expect(r.guardadas).toBe(2);
    expect(r.caidas).toBe(0);
    expect(m.recepciones.filter((x) => x.zipOrigen === 'facturas.zip')).toHaveLength(4);
    expect(m.visiones()).toBe(0);
  });

  it('un PDF solo de baja confianza entra a la bandeja MARCADO para revisión humana, con el PDF guardado', async () => {
    const m = mundo({ visionConfianza: 0.55 });
    const r = await procesarCorreoBuzon(ctx(), [{ nombre: 'scan.pdf', bytes: pdf('escaneo') }], m.deps);
    expect(r.revision).toBe(1);
    expect(r.guardadas).toBe(0);
    expect(m.facturas).toEqual([{ id: 'f1', uuid: U3, xml: false, pdf: true, revision: true, fuente: 'pdf_vision' }]);
    expect(m.subidos).toHaveLength(1);
    expect(m.visiones()).toBe(1);
  });

  it('el XML que llega DESPUÉS del PDF completa la fila con el dato duro y quita la revisión', async () => {
    const m = mundo({ visionConfianza: 0.55 });
    await procesarCorreoBuzon(ctx('em-1'), [{ nombre: 'scan.pdf', bytes: pdf('escaneo') }], m.deps);
    const r = await procesarCorreoBuzon(ctx('em-2'), [{ nombre: 'f.xml', bytes: xml(U3) }], m.deps);
    expect(m.facturas).toHaveLength(1);
    expect(m.facturas[0]).toMatchObject({ xml: true, revision: false, fuente: 'xml' });
    expect(r.guardadas).toBe(1);
  });

  it('el reintento del MISMO correo no duplica nada (idempotente)', async () => {
    const m = mundo();
    const adjuntos = [{ nombre: 'a.xml', bytes: xml(U1) }];
    await procesarCorreoBuzon(ctx(), adjuntos, m.deps);
    const r2 = await procesarCorreoBuzon(ctx(), adjuntos, m.deps);
    expect(m.facturas).toHaveLength(1);
    expect(r2.duplicadas).toBe(1);
    expect(r2.guardadas).toBe(0);
  });

  it('ADVERSARIAL: una bomba zip y un XML con DTD se RECHAZAN con rastro, sin tumbar al correo ni reintentar', async () => {
    const m = mundo();
    const bomba = construirZipCrudo([{ nombre: 'x.xml', datos: new Uint8Array(1000), tamanoDeclarado: 5 }]);
    const xxe = new Uint8Array(Buffer.from('<?xml version="1.0"?><!DOCTYPE a [<!ENTITY e SYSTEM "file:///etc/passwd">]><a>&e;</a>'));
    const r = await procesarCorreoBuzon(ctx(), [
      { nombre: 'bomba.zip', bytes: bomba }, { nombre: 'xxe.xml', bytes: xxe }, { nombre: 'ok.xml', bytes: xml(U1) },
    ], m.deps);
    expect(r.rechazadas).toBeGreaterThanOrEqual(2);
    expect(r.caidas).toBe(0);
    expect(r.guardadas).toBe(1);
    expect(m.facturas).toHaveLength(1);
    expect(m.recepciones.filter((x) => x.estado === 'rechazada').map((x) => x.nombre).sort()).toEqual(['bomba.zip', 'xxe.xml']);
  });

  it('un fallo TRANSITORIO de la base cuenta como caída (el correo se reintenta), no como archivo descartado', async () => {
    const m = mundo();
    m.deps.guardarFactura = async () => ({ ok: false, motivo: 'error' }) as never;
    const r = await procesarCorreoBuzon(ctx(), [{ nombre: 'a.xml', bytes: xml(U1) }], m.deps);
    expect(r.caidas).toBe(1);
    expect(r.ignoradas).toBe(0);
  });

  it('un archivo que no es XML, PDF ni zip se ignora con motivo', async () => {
    const m = mundo();
    const r = await procesarCorreoBuzon(ctx(), [{ nombre: 'foto.jpg', bytes: new Uint8Array([0xff, 0xd8, 0xff]) }], m.deps);
    expect(r.ignoradas).toBe(1);
  });
});
