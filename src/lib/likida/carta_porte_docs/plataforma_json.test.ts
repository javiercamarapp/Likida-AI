// T-A3-58 · JSON v3.0 de plataforma (formato G) y adjuntos sin extensión. Todo sintético: la forma del JSON real, sin un valor real.
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./repo', async () => (await import('./repo_falso.fixture')).api);
vi.mock('../bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => true) }));
import { estado, reset } from './repo_falso.fixture';
import { A, sembrarFlotas } from './escenario.fixture';
import { atenderCorreoCartaPorte, sinExtension, type DepsCorreo } from './correo_entrante';
import { aceptableSinExtension, detectarFormato, prepararContenido } from './contenido';
import { esJsonPlataformaV3, leerJsonPlataformaV3 } from './perfiles';
import { resolverPorIdentificadorPlataforma, type NumeroClienteCat } from './catalogo_cliente';
import { completarDerivados, NOTA_NETO_COMO_BRUTO } from './derivar';
import { llmFalso, lecturaBoreal } from './llm_falso.fixture';
import { correoTexto, defectuosos, excelAtlas, pdfBoreal, xmlCartaPorte } from './documentos_sinteticos.fixture';
import * as repo from './repo';

const ID_PLATAFORMA = '70123456'; // inventado
const enc = (o: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(o, null, 2));

/** La forma del JSON v3.0: bruto en 0 y solo neto, destino/régimen/pedimento vacíos, identificador de empresa numérico. */
export function jsonPlataformaV3(over: Record<string, unknown> = {}): Record<string, unknown> {
  const renglon = (desc: string, neto: number, piezas: number): Record<string, unknown> => ({
    CodigoEAN: '', S_TipoMateria: '03', S_BienesTransp: '24112100', S_ClaveSTCC: '', S_Descripcion: desc, S_ClaveUnidad: 'H87', S_Unidad: '',
    S_MaterialPeligroso: 'No', S_CveMaterialPeligroso: '', S_Embalaje: 'Z01', S_DescripEmbalaje: 'Tarima', S_PesoEnKg: neto, S_ValorMercancia: '', S_Moneda: '',
    S_FraccionArancelaria: '7308900100', S_NumPiezas: piezas, S_UnidadPeso: 'KGM', S_PesoTara: 0, S_PesoNeto: neto, S_PesoBruto: 0, DimensionAncho: 0, // grep-limpio:ok
  });
  return {
    id: 'sintetico-0001', EmpresaRfc: ID_PLATAFORMA, ProveedorRfc: 'x', Version: '3.0',
    DatosAdicionales: [
      { Nombre: 'NoEmbarque', Valor: '740001' }, { Nombre: 'Guía', Valor: 'GU-0001' }, { Nombre: 'Truck/Placa', Valor: 'PL4567' },
      { Nombre: 'TotalPiezas', Valor: '64' }, { Nombre: 'TotalPeso', Valor: '12690' },
    ],
    S_RFCRemitente: 'AAA010101AAA', S_NombreRemitente: 'Fabricante Ejemplo SA de CV', S_ResidenciaFiscal: 'MEX', S_PaisOrigen: 'MEX', S_PaisDestino: '', S_RegimenAduanero: '', // grep-limpio:ok
    Ruta: { Mercancias: { S_PesoBrutoTotal: 0, S_PesoNetoTotal: 0, Mercancia: [renglon('Estructura metálica tipo A', 9210.5, 52), renglon('Estructura metálica tipo B', 3480, 12)] } },
    DocumentacionAduanera: { S_TipoDocumento: '01', S_NumPedimento: '', S_IdentDocAduanero: '', S_RFCImpo: '' },
    ...over,
  };
}

describe('lector del formato G (JSON v3.0 de plataforma)', () => {
  it('se reconoce por su estructura y no confunde otro JSON', () => {
    expect(esJsonPlataformaV3(jsonPlataformaV3())).toBe(true);
    expect(esJsonPlataformaV3(jsonPlataformaV3({ Version: '2.1' }))).toBe(false);
    expect(esJsonPlataformaV3({ Version: '3.0', Mercancias: [] })).toBe(false);
    expect(esJsonPlataformaV3(jsonPlataformaV3({ DocumentacionAduanera: null }))).toBe(false);
    expect(esJsonPlataformaV3(null)).toBe(false);
    expect(esJsonPlataformaV3([jsonPlataformaV3()])).toBe(false);
  });

  it('peso bruto 0 y solo neto: el neto va como peso, marcado «neto», y el derivado deja la nota de T-A3-52', () => {
    const r = leerJsonPlataformaV3(jsonPlataformaV3());
    expect(r.extraccion.mercancias).toHaveLength(2);
    expect(r.extraccion.mercancias[0].peso_kg.valor).toBe('9210.5');
    expect(r.extraccion.mercancias[0].peso_kg.evidencia).toContain('S_PesoNeto');
    expect(r.extraccion.mercancias[0].peso_tipo.valor).toBe('neto');
    expect(r.avisos.join(' ')).toMatch(/peso bruto en cero/);
    const d = completarDerivados(r.extraccion);
    expect(d.mercancias.every((f) => (f.peso_kg.notas ?? []).includes(NOTA_NETO_COMO_BRUTO))).toBe(true);
    expect(d.campos.peso_bruto_total.valor).toBe('12690.5');
  });

  it('con un bruto real, el bruto manda y no hay nota de neto', () => {
    const j = jsonPlataformaV3();
    const merc = (j.Ruta as { Mercancias: { Mercancia: Array<Record<string, unknown>> } }).Mercancias.Mercancia;
    merc[0].S_PesoBruto = 9500;
    const r = leerJsonPlataformaV3(j);
    expect(r.extraccion.mercancias[0].peso_kg.valor).toBe('9500');
    expect(r.extraccion.mercancias[0].peso_tipo).toBeUndefined();
    expect(r.extraccion.mercancias[1].peso_tipo.valor).toBe('neto');
  });

  it('destino, régimen y pedimento vacíos quedan VACÍOS (no se inventan); lo que sí trae se lee', () => {
    const r = leerJsonPlataformaV3(jsonPlataformaV3());
    expect(r.extraccion.campos.destino_pais).toBeUndefined();
    for (const f of r.extraccion.mercancias) { expect(f.regimen_aduanero).toBeUndefined(); expect(f.pedimento).toBeUndefined(); }
    expect(r.extraccion.campos.folio_cliente.valor).toBe('740001');
    expect(r.extraccion.campos.origen_rfc.valor).toBe('AAA010101AAA'); // grep-limpio:ok
    expect(r.extraccion.campos.origen_nombre.valor).toBe('Fabricante Ejemplo SA de CV');
    expect(r.extraccion.mercancias[0]).toMatchObject({ bienes_transp: { valor: '24112100' }, clave_unidad: { valor: 'H87' }, cantidad: { valor: '52' }, fraccion_arancelaria: { valor: '7308900100' } }); // grep-limpio:ok
    expect(r.avisos.join(' ')).toMatch(/no trae el destino ni el régimen/);
    expect(r.avisos.join(' ')).toContain('Tipo de documento aduanero del JSON: 01');
  });

  it('el identificador de la empresa NO se vuelve RFC de nadie: sale aparte', () => {
    const r = leerJsonPlataformaV3(jsonPlataformaV3());
    expect(r.identificadorPlataforma).toBe(ID_PLATAFORMA);
    const todos = [r.extraccion.campos, ...r.extraccion.mercancias].flatMap((o) => Object.values(o).map((c) => c.valor));
    expect(todos).not.toContain(ID_PLATAFORMA);
    expect(leerJsonPlataformaV3(jsonPlataformaV3({ EmpresaRfc: '' })).identificadorPlataforma).toBeNull();
  });

  it('un JSON con claves prohibidas o valores raros no revienta ni toca el prototipo', async () => {
    const crudo = JSON.stringify(jsonPlataformaV3()).replace('"id":', '"__proto__":{"x":1},"id":');
    const c = await prepararContenido(new TextEncoder().encode(crudo), 'json');
    const r = leerJsonPlataformaV3(c.xml);
    expect(r.extraccion.mercancias).toHaveLength(2);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe('número interno a partir del identificador de la plataforma', () => {
  const fila = (clienteId: string, id: string | null, over: Partial<NumeroClienteCat> = {}): NumeroClienteCat => ({
    tenantId: A, clienteId, numeroInterno: `N-${clienteId}`, numeroPagador: null, activo: true, identificadorPlataforma: id, ...over,
  });
  it('una coincidencia activa del mismo tenant da el número interno', () => {
    expect(resolverPorIdentificadorPlataforma([fila('c1', ID_PLATAFORMA), fila('c2', '999')], A, ` ${ID_PLATAFORMA} `)).toEqual({ tipo: 'unico', clienteId: 'c1', numeroInterno: 'N-c1' });
  });
  it('sin coincidencia, vacío, inactivo o de otro tenant = ninguno; dos clientes con el mismo identificador = ambiguo', () => {
    expect(resolverPorIdentificadorPlataforma([fila('c1', '1')], A, ID_PLATAFORMA)).toEqual({ tipo: 'ninguno' });
    expect(resolverPorIdentificadorPlataforma([fila('c1', ID_PLATAFORMA)], A, '')).toEqual({ tipo: 'ninguno' });
    expect(resolverPorIdentificadorPlataforma([fila('c1', ID_PLATAFORMA, { activo: false })], A, ID_PLATAFORMA)).toEqual({ tipo: 'ninguno' });
    expect(resolverPorIdentificadorPlataforma([fila('c1', ID_PLATAFORMA, { tenantId: 'otro' })], A, ID_PLATAFORMA)).toEqual({ tipo: 'ninguno' });
    expect(resolverPorIdentificadorPlataforma([fila('c1', null)], A, ID_PLATAFORMA)).toEqual({ tipo: 'ninguno' });
    expect(resolverPorIdentificadorPlataforma([fila('c1', ID_PLATAFORMA), fila('c2', ID_PLATAFORMA)], A, ID_PLATAFORMA)).toEqual({ tipo: 'ambiguo', coincidencias: 2 });
  });
});

describe('adjuntos sin extensión: se decide por los bytes', () => {
  it('sinExtension: sin nombre, con (3) o con «v3.0» sí; con extensión real no', () => {
    for (const n of [undefined, null, '', 'CCP PORTAL EJEMPLO', 'CCP EJEMPLO (3)', 'portal v3.0']) expect(sinExtension(n)).toBe(true);
    for (const n of ['a.pdf', 'firma.png.exe', 'datos.zip', 'x.docx']) expect(sinExtension(n)).toBe(false);
  });
  it('aceptableSinExtension: JSON, PDF y Excel sí; foto solo si el correo dice image/*; el resto no', async () => {
    expect(aceptableSinExtension(enc(jsonPlataformaV3()))).toBe(true);
    expect(aceptableSinExtension(await pdfBoreal())).toBe(true);
    expect(aceptableSinExtension(excelAtlas())).toBe(true);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(detectarFormato(png)).toMatchObject({ ok: true, clase: 'imagen' });
    expect(aceptableSinExtension(png)).toBe(false);
    expect(aceptableSinExtension(png, 'image/png')).toBe(true);
    expect(aceptableSinExtension(Buffer.from(xmlCartaPorte()))).toBe(false);
    expect(aceptableSinExtension(Buffer.from('a,b,c\n1,2,3\n4,5,6\n'))).toBe(false);
    expect(aceptableSinExtension(Buffer.from('Hola, este es un texto cualquiera sin formato.'))).toBe(false);
    expect(aceptableSinExtension(defectuosos.ejecutable)).toBe(false);
    expect(aceptableSinExtension(new Uint8Array())).toBe(false);
  });
});

const DOM = 'mail.likida.test';
const TOKEN_A = 'abcdefghjkmnpqrstvwxyz23';
function deps(adjuntos: Record<string, Uint8Array>): DepsCorreo & { descargas: string[] } {
  const descargas: string[] = [];
  const llm = llmFalso((e) => lecturaBoreal(e.nivel));
  return {
    apagado: async () => false, llm: () => llm, restanteMs: () => 60_000,
    descargar: async (_email, id) => { descargas.push(id); const v = adjuntos[id]; return v ? { ok: true, bytes: v } : { ok: false, transitorio: false }; },
    descargas,
  };
}

describe('correo con el JSON de la plataforma como adjunto sin extensión', () => {
  const base = { emailId: 'em-g', from: 'Portal <portal@cliente.example>', subject: 'CCP' };
  beforeEach(async () => { reset(); sembrarFlotas(); process.env.RESEND_API_KEY = 're_test'; await repo.crearBuzon(A, TOKEN_A); void DOM; });

  it('cuerpo corto + adjunto sin extensión que es JSON ⇒ CREA el documento (antes: sin_contenido)', async () => {
    const d = deps({ j1: enc(jsonPlataformaV3()) });
    const r = await atenderCorreoCartaPorte(TOKEN_A, { ...base, text: 'Adjunto.', attachments: [{ id: 'j1', filename: 'CCP PORTAL EJEMPLO', content_type: 'application/octet-stream' }] }, d);
    expect(r).toMatchObject({ status: 200, cuerpo: { ok: true, recibidos: 1, ignorados: 0 } });
    expect(r.cuerpo.ignorado).toBeUndefined();
    const docs = [...estado.docs.values()];
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ tenantId: A, canal: 'correo', formato: 'json', nombreArchivo: 'CCP PORTAL EJEMPLO' });
  });

  it('adjunto sin nombre (imagen pegada) con content-type image/*: entra; el mismo sin content-type no', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
    const ok = await atenderCorreoCartaPorte(TOKEN_A, { ...base, emailId: 'em-i1', attachments: [{ id: 'i', content_type: 'image/png' }] }, deps({ i: png }));
    expect(ok.cuerpo).toMatchObject({ recibidos: 1 });
    const no = await atenderCorreoCartaPorte(TOKEN_A, { ...base, emailId: 'em-i2', attachments: [{ id: 'i', content_type: 'application/octet-stream' }] }, deps({ i: png }));
    expect(no.cuerpo).toMatchObject({ recibidos: 0, ignorados: 1 });
  });

  it('un adjunto sin extensión NO reconocible (texto, ejecutable, XML) sigue descartado y no crea documento', async () => {
    const d = deps({ t: Buffer.from('texto cualquiera de más de diez caracteres'), e: defectuosos.ejecutable, x: Buffer.from(xmlCartaPorte()) });
    const r = await atenderCorreoCartaPorte(TOKEN_A, { ...base, text: 'Hola.', attachments: [{ id: 't', filename: 'notas' }, { id: 'e', filename: 'instalador' }, { id: 'x', filename: 'ccp' }] }, d);
    expect(r).toMatchObject({ status: 200, cuerpo: { recibidos: 0, ignorados: 3 } });
    expect(estado.docs.size).toBe(0);
  });

  it('un adjunto con extensión que no es de documento (.exe, .zip) ni se descarga', async () => {
    const d = deps({ a: enc(jsonPlataformaV3()), b: enc(jsonPlataformaV3()) });
    await atenderCorreoCartaPorte(TOKEN_A, { ...base, text: 'Hola.', attachments: [{ id: 'a', filename: 'datos.zip' }, { id: 'b', filename: 'ccp.exe' }] }, d);
    expect(d.descargas).toEqual([]);
    expect(estado.docs.size).toBe(0);
  });

  it('el límite de tamaño sigue intacto para los adjuntos sin extensión', async () => {
    const grande = new Uint8Array(8 * 1024 * 1024 + 1).fill(123);
    const r = await atenderCorreoCartaPorte(TOKEN_A, { ...base, text: 'Hola.', attachments: [{ id: 'g', filename: 'enorme' }] }, deps({ g: grande }));
    expect(r.cuerpo).toMatchObject({ recibidos: 0, ignorados: 1 });
  });

  it('un cuerpo largo sigue sumando su propio documento junto al adjunto sin extensión', async () => {
    const r = await atenderCorreoCartaPorte(TOKEN_A, { ...base, emailId: 'em-c', text: correoTexto(), attachments: [{ id: 'j', filename: 'CCP' }] }, deps({ j: enc(jsonPlataformaV3()) }));
    expect(r.cuerpo).toMatchObject({ recibidos: 2 });
  });
});
