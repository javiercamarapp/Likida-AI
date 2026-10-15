import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { CampoValor, Extraccion } from './campos';
import { esContenidoPlantillaTms } from './perfiles';
import { aXlsxPlantillaTms } from './exportacion';
import { prepararContenido, MAX_HOJAS, hojasDeDatos } from './contenido';
import { esLibroPlantillaNueva, leerPlantillaTms } from './lector_plantilla_tms';
import { construirPlantilla } from './plantilla_tms';
import { llmFalso } from './llm_falso.fixture';
import { plantillaNormalRealEnBlanco, plantillaNormalRealLlena, VALORES_LLENA } from './evaluacion/plantilla_normal_real.fixture';

const cv = (valor: string | null): CampoValor => ({ valor, confianza: 0.95, evidencia: null, origen: 'llm' });
const conv = (o: Record<string, string | null>): Record<string, CampoValor> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, cv(v)]));

/** Extracción sintética con la forma de la plantilla (nada real). */
function extraccion(n: number, doc: Record<string, string | null> = {}, merc: (i: number) => Record<string, string | null> = () => ({})): Extraccion {
  const campos: Record<string, string | null> = {
    folio_cliente: 'REF-SINT-001', distancia_km: '874,11 km',
    origen_nombre: 'Embarcador Sintetico SA', origen_rfc: 'AAA010101AAA', origen_calle: 'Calle Uno', origen_num_ext: '10', origen_num_int: '2', // grep-limpio:ok
    origen_colonia_clave: '0001', origen_colonia: 'Colonia Uno', origen_cp: '44100', origen_localidad_clave: '01', origen_localidad: 'Localidad Uno',
    origen_municipio_clave: '039', origen_municipio: 'Municipio Uno', origen_estado: 'JAL', origen_pais: 'MEX',
    destino_nombre: 'Destino Sintetico LLC', destino_rfc: '58-7654321', destino_calle: 'Street Two', destino_num_ext: '20', // grep-limpio:ok
    destino_colonia: 'Zona Dos', destino_cp: '78040', destino_localidad: 'Ciudad Dos', destino_municipio: 'Condado Dos', destino_estado: 'NLE', destino_pais: 'USA',
    contacto_destino_nombre: 'Contacto Prueba', contacto_destino_telefono: '5550000000', contacto_destino_correo: 'contacto@example.test', // grep-limpio:ok
    numero_cliente_interno: '000123', caja_numero: 'CAJA-SINT-01', regimen_aduanero: null,
    ...doc,
  };
  const mercancias = Array.from({ length: n }, (_, i) => conv({
    bienes_transp: '43211500', descripcion: `Mercancia sintetica ${i + 1}`, cantidad: String(10 + i), clave_unidad: 'H87', unidad_descripcion: 'Pieza',
    embalaje: i % 2 ? '4G' : null, embalaje_descripcion: i % 2 ? 'Caja de carton' : null, peso_kg: `${1000 + i}.5`, fraccion_arancelaria: '8471500100', // grep-limpio:ok
    tipo_materia: '05', regimen_aduanero: 'EXD', pedimento: null, material_peligroso: i % 3 === 2 ? 'true' : 'false', clave_material_peligroso: i % 3 === 2 ? '1203' : null,
    rfc_importador: null, ...merc(i),
  }));
  return { campos: conv(campos), mercancias };
}

const ctx = { clienteInterno: null, plantilla: 'normal' as const, reglasGuia: false as const };

function idaYVuelta(ext: Extraccion, dist: 'texto_km' | 'numero' = 'texto_km') {
  const c = { ...ctx, distanciaFormato: dist };
  const original = construirPlantilla(ext, c);
  const lectura = leerPlantillaTms(aXlsxPlantillaTms(original, plantillaNormalRealEnBlanco()));
  expect(lectura).not.toBeNull();
  const releida = construirPlantilla(lectura!.extraccion, c);
  return { original, releida, lectura: lectura! };
}

describe('leerPlantillaTms: ida y vuelta con construirPlantilla', () => {
  for (const n of [1, 2, 14]) {
    it(`${n} mercancía(s): releer lo exportado da la misma plantilla celda a celda`, () => {
      const { original, releida, lectura } = idaYVuelta(extraccion(n));
      expect(releida.hojas).toEqual(original.hojas);
      expect(releida.faltantes).toEqual(original.faltantes);
      expect(lectura.extraccion.mercancias).toHaveLength(n);
      expect(lectura.llamadasLlm).toBe(0);
    });
  }

  it('importación con pedimento y peligroso; exportación sin pedimento', () => {
    const impo = idaYVuelta(extraccion(2, { regimen_aduanero: null }, () => ({ regimen_aduanero: 'IMD', pedimento: '24 16 3456 4000123' }))); // grep-limpio:ok
    expect(impo.releida.hojas).toEqual(impo.original.hojas);
    expect(impo.lectura.extraccion.campos.regimen_aduanero.valor).toBe('IMD');
    expect(impo.lectura.extraccion.mercancias[0].pedimento.valor).toBe('24 16 3456 4000123'); // grep-limpio:ok
    const expo = idaYVuelta(extraccion(2));
    expect(expo.lectura.extraccion.campos.regimen_aduanero.valor).toBe('EXD');
    expect(expo.lectura.extraccion.mercancias.every((m) => m.pedimento === undefined)).toBe(true);
  });

  it('material peligroso y su clave sobreviven; «N/A» no se vuelve dato', () => {
    const { lectura } = idaYVuelta(extraccion(3));
    const [a, , c] = lectura.extraccion.mercancias;
    expect(a.material_peligroso.valor).toBe('false');
    expect(a.clave_material_peligroso).toBeUndefined();
    expect(c.material_peligroso.valor).toBe('true');
    expect(c.clave_material_peligroso.valor).toBe('1203');
  });

  it('tres destinos: cada mercancía conserva su id de destino', () => {
    const doc = {
      destino_2_nombre: 'Destino Dos SA', destino_2_cp: '44200', destino_2_estado: 'JAL', destino_2_pais: 'MEX', destino_2_distancia_km: '120,5 km', // grep-limpio:ok
      destino_3_nombre: 'Destino Tres SA', destino_3_cp: '64000', destino_3_estado: 'NLE', destino_3_pais: 'MEX', // grep-limpio:ok
    };
    const ext = extraccion(3, doc, (i) => ({ id_destino: String(i + 1) }));
    const { original, releida, lectura } = idaYVuelta(ext);
    expect(releida.hojas).toEqual(original.hojas);
    expect(lectura.extraccion.campos.destino_3_nombre.valor).toBe('Destino Tres SA');
    expect(lectura.extraccion.mercancias.map((m) => m.id_destino.valor)).toEqual(['1', '2', '3']);
  });

  it('distancia como número también da la misma plantilla', () => {
    const { original, releida } = idaYVuelta(extraccion(1), 'numero');
    expect(releida.hojas).toEqual(original.hojas);
  });
});

describe('leerPlantillaTms: el formato de entrada A (plantilla ya llena)', () => {
  const lectura = leerPlantillaTms(plantillaNormalRealLlena())!;

  it('lee las celdas fijas y el remitente', () => {
    const c = lectura.extraccion.campos;
    expect(c.regimen_aduanero.valor).toBe('EXD');
    expect(c.folio_cliente.valor).toBe('REF-SINT-001');
    expect(c.numero_cliente_interno.valor).toBe('000123');
    expect(c.caja_numero.valor).toBe('CAJA-SINT-01');
    expect(c.origen_nombre.valor).toBe('Embarcador Sintetico SA');
    expect(c.origen_cp.valor).toBe('44100');
    expect(c.origen_estado.valor).toBe('JAL');
    expect(c.origen_pais.valor).toBe('MEX');
  });

  it('lee el destino de la fila 50 y las dos mercancías de las filas 22 y 23', () => {
    const c = lectura.extraccion.campos;
    expect(c.destino_nombre.valor).toBe('Destino Sintetico LLC');
    expect(c.destino_rfc.valor).toBe('58-7654321'); // Tax ID extranjero: conserva el guion
    expect(c.destino_estado.valor).toBe('NLE');
    expect(c.distancia_km.valor).toBe('874.11');
    expect(c.contacto_destino_correo.valor).toBe('contacto@example.test'); // grep-limpio:ok
    const [m1, m2] = lectura.extraccion.mercancias;
    expect(lectura.extraccion.mercancias).toHaveLength(2);
    expect(m1.descripcion.valor).toBe('Equipo de computo');
    expect(m1.peso_kg.valor).toBe('14130');
    expect(m1.pedimento.valor).toBe('24 16 3456 4000123'); // grep-limpio:ok
    expect(m2.peso_kg.valor).toBe('80.5');
    expect(m2.material_peligroso.valor).toBe('true');
    expect(m2.clave_material_peligroso.valor).toBe('1203');
  });

  it('origen de cada campo = perfil, con su coordenada como evidencia; 0 llamadas al LLM', () => {
    const modelo = llmFalso(() => { throw new Error('no debe llamarse'); });
    const todos = [...Object.values(lectura.extraccion.campos), ...lectura.extraccion.mercancias.flatMap((m) => Object.values(m))];
    expect(todos.length).toBeGreaterThan(30);
    for (const v of todos) { expect(v.origen).toBe('perfil'); expect(v.evidencia).toMatch(/^(RemintenteDestinatario|Mercancias)!/); }
    expect(lectura.extraccion.campos.numero_cliente_interno.evidencia).toBe('RemintenteDestinatario!B7');
    expect(lectura.llamadasLlm).toBe(0);
    expect(modelo.llamadas).toHaveLength(0);
  });

  it('ignora las hojas Error e Informacion Agente Aduanal (sus datos no entran)', () => {
    expect(lectura.hojasIgnoradas).toEqual(['Error', 'Informacion Agente Aduanal']);
    const texto = JSON.stringify(lectura.extraccion);
    expect(texto).not.toContain('Importacion definitiva');
  });

  it('tipos de celda mezclados: número o texto dan lo mismo', () => {
    const libro = XLSX.read(plantillaNormalRealLlena(), { type: 'array' });
    const rd = libro.Sheets.RemintenteDestinatario; const me = libro.Sheets.Mercancias;
    rd.C17 = { t: 'n', v: 1 }; // clave de colonia con el cero perdido
    rd.C20 = { t: 'n', v: 1 }; rd.C22 = { t: 'n', v: 39 }; rd.C19 = { t: 'n', v: 44100 };
    rd.A50 = { t: 's', v: '1' }; rd.B50 = { t: 's', v: '874,11 km' };
    me.D22 = { t: 's', v: '20' }; me.I22 = { t: 's', v: '14130' }; me.N22 = { t: 'n', v: 3 };
    const mezclado = leerPlantillaTms(new Uint8Array(XLSX.write(libro, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer))!;
    const c = mezclado.extraccion.campos;
    expect(c.origen_colonia_clave.valor).toBe('0001');
    expect(c.origen_localidad_clave.valor).toBe('01');
    expect(c.origen_municipio_clave.valor).toBe('039');
    expect(c.origen_cp.valor).toBe('44100');
    expect(c.distancia_km.valor).toBe('874.11');
    expect(mezclado.extraccion.mercancias[0].cantidad.valor).toBe('20');
    expect(mezclado.extraccion.mercancias[0].peso_kg.valor).toBe('14130');
    expect(mezclado.extraccion.mercancias[0].tipo_materia.valor).toBe('03');
    expect(mezclado.avisos.some((a) => a.includes('cero'))).toBe(true);
  });

  it('lee el RFC del importador (columna O), que el exportador aún no escribe', () => {
    const libro = XLSX.read(plantillaNormalRealLlena(), { type: 'array' });
    libro.Sheets.Mercancias.O22 = { t: 's', v: 'bbb020202bb2' }; // grep-limpio:ok
    const l = leerPlantillaTms(new Uint8Array(XLSX.write(libro, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer))!;
    expect(l.extraccion.mercancias[0].rfc_importador.valor).toBe('BBB020202BB2'); // grep-limpio:ok
    expect(l.extraccion.mercancias[1].rfc_importador).toBeUndefined();
  });

  it('encuentra las tablas por su encabezado real aunque no estén en la fila 21 ni 49', () => {
    const libro = XLSX.read(plantillaNormalRealLlena(), { type: 'array' });
    const me = libro.Sheets.Mercancias;
    // Mueve la tabla de mercancías 6 filas hacia abajo (encabezado en la 27).
    const movida: XLSX.WorkSheet = { '!ref': 'A1:O40' };
    for (const k of Object.keys(me)) {
      if (k.startsWith('!')) continue;
      const a = XLSX.utils.decode_cell(k);
      movida[XLSX.utils.encode_cell({ r: a.r >= 20 ? a.r + 6 : a.r, c: a.c })] = me[k];
    }
    libro.Sheets.Mercancias = movida;
    const l = leerPlantillaTms(new Uint8Array(XLSX.write(libro, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer))!;
    expect(l.extraccion.mercancias).toHaveLength(2);
    expect(l.extraccion.mercancias[0].descripcion.valor).toBe('Equipo de computo');
    expect(VALORES_LLENA.mercancias).toHaveLength(2);
  });
});

describe('leerPlantillaTms: lo que no es la plantilla cae al flujo actual', () => {
  const libroDe = (hojas: Record<string, string[][]>): Uint8Array => {
    const l = XLSX.utils.book_new();
    for (const [n, f] of Object.entries(hojas)) XLSX.utils.book_append_sheet(l, XLSX.utils.aoa_to_sheet(f), n);
    return new Uint8Array(XLSX.write(l, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
  };

  it('un libro cualquiera devuelve null, sin lanzar', () => {
    expect(leerPlantillaTms(libroDe({ Hoja1: [['Folio', 'Peso'], ['A1', '10']] }))).toBeNull();
  });
  it('bytes que no son un libro devuelven null', () => {
    expect(leerPlantillaTms(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
  it('hojas con los nombres de la plantilla pero sin sus encabezados devuelven null', () => {
    expect(leerPlantillaTms(libroDe({ RemintenteDestinatario: [['x']], Mercancias: [['y']] }))).toBeNull();
  });
  it('la plantilla en blanco se lee sin datos y lo avisa', () => {
    const l = leerPlantillaTms(plantillaNormalRealEnBlanco())!;
    expect(l.extraccion.mercancias).toHaveLength(0);
    expect(Object.keys(l.extraccion.campos)).toHaveLength(0);
    expect(l.avisos.some((a) => a.includes('no trae mercancías'))).toBe(true);
  });
  it('la plantilla «nueva» (Datos/Origenes/Destinos) se detecta y espera a T-A3-44', () => {
    expect(esLibroPlantillaNueva(['Datos', 'Origenes', 'Destinos', 'Mercancias', 'RemintenteDestinatario'])).toBe(true);
    expect(esLibroPlantillaNueva(['RemintenteDestinatario', 'Mercancias', 'Error'])).toBe(false);
  });
  it.todo('plantilla «nueva»: leer Origenes y Destinos (espera a T-A3-44)');
});

describe('libro de 5 hojas con la Guía de llenado', () => {
  const conGuia = (): Uint8Array => {
    const libro = XLSX.read(plantillaNormalRealLlena(), { type: 'array' });
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([['Guia de llenado'], ['Instruccion 1'], ['Instruccion 2']]), 'Guia de Llenado');
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([['Extra'], ['dato']]), 'Notas');
    return new Uint8Array(XLSX.write(libro, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
  };

  it('las hojas ignoradas no cuentan contra MAX_HOJAS ni se leen como datos', async () => {
    const c = await prepararContenido(conGuia(), 'excel');
    const nombres = (c.tabla ?? []).map((h) => h.nombre);
    expect(nombres).toEqual(['RemintenteDestinatario', 'Mercancias', 'Notas']);
    expect(c.avisos.some((a) => a.includes('se leyeron'))).toBe(false);
    expect(c.avisos.some((a) => a.includes('ignoraron'))).toBe(true);
    expect(esContenidoPlantillaTms(c)).toBe(true);
  });

  it('el lector las ignora todas (Error, Informacion Agente Aduanal y Guia)', () => {
    const l = leerPlantillaTms(conGuia())!;
    expect(l.hojasIgnoradas).toEqual(['Error', 'Informacion Agente Aduanal', 'Guia de Llenado']);
    expect(l.extraccion.mercancias).toHaveLength(2);
  });

  it('un libro que NO es la plantilla conserva el tope de hojas de siempre', () => {
    const nombres = ['A', 'B', 'C', 'D', 'E', 'F', 'Error'];
    expect(hojasDeDatos(nombres)).toEqual(nombres);
    expect(hojasDeDatos(nombres).length).toBeGreaterThan(MAX_HOJAS);
  });
});
