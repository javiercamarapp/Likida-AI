import { beforeEach, describe, expect, it, vi } from 'vitest';

// Las puertas de la exportación (rate limit, sesión → flota, área operacion, puedeExportar), el aislamiento por tenant
// y que SOLO salen documentos aprobados. Lo que se dobla es la base y la sesión; permisos y visibilidad son los REALES.
let tenant: { ok: true; tenantId: string; rol: string } | { ok: false; status: 401 | 403 | 503; motivo: string } = { ok: true, tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', rol: 'flota_admin' };
let limite = true;
vi.mock('@/lib/auth/tenant-api', () => ({ resolverTenantApi: async () => tenant }));
vi.mock('@/lib/auth/session', () => ({ getSessionTenant: async () => ({ userId: 'u-1' }) }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => limite, clientIp: () => '1.2.3.4' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/carta_porte_docs/repo', async () => (await import('@/lib/likida/carta_porte_docs/repo_falso.fixture')).api);

import { estado, reset } from '@/lib/likida/carta_porte_docs/repo_falso.fixture';
import { A, B } from '@/lib/likida/carta_porte_docs/escenario.fixture';
import { extraccionAtlasOk } from '@/lib/likida/carta_porte_docs/documentos_sinteticos.fixture';
import type { DocumentoFila } from '@/lib/likida/carta_porte_docs/repo';
import * as XLSX from 'xlsx';
import { GET } from './route';

const U1 = '11111111-1111-4111-8111-111111111111'; const U2 = '22222222-2222-4222-8222-222222222222'; const U3 = '33333333-3333-4333-8333-333333333333'; const UB = '44444444-4444-4444-8444-444444444444';
const peticion = (qs = '') => new Request(`https://app.likida.ai/api/export/carta-porte-docs${qs}`);

function doc(id: string, tenantId: string, over: Partial<DocumentoFila> = {}): void {
  estado.docs.set(id, {
    id, tenantId, canal: 'manual', formato: 'excel', nombreArchivo: `${id.slice(0, 4)}.xlsx`, mime: null, bytes: 1, sha256: id.replace(/-/g, '').padEnd(64, '0'), storageRuta: null, estado: 'aprobado', version: 2,
    clienteId: null, perfilId: null, perfilVersion: null, remitente: null, asunto: null, remitenteReconocido: null, textoExtracto: null, riesgoInyeccion: false, extraccion: extraccionAtlasOk(), validacion: null,
    confianzaMin: null, nivelModelo: 1, modelo: null, tokensIn: 0, tokensOut: 0, costoUsd: 0, viajeId: null, procesandoHasta: null, intentos: 1, ultimoError: null, abiertoEn: null, revisadoPor: null,
    aprobadoPor: null, aprobadoEn: '2026-10-02T10:00:00.000Z', rechazoMotivo: null, tiempoRevisionSeg: 60, exportadoEn: null, retenerHasta: '2027-01-01T00:00:00.000Z', purgadoEn: null,
    createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z', ...over,
  });
}

beforeEach(() => {
  reset(); limite = true; tenant = { ok: true, tenantId: A, rol: 'flota_admin' };
  doc(U1, A); doc(U2, A, { estado: 'por_revisar', aprobadoEn: null }); doc(U3, A, { exportadoEn: '2026-10-03T00:00:00.000Z' }); doc(UB, B);
  estado.eventos.length = 0;
});

describe('las puertas', () => {
  it('rate limit → 429; sin sesión → su status; rol sin el área o sin el verbo → 403', async () => {
    limite = false;
    expect((await GET(peticion())).status).toBe(429);
    limite = true;
    tenant = { ok: false, status: 401, motivo: 'sin sesión' };
    expect((await GET(peticion())).status).toBe(401);
    for (const rol of ['vendedor', 'contador']) {
      tenant = { ok: true, tenantId: A, rol };
      expect((await GET(peticion())).status, rol).toBe(403);
    }
  });
});

describe('el archivo', () => {
  it('por omisión exporta los aprobados que NO se habían exportado, de ESTA flota, con BOM y nombre', async () => {
    const r = await GET(peticion());
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toMatch(/^attachment; filename="carta-porte-estandar-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM: Excel en español abre UTF-8 sin acentos rotos
    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(csv.slice(1).startsWith('Folio,FechaSalida')).toBe(true);
    expect(csv.trim().split('\r\n')).toHaveLength(2); // encabezado + 1 mercancía de U1 (U2 no está aprobado, U3 ya salió, UB es de otra flota)
    expect(estado.docs.get(U1)!.exportadoEn).not.toBeNull();
    expect(estado.docs.get(UB)!.exportadoEn).toBeNull();
    expect(estado.eventos.filter((e) => e.tipo === 'exportado' && e.documentoId === U1)).toHaveLength(1);
  });

  it('la segunda vez ya no hay nada nuevo (404), pero con ?ids= se puede volver a bajar', async () => {
    await GET(peticion());
    expect((await GET(peticion())).status).toBe(404);
    expect((await GET(peticion(`?ids=${U1}`))).status).toBe(200);
  });

  it('un ?ids= con documentos de OTRA flota no exporta nada de ella', async () => {
    const r = await GET(peticion(`?ids=${UB}`));
    expect(r.status).toBe(404);
    const mixto = await GET(peticion(`?ids=${UB},${U1}`));
    expect(mixto.status).toBe(200);
    expect((await mixto.text()).trim().split('\r\n')).toHaveLength(2);
    expect(estado.docs.get(UB)!.exportadoEn).toBeNull();
  });

  it('un documento por revisar pedido por id NO sale (solo lo aprobado)', async () => {
    expect((await GET(peticion(`?ids=${U2}`))).status).toBe(404);
  });

  it('json', async () => {
    const r = await GET(peticion('?formato=json'));
    expect(r.headers.get('content-type')).toMatch(/json/);
    expect(JSON.parse(await r.text()).filas).toHaveLength(1);
  });

  it('xlsx: sale un libro de Excel real con encabezado, números como número y el sello de exportación', async () => {
    const r = await GET(peticion('?formato=xlsx'));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(r.headers.get('content-disposition')).toMatch(/filename="carta-porte-estandar-\d{4}-\d{2}-\d{2}\.xlsx"/);
    const libro = XLSX.read(new Uint8Array(await r.arrayBuffer()), { type: 'array' });
    const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(libro.Sheets[libro.SheetNames[0]]);
    expect(filas).toHaveLength(1);
    expect(filas[0].PesoKg).toBe(8400);
    expect(typeof filas[0].PesoKg).toBe('number');
    expect(estado.eventos.some((e) => (e as unknown as { tipo?: string }).tipo === 'exportado')).toBe(true);
  });

  describe('?formato=plantilla_tms&documento=', () => {
    const lee = async (r: Response) => XLSX.read(new Uint8Array(await r.arrayBuffer()), { type: 'array' });

    it('aprobado: 200, MIME xlsx, 3 hojas, y queda el evento exportado', async () => {
      const r = await GET(peticion(`?formato=plantilla_tms&documento=${U1}`));
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(r.headers.get('content-disposition')).toMatch(/filename="plantilla-tms-[0-9a-f]{8}\.xlsx"/);
      const l = await lee(r);
      expect(l.SheetNames).toEqual(['RemintenteDestinatario', 'Mercancias', 'Error']);
      expect(l.Sheets.RemintenteDestinatario.C12.v).toBeDefined();
      expect(estado.eventos.filter((e) => e.tipo === 'exportado' && e.documentoId === U1)).toHaveLength(1);
    });

    it('con un faltante BLOQUEANTE (2 orígenes en la plantilla normal): 409 con el motivo, no sella exportado y no entrega el archivo (INN-A3-04)', async () => {
      const e = extraccionAtlasOk();
      e.campos.origen_2_nombre = { valor: 'Segundo Origen Sintetico SA', confianza: 0.95, evidencia: null, origen: 'llm' };
      estado.docs.get(U1)!.extraccion = e;
      const r = await GET(peticion(`?formato=plantilla_tms&documento=${U1}`));
      expect(r.status).toBe(409);
      expect(await r.text()).toMatch(/or[ií]genes/i);
      expect(estado.docs.get(U1)!.exportadoEn).toBeNull();
      expect(estado.eventos.filter((x) => x.tipo === 'exportado')).toHaveLength(0);
    });

    it('los avisos NO bloquean, pero se cuentan en X-Avisos para que el visor los muestre', async () => {
      const r = await GET(peticion(`?formato=plantilla_tms&documento=${U1}`));
      expect(r.status).toBe(200);
      expect(r.headers.get('x-avisos')).toMatch(/^\d+$/);
    });

    it('no aprobado: 409 con mensaje llano y nada se sella', async () => {
      const r = await GET(peticion(`?formato=plantilla_tms&documento=${U2}`));
      expect(r.status).toBe(409);
      expect(await r.text()).toMatch(/aprobado/);
      expect(estado.eventos).toHaveLength(0);
    });

    it('documento de otra flota: 404; id inválido o ausente: 400', async () => {
      expect((await GET(peticion(`?formato=plantilla_tms&documento=${UB}`))).status).toBe(404);
      expect((await GET(peticion('?formato=plantilla_tms&documento=nope'))).status).toBe(400);
      expect((await GET(peticion('?formato=plantilla_tms'))).status).toBe(400);
      expect(estado.docs.get(UB)!.exportadoEn).toBeNull();
    });

    it('las puertas siguen: rol sin permiso -> 403', async () => {
      tenant = { ok: true, tenantId: A, rol: 'contador' };
      expect((await GET(peticion(`?formato=plantilla_tms&documento=${U1}`))).status).toBe(403);
    });
  });

  it('un formato que no es csv, json ni xlsx → 400', async () => {
    expect((await GET(peticion('?formato=pdf'))).status).toBe(400);
  });

  it('un formato guardado de la flota (otra flota no se ve) y uno inválido (409)', async () => {
    const cfg = { columnas: [{ encabezado: 'Folio', campo: 'folio_cliente' }, { encabezado: 'Sistema', constante: 'LIKIDA' }] };
    estado.exportConfigs.push({ tenantId: A, id: U1.replace('1', '5'), nombre: 'Cliente demo', formato: 'csv', config: cfg, activa: true });
    estado.exportConfigs.push({ tenantId: B, id: U1.replace('1', '6'), nombre: 'De la otra flota', formato: 'csv', config: cfg, activa: true });
    estado.exportConfigs.push({ tenantId: A, id: U1.replace('1', '7'), nombre: 'Roto', formato: 'csv', config: { columnas: [{ encabezado: 'X', campo: 'password' }] }, activa: true });
    const ok = await GET(peticion(`?config=${U1.replace('1', '5')}`));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('Folio,Sistema\r\nATL-20481,LIKIDA');
    expect((await GET(peticion(`?config=${U1.replace('1', '6')}`))).status).toBe(404);
    expect((await GET(peticion(`?config=${U1.replace('1', '7')}`))).status).toBe(409);
  });

  it.each([
    ['?formato=xml'], ['?config=no-es-uuid'], ['?ids=uno,dos'], [`?ids=${Array.from({ length: 501 }, () => U1).join(',')}`],
  ])('parámetros inválidos → 400 (%s)', async (qs) => {
    expect((await GET(peticion(qs.length > 200 ? qs : qs))).status).toBe(400);
  });

  it('si el sello de exportación falla, el archivo sale igual', async () => {
    estado.fallar.set('registrarEvento', new Error('bitácora caída'));
    expect((await GET(peticion())).status).toBe(200);
  });

  it('un error inesperado da 500 con mensaje, sin filtrar detalles', async () => {
    estado.fallar.set('reclamarDocumento', new Error('x')); // no se usa aquí; forzamos fallo real:
    const spy = vi.spyOn(await import('@/lib/likida/carta_porte_docs/repo'), 'listarDocumentos').mockRejectedValueOnce(new Error('secreto interno'));
    const r = await GET(peticion());
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain('secreto interno');
    spy.mockRestore();
  });
});
describe('inyección de fórmulas en el archivo real', () => {
  it('en el xlsx lo que un tercero escribió es TEXTO neutralizado, nunca fórmula', async () => {
    const e = extraccionAtlasOk(); e.mercancias[0].descripcion = { valor: '=cmd|"/c calc"!A1', confianza: 1, evidencia: null, origen: 'humano' };
    estado.docs.get(U1)!.extraccion = e;
    const libro = XLSX.read(new Uint8Array(await (await GET(peticion('?formato=xlsx'))).arrayBuffer()), { type: 'array' });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    const celdas = Object.entries(hoja).filter(([k]) => !k.startsWith('!')) as Array<[string, { t: string; v: unknown; f?: string }]>;
    expect(celdas.some(([, c]) => c.f !== undefined)).toBe(false);
    expect(celdas.find(([, c]) => c.v === `'=cmd|"/c calc"!A1`)?.[1].t).toBe('s');
  });

  it('lo que un tercero escribió en el documento sale neutralizado', async () => {
    const e = extraccionAtlasOk(); e.mercancias[0].descripcion = { valor: '=cmd|"/c calc"!A1', confianza: 1, evidencia: null, origen: 'humano' };
    estado.docs.get(U1)!.extraccion = e;
    const csv = await (await GET(peticion())).text();
    expect(csv).toContain(`"'=cmd|""/c calc""!A1"`);
    expect(csv).not.toMatch(/,=cmd/);
  });
});
