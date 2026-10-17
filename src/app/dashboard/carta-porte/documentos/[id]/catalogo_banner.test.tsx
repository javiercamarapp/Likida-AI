import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// «¿Guardar estos datos en el catálogo de <cliente>?» (T-A3-22): el banner sale solo con datos que tecleó una persona, en
// un documento aprobado y ligado a un cliente; guardar es una acción explícita; y el siguiente documento ya no lo ofrece.
let sesion: { tenantId: string; rol: string; userId: string } = { tenantId: 't-1', rol: 'flota_admin', userId: 'u-1' };
const { revalidatePath, aplicadas, bitacora } = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  aplicadas: [] as Array<{ tenantId: string; tipo: string; registros: Array<Record<string, unknown>>; actorId: string }>,
  bitacora: vi.fn(async () => true),
}));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => sesion }));
vi.mock('next/navigation', () => ({ redirect: (r: string) => { throw new Error(`REDIRECT:${r}`); }, notFound: () => { throw new Error('NOT_FOUND'); }, useRouter: () => ({ refresh: () => {} }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: bitacora }));
vi.mock('@/lib/likida/carta_porte_datos', async (orig) => ({ ...(await orig<typeof import('@/lib/likida/carta_porte_datos')>()), getBorradorViaje: async () => null }));
vi.mock('@/lib/likida/carta_porte_docs/repo', async () => (await import('@/lib/likida/carta_porte_docs/repo_falso.fixture')).api);
vi.mock('@/lib/likida/carta_porte_docs/repo_envios', async () => {
  const { api } = await import('@/lib/likida/carta_porte_docs/repo_falso.fixture');
  return { repoEnvios: { listarPorDocumento: async (t: string, d: string) => (await api.enviosDeDocumento(t, d)).map((e) => ({ proximaRevision: null, ultimoError: null, ...e })) } };
});
// La base real del catálogo no entra: el puerto es un doble que anota lo que se escribiría.
vi.mock('@/lib/likida/carta_porte_docs/catalogo_puerto', () => ({
  puertoSupabase: () => ({
    clientes: async () => [], existentes: async () => [],
    aplicarLote: async (tenantId: string, tipo: string, registros: Array<Record<string, unknown>>, actorId: string) => { aplicadas.push({ tenantId, tipo, registros, actorId }); },
  }),
}));

import { estado, reset } from '@/lib/likida/carta_porte_docs/repo_falso.fixture';
import { fijarGuardiaPerfil } from '@/lib/likida/carta_porte_docs/envio';
import { extraccionAtlasOk, cv } from '@/lib/likida/carta_porte_docs/documentos_sinteticos.fixture';
import { validarExtraccion } from '@/lib/likida/carta_porte_docs/validacion';
import { sembrarFlotas, A } from '@/lib/likida/carta_porte_docs/escenario.fixture';
import { proponerCatalogo } from '@/lib/likida/carta_porte_docs/catalogo_pantalla';
import type { CampoValor, Extraccion } from '@/lib/likida/carta_porte_docs/campos';
import type { DocumentoFila } from '@/lib/likida/carta_porte_docs/repo';
import PaginaRevision from './page';
import { VistaRevision } from './vista';

const ID = '22222222-2222-4222-8222-222222222222';
const CLIENTE = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
const SP = Promise.resolve({});
const fd = (c: Record<string, string | string[]>) => { const f = new FormData(); for (const [k, v] of Object.entries(c)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x); return f; };
const humano = (valor: string): CampoValor => ({ valor, confianza: 1, evidencia: null, origen: 'humano', notas: ['Corregido por una persona.'] });

/** El embarque sintético con SKU en la descripción y clave/unidad/embalaje tecleados por una persona. */
function extraccionHumana(): Extraccion {
  const e = extraccionAtlasOk();
  e.mercancias[0] = { ...e.mercancias[0], descripcion: cv('Botella SKU-BV-100 1L'), bienes_transp: humano('24131500'), clave_unidad: humano('XBX'), embalaje: humano('4G') };
  e.campos.destino_rfc = humano(e.campos.destino_rfc.valor!);
  return e;
}

function sembrarDoc(over: Partial<DocumentoFila> = {}, ext: Extraccion = extraccionHumana()): DocumentoFila {
  const d = {
    id: ID, tenantId: A, canal: 'manual', formato: 'excel', nombreArchivo: 'doc.xlsx', mime: null, bytes: 10, sha256: 'a'.repeat(64), storageRuta: `${A}/semilla`, estado: 'aprobado', version: 4,
    clienteId: CLIENTE, perfilId: null, perfilVersion: null, remitente: null, asunto: null, remitenteReconocido: null, textoExtracto: 'Folio | ATL-20481', riesgoInyeccion: false,
    extraccion: { ...ext, meta: { origen: 'llm', nivel: 1, escalamientos: [], avisos: [], notasModelo: [], indiciosInyeccion: [] } }, validacion: validarExtraccion(ext),
    confianzaMin: 0.95, nivelModelo: 1, modelo: 'm', tokensIn: 0, tokensOut: 0, costoUsd: 0, viajeId: null, procesandoHasta: null, intentos: 1, ultimoError: null,
    abiertoEn: null, revisadoPor: null, aprobadoPor: null, aprobadoEn: '2026-10-02T00:00:00.000Z', rechazoMotivo: null, tiempoRevisionSeg: null, exportadoEn: null, retenerHasta: '2027-01-01T00:00:00.000Z',
    purgadoEn: null, createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z', ...over,
  } as DocumentoFila;
  estado.docs.set(d.id, d);
  return d;
}

type Props = { doc: DocumentoFila; catalogo: { cliente: string; propuesta: ReturnType<typeof proponerCatalogo> } | null; acciones: { revisar: (p: null, f: FormData) => Promise<{ ok: boolean; mensaje?: string; error?: string }> } };
const montar = async () => ((await PaginaRevision({ params: Promise.resolve({ id: ID }), searchParams: SP })) as unknown as { props: Props }).props;

beforeEach(() => {
  vi.clearAllMocks(); reset(); aplicadas.length = 0; fijarGuardiaPerfil(); sembrarFlotas();
  sesion = { tenantId: A, rol: 'flota_admin', userId: 'u-1' };
  estado.clientes.push({ tenantId: A, id: CLIENTE, nombre: 'Cliente Uno' });
});

describe('el banner en la página', () => {
  it('documento aprobado con datos tecleados por una persona: ofrece producto y destinatario con el SKU sugerido', async () => {
    sembrarDoc();
    const { catalogo } = await montar();
    expect(catalogo?.cliente).toBe('Cliente Uno');
    expect(catalogo?.propuesta.productos[0]).toMatchObject({ indice: 0, skuSugerido: 'SKU-BV-100', campos: { bienes_transp: '24131500', clave_unidad: 'XBX', embalaje: '4G' } });
    expect(catalogo?.propuesta.partes.map((p) => p.lado)).toEqual(['destino']);
  });

  it('sin origen humano, sin cliente, o sin aprobar: no hay banner', async () => {
    sembrarDoc({}, extraccionAtlasOk());
    expect((await montar()).catalogo).toBeNull();
    sembrarDoc({ clienteId: null });
    expect((await montar()).catalogo).toBeNull();
    sembrarDoc({ estado: 'por_revisar', aprobadoEn: null });
    expect((await montar()).catalogo).toBeNull();
  });

  it('si el catálogo no se puede leer, la revisión sigue y el banner simplemente no sale', async () => {
    sembrarDoc();
    estado.fallar.set('cargarCatalogoCliente', new Error('base caída'));
    expect((await montar()).catalogo).toBeNull();
  });
});

describe('el banner en la vista', () => {
  it('pinta la pregunta, el SKU editable, las casillas y el botón explícito; sin propuesta no pinta nada', async () => {
    sembrarDoc();
    const p = await montar();
    const html = renderToStaticMarkup(<VistaRevision doc={p.doc} revision={null} original={{ tipo: 'nada', motivo: 'x' }} operadores={[]} eventos={[]} acciones={{ revisar: p.acciones.revisar as never }} catalogo={p.catalogo} />);
    // Sin `revision` la forma no se pinta: se comprueba con una revisión mínima en el caso siguiente.
    expect(html).not.toContain('Guardar en el catálogo');
    const { revisionDe } = await import('@/lib/likida/carta_porte_docs/presentacion');
    const rev = revisionDe(p.doc);
    const con = renderToStaticMarkup(<VistaRevision doc={p.doc} revision={rev} original={{ tipo: 'nada', motivo: 'x' }} operadores={[]} eventos={[]} acciones={{ revisar: p.acciones.revisar as never }} catalogo={p.catalogo} />);
    expect(con).toContain('¿Guardar estos datos en el catálogo de Cliente Uno?');
    expect(con).toContain('name="cat_sku_0"');
    expect(con).toContain('value="SKU-BV-100"');
    expect(con).toContain('name="cat_prod"');
    expect(con).toMatch(/name="cat_parte"[^>]*value="destino"/);
    expect(con).toContain('value="guardar_catalogo"');
    expect(con).toContain('No se guarda nada solo.');
    const sin = renderToStaticMarkup(<VistaRevision doc={p.doc} revision={rev} original={{ tipo: 'nada', motivo: 'x' }} operadores={[]} eventos={[]} acciones={{ revisar: p.acciones.revisar as never }} catalogo={null} />);
    expect(sin).not.toContain('Guardar estos datos en el catálogo');
  });
});

describe('guardar en el catálogo (intención guardar_catalogo)', () => {
  it('con el SKU confirmado escribe producto y destinatario con el cliente del documento, el tenant y el usuario de la SESIÓN', async () => {
    sembrarDoc();
    const p = await montar();
    const r = await p.acciones.revisar(null, fd({ documentoId: ID, version: '4', intencion: 'guardar_catalogo', cat_prod: '0', cat_sku_0: 'SKU-BV-100', cat_parte: 'destino', tenant: 'otra-flota', userId: 'OTRO' }));
    expect(r).toMatchObject({ ok: true });
    expect(aplicadas.map((a) => [a.tenantId, a.tipo, a.actorId])).toEqual([[A, 'producto', 'u-1'], [A, 'parte', 'u-1']]);
    expect(aplicadas[0].registros[0]).toMatchObject({ cliente_id: CLIENTE, sku: 'SKU-BV-100', bienes_transp: '24131500', clave_unidad: 'XBX', embalaje: '4G' });
    expect(aplicadas[1].registros[0]).toMatchObject({ cliente_id: CLIENTE, rol: 'destinatario', alias: 'Comercializadora Monterrey SA de CV' });
    // Bitácora: solo conteos, nunca nombres ni RFC de terceros.
    expect(bitacora).toHaveBeenCalledWith(expect.objectContaining({ accion: 'ccp.catalogo_desde_documento', tenantId: A, detalle: { productos: 1, partes: 1 } }), expect.anything());
    expect(JSON.stringify(bitacora.mock.calls)).not.toContain('Comercializadora');
  });

  it('y lo guardado se usa: el siguiente documento del mismo SKU sale del catálogo y ya no ofrece guardar', async () => {
    sembrarDoc();
    const p = await montar();
    await p.acciones.revisar(null, fd({ documentoId: ID, version: '4', intencion: 'guardar_catalogo', cat_prod: '0', cat_sku_0: 'SKU-BV-100', cat_parte: 'destino' }));
    // «La base» recibe lo escrito.
    const prod = aplicadas[0].registros[0];
    const par = aplicadas[1].registros[0];
    estado.catalogoProductos.push({ tenantId: A, clienteId: CLIENTE, sku: String(prod.sku), descripcionPatron: null, bienesTransp: String(prod.bienes_transp), claveUnidad: String(prod.clave_unidad), embalaje: prod.embalaje as string, fraccion: null, tipoMateria: null, materialPeligroso: false, claveMaterialPeligroso: null });
    estado.catalogoPartes.push({ tenantId: A, clienteId: CLIENTE, rol: 'destinatario', alias: String(par.alias), razonSocial: null, rfc: String(par.rfc), idFiscalExtranjero: null, calle: null, numExt: null, numInt: null, coloniaClave: null, colonia: null, cp: par.cp as string, localidadClave: null, localidad: null, municipioClave: null, municipio: null, estado: null, pais: null, contacto: null, telefono: null, correo: null });
    // Mismo documento otra vez: ya está todo en el catálogo, no se vuelve a ofrecer.
    expect((await montar()).catalogo).toBeNull();
    // Otro embarque del mismo SKU, sin clave ni unidad: el catálogo se las pone.
    const { enriquecer } = await import('@/lib/likida/carta_porte_docs/catalogo_cliente');
    const sig: Extraccion = { campos: {}, mercancias: [{ descripcion: cv('Botella SKU-BV-100 1L'), cantidad: cv('10'), peso_kg: cv('100') }] };
    const e = enriquecer(sig, await (await import('@/lib/likida/carta_porte_docs/repo')).cargarCatalogoCliente(A, CLIENTE), { tenantId: A, clienteId: CLIENTE });
    expect(e.extraccion.mercancias[0].bienes_transp).toMatchObject({ valor: '24131500', origen: 'catalogo' });
  });

  it('nada elegido, un SKU que no está en la descripción, un documento sin aprobar o una versión vieja: no escribe', async () => {
    sembrarDoc();
    const p = await montar();
    const base = { documentoId: ID, version: '4', intencion: 'guardar_catalogo' };
    expect(await p.acciones.revisar(null, fd(base))).toMatchObject({ ok: false, error: 'No elegiste nada para guardar.' });
    expect(await p.acciones.revisar(null, fd({ ...base, cat_prod: '0', cat_sku_0: 'OTRO-999' }))).toMatchObject({ ok: false, error: expect.stringMatching(/no aparece en su descripción/) });
    expect(await p.acciones.revisar(null, fd({ ...base, version: '1', cat_prod: '0', cat_sku_0: 'SKU-BV-100' }))).toMatchObject({ ok: false, error: expect.stringMatching(/Otra persona cambió/) });
    sembrarDoc({ estado: 'por_revisar', aprobadoEn: null });
    expect(await p.acciones.revisar(null, fd({ ...base, cat_prod: '0', cat_sku_0: 'SKU-BV-100' }))).toMatchObject({ ok: false, error: expect.stringMatching(/aprobado y ligado a un cliente/) });
    sembrarDoc({ clienteId: null });
    expect(await p.acciones.revisar(null, fd({ ...base, cat_prod: '0', cat_sku_0: 'SKU-BV-100' }))).toMatchObject({ ok: false });
    expect(aplicadas).toEqual([]);
  });

  it('un valor del formulario no puede inventar datos: solo cuentan los índices y lados que la base propone', async () => {
    sembrarDoc();
    const p = await montar();
    const r = await p.acciones.revisar(null, fd({ documentoId: ID, version: '4', intencion: 'guardar_catalogo', cat_prod: ['7', '-1', 'x'], cat_sku_7: 'SKU-BV-100', cat_parte: ['origen', 'cualquiera'] }));
    expect(r).toMatchObject({ ok: false });
    expect(aplicadas).toEqual([]);
  });
});
