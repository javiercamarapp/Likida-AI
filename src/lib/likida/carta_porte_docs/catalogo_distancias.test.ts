import { describe, expect, it } from 'vitest';
import { CAMPOS_DOC_LLM, campoDoc, type CampoValor, type Extraccion } from './campos';
import {
  COLUMNAS_DISTANCIA, claveDeRuta, completarDistancias, importarDistancias, leerKm, plantillaDistanciasCsv, resolverDistancia,
  type PuertoDistancias, type RegistroDistancia, type RutaDistancia,
} from './catalogo_distancias';
import { leerCsv } from './catalogo_import';
import { SalidaLlmSchema, construirSistema } from './extractor';

// Todo es sintético: clientes inventados, CP y municipios de juguete.

const T1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const T2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const C1 = 'cccccccc-0000-4000-8000-000000000001';
const C2 = 'cccccccc-0000-4000-8000-000000000002';
const CAJENO = 'cccccccc-0000-4000-8000-0000000000ff';
const ctx = { tenantId: T1, clienteId: C1 };

const ruta = (o: Partial<RutaDistancia> & Pick<RutaDistancia, 'origen' | 'destino' | 'km'>): RutaDistancia => ({ tenantId: T1, clienteId: C1, tipo: 'cp', ...o });
const RUTAS: RutaDistancia[] = [
  ruta({ origen: '64000', destino: '78000', km: 812.35 }),
  ruta({ tipo: 'municipio', origen: 'monterrey', destino: 'nuevo laredo', km: 230 }),
  ruta({ origen: '64000', destino: '78100', km: 900 }),
  ruta({ clienteId: C2, origen: '64000', destino: '78000', km: 111 }), // otro cliente de la misma flota
  ruta({ tenantId: T2, clienteId: CAJENO, origen: '64000', destino: '78000', km: 222 }), // otra flota
];

const c = (valor: string | null, origen: CampoValor['origen'] = 'llm', confianza = 0.9): CampoValor => ({ valor, confianza, evidencia: null, origen });
const extraccion = (campos: Record<string, CampoValor>): Extraccion => ({ campos, mercancias: [] });

describe('leerKm: el formato de la distancia', () => {
  it.each([
    ['812,35 km', '812.35'], ['812.35', '812.35'], ['1,250.50 km', '1250.5'], ['920', '920'], ['920km', '920'], ['  230,0 KM ', '230'],
    ['1.250,5 kms', '1250.5'], [812.35, '812.35'],
  ])('«%s» → %s', (crudo, esperado) => {
    const l = leerKm(crudo);
    expect(l.ok && l.texto).toBe(esperado);
  });
  it.each([
    ['', 'vacia'], ['   ', 'vacia'], ['km', 'vacia'], ['mucho', 'ilegible'], ['1.500', 'ambigua'], ['1,500 km', 'ambigua'],
    ['0', 'fuera_de_rango'], ['-5', 'fuera_de_rango'], ['100000', 'fuera_de_rango'],
  ])('«%s» se rechaza (%s), no se adivina', (crudo, motivo) => {
    expect(leerKm(crudo)).toEqual({ ok: false, motivo });
  });
});

describe('resolverDistancia: par conocido → valor, desconocido → ninguna', () => {
  it('par de CP conocido', () => {
    expect(resolverDistancia(RUTAS, ctx, { cp: '64000' }, { cp: '78000' })).toEqual({ tipo: 'unica', km: 812.35, por: 'cp' });
  });
  it('par de municipios, sin importar acentos ni mayúsculas', () => {
    expect(resolverDistancia(RUTAS, ctx, { municipio: 'MONTERREY' }, { municipio: 'Nuevo  Laredó' })).toEqual({ tipo: 'unica', km: 230, por: 'municipio' });
  });
  it('el CP gana sobre el municipio y, si el CP no está, se cae al municipio', () => {
    expect(resolverDistancia(RUTAS, ctx, { cp: '64000', municipio: 'Monterrey' }, { cp: '78000', municipio: 'Nuevo Laredo' })).toMatchObject({ km: 812.35, por: 'cp' });
    expect(resolverDistancia(RUTAS, ctx, { cp: '64999', municipio: 'Monterrey' }, { cp: '78999', municipio: 'Nuevo Laredo' })).toMatchObject({ km: 230, por: 'municipio' });
  });
  it('par desconocido, sentido contrario o datos incompletos → ninguna (la ruta es dirigida)', () => {
    expect(resolverDistancia(RUTAS, ctx, { cp: '64000' }, { cp: '99999' })).toEqual({ tipo: 'ninguna' });
    expect(resolverDistancia(RUTAS, ctx, { cp: '78000' }, { cp: '64000' })).toEqual({ tipo: 'ninguna' });
    expect(resolverDistancia(RUTAS, ctx, { cp: '64000' }, {})).toEqual({ tipo: 'ninguna' });
    expect(resolverDistancia(RUTAS, ctx, { cp: '6400' }, { cp: '78000' })).toEqual({ tipo: 'ninguna' }); // 4 dígitos: no se completa
    expect(resolverDistancia([], ctx, { cp: '64000' }, { cp: '78000' })).toEqual({ tipo: 'ninguna' });
    expect(resolverDistancia(null, ctx, { cp: '64000' }, { cp: '78000' })).toEqual({ tipo: 'ninguna' });
  });
  it('solo usa rutas del mismo tenant y cliente; sin cliente identificado no resuelve nada', () => {
    expect(resolverDistancia(RUTAS, { tenantId: T1, clienteId: C2 }, { cp: '64000' }, { cp: '78000' })).toMatchObject({ km: 111 });
    expect(resolverDistancia(RUTAS, { tenantId: T2, clienteId: C1 }, { cp: '64000' }, { cp: '78000' })).toEqual({ tipo: 'ninguna' });
    expect(resolverDistancia(RUTAS, { tenantId: T1, clienteId: null }, { cp: '64000' }, { cp: '78000' })).toEqual({ tipo: 'ninguna' });
  });
  it('dos distancias distintas para el mismo par → ambigua, no se elige una', () => {
    const dup = [...RUTAS, ruta({ origen: '64000', destino: '78000', km: 815 })];
    expect(resolverDistancia(dup, ctx, { cp: '64000' }, { cp: '78000' })).toEqual({ tipo: 'ambigua', por: 'cp' });
  });
});

describe('completarDistancias sobre la extracción', () => {
  const base = { origen_cp: c('64000'), destino_cp: c('78000') };

  it('par conocido → la distancia sale del catálogo, marcada, y el original no se muta', () => {
    const e = extraccion({ ...base });
    const r = completarDistancias(e, RUTAS, ctx);
    expect(r.extraccion.campos.distancia_km).toMatchObject({ valor: '812.35', origen: 'catalogo' });
    expect(r.extraccion.campos.distancia_km.notas?.[0]).toMatch(/^Completado/);
    expect(r.completados).toEqual(['distancia_km']);
    expect(r.hallazgos).toEqual([]);
    expect(e.campos.distancia_km).toBeUndefined();
  });

  it('par desconocido → bloqueo distancia_faltante (nada inventado)', () => {
    const r = completarDistancias(extraccion({ origen_cp: c('64000'), destino_cp: c('99999') }), RUTAS, ctx);
    expect(r.extraccion.campos.distancia_km).toBeUndefined();
    expect(r.hallazgos).toHaveLength(1);
    expect(r.hallazgos[0]).toMatchObject({ campo: 'distancia_km', severidad: 'bloqueo', codigo: 'distancia_faltante' });
    expect(r.hallazgos[0].mensaje).toMatch(/no está en el catálogo/);
  });

  it('sin catálogo cargado, la distancia es dato obligatorio a capturar en el visor', () => {
    const r = completarDistancias(extraccion({ ...base }), null, ctx);
    expect(r.hallazgos[0]).toMatchObject({ severidad: 'bloqueo', codigo: 'distancia_faltante' });
  });

  it('par ambiguo → bloqueo y lo dice', () => {
    const dup = [...RUTAS, ruta({ origen: '64000', destino: '78000', km: 815 })];
    const r = completarDistancias(extraccion({ ...base }), dup, ctx);
    expect(r.hallazgos[0]).toMatchObject({ codigo: 'distancia_faltante' });
    expect(r.hallazgos[0].mensaje).toMatch(/distintas/);
    expect(r.extraccion.campos.distancia_km).toBeUndefined();
  });

  it('«812,35 km» del documento → «812.35» (el libro recibe solo número) y no pisa el origen', () => {
    const r = completarDistancias(extraccion({ ...base, distancia_km: c('812,35 km', 'xml', 0.99) }), RUTAS, ctx);
    expect(r.extraccion.campos.distancia_km).toMatchObject({ valor: '812.35', origen: 'xml', confianza: 0.99 });
    expect(r.completados).toEqual([]);
    expect(r.hallazgos).toEqual([]);
  });

  it('si el documento trae otra distancia que el catálogo, conserva la del documento con aviso «Confírmalo»', () => {
    const r = completarDistancias(extraccion({ ...base, distancia_km: c('900 km') }), RUTAS, ctx);
    expect(r.extraccion.campos.distancia_km.valor).toBe('900');
    expect(r.extraccion.campos.distancia_km.notas?.join(' ')).toMatch(/El catálogo dice «812.35», el documento dice «900». Confírmalo/);
    expect(r.hallazgos[0]).toMatchObject({ severidad: 'confirmar', codigo: 'distancia_difiere_catalogo' });
  });

  it('un valor humano no se toca ni se reformatea', () => {
    const r = completarDistancias(extraccion({ ...base, distancia_km: c('900 km', 'humano', 1) }), RUTAS, ctx);
    expect(r.extraccion.campos.distancia_km.valor).toBe('900 km');
    expect(r.hallazgos).toEqual([]);
  });

  it('una distancia ilegible o ambigua bloquea en vez de pasar', () => {
    const a = completarDistancias(extraccion({ ...base, distancia_km: c('mucho') }), RUTAS, ctx);
    expect(a.hallazgos[0]).toMatchObject({ severidad: 'bloqueo', codigo: 'distancia_ilegible' });
    expect(a.extraccion.campos.distancia_km.valor).toBe('mucho');
    const b = completarDistancias(extraccion({ ...base, distancia_km: c('1.500') }), RUTAS, ctx);
    expect(b.hallazgos[0].mensaje).toMatch(/ambiguo/);
  });

  it('varios destinos: cada uno se resuelve por su propio par, y los que no están bloquean por destino', () => {
    const e = extraccion({
      origen_cp: c('64000'), destino_cp: c('78000'), destino_2_cp: c('78100'), destino_2_nombre: c('Destino Dos'), destino_3_cp: c('99999'), destino_3_nombre: c('Destino Tres'),
    });
    const r = completarDistancias(e, RUTAS, ctx);
    expect(r.extraccion.campos.distancia_km.valor).toBe('812.35');
    expect(r.extraccion.campos.destino_2_distancia_km.valor).toBe('900');
    expect(r.extraccion.campos.destino_3_distancia_km).toBeUndefined();
    expect(r.hallazgos.map((h) => h.campo)).toEqual(['destino_3_distancia_km']);
    expect(r.hallazgos[0].mensaje).toMatch(/del destino 3/);
  });
});

describe('el extractor ya no devuelve ni pide la distancia', () => {
  it('distancia_km es de solo enriquecimiento: fuera del prompt y del esquema del modelo', () => {
    expect(campoDoc('distancia_km')?.soloEnriquecimiento).toBe(true);
    expect(CAMPOS_DOC_LLM.some((x) => x.clave === 'distancia_km')).toBe(false);
    expect(construirSistema().includes('- distancia_km:')).toBe(false);
    const salida = SalidaLlmSchema.safeParse({ campos: [{ clave: 'distancia_km', valor: '812', confianza: 1, evidencia: 'x' }], mercancias: [], notas: null });
    expect(salida.success).toBe(false);
  });
});

// ── Importación CSV ─────────────────────────────────────────────────────────

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
interface Falso extends PuertoDistancias { almacen: Map<string, RegistroDistancia>; lotes: number[]; fallarEnLote?: number }
function puertoFalso(): Falso {
  const clientes: Record<string, Array<{ id: string; nombre: string }>> = {
    [T1]: [{ id: C1, nombre: 'Cliente Uno' }, { id: C2, nombre: 'Cliente Dos' }],
    [T2]: [{ id: CAJENO, nombre: 'Cliente Ajeno' }],
  };
  const f: Falso = {
    almacen: new Map(), lotes: [],
    async clientes(t) { return clientes[t] ?? []; },
    async existentes(_t, ids) { return [...f.almacen.values()].filter((v) => ids.includes(v.cliente_id)); },
    async aplicarLote(_t, registros) {
      if (f.fallarEnLote !== undefined && f.lotes.length === f.fallarEnLote) throw new Error('boom');
      f.lotes.push(registros.length);
      for (const r of registros) f.almacen.set(claveDeRuta(r), { ...r });
    },
  };
  return f;
}
const entrada = (csv: string, confirmar: boolean, tenantId = T1) => ({ tenantId, actorId: 'u-1', bytes: enc(csv), confirmar });
const CAB = COLUMNAS_DISTANCIA.join(',');
const DIEZ = [
  CAB,
  ...Array.from({ length: 6 }, (_, i) => `Cliente Uno,cp,6400${i},7800${i},${800 + i},`.replace(/,$/, '')),
  'Cliente Uno,municipio,Monterrey,Nuevo Laredó,"230,5 km"',
  'Cliente Dos,municipio,SALTILLO,monterrey,85',
  'Cliente Dos,cp,25000,64000,"85,00"',
  'Cliente Uno,cp,64000,78100,900',
].join('\r\n');

describe('importación CSV del catálogo de distancias', () => {
  it('la plantilla trae BOM, el encabezado y una fila de ejemplo que no pega con ningún cliente', () => {
    const csv = plantillaDistanciasCsv();
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const l = leerCsv(enc(csv));
    expect(l.ok && l.filas[0]).toEqual([...COLUMNAS_DISTANCIA]);
    expect(l.ok && l.filas[1][0]).toBe('Cliente de ejemplo');
  });

  it('10 filas: la vista previa cuenta y no escribe; confirmar escribe; reimportar da 0 nuevas, 0 cambian', async () => {
    const p = puertoFalso();
    const previa = await importarDistancias(entrada(DIEZ, false), p);
    expect(previa).toMatchObject({ ok: true, aplicado: false, nuevas: 10, cambian: 0, conError: 0 });
    expect(p.almacen.size).toBe(0);

    const hecho = await importarDistancias(entrada(DIEZ, true), p);
    expect(hecho).toMatchObject({ ok: true, aplicado: true, nuevas: 10, cambian: 0 });
    expect(p.almacen.size).toBe(10);
    // Forma canónica: municipio sin acentos ni mayúsculas, km con punto decimal sin unidad.
    expect(p.almacen.get(claveDeRuta({ cliente_id: C1, tipo: 'municipio', origen: 'monterrey', destino: 'nuevo laredo' }))?.km).toBe('230.5');
    expect(p.almacen.get(claveDeRuta({ cliente_id: C2, tipo: 'municipio', origen: 'saltillo', destino: 'monterrey' }))?.km).toBe('85');
    expect(p.almacen.get(claveDeRuta({ cliente_id: C2, tipo: 'cp', origen: '25000', destino: '64000' }))?.km).toBe('85');

    const otra = await importarDistancias(entrada(DIEZ, true), p);
    expect(otra).toMatchObject({ ok: true, aplicado: false, nuevas: 0, cambian: 0, sinCambio: 10 });
  });

  it('lo importado se resuelve: par conocido → valor; desconocido → bloqueo', async () => {
    const p = puertoFalso();
    await importarDistancias(entrada(DIEZ, true), p);
    const rutas: RutaDistancia[] = [...p.almacen.values()].map((r) => ({ tenantId: T1, clienteId: r.cliente_id, tipo: r.tipo, origen: r.origen, destino: r.destino, km: Number(r.km) }));
    const ok = completarDistancias(extraccion({ origen_cp: c('64001'), destino_cp: c('78001') }), rutas, ctx);
    expect(ok.extraccion.campos.distancia_km.valor).toBe('801');
    const no = completarDistancias(extraccion({ origen_cp: c('64001'), destino_cp: c('11111') }), rutas, ctx);
    expect(no.hallazgos[0].codigo).toBe('distancia_faltante');
  });

  it('un km distinto en el mismo par es un cambio, no una duplicada', async () => {
    const p = puertoFalso();
    await importarDistancias(entrada(`${CAB}\r\nCliente Uno,cp,64000,78000,812`, true), p);
    const r = await importarDistancias(entrada(`${CAB}\r\nCliente Uno,cp,64000,78000,"812,5 km"`, true), p);
    expect(r).toMatchObject({ aplicado: true, nuevas: 0, cambian: 1 });
    expect([...p.almacen.values()][0].km).toBe('812.5');
  });

  it('errores por fila (con número de fila) y todo o nada al confirmar', async () => {
    const p = puertoFalso();
    const csv = [
      CAB,
      'Cliente Uno,cp,64000,78000,812',
      'Cliente Uno,cp,6400,78000,812',        // 3: CP corto
      'Cliente Uno,via,64000,78000,812',      // 4: tipo inválido
      'Cliente Uno,cp,64000,78002,0',         // 5: km cero
      'Cliente Uno,cp,64000,78003,1.500',     // 6: km ambiguo
      'Cliente Uno,cp,64000,78004,mucho',     // 7: km no numérico
      'Cliente Nadie,cp,64000,78005,10',      // 8: cliente inexistente
      'Cliente Ajeno,cp,64000,78006,10',      // 9: cliente de OTRA flota
      'Cliente Uno,cp,64000,78000,813',       // 10: repite la ruta de la fila 2
      'Cliente Uno,municipio,,laredo,10',     // 11: municipio vacío
      'Cliente Uno,cp,64000,78007,-5',        // 12: empieza con «-» (fórmula)
      'Cliente Uno,cp,64000,78008,=1+1',      // 13: fórmula
    ].join('\r\n');
    const previa = await importarDistancias(entrada(csv, false), p);
    expect(previa).toMatchObject({ ok: true, aplicado: false, nuevas: 1, conError: 11 });
    expect(previa.errores.map((e) => e.fila)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(previa.errores.find((e) => e.fila === 3)?.mensaje).toMatch(/código postal de 5 dígitos/);
    expect(previa.errores.find((e) => e.fila === 9)?.mensaje).toMatch(/No hay un cliente llamado/);
    expect(previa.errores.find((e) => e.fila === 10)?.mensaje).toMatch(/Repite la ruta de la fila 2/);
    expect(previa.errores.find((e) => e.fila === 12)?.mensaje).toMatch(/fórmula/);
    const confirmada = await importarDistancias(entrada(csv, true), p);
    expect(confirmada).toMatchObject({ ok: false, aplicado: false });
    expect(p.almacen.size).toBe(0);
  });

  it('el cliente puede ir por id, pero solo si es de la flota de la sesión', async () => {
    const p = puertoFalso();
    const bien = await importarDistancias(entrada(`${CAB}\r\n${C1},cp,64000,78000,812`, true), p);
    expect(bien).toMatchObject({ ok: true, aplicado: true, nuevas: 1 });
    const mal = await importarDistancias(entrada(`${CAB}\r\n${CAJENO},cp,64000,78000,812`, true), p);
    expect(mal).toMatchObject({ ok: false, conError: 1 });
    expect(mal.errores[0].mensaje).toMatch(/no es de tu flota/);
  });

  it('archivos mal formados se rechazan con mensaje llano', async () => {
    const p = puertoFalso();
    expect((await importarDistancias(entrada('', false), p)).mensaje).toMatch(/vacío/);
    expect((await importarDistancias(entrada(`${CAB}\r\n`, false), p)).mensaje).toMatch(/solo trae el encabezado/);
    expect((await importarDistancias(entrada('cliente,tipo,origen,destino\r\nCliente Uno,cp,64000,78000', false), p)).mensaje).toMatch(/Falta la columna obligatoria «km»/);
    expect((await importarDistancias(entrada(`${CAB},extra\r\nCliente Uno,cp,64000,78000,1,x`, false), p)).mensaje).toMatch(/Columna no reconocida/);
  });

  it('si un lote falla a medias lo dice y reimportar termina sin duplicar', async () => {
    const p = puertoFalso();
    const filas = Array.from({ length: 1200 }, (_, i) => `Cliente Uno,cp,${String(10000 + i)},${String(20000 + i)},${100 + (i % 50)}`);
    const csv = [CAB, ...filas].join('\r\n');
    p.fallarEnLote = 1;
    const r1 = await importarDistancias(entrada(csv, true), p);
    expect(r1).toMatchObject({ ok: false, aplicado: false });
    expect(r1.mensaje).toMatch(/Se guardaron 500 de 1200/);
    p.fallarEnLote = undefined;
    const r2 = await importarDistancias(entrada(csv, true), p);
    expect(r2).toMatchObject({ ok: true, aplicado: true, nuevas: 700, sinCambio: 500 });
    expect(p.almacen.size).toBe(1200);
  });
});
