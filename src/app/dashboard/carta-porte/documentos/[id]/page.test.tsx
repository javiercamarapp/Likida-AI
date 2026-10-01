import { beforeEach, expect, it, vi } from 'vitest';

// La revisión: UNA acción atiende todos los botones por `intencion`; re-resuelve sesión y área; usa el tenant de la SESIÓN;
// no deja aprobar con lo que la validación no deja; y un documento de otra flota es 404, no la ficha ajena.
let sesion: { tenantId: string; rol: string; userId: string } = { tenantId: 't-1', rol: 'flota_admin', userId: 'u-1' };
const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => sesion }));
vi.mock('next/navigation', () => ({ redirect: (r: string) => { throw new Error(`REDIRECT:${r}`); }, notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => true) }));
vi.mock('@/lib/likida/carta_porte_datos', async (orig) => ({ ...(await orig<typeof import('@/lib/likida/carta_porte_datos')>()), getBorradorViaje: async () => null }));
vi.mock('@/lib/likida/carta_porte_docs/repo', async () => (await import('@/lib/likida/carta_porte_docs/repo_falso.fixture')).api);

import { estado, reset } from '@/lib/likida/carta_porte_docs/repo_falso.fixture';
import { extraccionAtlasOk, cv } from '@/lib/likida/carta_porte_docs/documentos_sinteticos.fixture';
import { validarExtraccion } from '@/lib/likida/carta_porte_docs/validacion';
import { sembrarFlotas } from '@/lib/likida/carta_porte_docs/escenario.fixture';
import { A } from '@/lib/likida/carta_porte_docs/escenario.fixture';
import type { DocumentoFila } from '@/lib/likida/carta_porte_docs/repo';
import PaginaRevision from './page';

const ID = '22222222-2222-4222-8222-222222222222';
type Accion = (previo: null, fd: FormData) => Promise<{ ok: boolean; mensaje?: string; error?: string; detalles?: string[] }>;
const SP = Promise.resolve({});
const fd = (c: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(c)) f.set(k, v); return f; };

function sembrarDoc(over: Partial<DocumentoFila> = {}, ext = extraccionAtlasOk()): DocumentoFila {
  const d = {
    id: ID, tenantId: A, canal: 'manual', formato: 'excel', nombreArchivo: 'atlas.xlsx', mime: null, bytes: 10, sha256: 'a'.repeat(64), storageRuta: `${A}/semilla`, estado: 'por_revisar', version: 3,
    clienteId: null, perfilId: null, perfilVersion: null, remitente: null, asunto: null, remitenteReconocido: null, textoExtracto: 'Folio | ATL-20481', riesgoInyeccion: false,
    extraccion: { ...ext, meta: { origen: 'llm', nivel: 1, escalamientos: [], avisos: [], notasModelo: [], indiciosInyeccion: [] } }, validacion: validarExtraccion(ext),
    confianzaMin: 0.95, nivelModelo: 1, modelo: 'google/gemini-3.5-flash-lite', tokensIn: 0, tokensOut: 0, costoUsd: 0.002, viajeId: null, procesandoHasta: null, intentos: 1, ultimoError: null,
    abiertoEn: null, revisadoPor: null, aprobadoPor: null, aprobadoEn: null, rechazoMotivo: null, tiempoRevisionSeg: null, exportadoEn: null, retenerHasta: '2027-01-01T00:00:00.000Z',
    purgadoEn: null, createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z', ...over,
  } as DocumentoFila;
  estado.docs.set(d.id, d);
  return d;
}
const ver = (): string => String(estado.docs.get(ID)!.version);
const montar = async () => (await PaginaRevision({ params: Promise.resolve({ id: ID }), searchParams: SP })) as unknown as { props: { doc: DocumentoFila; acciones: { revisar: Accion }; revision: { bloqueos: number } | null; original: { tipo: string }; operadores: unknown[] } };

beforeEach(() => { vi.clearAllMocks(); reset(); sembrarFlotas(); sesion = { tenantId: A, rol: 'flota_admin', userId: 'u-1' }; });

it('un rol sin el área rebota; un id que no es uuid o de otra flota es 404', async () => {
  sembrarDoc();
  sesion = { ...sesion, rol: 'vendedor' };
  await expect(montar()).rejects.toThrow('REDIRECT:/dashboard');
  sesion = { ...sesion, rol: 'flota_admin', tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
  await expect(montar()).rejects.toThrow('NOT_FOUND');
  sesion = { ...sesion, tenantId: A };
  await expect(PaginaRevision({ params: Promise.resolve({ id: 'no-es-uuid' }), searchParams: SP })).rejects.toThrow('NOT_FOUND');
});

it('abrir la pantalla marca la primera apertura (inicio del tiempo medido) una sola vez', async () => {
  sembrarDoc();
  const p = await montar();
  expect(p.props.doc.abiertoEn).not.toBeNull();
  const antes = estado.docs.get(ID)!.abiertoEn;
  await montar();
  expect(estado.docs.get(ID)!.abiertoEn).toBe(antes);
});

it('un documento aprobado NO se marca como abierto (no es una revisión)', async () => {
  sembrarDoc({ estado: 'aprobado', aprobadoEn: '2026-10-02T00:00:00.000Z' });
  expect((await montar()).props.doc.abiertoEn).toBeNull();
});

it('el original: texto extraído para Excel/CSV/PDF con texto', async () => {
  sembrarDoc();
  expect((await montar()).props.original).toEqual({ tipo: 'texto', texto: 'Folio | ATL-20481' });
});

it('el original: foto → URL firmada de corta vida; archivo ya purgado → se dice', async () => {
  estado.archivos.set(`${A}/x`, new Uint8Array([1]));
  sembrarDoc({ formato: 'imagen', storageRuta: `${A}/x`, textoExtracto: null });
  expect((await montar()).props.original).toEqual({ tipo: 'imagen', url: `https://firmada.test/${A}/x` });
  sembrarDoc({ formato: 'imagen', storageRuta: null, purgadoEn: '2026-12-01T00:00:00.000Z', textoExtracto: null });
  expect((await montar()).props.original).toMatchObject({ tipo: 'nada', motivo: expect.stringMatching(/retención/) });
});

it('guardar: aplica SOLO lo que cambió, sube la versión, deja la corrección y usa el usuario de la SESIÓN', async () => {
  sembrarDoc();
  const p = await montar();
  const v = estado.docs.get(ID)!.version;
  const r = await p.props.acciones.revisar(null, fd({ documentoId: ID, version: String(v), intencion: 'guardar', 'c:origen_cp': '44200', 'c:origen_rfc': estado.docs.get(ID)!.extraccion!.campos.origen_rfc.valor!, userId: 'OTRO' }));
  expect(r).toMatchObject({ ok: true });
  expect(estado.docs.get(ID)!.extraccion!.campos.origen_cp).toMatchObject({ valor: '44200', origen: 'humano' });
  expect(estado.docs.get(ID)!.extraccion!.campos.origen_rfc.origen).not.toBe('humano');
  expect(estado.correcciones).toEqual([expect.objectContaining({ campo: 'origen_cp', valorAntes: '44100', valorDespues: '44200', tenantId: A })]);
  expect(estado.docs.get(ID)!.revisadoPor).toBe('u-1');
  expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/carta-porte/documentos/${ID}`);
});

it('con una versión vieja: conflicto, sin cambios', async () => {
  sembrarDoc();
  const p = await montar();
  const r = await p.props.acciones.revisar(null, fd({ documentoId: ID, version: '1', intencion: 'guardar', 'c:origen_cp': '44200' }));
  expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Otra persona cambió/) });
  expect(estado.docs.get(ID)!.extraccion!.campos.origen_cp.valor).toBe('44100');
});

it('una forma de OTRO documento o sin versión se rechaza', async () => {
  sembrarDoc();
  const p = await montar();
  expect(await p.props.acciones.revisar(null, fd({ documentoId: '33333333-3333-4333-8333-333333333333', version: ver(), intencion: 'guardar' }))).toMatchObject({ ok: false, error: expect.stringMatching(/no corresponde/) });
  expect(await p.props.acciones.revisar(null, fd({ documentoId: ID, intencion: 'guardar' }))).toMatchObject({ ok: false, error: expect.stringMatching(/versión/) });
  expect(await p.props.acciones.revisar(null, fd({ documentoId: ID, version: ver(), intencion: 'inventada' }))).toEqual({ ok: false, error: 'No reconozco esa acción.' });
});

it('aprobar con un bloqueo vivo: NO se aprueba y el mensaje dice por qué', async () => {
  const e = extraccionAtlasOk(); delete e.campos.destino_rfc;
  sembrarDoc({}, e);
  const p = await montar();
  const r = await p.props.acciones.revisar(null, fd({ documentoId: ID, version: ver(), intencion: 'aprobar' }));
  expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/No se puede aprobar todavía.*RFC del destinatario/) });
  expect(estado.docs.get(ID)!.estado).toBe('por_revisar');
});

it('aprobar con la forma que ARREGLA el bloqueo: guarda, aprueba y crea el viaje; el resumen dice qué pasó', async () => {
  const e = extraccionAtlasOk(); delete e.campos.destino_rfc;
  const doc = sembrarDoc({}, e);
  const rfc = extraccionAtlasOk().campos.destino_rfc.valor!;
  const p = await montar();
  const r = await p.props.acciones.revisar(null, fd({ documentoId: ID, version: String(estado.docs.get(ID)!.version), intencion: 'aprobar', 'c:destino_rfc': rfc }));
  expect(r).toMatchObject({ ok: true, mensaje: 'Documento aprobado.' });
  expect(estado.docs.get(ID)!.estado).toBe('aprobado');
  expect(r.detalles?.join(' ')).toMatch(/Viaje ATL-20481 creado con 1 mercancía/);
  expect(estado.viajes.filter((v) => v.tenantId === A && v.folio === 'ATL-20481')).toHaveLength(1);
  expect(estado.viajes[0].operadorId).toBe('op-juan'); // «Juan Pérez López», nombre exacto
  void doc;
});

it('rechazar pide motivo; reabrir devuelve a revisión; crear viaje exige aprobado', async () => {
  sembrarDoc();
  const p = await montar();
  expect(await p.props.acciones.revisar(null, fd({ documentoId: ID, version: ver(), intencion: 'rechazar', motivo: ' ' }))).toMatchObject({ ok: false });
  expect(await p.props.acciones.revisar(null, fd({ documentoId: ID, version: ver(), intencion: 'viaje' }))).toMatchObject({ ok: false, error: expect.stringMatching(/aprobado/) });
  expect(await p.props.acciones.revisar(null, fd({ documentoId: ID, version: ver(), intencion: 'rechazar', motivo: 'Duplicado' }))).toMatchObject({ ok: true });
  expect(estado.docs.get(ID)!.estado).toBe('rechazado');
  const v = estado.docs.get(ID)!.version;
  expect(await p.props.acciones.revisar(null, fd({ documentoId: ID, version: String(v), intencion: 'reabrir' }))).toMatchObject({ ok: true });
  expect(estado.docs.get(ID)!.estado).toBe('por_revisar');
});

it('quitar un renglón guarda lo escrito y luego lo quita', async () => {
  const e = extraccionAtlasOk(); e.mercancias.push({ ...e.mercancias[0], descripcion: cv('Tapas') });
  sembrarDoc({}, e);
  const p = await montar();
  const r = await p.props.acciones.revisar(null, fd({ documentoId: ID, version: ver(), intencion: 'quitar:1' }));
  expect(r).toMatchObject({ ok: true });
  expect(estado.docs.get(ID)!.extraccion!.mercancias).toHaveLength(1);
  expect(estado.correcciones.some((c) => c.campo === 'mercancia')).toBe(true);
});

it('un rol sin área rechaza TODAS las intenciones aunque se invoque la acción directo', async () => {
  sembrarDoc();
  const p = await montar();
  sesion = { ...sesion, rol: 'vendedor' };
  for (const intencion of ['guardar', 'aprobar', 'rechazar', 'reabrir', 'viaje', 'quitar:0']) {
    expect(await p.props.acciones.revisar(null, fd({ documentoId: ID, version: ver(), intencion, motivo: 'x' }))).toEqual({ ok: false, error: 'Tu rol no puede revisar documentos de Carta Porte.' });
  }
  expect(estado.docs.get(ID)!.estado).toBe('por_revisar');
  expect(estado.eventos.some((e) => e.tipo === 'aprobado' || e.tipo === 'rechazado')).toBe(false);
});

it('la acción usa el tenant de la SESIÓN: con otra flota el documento «no está en tu flota»', async () => {
  sembrarDoc();
  const p = await montar();
  sesion = { ...sesion, tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
  const r = await p.props.acciones.revisar(null, fd({ documentoId: ID, version: ver(), intencion: 'guardar', 'c:origen_cp': '99999' }));
  expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/no está en tu flota/) });
  expect(estado.docs.get(ID)!.extraccion!.campos.origen_cp.valor).toBe('44100');
});

it('eliminar: solo quien ADMINISTRA la flota; el encargado (que sí revisa) no', async () => {
  sembrarDoc({ estado: 'rechazado', rechazoMotivo: 'x' });
  const p = await montar();
  sesion = { ...sesion, rol: 'encargado' };
  expect(await p.props.acciones.revisar(null, fd({ documentoId: ID, version: ver(), intencion: 'eliminar' }))).toEqual({ ok: false, error: 'Solo quien administra la flota puede eliminar un documento.' });
  expect(estado.docs.has(ID)).toBe(true);
  sesion = { ...sesion, rol: 'flota_admin' };
  expect(await p.props.acciones.revisar(null, fd({ documentoId: ID, version: ver(), intencion: 'eliminar' }))).toMatchObject({ ok: true });
  expect(estado.docs.has(ID)).toBe(false);
});
