import { describe, it, expect } from 'vitest';
import { detectarFormato, prepararContenido, type ContenidoDoc } from './contenido';
import {
  aplicarPerfil, aprender, claveDePerfil, elegirPerfil, firmaDe, localizarEncabezado, puntuarPerfil, valorDeEtiqueta, valorDeRuta,
  MAX_EJEMPLOS, UMBRAL_COINCIDENCIA, type Mapeo, type Perfil,
} from './perfiles';
import { campoDoc, type Extraccion } from './campos';
import { normalizarNumero, normalizarValor } from './normalizar';
import { cv, csvAtlas, excelAtlas, extraccionAtlasOk, filaAtlas, EMBARQUE_ATLAS, pdfBoreal, RFC, xmlPropio, correoTexto } from './documentos_sinteticos.fixture';

async function contenido(bytes: Uint8Array): Promise<ContenidoDoc> {
  const d = detectarFormato(bytes);
  if (!d.ok) throw new Error(d.motivo);
  return prepararContenido(bytes, d.clase);
}

const perfilCon = (c: ContenidoDoc, mapeos: Mapeo[], extra: Partial<Perfil> = {}): Perfil => ({
  id: 'p', clave: 'p', nombre: 'P', clienteId: null, formato: c.formato, firma: firmaDe(c), versionActiva: 1,
  activa: { version: 1, mapeos, ejemplos: [] }, ...extra,
});

describe('la cabecera de una tabla', () => {
  it('se localiza aunque haya un título y filas en blanco antes', async () => {
    const c = await contenido(excelAtlas());
    const t = localizarEncabezado(c.tabla![0])!;
    expect(t.encabezados[0]).toBe('Folio Embarque');
    expect(t.llaves[14]).toBe('peso kg');
    expect(t.filas).toHaveLength(1);
  });
  it('una hoja de puros números no tiene cabecera', () => {
    expect(localizarEncabezado({ nombre: 'x', filas: [['1', '2', '3'], ['4', '5', '6']] })).toBeNull();
  });
});

describe('reconocer el formato de un cliente', () => {
  it('el mismo formato con otros datos puntúa alto; otro formato, cero', async () => {
    const a = await contenido(excelAtlas());
    const p = perfilCon(a, []);
    const otro = await contenido(excelAtlas([filaAtlas({ ...EMBARQUE_ATLAS, folio: 'X-9' })]));
    expect(puntuarPerfil(p, otro)).toBeGreaterThanOrEqual(0.95);
    expect(puntuarPerfil(p, await contenido(await pdfBoreal()))).toBe(0);
    expect(puntuarPerfil(p, await contenido(csvAtlas()))).toBeGreaterThanOrEqual(UMBRAL_COINCIDENCIA); // excel y csv son el mismo grupo de tabla
  });

  it('una tabla con otras columnas no coincide', async () => {
    const a = await contenido(excelAtlas());
    const p = perfilCon(a, []);
    const distinta = await contenido(Buffer.from('Orden,Cliente,Total\n1,X,100\n2,Y,200'));
    expect(puntuarPerfil(p, distinta)).toBeLessThan(UMBRAL_COINCIDENCIA);
  });

  it('el dominio del remitente suma un poco pero NO basta solo', async () => {
    const c = await contenido(Buffer.from(correoTexto()));
    const p = perfilCon(c, [], { firma: { formato: 'correo', etiquetas: ['folio', 'salida'], remitentes: ['cementosgolfo.example'] } });
    const otroTexto = await contenido(Buffer.from('Hola, ¿cómo estás? Te escribo para saludarte y desearte buen día.'));
    expect(puntuarPerfil(p, otroTexto, 'x@cementosgolfo.example')).toBe(0);
  });

  it('elegirPerfil: el mejor ≥ umbral; sin empate; ambiguo = ninguno', async () => {
    const c = await contenido(excelAtlas());
    const a = perfilCon(c, [], { id: 'a' });
    const b = perfilCon(c, [], { id: 'b' });
    expect(elegirPerfil([a], c).perfil?.id).toBe('a');
    const dos = elegirPerfil([a, b], c);
    expect(dos.perfil).toBeNull();
    expect(dos.ambiguo).toBe(true);
    expect(elegirPerfil([], c)).toEqual({ perfil: null, puntaje: 0, ambiguo: false });
  });

  it('con cliente forzado solo cuentan los perfiles de ese cliente (o los sin cliente)', async () => {
    const c = await contenido(excelAtlas());
    const a = perfilCon(c, [], { id: 'a', clienteId: 'c1' });
    expect(elegirPerfil([a], c, null, 'c2').perfil).toBeNull();
    expect(elegirPerfil([a], c, null, 'c1').perfil?.id).toBe('a');
  });
});

describe('aprender de lo que un humano aprobó', () => {
  it('Excel: infiere las columnas, incluso cuando el valor aprobado está normalizado (Jalisco→JAL, 15/10/2026→ISO, Cajas→XBX)', async () => {
    const c = await contenido(excelAtlas());
    const r = aprender({ contenido: c, final: extraccionAtlasOk('humano', 1), previa: null, riesgoInyeccion: false });
    const por = Object.fromEntries(r.mapeos.map((m) => [`${m.mercancia ? 'm.' : ''}${m.campo}`, m]));
    expect(por['origen_estado'].fuente).toEqual({ tipo: 'columna', encabezado: 'Estado Origen' });
    expect(por['fecha_salida'].fuente).toEqual({ tipo: 'columna', encabezado: 'Fecha Salida' });
    expect(por['m.clave_unidad'].fuente).toEqual({ tipo: 'columna', encabezado: 'Unidad' });
    expect(por['m.bienes_transp'].fuente).toEqual({ tipo: 'columna', encabezado: 'Clave SAT' });
    expect(r.cambios.length).toBe(r.mapeos.length);
    expect(r.ejemplos).toHaveLength(1);
  });

  it('aprende cómo escribe sus cifras: «1,200» con coma de miles', async () => {
    const c = await contenido(excelAtlas());
    const r = aprender({ contenido: c, final: extraccionAtlasOk('humano', 1), previa: null, riesgoInyeccion: false });
    expect(r.mapeos.find((m) => m.mercancia && m.campo === 'cantidad')?.separadorMiles).toBe(',');
    expect(normalizarNumero('3,500', ',').valor).toBe(3500);
    expect(normalizarNumero('3.500', ',').valor).toBe(3.5);
    expect(normalizarNumero('3.500', '.').valor).toBe(3500);
    expect(normalizarNumero('3,500', '.').valor).toBe(3.5);
  });

  it('no aprende cuando dos columnas valen lo mismo (no se adivina cuál es)', async () => {
    const wb = Buffer.from('Folio,Peso bruto,Peso neto,Descripcion,Cantidad\nF1,1000,1000,Cemento,5\n');
    const c = await contenido(wb);
    const fin: Extraccion = { campos: { folio_cliente: cv('F1', 1, 'humano') }, mercancias: [{ peso_kg: cv('1000', 1, 'humano'), descripcion: cv('Cemento', 1, 'humano') }] };
    const r = aprender({ contenido: c, final: fin, previa: null, riesgoInyeccion: false });
    const campos = r.mapeos.map((m) => m.campo);
    expect(campos).toContain('folio_cliente');
    expect(campos).toContain('descripcion');
    expect(campos).not.toContain('peso_kg');
  });

  it('el peso bruto total no se aprende de la primera fila cuando hay varias mercancías', async () => {
    const c = await contenido(excelAtlas([filaAtlas(EMBARQUE_ATLAS), filaAtlas({ ...EMBARQUE_ATLAS, producto: 'Tapas', pesoKg: '600' })]));
    const fin = extraccionAtlasOk('humano', 1);
    const r = aprender({ contenido: c, final: fin, previa: null, riesgoInyeccion: false });
    expect(r.mapeos.some((m) => m.campo === 'peso_bruto_total')).toBe(false);
  });

  it('es idempotente: aprender lo mismo dos veces no crea una versión nueva', async () => {
    const c = await contenido(excelAtlas());
    const fin = extraccionAtlasOk('humano', 1);
    const a = aprender({ contenido: c, final: fin, previa: null, riesgoInyeccion: false });
    const b = aprender({ contenido: c, final: fin, previa: { version: 1, mapeos: a.mapeos, ejemplos: a.ejemplos }, riesgoInyeccion: false });
    expect(b.cambios).toEqual([]);
    expect(b.ejemplos).toEqual(a.ejemplos);
  });

  it('una corrección humana REEMPLAZA el mapeo anterior (columna distinta) y lo dice', async () => {
    const c = await contenido(excelAtlas());
    const a = aprender({ contenido: c, final: extraccionAtlasOk('humano', 1), previa: null, riesgoInyeccion: false });
    const equivocado: Mapeo[] = a.mapeos.map((m) => (m.campo === 'origen_cp' ? { ...m, fuente: { tipo: 'columna', encabezado: 'CP Destino' } } : m));
    const b = aprender({ contenido: c, final: extraccionAtlasOk('humano', 1), previa: { version: 1, mapeos: equivocado, ejemplos: [] }, riesgoInyeccion: false });
    expect(b.cambios.join('\n')).toMatch(/Corregido: origen_cp ← columna «CP Origen» \(antes columna «CP Destino»\)/);
    expect(b.mapeos.find((m) => m.campo === 'origen_cp')?.fuente).toEqual({ tipo: 'columna', encabezado: 'CP Origen' });
  });

  it('un mapeo constante puesto a mano NO lo pisa el aprendizaje', async () => {
    const c = await contenido(excelAtlas());
    const fijo: Mapeo = { campo: 'origen_rfc', mercancia: false, fuente: { tipo: 'constante', valor: RFC.atlas } };
    const r = aprender({ contenido: c, final: extraccionAtlasOk('humano', 1), previa: { version: 1, mapeos: [fijo], ejemplos: [] }, riesgoInyeccion: false });
    expect(r.mapeos.find((m) => m.campo === 'origen_rfc')?.fuente.tipo).toBe('constante');
  });

  it('NO se aprende de un documento con riesgo de inyección', async () => {
    const c = await contenido(excelAtlas());
    const r = aprender({ contenido: c, final: extraccionAtlasOk('humano', 1), previa: null, riesgoInyeccion: true });
    expect(r.cambios).toEqual([]);
    expect(r.mapeos).toEqual([]);
    expect(r.omitido).toMatch(/instrucción/);
  });

  it('los ejemplos se acotan a 5 (los más recientes)', async () => {
    const c = await contenido(excelAtlas());
    let previa = { version: 1, mapeos: [] as Mapeo[], ejemplos: [] as ReturnType<typeof aprender>['ejemplos'] };
    for (let i = 0; i < 8; i++) {
      const fin = extraccionAtlasOk('humano', 1);
      fin.campos.folio_cliente = cv(`ATL-${i}`, 1, 'humano');
      const c2 = await contenido(excelAtlas([filaAtlas({ ...EMBARQUE_ATLAS, folio: `ATL-${i}` })]));
      const r = aprender({ contenido: c2, final: fin, previa: previa.mapeos.length ? previa : null, riesgoInyeccion: false });
      previa = { version: previa.version + 1, mapeos: r.mapeos, ejemplos: r.ejemplos };
    }
    void c;
    expect(previa.ejemplos.length).toBeLessThanOrEqual(MAX_EJEMPLOS);
  });

  it('texto (PDF/correo): aprende la ETIQUETA que precede al valor', async () => {
    const c = await contenido(await pdfBoreal());
    const fin: Extraccion = {
      campos: { folio_cliente: cv('BOR-77120', 1, 'humano'), origen_cp: cv('66600', 1, 'humano'), origen_rfc: cv(RFC.boreal, 1, 'humano'), operador_nombre: cv('Maria Hernandez Soto', 1, 'humano') },
      mercancias: [{ descripcion: cv('Alimentos enlatados', 1, 'humano'), bienes_transp: cv('50202300', 1, 'humano') }],
    };
    const r = aprender({ contenido: c, final: fin, previa: null, riesgoInyeccion: false });
    const por = Object.fromEntries(r.mapeos.map((m) => [`${m.mercancia ? 'm.' : ''}${m.campo}`, m.fuente]));
    expect(por['folio_cliente']).toEqual({ tipo: 'etiqueta', etiqueta: 'Orden' });
    expect(por['origen_cp']).toEqual({ tipo: 'etiqueta', etiqueta: 'CP origen' });
    expect(por['m.bienes_transp']).toEqual({ tipo: 'etiqueta', etiqueta: 'Clave producto' });
    // y se reaplica a OTRO documento del mismo formato
    const otro = await contenido(await pdfBoreal({ folio: 'BOR-90001' }));
    const ap = aplicarPerfil(perfilCon(c, r.mapeos), otro);
    expect(ap.extraccion.campos.folio_cliente.valor).toBe('BOR-90001');
    expect(ap.extraccion.campos.origen_cp.valor).toBe('66600');
    expect(ap.extraccion.mercancias[0].bienes_transp.valor).toBe('50202300');
  });

  it('XML propio: aprende la ruta y la reaplica', async () => {
    const c = await contenido(Buffer.from(xmlPropio()));
    const fin: Extraccion = {
      campos: { folio_cliente: cv('XP-300', 1, 'humano'), origen_cp: cv('37000', 1, 'humano'), destino_cp: cv('25000', 1, 'humano') },
      mercancias: [{ descripcion: cv('Resina plástica', 1, 'humano'), peso_kg: cv('10000', 1, 'humano') }],
    };
    const r = aprender({ contenido: c, final: fin, previa: null, riesgoInyeccion: false });
    const por = Object.fromEntries(r.mapeos.map((m) => [`${m.mercancia ? 'm.' : ''}${m.campo}`, m.fuente]));
    expect(por['folio_cliente']).toEqual({ tipo: 'ruta', ruta: 'Embarque/@folio' });
    expect(por['origen_cp']).toEqual({ tipo: 'ruta', ruta: 'Embarque/Origen/CP' });
    const ap = aplicarPerfil(perfilCon(c, r.mapeos), c);
    expect(ap.extraccion.campos.destino_cp.valor).toBe('25000');
    expect(ap.extraccion.mercancias[0].descripcion.valor).toBe('Resina plástica');
  });
});

describe('aplicar un perfil', () => {
  const colMapeos = (...pares: Array<[string, string, boolean?]>): Mapeo[] =>
    pares.map(([campo, encabezado, mercancia]) => ({ campo, mercancia: !!mercancia, fuente: { tipo: 'columna', encabezado } }));

  it('una columna que ya no está se avisa (el formato cambió) en vez de fallar', async () => {
    const c = await contenido(excelAtlas());
    const p = perfilCon(c, colMapeos(['folio_cliente', 'Folio Embarque'], ['origen_cp', 'Columna Que Ya No Existe']));
    const r = aplicarPerfil(p, c);
    expect(r.extraccion.campos.folio_cliente.valor).toBe('ATL-20481');
    expect(r.avisos.join(' ')).toMatch(/ya no está en este archivo/);
  });

  it('una fila de TOTAL no es una mercancía', async () => {
    const c = await contenido(excelAtlas([filaAtlas(EMBARQUE_ATLAS)], { extras: [['TOTAL', '', '', '', '', '', '', '', '', '', '', '', '1,200', '', '8,400', '', '']] }));
    const p = perfilCon(c, colMapeos(['descripcion', 'Producto', true], ['peso_kg', 'Peso (kg)', true]));
    expect(aplicarPerfil(p, c).extraccion.mercancias).toHaveLength(1);
  });

  it('varias filas = varias mercancías, y el folio de la primera es el del documento', async () => {
    const c = await contenido(excelAtlas([filaAtlas(EMBARQUE_ATLAS), filaAtlas({ ...EMBARQUE_ATLAS, producto: 'Tapas', pesoKg: '600' })]));
    const p = perfilCon(c, colMapeos(['folio_cliente', 'Folio Embarque'], ['descripcion', 'Producto', true], ['peso_kg', 'Peso (kg)', true]));
    const r = aplicarPerfil(p, c);
    expect(r.extraccion.mercancias.map((m) => m.descripcion.valor)).toEqual(['Botellas de vidrio vacías', 'Tapas']);
    expect(r.extraccion.campos.folio_cliente.valor).toBe('ATL-20481');
  });

  it('un archivo con VARIOS folios avisa que solo se leyó el primero', async () => {
    const c = await contenido(excelAtlas([filaAtlas(EMBARQUE_ATLAS), filaAtlas({ ...EMBARQUE_ATLAS, folio: 'ATL-20482' })]));
    const p = perfilCon(c, colMapeos(['folio_cliente', 'Folio Embarque']));
    expect(aplicarPerfil(p, c).avisos.join(' ')).toMatch(/2 folios distintos/);
  });

  it('constante: valor fijo del cliente, con confianza menor que la de una lectura', async () => {
    const c = await contenido(excelAtlas());
    const p = perfilCon(c, [{ campo: 'origen_rfc', mercancia: false, fuente: { tipo: 'constante', valor: RFC.atlas } }]);
    const r = aplicarPerfil(p, c);
    expect(r.extraccion.campos.origen_rfc.valor).toBe(RFC.atlas);
    expect(r.extraccion.campos.origen_rfc.confianza).toBeLessThan(0.97);
  });

  it('un valor del perfil que no pasa la normalización conserva la nota y baja la confianza', async () => {
    const c = await contenido(excelAtlas([filaAtlas({ ...EMBARQUE_ATLAS, origenCp: '6600' })]));
    const p = perfilCon(c, colMapeos(['origen_cp', 'CP Origen']));
    const r = aplicarPerfil(p, c);
    expect(r.extraccion.campos.origen_cp.valor).toBe('06600');
    expect(r.extraccion.campos.origen_cp.confianza).toBeLessThan(0.85);
    expect(r.extraccion.campos.origen_cp.notas?.[0]).toMatch(/cero inicial/);
  });
});

describe('piezas', () => {
  it('valorDeEtiqueta: dos pares en una línea y etiquetas con acentos/mayúsculas', () => {
    const t = 'Folio:   A-1      Peso: 10 kg\nOrigen Código Postal : 44100\nSin etiqueta aquí';
    expect(valorDeEtiqueta(t, 'peso')?.valor).toBe('10 kg');
    expect(valorDeEtiqueta(t, 'origen codigo postal')?.valor).toBe('44100');
    expect(valorDeEtiqueta(t, 'inexistente')).toBeNull();
  });
  it('valorDeRuta: atributos y rutas inexistentes o absurdamente largas', () => {
    const arbol = { A: { B: { '@_x': '1', C: 'hola' } } };
    expect(valorDeRuta(arbol, 'A/B/@x')).toBe('1');
    expect(valorDeRuta(arbol, 'A/B/C')).toBe('hola');
    expect(valorDeRuta(arbol, 'A/Z')).toBeNull();
    expect(valorDeRuta(arbol, Array(20).fill('A').join('/'))).toBeNull();
  });
  it('claveDePerfil produce slugs válidos', () => {
    expect(claveDePerfil('Distribuidora Atlas — Excel (2026)')).toBe('distribuidora-atlas-excel-2026');
    expect(claveDePerfil('###')).toBe('perfil');
    expect(claveDePerfil('x'.repeat(200)).length).toBe(60);
    expect(/^[a-z0-9][a-z0-9_-]{0,59}$/.test(claveDePerfil('Ñandú SA'))).toBe(true);
  });
  it('normalizarValor con pista de miles', () => {
    expect(normalizarValor(campoDoc('distancia_km')!, '1.500', { miles: '.' }).valor).toBe('1500');
    expect(normalizarValor(campoDoc('distancia_km')!, '1.500', { miles: ',' }).valor).toBe('1.5');
  });
});
