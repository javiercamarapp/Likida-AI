import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearBaseEnMemoria, type BaseEnMemoria } from '@/lib/pruebas/tablas_en_memoria.fixture';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA ADVERSARIAL ALTO #2 (0845) — el CFDI real que llega por el buzón
// DESPUÉS de que una persona ya aprobó o rechazó la factura (el PDF llegó
// primero, se decidió con esa lectura, y el XML llega tarde).
//
// Antes: `completarFacturaConXml` solo escribía con `.eq('estado','pendiente')`;
// si la fila ya no era pendiente, el UPDATE afectaba 0 filas y la función
// devolvía sin guardar NADA — el XML (dato duro del CFDI, evidencia fiscal
// CFF 30) se perdía para siempre.
//
// Ahora: se guarda en `xml_crudo_tardio` / `recibido_tardio_en` (0845), SIN
// tocar `estado`/`decidido_por`/`decidido_en` — la decisión ya tomada no cambia.
// ═══════════════════════════════════════════════════════════════════════════

const estado = vi.hoisted(() => ({ db: null as unknown as BaseEnMemoria }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => estado.db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { completarFacturaConXml } = await import('./repo');

const T = '11111111-1111-4111-8111-111111111111';
const UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1';

const xmlDatos = {
  rfcEmisor: 'AAA010101AAA', rfcReceptor: 'BBB010101BBB', fecha: '2026-09-30T10:00:00',
  subTotal: 1000, ivaTraslado: 160, total: 1160, conceptos: [{}],
} as never;

const facturaDecidida = (over: Record<string, unknown> = {}) => ({
  id: 'f1', tenant_id: T, cfdi_uuid: UUID, estado: 'aprobada', decidido_por: 'ana@flota.mx',
  decidido_en: '2026-10-01T12:00:00Z', xml_crudo: null, ocr_confianza: 0.55, total: 1150,
  descripcion: 'leído de un PDF por visión', xml_crudo_tardio: null, recibido_tardio_en: null,
  ...over,
});

beforeEach(() => {
  estado.db = crearBaseEnMemoria({ factura_proveedor: [] });
});

describe('completarFacturaConXml — factura YA DECIDIDA (ALTO #2)', () => {
  it('el XML real NO se pierde: se guarda en xml_crudo_tardio sin tocar la decisión', async () => {
    estado.db = crearBaseEnMemoria({ factura_proveedor: [facturaDecidida()] });

    const r = await completarFacturaConXml(T, UUID, xmlDatos, '<cfdi:Comprobante Total="1160.00"/>', 'BBB010101BBB', 'vigente');

    expect(r).toBe('guardado_tardio');
    const fila = estado.db.tabla('factura_proveedor')[0];
    expect(fila.xml_crudo_tardio).toBe('<cfdi:Comprobante Total="1160.00"/>');
    expect(fila.recibido_tardio_en).toBeTruthy();
    // La decisión YA tomada no cambia: ni el estado, ni quién/cuándo decidió, ni lo que esa
    // persona vio (xml_crudo sigue null — la factura se decidió con la LECTURA del PDF, no con este XML).
    expect(fila.estado).toBe('aprobada');
    expect(fila.decidido_por).toBe('ana@flota.mx');
    expect(fila.decidido_en).toBe('2026-10-01T12:00:00Z');
    expect(fila.xml_crudo).toBeNull();
    expect(fila.total).toBe(1150);
  });

  it('también se preserva si la factura ya fue RECHAZADA, no solo aprobada', async () => {
    estado.db = crearBaseEnMemoria({ factura_proveedor: [facturaDecidida({ estado: 'rechazada', decidido_por: 'luis@flota.mx' })] });

    const r = await completarFacturaConXml(T, UUID, xmlDatos, '<cfdi:Comprobante Total="1160.00"/>', 'BBB010101BBB', null);

    expect(r).toBe('guardado_tardio');
    const fila = estado.db.tabla('factura_proveedor')[0];
    expect(fila.estado).toBe('rechazada');
    expect(fila.xml_crudo_tardio).toBeTruthy();
  });

  it('un segundo correo con el MISMO folio tardío no pisa el primero (idempotente)', async () => {
    estado.db = crearBaseEnMemoria({ factura_proveedor: [facturaDecidida({ xml_crudo_tardio: '<primero/>', recibido_tardio_en: '2026-10-02T00:00:00Z' })] });

    const r = await completarFacturaConXml(T, UUID, xmlDatos, '<segundo/>', 'BBB010101BBB', 'vigente');

    expect(r).toBe('sin_cambio');
    const fila = estado.db.tabla('factura_proveedor')[0];
    expect(fila.xml_crudo_tardio).toBe('<primero/>'); // no lo pisó
    expect(fila.recibido_tardio_en).toBe('2026-10-02T00:00:00Z');
  });

  it('caso normal (sigue vigente): la factura PENDIENTE sin XML se completa como antes', async () => {
    estado.db = crearBaseEnMemoria({
      factura_proveedor: [{ id: 'f2', tenant_id: T, cfdi_uuid: UUID, estado: 'pendiente', xml_crudo: null, ocr_confianza: 0.55, xml_crudo_tardio: null, recibido_tardio_en: null }],
    });

    const r = await completarFacturaConXml(T, UUID, xmlDatos, '<cfdi:Comprobante Total="1160.00"/>', 'BBB010101BBB', 'vigente');

    expect(r).toBe('completada');
    const fila = estado.db.tabla('factura_proveedor')[0];
    expect(fila.xml_crudo).toBe('<cfdi:Comprobante Total="1160.00"/>');
    expect(fila.estado).toBe('pendiente'); // sigue pendiente: completar no decide por la persona
    expect(fila.xml_crudo_tardio).toBeNull(); // no usó la vía tardía: sí pudo completar por la vía normal
  });
});
