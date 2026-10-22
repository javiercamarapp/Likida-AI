import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearBaseEnMemoria, type BaseEnMemoria } from '@/lib/pruebas/tablas_en_memoria.fixture';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA ADVERSARIAL ALTO #2 (A9, buzón sin autenticar, 21-oct-2026).
//
// `completarFacturaConXml` solo comprobaba el UUID + «sigue pendiente y sin
// XML» antes de sobrescribir total/subtotal/IVA/RFC/fecha/descripción y
// APAGAR `requiere_revision` — sin comparar esas cifras nuevas contra las que
// YA se habían guardado al leer el PDF/visión.
//
// El buzón es entrada SIN AUTENTICAR (solo protegido por el token), así que
// el ataque es directo: un correo manda PRIMERO un PDF con un UUID elegido
// (cae en revisión por baja confianza de OCR, como cualquier PDF) y DESPUÉS
// un XML forjado con el MISMO UUID pero cifras/RFC distintos. Sin el cotejo,
// la fila quedaba como una factura normal — sin ningún aviso — con la cifra
// que el remitente eligió.
// ═══════════════════════════════════════════════════════════════════════════

const estado = vi.hoisted(() => ({ db: null as unknown as BaseEnMemoria }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => estado.db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { completarFacturaConXml } = await import('./repo');

const T = '11111111-1111-4111-8111-111111111111';
const UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1';

/** La fila que dejó la LECTURA DEL PDF: pendiente, sin XML, con baja confianza (como cualquier PDF solo). */
const filaDePdf = (over: Record<string, unknown> = {}) => ({
  id: 'f1', tenant_id: T, cfdi_uuid: UUID, estado: 'pendiente', xml_crudo: null,
  ocr_confianza: 0.4, fuente_datos: 'pdf_vision', requiere_revision: true,
  revision_motivo: 'lectura de PDF con confianza 0.4 (umbral 0.8)',
  total: 1160, sub_total: 1000, iva: 160, emisor_rfc: 'AAA010101AAA', receptor_rfc: 'BBB010101BBB',
  xml_crudo_tardio: null, recibido_tardio_en: null,
  ...over,
});

beforeEach(() => {
  estado.db = crearBaseEnMemoria({ factura_proveedor: [] });
});

describe('completarFacturaConXml — discrepancia entre el PDF leído y el XML que llega después (ALTO #2)', () => {
  it('EXACTAMENTE el escenario del hallazgo: PDF total=1160/emisor AAA, luego XML total=100000/emisor ZZZ, mismo UUID — la fila NO se da por buena', async () => {
    estado.db = crearBaseEnMemoria({ factura_proveedor: [filaDePdf()] });

    const xmlHostil = {
      rfcEmisor: 'ZZZ010101ZZZ', rfcReceptor: 'BBB010101BBB', fecha: '2026-10-21T10:00:00',
      subTotal: 86207, ivaTraslado: 13793, total: 100000, conceptos: [{}],
    } as never;

    const r = await completarFacturaConXml(T, UUID, xmlHostil, '<cfdi:Comprobante Total="100000.00"/>', 'BBB010101BBB', 'vigente');

    expect(r).toBe('completada');
    const fila = estado.db.tabla('factura_proveedor')[0];
    // LO QUE IMPORTA: la fila SIGUE pidiendo revisión — nunca pasa a 'false' por el solo hecho de
    // que llegó un XML con el mismo folio fiscal. Un humano tiene que comparar antes de tratarla
    // como una factura normal.
    expect(fila.requiere_revision).toBe(true);
    expect(fila.revision_motivo).toMatch(/no coincide/i);
    expect(String(fila.revision_motivo)).toMatch(/1160/);
    expect(String(fila.revision_motivo)).toMatch(/100000/);
    expect(String(fila.revision_motivo)).toMatch(/AAA010101AAA/);
    expect(String(fila.revision_motivo)).toMatch(/ZZZ010101ZZZ/);
    // El XML sí se guarda (es evidencia fiscal real, CFF 30) — lo que no ocurre es que se
    // trate como validado sin que nadie lo mire.
    expect(fila.xml_crudo).toBe('<cfdi:Comprobante Total="100000.00"/>');
  });

  it('una discrepancia SOLO de RFC (mismo total) también fuerza revisión', async () => {
    estado.db = crearBaseEnMemoria({ factura_proveedor: [filaDePdf({ total: 1160, sub_total: 1000, iva: 160 })] });

    const xml = {
      rfcEmisor: 'ZZZ010101ZZZ', rfcReceptor: 'BBB010101BBB', fecha: '2026-10-21T10:00:00',
      subTotal: 1000, ivaTraslado: 160, total: 1160, conceptos: [{}],
    } as never;

    await completarFacturaConXml(T, UUID, xml, '<cfdi/>', 'BBB010101BBB', 'vigente');

    const fila = estado.db.tabla('factura_proveedor')[0];
    expect(fila.requiere_revision).toBe(true);
    expect(String(fila.revision_motivo)).toMatch(/RFC emisor/);
  });

  it('una diferencia menor al 1% (redondeo normal de OCR) NO se trata como discrepancia', async () => {
    // 1160.50 vs 1160: 0.043% de diferencia — el ruido normal entre OCR y el dato duro del XML.
    estado.db = crearBaseEnMemoria({ factura_proveedor: [filaDePdf({ total: 1160.5, sub_total: 1000, iva: 160 })] });

    const xml = {
      rfcEmisor: 'AAA010101AAA', rfcReceptor: 'BBB010101BBB', fecha: '2026-10-21T10:00:00',
      subTotal: 1000, ivaTraslado: 160, total: 1160, conceptos: [{}],
    } as never;

    const r = await completarFacturaConXml(T, UUID, xml, '<cfdi:Comprobante Total="1160.00"/>', 'BBB010101BBB', 'vigente');

    expect(r).toBe('completada');
    const fila = estado.db.tabla('factura_proveedor')[0];
    expect(fila.requiere_revision).toBe(false);
    expect(fila.revision_motivo).toBeNull();
  });

  it('el caso normal (PDF y XML cuadran) sigue limpiando la revisión, como antes', async () => {
    estado.db = crearBaseEnMemoria({ factura_proveedor: [filaDePdf({ total: 1160, sub_total: 1000, iva: 160, emisor_rfc: 'AAA010101AAA', receptor_rfc: 'BBB010101BBB' })] });

    const xml = {
      rfcEmisor: 'AAA010101AAA', rfcReceptor: 'BBB010101BBB', fecha: '2026-10-21T10:00:00',
      subTotal: 1000, ivaTraslado: 160, total: 1160, conceptos: [{}],
    } as never;

    const r = await completarFacturaConXml(T, UUID, xml, '<cfdi:Comprobante Total="1160.00"/>', 'BBB010101BBB', 'vigente');

    expect(r).toBe('completada');
    const fila = estado.db.tabla('factura_proveedor')[0];
    expect(fila.requiere_revision).toBe(false);
    expect(fila.revision_motivo).toBeNull();
    expect(fila.xml_crudo).toBe('<cfdi:Comprobante Total="1160.00"/>');
  });

  it('sin baseline previo (fila sin cifras aún) no hay discrepancia que declarar', async () => {
    estado.db = crearBaseEnMemoria({
      factura_proveedor: [{ id: 'f2', tenant_id: T, cfdi_uuid: UUID, estado: 'pendiente', xml_crudo: null, ocr_confianza: null, xml_crudo_tardio: null, recibido_tardio_en: null }],
    });

    const xml = {
      rfcEmisor: 'AAA010101AAA', rfcReceptor: 'BBB010101BBB', fecha: '2026-10-21T10:00:00',
      subTotal: 1000, ivaTraslado: 160, total: 1160, conceptos: [{}],
    } as never;

    const r = await completarFacturaConXml(T, UUID, xml, '<cfdi:Comprobante Total="1160.00"/>', 'BBB010101BBB', 'vigente');

    expect(r).toBe('completada');
    const fila = estado.db.tabla('factura_proveedor')[0];
    expect(fila.requiere_revision).toBe(false);
  });
});
