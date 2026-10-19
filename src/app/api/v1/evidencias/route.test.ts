import { describe, it, expect, vi, beforeEach } from 'vitest';

// GET /v1/evidencias: el estado de los documentos de cierre (T-A5-53/54) de UN viaje, aislado por el tenant de la
// credencial. `viajeId` es obligatorio (no hay un listado útil sin acotar a un viaje). Área `operacion`.

const abrir = vi.fn(async (_req: Request, _area: string): Promise<Record<string, unknown>> => ({ ok: true, tenantId: 't-1', rol: 'llave:operacion' }));
vi.mock('@/app/api/v1/_comun', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, abrir: (...a: [Request, string]) => abrir(...a) };
});
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const FILA_BASE = {
  id: 'd1111111-1111-1111-1111-111111111111',
  tenantId: 't-1',
  viajeId: '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001',
  documentoRequeridoId: 'c1111111-1111-1111-1111-111111111111',
  nombreSolicitado: 'Carta porte firmada',
  tipoSolicitado: 'basico' as const,
  solicitadoEn: '2026-10-18T10:00:00.000Z',
  recibidoEn: null as string | null,
  viajeHitoEvidenciaId: null as string | null,
  intentosLegibilidad: 0,
  estado: 'pendiente' as 'pendiente' | 'recibido' | 'revisar',
  respuestaChofer: null as 'evid_listo' | 'evid_falta' | null,
};

const leerDocumentosCierre = vi.fn(async (..._a: unknown[]): Promise<Array<typeof FILA_BASE>> => []);
vi.mock('@/lib/likida/conductor/repo_validacion', () => ({
  leerDocumentosCierre: (...a: unknown[]) => leerDocumentosCierre(...a),
}));

const { GET } = await import('./route');
const V = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001';
const get = (qs: string) => GET(new Request(`https://app.likida.ai/api/v1/evidencias${qs}`));

beforeEach(() => {
  abrir.mockReset(); abrir.mockResolvedValue({ ok: true, tenantId: 't-1', rol: 'llave:operacion' });
  leerDocumentosCierre.mockReset(); leerDocumentosCierre.mockResolvedValue([]);
});

describe('GET /v1/evidencias', () => {
  it('pide el área operacion y lee SOLO dentro de la flota de la credencial', async () => {
    leerDocumentosCierre.mockResolvedValue([FILA_BASE]);
    const r = await get(`?viajeId=${V}`);
    expect(r.status).toBe(200);
    expect(abrir.mock.calls[0][1]).toBe('operacion');
    expect(leerDocumentosCierre).toHaveBeenCalledWith('t-1', V);
    const body = await r.json();
    expect(body.datos).toHaveLength(1);
    expect(body.datos[0]).toMatchObject({ documentoRequeridoId: FILA_BASE.documentoRequeridoId, nombre: 'Carta porte firmada', tipo: 'basico', estado: 'pendiente' });
  });

  it('todos los documentos recibidos: el resumen lo dice y faltan = 0', async () => {
    leerDocumentosCierre.mockResolvedValue([
      { ...FILA_BASE, id: 'd1', estado: 'recibido', recibidoEn: '2026-10-18T12:00:00.000Z' },
      { ...FILA_BASE, id: 'd2', documentoRequeridoId: 'c2', nombreSolicitado: 'Pedimento', estado: 'recibido', recibidoEn: '2026-10-18T12:00:00.000Z' },
    ]);
    const body = await (await get(`?viajeId=${V}`)).json();
    expect(body.resumen).toEqual({ usaCatalogo: true, total: 2, recibidos: 2, faltan: 0 });
  });

  it('falta uno: el resumen cuenta exactamente el que falta', async () => {
    leerDocumentosCierre.mockResolvedValue([
      { ...FILA_BASE, id: 'd1', estado: 'recibido', recibidoEn: '2026-10-18T12:00:00.000Z' },
      { ...FILA_BASE, id: 'd2', documentoRequeridoId: 'c2', nombreSolicitado: 'Pedimento', estado: 'pendiente' },
    ]);
    const body = await (await get(`?viajeId=${V}`)).json();
    expect(body.resumen).toEqual({ usaCatalogo: true, total: 2, recibidos: 1, faltan: 1 });
  });

  it('cliente sin catálogo (o viaje sin solicitud): lista vacía y resumen sin romper', async () => {
    leerDocumentosCierre.mockResolvedValue([]);
    const body = await (await get(`?viajeId=${V}`)).json();
    expect(body.datos).toEqual([]);
    expect(body.resumen).toEqual({ usaCatalogo: false, total: 0, recibidos: 0, faltan: 0 });
  });

  it('sin `viajeId` es 400 y no consulta nada', async () => {
    const r = await get('');
    expect(r.status).toBe(400);
    expect(leerDocumentosCierre).not.toHaveBeenCalled();
  });

  it('un `viajeId` que no es uuid es 400 y no consulta nada', async () => {
    const r = await get("?viajeId=x'; drop table viaje_documento_cierre;--");
    expect(r.status).toBe(400);
    expect(leerDocumentosCierre).not.toHaveBeenCalled();
  });

  it('sin credencial no lee nada', async () => {
    abrir.mockResolvedValue({ ok: false, respuesta: new Response(null, { status: 401 }) });
    const r = await get(`?viajeId=${V}`);
    expect(r.status).toBe(401);
    expect(leerDocumentosCierre).not.toHaveBeenCalled();
  });

  it('una lectura que revienta es 500 sin filtrar el mensaje interno', async () => {
    leerDocumentosCierre.mockRejectedValue(new Error('relation "viaje_documento_cierre" does not exist'));
    const r = await get(`?viajeId=${V}`);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('viaje_documento_cierre');
  });
});
