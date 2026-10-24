import { describe, it, expect } from 'vitest';
import { detectarFormato, prepararContenido, type ContenidoDoc } from './contenido';
import {
  aplicarPerfil, aprender, claveDePerfil, elegirPerfil, estructuraDeJson, firmaDe, localizarEncabezado, puntuarPerfil, tramosJson, valorDeEtiqueta, valorDeRuta, valorDeRutaJson,
  MAX_EJEMPLOS, UMBRAL_COINCIDENCIA, type Mapeo, type Perfil,
} from './perfiles';
import { campoDoc, type Extraccion } from './campos';
import { normalizarNumero, normalizarValor } from './normalizar';
import { extraerDocumento } from './extractor';
import { llmFalso, salida } from './llm_falso.fixture';
import { validarExtraccion } from './validacion';
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

describe('orden de fecha por perfil (MM/DD)', () => {
  const csvFecha = (fecha: string): Buffer => Buffer.from(`Folio,Fecha Salida,Descripcion,Cantidad\nF1,${fecha},Cemento,5\n`);
  const finalFecha = (iso: string): Extraccion => ({
    campos: { folio_cliente: cv('F1', 1, 'humano'), fecha_salida: cv(iso, 1, 'humano') },
    mercancias: [{ descripcion: cv('Cemento', 1, 'humano') }],
  });
  const fechaDe = (r: ReturnType<typeof aplicarPerfil>): string | undefined => r.extraccion.campos.fecha_salida?.valor ?? undefined;

  it('aprender de 10/14/2026 aprobada como 2026-10-14 fija ordenFecha mdy', async () => {
    const c = await contenido(csvFecha('10/14/2026'));
    const r = aprender({ contenido: c, final: finalFecha('2026-10-14'), previa: null, riesgoInyeccion: false });
    const m = r.mapeos.find((x) => x.campo === 'fecha_salida');
    expect(m?.fuente).toEqual({ tipo: 'columna', encabezado: 'Fecha Salida' });
    expect(m?.ordenFecha).toBe('mdy');
    expect(r.notas).toBeUndefined();
  });

  it('reaplicar el perfil mdy en 10/11/2026 da 11 de octubre; sin ordenFecha daría 10 de noviembre', async () => {
    const c1 = await contenido(csvFecha('10/14/2026'));
    const a = aprender({ contenido: c1, final: finalFecha('2026-10-14'), previa: null, riesgoInyeccion: false });
    const c2 = await contenido(csvFecha('10/11/2026'));
    expect(fechaDe(aplicarPerfil(perfilCon(c2, a.mapeos), c2))).toBe('2026-10-11');
    const sinOrden = a.mapeos.map(({ ordenFecha: _o, ...resto }) => resto);
    expect(fechaDe(aplicarPerfil(perfilCon(c2, sinOrden), c2))).toBe('2026-11-10');
  });

  it('un perfil viejo (sin ordenFecha) se comporta como antes: día/mes', async () => {
    const c = await contenido(csvFecha('15/10/2026'));
    const mapeos: Mapeo[] = [{ campo: 'fecha_salida', mercancia: false, fuente: { tipo: 'columna', encabezado: 'Fecha Salida' } }];
    expect(fechaDe(aplicarPerfil(perfilCon(c, mapeos), c))).toBe('2026-10-15');
  });

  it('si la única fecha es ambigua (10/11/2026) no infiere el orden y deja la nota', async () => {
    const c = await contenido(csvFecha('10/11/2026'));
    const r = aprender({ contenido: c, final: finalFecha('2026-10-11'), previa: null, riesgoInyeccion: false });
    expect(r.mapeos.find((x) => x.campo === 'fecha_salida')?.ordenFecha).toBeUndefined();
    expect(r.notas?.join(' ')).toMatch(/fecha ambigua: confirma el orden/);
  });

  it('una fecha ya leída día/mes (15/10/2026 → 2026-10-15) no fija mdy ni deja nota', async () => {
    const c = await contenido(csvFecha('15/10/2026'));
    const r = aprender({ contenido: c, final: finalFecha('2026-10-15'), previa: null, riesgoInyeccion: false });
    expect(r.mapeos.find((x) => x.campo === 'fecha_salida')?.ordenFecha).toBeUndefined();
    expect(r.notas).toBeUndefined();
  });

  it('un orden mdy ya confirmado no se pierde cuando la nueva muestra es ambigua; y no genera versión nueva', async () => {
    const c1 = await contenido(csvFecha('10/14/2026'));
    const a = aprender({ contenido: c1, final: finalFecha('2026-10-14'), previa: null, riesgoInyeccion: false });
    const c2 = await contenido(csvFecha('10/11/2026'));
    const b = aprender({ contenido: c2, final: finalFecha('2026-10-11'), previa: { version: 1, mapeos: a.mapeos, ejemplos: a.ejemplos }, riesgoInyeccion: false });
    expect(b.mapeos.find((x) => x.campo === 'fecha_salida')?.ordenFecha).toBe('mdy');
    expect(b.cambios).toEqual([]);
  });

  it('A37-S32-03: una fecha igual en ambos órdenes (12/12/2026) no borra el mdy aprendido ni cuenta como cambio; 03/04/2026 sigue leyéndose mes/día', async () => {
    const c1 = await contenido(csvFecha('10/14/2026'));
    const a = aprender({ contenido: c1, final: finalFecha('2026-10-14'), previa: null, riesgoInyeccion: false });
    const c2 = await contenido(csvFecha('12/12/2026'));
    const b = aprender({ contenido: c2, final: finalFecha('2026-12-12'), previa: { version: 1, mapeos: a.mapeos, ejemplos: a.ejemplos }, riesgoInyeccion: false });
    expect(b.mapeos.find((x) => x.campo === 'fecha_salida')?.ordenFecha).toBe('mdy');
    expect(b.cambios).toEqual([]);
    const c3 = await contenido(csvFecha('03/04/2026'));
    expect(fechaDe(aplicarPerfil(perfilCon(c3, b.mapeos), c3))).toBe('2026-03-04');
  });

  it('A37-S32-03: una fecha que SOLO cuadra día/mes (15/10/2026) es prueba en contra: no hereda el mdy', async () => {
    const c1 = await contenido(csvFecha('10/14/2026'));
    const a = aprender({ contenido: c1, final: finalFecha('2026-10-14'), previa: null, riesgoInyeccion: false });
    const c2 = await contenido(csvFecha('15/10/2026'));
    const b = aprender({ contenido: c2, final: finalFecha('2026-10-15'), previa: { version: 1, mapeos: a.mapeos, ejemplos: a.ejemplos }, riesgoInyeccion: false });
    expect(b.mapeos.find((x) => x.campo === 'fecha_salida')?.ordenFecha).toBeUndefined();
    expect(b.cambios.join(' ')).toMatch(/Corregido: fecha_salida/);
  });

  it('cambiar el orden de un mapeo cuenta como cambio (mapeoIgual compara ordenFecha)', async () => {
    const c = await contenido(csvFecha('10/14/2026'));
    const previa: Mapeo[] = [{ campo: 'fecha_salida', mercancia: false, fuente: { tipo: 'columna', encabezado: 'Fecha Salida' } }];
    const b = aprender({ contenido: c, final: finalFecha('2026-10-14'), previa: { version: 1, mapeos: previa, ejemplos: [] }, riesgoInyeccion: false });
    expect(b.cambios.join(' ')).toMatch(/Corregido: fecha_salida/);
    expect(b.mapeos.find((x) => x.campo === 'fecha_salida')?.ordenFecha).toBe('mdy');
  });
});

describe('A37-S32-02: los ejemplos del perfil no guardan datos de personas', () => {
  it('operador_* y contacto_* se aprenden como columna pero NO su valor (ni en campos ni en la evidencia)', async () => {
    const c = await contenido(Buffer.from('Folio,Operador,Licencia,Descripcion,Cantidad\nF1,Persona Sintetica Uno,LIC-SINT-0001,Cemento,5\n'));
    const final: Extraccion = {
      campos: { folio_cliente: cv('F1', 1, 'humano'), operador_nombre: cv('Persona Sintetica Uno', 1, 'humano'), operador_licencia: cv('LIC-SINT-0001', 1, 'humano') },
      mercancias: [{ descripcion: cv('Cemento', 1, 'humano') }],
    };
    const r = aprender({ contenido: c, final, previa: null, riesgoInyeccion: false });
    expect(r.mapeos.find((m) => m.campo === 'operador_nombre')?.fuente).toEqual({ tipo: 'columna', encabezado: 'Operador' });
    const guardado = JSON.stringify(r.ejemplos);
    expect(guardado).not.toContain('Persona Sintetica Uno');
    expect(guardado).not.toContain('LIC-SINT-0001');
    expect(r.ejemplos[0].campos.operador_nombre).toBeUndefined();
    expect(r.ejemplos[0].evidencias.find((e) => e.campo === 'operador_nombre')?.linea).toBe('Operador: «valor»');
    // el resto del ejemplo sí enseña (folio y descripción)
    expect(r.ejemplos[0].campos.folio_cliente).toBe('F1');
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


// ── JSON determinista (T-A3-12) ─────────────────────────────────────────────

/** Un embarque con la FORMA del JSON de un cliente (prefijos `S_`, `DatosAdicionales`, 2 mercancías). Todo inventado. */
function jsonM1(extra: { destino?: boolean; mercancias?: unknown[] } = {}): Uint8Array {
  const doc: Record<string, unknown> = {
    S_Version: '3.0',
    S_NombreRemitente: 'Fabricante Sintético SA de CV',
    S_RfcRemitente: RFC.atlas,
    S_CpRemitente: '66000',
    S_ResidenciaFiscal: 'Calle Ficticia 100, Parque Industrial Ejemplo',
    S_PaisDestino: '',
    DatosAdicionales: { NoEmbarque: '700123', Guia: 'GUIA-0001', Placa: 'ABC1234' },
    Mercancias: extra.mercancias ?? [
      { S_Descripcion: 'Estructura metálica tipo A', S_ClaveProdServ: '24112100', S_Cantidad: 46, S_ClaveUnidad: 'H87', S_PesoKg: 8810 },
      { S_Descripcion: 'Estructura metálica tipo B', S_ClaveProdServ: '24112100', S_Cantidad: 18, S_ClaveUnidad: 'H87', S_PesoKg: 4146 },
    ],
  };
  if (extra.destino) {
    doc.S_PaisDestino = 'MEX';
    doc.S_NombreDestino = 'Comercializadora Ficticia SA de CV';
    doc.S_RfcDestino = RFC.destino1;
    doc.S_CpDestino = '64000';
  }
  return new TextEncoder().encode(JSON.stringify(doc, null, 2));
}

const ruta = (campo: string, r: string, mercancia = false): Mapeo => ({ campo, mercancia, fuente: { tipo: 'ruta', ruta: r } });
const MAPEOS_M1: Mapeo[] = [
  ruta('folio_cliente', 'DatosAdicionales.NoEmbarque'),
  ruta('origen_nombre', 'S_NombreRemitente'),
  ruta('origen_rfc', 'S_RfcRemitente'),
  ruta('origen_cp', 'S_CpRemitente'),
  ruta('origen_domicilio', 'S_ResidenciaFiscal'),
  ruta('destino_nombre', 'S_NombreDestino'),
  ruta('destino_rfc', 'S_RfcDestino'),
  ruta('destino_cp', 'S_CpDestino'),
  ruta('destino_pais', 'S_PaisDestino'),
  ruta('descripcion', 'Mercancias[*].S_Descripcion', true),
  ruta('bienes_transp', 'Mercancias[*].S_ClaveProdServ', true),
  ruta('cantidad', 'Mercancias[*].S_Cantidad', true),
  ruta('clave_unidad', 'Mercancias[*].S_ClaveUnidad', true),
  ruta('peso_kg', 'Mercancias[*].S_PesoKg', true),
];

describe('JSON: rutas', () => {
  const arbol = { A: { b: 'x', n: 5, t: true, v: '', obj: {} }, L: [{ k: 1 }, { k: 2 }, { k: 3 }], U: [{ k: 'solo' }] };
  it('punto o diagonal; números y booleanos salen como texto; vacío y objetos son null', () => {
    expect(valorDeRutaJson(arbol, 'A.b')).toBe('x');
    expect(valorDeRutaJson(arbol, 'A/b')).toBe('x');
    expect(valorDeRutaJson(arbol, 'A.n')).toBe('5');
    expect(valorDeRutaJson(arbol, 'A.t')).toBe('true');
    expect(valorDeRutaJson(arbol, 'A.v')).toBeNull();
    expect(valorDeRutaJson(arbol, 'A.obj')).toBeNull();
    expect(valorDeRutaJson(arbol, 'A.noexiste')).toBeNull();
  });
  it('arreglos: sin índice = el primero; [n] = ese; [*] = el primero con valor', () => {
    expect(valorDeRutaJson(arbol, 'L.k')).toBe('1');
    expect(valorDeRutaJson(arbol, 'L[2].k')).toBe('3');
    expect(valorDeRutaJson(arbol, 'L[9].k')).toBeNull();
    expect(valorDeRutaJson(arbol, 'L[*].k')).toBe('1');
  });
  it('claves prohibidas, rutas absurdas y claves heredadas no se siguen', () => {
    expect(tramosJson('a.__proto__.x')).toBeNull();
    expect(tramosJson('constructor.name')).toBeNull();
    expect(tramosJson(Array(13).fill('a').join('.'))).toBeNull();
    expect(tramosJson('a[x]')).toBeNull();
    expect(valorDeRutaJson({ a: 1 }, 'toString')).toBeNull();
    expect(valorDeRutaJson({ a: 'b' }, 'a.length')).toBeNull();
  });
  it('la estructura de un JSON no incluye valores y marca los arreglos', () => {
    expect(estructuraDeJson(arbol)).toEqual(expect.arrayContaining(['A', 'A.b', 'L[*]', 'L[*].k']));
    expect(estructuraDeJson(arbol).join(' ')).not.toContain('solo');
  });
});

describe('JSON: perfil por ruta, sin modelo', () => {
  it('un JSON con la forma del cliente se resuelve por ruta: origen perfil, 0.97, cero llamadas al modelo', async () => {
    const c = await contenido(jsonM1({ destino: true }));
    expect(c.formato).toBe('json');
    const p = perfilCon(c, MAPEOS_M1);
    const llm = llmFalso(() => { throw new Error('no debería llamarse al modelo'); });
    const r = await extraerDocumento(c, { llm, perfiles: [p] });
    expect(llm.llamadas).toHaveLength(0);
    expect(r.origen).toBe('perfil');
    expect(r.nivel).toBe(0);
    expect(r.costoUsd).toBe(0);
    expect(r.perfilId).toBe('p');
    const e = r.extraccion;
    expect(e.campos.folio_cliente).toMatchObject({ valor: '700123', origen: 'perfil', confianza: 0.97 });
    expect(e.campos.origen_domicilio.valor).toBe('Calle Ficticia 100, Parque Industrial Ejemplo');
    expect(e.campos.destino_cp.valor).toBe('64000');
    expect(e.mercancias).toHaveLength(2);
    expect(e.mercancias.map((m) => m.cantidad.valor)).toEqual(['46', '18']);
    expect(e.mercancias.map((m) => m.peso_kg.valor)).toEqual(['8810', '4146']);
    const piezas = e.mercancias.reduce((s, m) => s + Number(m.cantidad.valor), 0);
    const kg = e.mercancias.reduce((s, m) => s + Number(m.peso_kg.valor), 0);
    expect([piezas, kg]).toEqual([64, 12956]);
    for (const m of e.mercancias) for (const v of Object.values(m)) expect(v.origen).toBe('perfil');
    expect(e.campos.origen_rfc.evidencia).toBe(`S_RfcRemitente = ${RFC.atlas}`);
  });

  it('el mismo formato con otros datos puntúa alto; otra estructura o otro formato, bajo', async () => {
    const c = await contenido(jsonM1({ destino: true }));
    const p = perfilCon(c, MAPEOS_M1);
    const otro = await contenido(jsonM1({ destino: true, mercancias: [{ S_Descripcion: 'Otra', S_ClaveProdServ: '24112100', S_Cantidad: 1, S_ClaveUnidad: 'H87', S_PesoKg: 10 }] }));
    expect(puntuarPerfil(p, otro)).toBeGreaterThanOrEqual(UMBRAL_COINCIDENCIA);
    const ajeno = await contenido(new TextEncoder().encode(JSON.stringify({ viaje: { id: 1 }, paradas: [{ lugar: 'x' }] })));
    expect(puntuarPerfil(p, ajeno)).toBeLessThan(UMBRAL_COINCIDENCIA);
    expect(puntuarPerfil(p, await contenido(Buffer.from(xmlPropio())))).toBe(0);
    expect(elegirPerfil([p], otro).perfil?.id).toBe('p');
    expect(elegirPerfil([p], ajeno).perfil).toBeNull();
  });

  it('destino vacío: el perfil no lo inventa, avisa la ruta vacía y la validación BLOQUEA', async () => {
    const c = await contenido(jsonM1());
    const p = perfilCon(c, MAPEOS_M1);
    const r = aplicarPerfil(p, c);
    expect(r.extraccion.campos.destino_pais).toBeUndefined();
    expect(r.extraccion.campos.destino_cp).toBeUndefined();
    expect(r.avisos.join(' ')).toMatch(/«S_PaisDestino» \(destino_pais\) no existe o viene vacía/);
    expect(r.extraccion.mercancias).toHaveLength(2);
    const v = validarExtraccion(r.extraccion);
    expect(v.listoParaAprobar).toBe(false);
    const bloqueos = v.hallazgos.filter((h) => h.severidad === 'bloqueo').map((h) => `${h.campo}:${h.codigo}`);
    expect(bloqueos).toEqual(expect.arrayContaining(['destino_rfc:critico_ausente', 'destino_cp:critico_ausente']));
  });

  it('destino vacío en el pipeline: el modelo solo completa lo que falta y el bloqueo sigue si no lo trae', async () => {
    const c = await contenido(jsonM1());
    const p = perfilCon(c, MAPEOS_M1);
    const llm = llmFalso(() => salida(1, {}));
    const r = await extraerDocumento(c, { llm, perfiles: [p], nivelMaximo: 1 });
    expect(llm.llamadas).toHaveLength(1);
    expect(llm.llamadas[0].formato).toBe('json');
    expect(r.origen).toBe('perfil+llm');
    expect(r.extraccion.campos.origen_rfc.origen).toBe('perfil');
    expect(r.extraccion.campos.destino_cp).toBeUndefined();
    expect(validarExtraccion(r.extraccion).hallazgos.some((h) => h.campo === 'destino_cp' && h.severidad === 'bloqueo')).toBe(true);
  });

  it('un perfil sin la ruta (el cliente cambió su JSON) avisa en vez de fallar', async () => {
    const c = await contenido(jsonM1({ destino: true }));
    const p = perfilCon(c, [ruta('folio_cliente', 'DatosAdicionales.NoEmbarque'), ruta('origen_cp', 'S_CodigoPostalNuevo'), ruta('peso_kg', 'Mercancias[*].PesoNuevo', true)]);
    const r = aplicarPerfil(p, c);
    expect(r.extraccion.campos.folio_cliente.valor).toBe('700123');
    expect(r.avisos.join(' ')).toMatch(/S_CodigoPostalNuevo/);
    expect(r.avisos.join(' ')).toMatch(/Mercancias\[\*\]\.PesoNuevo/);
  });
});

describe('JSON: sin perfil va al modelo como texto estructurado', () => {
  it('el modelo recibe formato json y el texto re-serializado; su confianza y su origen son los del modelo', async () => {
    const c = await contenido(jsonM1({ destino: true }));
    const llm = llmFalso(() => salida(1, { folio_cliente: ['700123', 0.9, '"NoEmbarque": "700123"'] }, [{ descripcion: ['Estructura metálica tipo A', 0.9, '"S_Descripcion": "Estructura metálica tipo A"'] }]));
    const r = await extraerDocumento(c, { llm, perfiles: [], nivelMaximo: 1 });
    expect(llm.llamadas).toHaveLength(1);
    expect(llm.llamadas[0].formato).toBe('json');
    expect(llm.llamadas[0].texto).toContain('"NoEmbarque": "700123"');
    expect(r.origen).toBe('llm');
    expect(r.extraccion.campos.folio_cliente).toMatchObject({ valor: '700123', origen: 'llm', confianza: 0.9 });
  });

  it('un JSON de cliente con una clave «CartaPorte» NO se toma por un CFDI con 0.99: sigue por perfil/modelo', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ CartaPorte: { Ubicaciones: { Ubicacion: [{ CodigoPostal: '66000' }] }, Mercancias: { Mercancia: [{ Descripcion: 'Algo' }] } }, Referencia: 'ZZ-1' }));
    const c = await contenido(bytes);
    const llm = llmFalso(() => salida(1, {}));
    const r = await extraerDocumento(c, { llm, perfiles: [], nivelMaximo: 1 });
    expect(llm.llamadas).toHaveLength(1);
    expect(r.origen).toBe('llm');
  });
});
