import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';

// ═══════════════════════════════════════════════════════════════════════════
// E1-B (P0-7) · EL ACUSE «SOLO FOLIO» DEL CIERRE PARA EL ENCARGADO.
//
// El encargado no ve dinero: el PDF completo no es suyo. Recibe un acuse con
// folio, operador y fecha — nunca cifras. Estas pruebas fijan: (1) que el papel
// no trae un solo importe, (2) a quién llega y a quién no, (3) la idempotencia
// por existencia del archivo y (4) que fallar aquí no toca el aviso al jefe.
// ═══════════════════════════════════════════════════════════════════════════

const m = vi.hoisted(() => ({
  telefonoJefeDe: vi.fn(),
  telefonoParaDineroDe: vi.fn(),
  sendDocument: vi.fn(),
  avisarOficina: vi.fn(),
  upload: vi.fn(),
  createSignedUrl: vi.fn(),
}));

vi.mock('@/lib/meta/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/meta/client')>();
  return { sendDocument: m.sendDocument, esReintentableMeta: actual.esReintentableMeta };
});
vi.mock('@/lib/meta/aviso_oficina', () => ({ avisarOficina: m.avisarOficina, parametrosAvisoOficina: () => [] }));
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: vi.fn(async () => {}) }));
vi.mock('./contactos', () => ({ telefonoJefeDe: m.telefonoJefeDe, telefonoParaDineroDe: m.telefonoParaDineroDe }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    storage: { from: () => ({ upload: m.upload, createSignedUrl: m.createSignedUrl }) },
    from: () => {
      const nodo: Record<string, unknown> = {};
      for (const k of ['select', 'eq', 'order', 'limit']) nodo[k] = () => nodo;
      nodo.maybeSingle = () => Promise.resolve({ data: { total_comprobado: 8421.5, total_anticipo: 9000, diferencia: -578.5, diferencias: [], folio: 'F-0042', operador: { nombre: 'Operador Demo' } }, error: null });
      return nodo;
    },
  }),
}));

const { avisarCierreAlJefe } = await import('./avisar_cierre');
const { acuseSoloFolioAlEncargado } = await import('./acuse_folio');
const { lineasSoloFolio, generarPdfSoloFolio } = await import('./liquidacion/pdf_folio');

const resumen = { folio: 'F-0042', operador: 'Operador Demo', anticipo: 9000, totalComprobado: 8421.5, diferencia: -578.5, diferencias: [] };
const args = (o: Record<string, unknown> = {}) => ({
  tenantId: 't1', viajeId: 'v1', resumen, requiereDecision: false,
  telefonoDinero: '5215500001111', telefonoOperador: '5215500002222', ...o,
});

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.telefonoJefeDe.mockResolvedValue('5215500003333');
  m.telefonoParaDineroDe.mockResolvedValue('5215500001111');
  m.upload.mockResolvedValue({ error: null });
  m.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://x/folio.pdf' }, error: null });
  m.sendDocument.mockResolvedValue({ ok: true, id: 'w1' });
  m.avisarOficina.mockResolvedValue({ ok: true, via: 'texto' });
});

describe('el papel «solo folio»', () => {
  it('imprime folio, operador y fecha, y NINGUNA cifra de dinero', () => {
    const t = lineasSoloFolio({ folio: 'F-0042', operador: 'Operador Demo', cerradaEn: '2026-10-03T18:00:00Z', requiereRevisionDeOficina: true }).join('\n');
    expect(t).toContain('F-0042');
    expect(t).toContain('Operador Demo');
    expect(t).not.toMatch(/\$|MXN|\d[\d,]*\.\d{2}/);
  });
  it('genera un PDF válido de una página', async () => {
    const bytes = await generarPdfSoloFolio({ folio: 'F-0042', operador: 'Operador Demo', cerradaEn: '2026-10-03T18:00:00Z', requiereRevisionDeOficina: false });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
  it('los bytes del PDF no contienen los importes del viaje', async () => {
    const bytes = await generarPdfSoloFolio({ folio: 'F-0042', operador: 'Operador Demo', cerradaEn: '2026-10-03T18:00:00Z', requiereRevisionDeOficina: false });
    const crudo = Buffer.from(bytes).toString('latin1');
    for (const cifra of ['8421', '9000', '578']) expect(crudo).not.toContain(cifra);
  });
});

describe('acuseSoloFolioAlEncargado', () => {
  it('sube el PDF a una ruta determinista y se lo manda al encargado', async () => {
    expect(await acuseSoloFolioAlEncargado(args())).toBe('enviado');
    expect(m.upload.mock.calls[0][0]).toBe('t1/v1-folio.pdf');
    expect(m.upload.mock.calls[0][2]).toMatchObject({ upsert: false });
    expect(m.sendDocument).toHaveBeenCalledWith('5215500003333', 'https://x/folio.pdf', 'cierre-F-0042.pdf', expect.stringContaining('F-0042'));
    // el caption tampoco lleva cifras
    expect(String(m.sendDocument.mock.calls[0][3])).not.toMatch(/\$|\d{3,}\.\d{2}/);
  });
  it('sin encargado con teléfono: no manda nada', async () => {
    m.telefonoJefeDe.mockResolvedValue(null);
    expect(await acuseSoloFolioAlEncargado(args())).toBe('sin_encargado');
    expect(m.sendDocument).not.toHaveBeenCalled();
  });
  it('si el contacto de operación es el mismo número que el de dinero o el chofer, no se duplica', async () => {
    m.telefonoJefeDe.mockResolvedValue('5215500001111');
    expect(await acuseSoloFolioAlEncargado(args())).toBe('mismo_numero');
    m.telefonoJefeDe.mockResolvedValue('5215500002222');
    expect(await acuseSoloFolioAlEncargado(args())).toBe('mismo_numero');
    expect(m.sendDocument).not.toHaveBeenCalled();
  });
  it('idempotente: si el archivo ya existe, el acuse ya salió y no se reenvía', async () => {
    m.upload.mockResolvedValue({ error: { message: 'The resource already exists' } });
    expect(await acuseSoloFolioAlEncargado(args())).toBe('ya_enviado');
    expect(m.sendDocument).not.toHaveBeenCalled();
  });
  it('un fallo de subida distinto a «ya existe» no se manda ni se disfraza de éxito', async () => {
    m.upload.mockResolvedValue({ error: { message: 'bucket caído' } });
    expect(await acuseSoloFolioAlEncargado(args())).toBe('fallo');
    expect(m.sendDocument).not.toHaveBeenCalled();
  });
  it('Meta rechaza de forma definitiva: fallo; si queda en el outbox: enviado', async () => {
    m.sendDocument.mockResolvedValue({ ok: false, error: 'x', codigo: 131030 });
    expect(await acuseSoloFolioAlEncargado(args())).toBe('fallo');
    m.upload.mockResolvedValue({ error: null });
    m.sendDocument.mockResolvedValue({ ok: false, error: 'red' });
    expect(await acuseSoloFolioAlEncargado(args())).toBe('enviado');
  });
});

describe('avisarCierreAlJefe + acuse', () => {
  it('manda el ejemplar completo al de dinero y el acuse al encargado (dos documentos distintos)', async () => {
    const r = await avisarCierreAlJefe({ tenantId: 't1', viajeId: 'v1', urlPdf: 'https://x/completo.pdf', telefonoOperador: '5215500002222' });
    expect(r.enviado).toBe(true);
    const destinos = m.sendDocument.mock.calls.map((c) => [c[0], c[1]]);
    expect(destinos).toContainEqual(['5215500001111', 'https://x/completo.pdf']);
    expect(destinos).toContainEqual(['5215500003333', 'https://x/folio.pdf']);
  });
  it('si el acuse truena, el aviso al jefe sigue saliendo igual', async () => {
    m.telefonoJefeDe.mockRejectedValue(new Error('base caída'));
    const r = await avisarCierreAlJefe({ tenantId: 't1', viajeId: 'v1', urlPdf: 'https://x/completo.pdf', telefonoOperador: '5215500002222' });
    expect(r.enviado).toBe(true);
    expect(r.pdfEnviado).toBe(true);
  });
});
