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
  generarPdf: vi.fn(),
}));

vi.mock('@/lib/meta/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/meta/client')>();
  return { sendDocument: m.sendDocument, esReintentableMeta: actual.esReintentableMeta };
});
vi.mock('@/lib/meta/aviso_oficina', () => ({
  avisarOficina: m.avisarOficina, parametrosAvisoOficina: () => [], esFueraDeVentana: (c?: number) => c === 131047 || c === 131026,
}));
vi.mock('./liquidacion/pdf_folio', async (original) => {
  const real = await original<typeof import('./liquidacion/pdf_folio')>();
  return { ...real, generarPdfSoloFolio: (...a: unknown[]) => m.generarPdf(...a) };
});
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
const { lineasSoloFolio, generarPdfSoloFolio } = await vi.importActual<typeof import('./liquidacion/pdf_folio')>('./liquidacion/pdf_folio');

const resumen = { folio: 'F-0042', operador: 'Operador Demo', anticipo: 9000, totalComprobado: 8421.5, diferencia: -578.5, diferencias: [], cerradaEn: '2026-09-20T15:00:00Z' };
const args = (o: Record<string, unknown> = {}) => ({
  tenantId: 't1', viajeId: 'v1', resumen, requiereDecision: false,
  telefonoDinero: '5215500001111', telefonoOperador: '5215500002222', ...o,
});

/** Un Storage de juguete: lo subido existe; firmar lo que no existe da «Object not found». */
let existentes: Set<string>;
let fallaFirma: ((ruta: string) => { message: string } | null) | null;

beforeEach(() => {
  existentes = new Set();
  fallaFirma = null;
  Object.values(m).forEach((f) => f.mockReset());
  m.generarPdf.mockImplementation((d: Parameters<typeof generarPdfSoloFolio>[0]) => generarPdfSoloFolio(d));
  m.telefonoJefeDe.mockResolvedValue('5215500003333');
  m.telefonoParaDineroDe.mockResolvedValue('5215500001111');
  m.upload.mockImplementation(async (ruta: string) => {
    if (existentes.has(ruta)) return { error: { message: 'The resource already exists' } };
    existentes.add(ruta);
    return { error: null };
  });
  m.createSignedUrl.mockImplementation(async (ruta: string) => {
    const e = fallaFirma?.(ruta);
    if (e) return { data: null, error: e };
    return existentes.has(ruta)
      ? { data: { signedUrl: `https://x/${ruta.split('/').pop()}` }, error: null }
      : { data: null, error: { message: 'Object not found' } };
  });
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
  it('sube el PDF a una ruta determinista, se lo manda al encargado y deja el sello de entrega', async () => {
    expect(await acuseSoloFolioAlEncargado(args())).toBe('enviado');
    expect(m.upload.mock.calls[0][0]).toBe('t1/v1-folio.pdf');
    expect(m.upload.mock.calls[0][2]).toMatchObject({ upsert: false });
    expect(m.sendDocument).toHaveBeenCalledWith('5215500003333', 'https://x/v1-folio.pdf', 'cierre-F-0042.pdf', expect.stringContaining('F-0042'));
    // el caption tampoco lleva cifras
    expect(String(m.sendDocument.mock.calls[0][3])).not.toMatch(/\$|\d{3,}\.\d{2}/);
    expect(existentes.has('t1/v1-folio.enviado')).toBe(true);
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
  it('idempotente por REGISTRO DE ENTREGA: si el sello existe, el acuse ya salió y no se reenvía', async () => {
    expect(await acuseSoloFolioAlEncargado(args())).toBe('enviado');
    m.sendDocument.mockClear();
    expect(await acuseSoloFolioAlEncargado(args())).toBe('ya_enviado');
    expect(m.sendDocument).not.toHaveBeenCalled();
  });
  it('M1 · upload ok + envío rechazado de forma definitiva: NO sella; el reintento reutiliza el PDF y vuelve a enviar', async () => {
    m.sendDocument.mockResolvedValueOnce({ ok: false, error: 'x', codigo: 131030 });
    expect(await acuseSoloFolioAlEncargado(args())).toBe('fallo');
    expect(existentes.has('t1/v1-folio.pdf')).toBe(true);
    expect(existentes.has('t1/v1-folio.enviado')).toBe(false);
    m.generarPdf.mockClear(); m.upload.mockClear();
    // el siguiente «listo»: el PDF ya está subido → no se regenera ni se sube otra vez, solo se reintenta el envío
    expect(await acuseSoloFolioAlEncargado(args())).toBe('enviado');
    expect(m.generarPdf).not.toHaveBeenCalled();
    expect(m.upload.mock.calls.map((c) => c[0])).toEqual(['t1/v1-folio.enviado']);
    expect(m.sendDocument).toHaveBeenCalledTimes(2);
    expect(await acuseSoloFolioAlEncargado(args())).toBe('ya_enviado');
  });
  it('M1 · upload ok + la firma falla: no se da por enviado y el reintento sí manda', async () => {
    let n = 0;
    fallaFirma = (ruta) => (ruta.endsWith('.pdf') && n++ === 1 ? { message: 'storage 503' } : null);
    expect(await acuseSoloFolioAlEncargado(args())).toBe('fallo');
    expect(m.sendDocument).not.toHaveBeenCalled();
    expect(existentes.has('t1/v1-folio.enviado')).toBe(false);
    fallaFirma = null;
    expect(await acuseSoloFolioAlEncargado(args())).toBe('enviado');
    expect(m.sendDocument).toHaveBeenCalledTimes(1);
  });
  it('un fallo de subida distinto a «ya existe» no se manda ni se disfraza de éxito', async () => {
    m.upload.mockResolvedValue({ error: { message: 'bucket caído' } });
    expect(await acuseSoloFolioAlEncargado(args())).toBe('fallo');
    expect(m.sendDocument).not.toHaveBeenCalled();
  });
  it('si no se puede leer el sello (storage caído), ni se manda ni se sella', async () => {
    fallaFirma = () => ({ message: 'storage 503' });
    expect(await acuseSoloFolioAlEncargado(args())).toBe('fallo');
    expect(m.sendDocument).not.toHaveBeenCalled();
  });
  it('si queda en el outbox (sin código o código reintentable): enviado y sellado', async () => {
    m.sendDocument.mockResolvedValue({ ok: false, error: 'red' });
    expect(await acuseSoloFolioAlEncargado(args())).toBe('enviado');
    expect(existentes.has('t1/v1-folio.enviado')).toBe(true);
  });
  it('M1 · fuera de la ventana de 24 h (131047): el folio sale por la plantilla de oficina y eso sella', async () => {
    m.sendDocument.mockResolvedValue({ ok: false, error: 'Re-engagement', codigo: 131047 });
    expect(await acuseSoloFolioAlEncargado(args())).toBe('enviado');
    expect(m.avisarOficina).toHaveBeenCalledTimes(1);
    const texto = String(m.avisarOficina.mock.calls[0][1]);
    expect(texto).toContain('F-0042');
    expect(texto).not.toMatch(/\$|\d{3,}\.\d{2}/);
    expect(existentes.has('t1/v1-folio.enviado')).toBe(true);
  });
  it('fuera de ventana y la plantilla tampoco sale: fallo sin sello (se reintenta)', async () => {
    m.sendDocument.mockResolvedValue({ ok: false, error: 'Re-engagement', codigo: 131047 });
    m.avisarOficina.mockResolvedValue({ ok: false, motivo: 'x', fueraDeVentana: true, reintentable: false, encolado: false });
    expect(await acuseSoloFolioAlEncargado(args())).toBe('fallo');
    expect(existentes.has('t1/v1-folio.enviado')).toBe(false);
  });
  it('B2 · el acuse imprime la fecha REAL de cierre de la liquidación, no la del envío', async () => {
    await acuseSoloFolioAlEncargado(args());
    expect(m.generarPdf.mock.calls[0][0]).toMatchObject({ cerradaEn: '2026-09-20T15:00:00Z' });
  });
});

describe('avisarCierreAlJefe + acuse', () => {
  it('manda el ejemplar completo al de dinero y el acuse al encargado (dos documentos distintos)', async () => {
    const r = await avisarCierreAlJefe({ tenantId: 't1', viajeId: 'v1', urlPdf: 'https://x/completo.pdf', telefonoOperador: '5215500002222' });
    expect(r.enviado).toBe(true);
    const destinos = m.sendDocument.mock.calls.map((c) => [c[0], c[1]]);
    expect(destinos).toContainEqual(['5215500001111', 'https://x/completo.pdf']);
    expect(destinos).toContainEqual(['5215500003333', 'https://x/v1-folio.pdf']);
  });
  it('si el acuse truena, el aviso al jefe sigue saliendo igual', async () => {
    m.telefonoJefeDe.mockRejectedValue(new Error('base caída'));
    const r = await avisarCierreAlJefe({ tenantId: 't1', viajeId: 'v1', urlPdf: 'https://x/completo.pdf', telefonoOperador: '5215500002222' });
    expect(r.enviado).toBe(true);
    expect(r.pdfEnviado).toBe(true);
  });
});
