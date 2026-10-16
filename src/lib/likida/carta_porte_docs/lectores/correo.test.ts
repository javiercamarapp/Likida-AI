// T-A3-61 — Lectores F1, F2 y F3 (correo/captura en texto) → extracción común. Todo con texto SINTÉTICO con la forma real.
import { describe, expect, it } from 'vitest';
import type { Extraccion } from '../campos';
import { detectarFormato, prepararContenido, type ContenidoDoc } from '../contenido';
import { extraerDocumento } from '../extractor';
import { llmFalso, salida } from '../llm_falso.fixture';
import { clasificarFormato } from '../registro_formatos';
import { validarExtraccion } from '../validacion';
import { capturaPng, emlDeCorreo, textoF1, textoF2, textoF3, transcriptorFalso } from '../correo_formatos.fixture';
import { leerCorreoF1 } from './correo_f1';
import { leerCorreoF2 } from './correo_f2';
import { leerCorreoF3 } from './correo_f3';

const correo = (texto: string): ContenidoDoc => ({ formato: 'correo', texto, imagenes: [], tabla: null, xml: null, avisos: [] });
const v = (e: Extraccion, k: string, i = 0): string | null => e.mercancias[i]?.[k]?.valor ?? null;
const d = (e: Extraccion, k: string): string | null => e.campos[k]?.valor ?? null;

async function desdeBytes(bytes: Uint8Array): Promise<ContenidoDoc> {
  const det = detectarFormato(bytes);
  if (!det.ok) throw new Error(det.motivo);
  return prepararContenido(bytes, det.clase);
}

describe('F1 — tabla «DATOS DE LA MERCANCÍA» (dos columnas)', () => {
  const r = leerCorreoF1(correo(textoF1()));
  it('lee cada rótulo a su campo, con el peso bruto por encima del «peso por embalaje»', () => {
    expect(r).toMatchObject({ formato: 'F1', leido: true, capturaIncompleta: null });
    const e = r.extraccion;
    expect(e.mercancias).toHaveLength(1);
    expect(v(e, 'peso_kg')).toBe('12000.5');
    expect(v(e, 'peso_tipo')).toBe('bruto');
    expect(v(e, 'descripcion')).toBe('RESINA SINTETICA DE PRUEBA');
    expect(v(e, 'bienes_transp')).toBe('13111999'); // «Clave unidad de producto SAT» es la clave del PRODUCTO
    expect(v(e, 'embalaje')).toBe('4G');
    expect(v(e, 'cantidad')).toBe('20');
    expect(v(e, 'peso_unidad')).toBe('KGM');
    expect(v(e, 'fraccion_arancelaria')).toBe('3907' + '999900');
    expect(v(e, 'pedimento')).toMatch(/26.?24.?1234.?1234567/);
  });
  it('el rótulo engañoso queda anotado y el peso neto no se pierde (va a adicionales)', () => {
    expect(r.extraccion.mercancias[0].bienes_transp.notas?.join(' ')).toMatch(/engaña.*PRODUCTO/);
    expect(r.adicionales.peso_neto).toBe('11800.000');
    expect(r.avisos.join(' ')).toMatch(/peso neto y no se usó/);
  });
  it('la caja sale del asunto (TRL) y del título de la tabla; si coinciden, más seguro y siempre «confírmala»', () => {
    const c = r.extraccion.campos.caja_numero;
    expect(c).toMatchObject({ valor: '90001', origen: 'derivado' });
    expect(c.confianza).toBe(0.7);
    expect(c.notas?.join(' ')).toMatch(/confírmala/);
  });
  it('deja vacío lo que el correo no trae (régimen, tipo de materia, cliente interno, distancia)', () => {
    expect(v(r.extraccion, 'regimen_aduanero')).toBeNull();
    expect(v(r.extraccion, 'tipo_materia')).toBeNull();
    expect(r.vacios).toEqual(expect.arrayContaining(['regimen_aduanero', 'numero_cliente_interno', 'distancia_km']));
  });
  it('la interfaz (asunto y botón) no se lee como dato', () => {
    expect(r.avisos.join(' ')).toMatch(/Se ignoró la interfaz del correo/);
    expect(Object.values(r.extraccion.campos).every((c) => !/resumir/i.test(c.valor ?? ''))).toBe(true);
  });
  it('un texto que no es la tabla no se toma por F1', () => {
    expect(leerCorreoF1(correo('Buen día, adjunto la remisión.\nCantidad: 10')).leido).toBe(false);
  });
});

describe('F2 — bloque «Datos para CP:»', () => {
  const r = leerCorreoF2(correo(textoF2()));
  it('lee domicilio de origen, carga sin rótulo y rótulos con dos puntos', () => {
    expect(r).toMatchObject({ formato: 'F2', leido: true, capturaIncompleta: null });
    const e = r.extraccion;
    expect(d(e, 'origen_nombre')).toBe('Manufacturas Ficticias del Bajío, S.A. de C.V.');
    expect(d(e, 'origen_rfc')).toMatch(/^BOR|^GBO/);
    expect(d(e, 'origen_cp')).toBe('45200');
    expect(d(e, 'origen_estado')).toBe('JAL');
    expect(d(e, 'origen_domicilio')).toMatch(/PARQUE INDUSTRIAL DE PRUEBA.*Calle Inventada # 31.*Zapopan/);
    expect(v(e, 'cantidad')).toBe('194');
    expect(v(e, 'unidad_texto')?.toLowerCase()).toBe('piezas');
    expect(v(e, 'peso_kg')).toBe('7185.07');
    expect(v(e, 'peso_unidad')).toBe('KGM');
    expect(v(e, 'clave_unidad')).toBe('H87');
    expect(v(e, 'bienes_transp')).toBe('56111999');
    expect(v(e, 'descripcion')).toBe('Muebles de prueba');
    expect(v(e, 'fraccion_arancelaria')).toBe('9403' + '609900');
  });
  it('tipo de materia, régimen y documento; el tipo de documento queda en adicionales y NO se inventa un pedimento', () => {
    expect(v(r.extraccion, 'tipo_materia')).toBe('03'); // la clave SAT es de 2 dígitos
    expect(v(r.extraccion, 'regimen_aduanero')).toBe('EXD');
    expect(r.adicionales.tipo_documento).toBe('1 Pedimento');
    expect(v(r.extraccion, 'pedimento')).toBeNull();
  });
  it('el peso sin rótulo no dice si es bruto o neto: se anota para confirmar', () => {
    expect(r.extraccion.mercancias[0].peso_kg.notas?.join(' ')).toMatch(/bruto o neto/);
  });
  it('un correo con «Datos para CP:» sin carga no lee mercancía', () => {
    expect(leerCorreoF2(correo('Datos para CP:\nSaludos')).leido).toBe(false);
  });
});

describe('F3 — bloque de rótulos con el valor en la línea de abajo', () => {
  const r = leerCorreoF3(correo(textoF3()));
  it('lee el domicilio, el contacto, el teléfono, la caja y cada rótulo', () => {
    expect(r).toMatchObject({ formato: 'F3', leido: true, capturaIncompleta: null });
    const e = r.extraccion;
    expect(d(e, 'destino_nombre')).toBe('COMERCIALIZADORA DE PRUEBA SA DE CV');
    expect(d(e, 'destino_cp')).toBe('59000');
    expect(d(e, 'destino_estado')).toBe('MIC');
    expect(d(e, 'destino_domicilio')).toMatch(/CALLE FICTICIA 100.*COLONIA IMAGINARIA/);
    expect(d(e, 'contacto_destino_telefono')).toBe('5555555555');
    expect(d(e, 'contacto_destino_nombre')).toBe('SR. PERSONA INVENTADA');
    expect(d(e, 'caja_numero')).toBe('90077');
    expect(v(e, 'descripcion')).toBe('HERRAMIENTAS');
    expect(v(e, 'bienes_transp')).toBe('27111999');
    expect(v(e, 'peso_kg')).toBe('11385.75');
    expect(v(e, 'fraccion_arancelaria')).toBe('8205' + '599900');
  });
  it('«(20) CAJA» no es una clave: la cantidad es la del rótulo CANTIDAD y la unidad queda como texto', () => {
    const e = r.extraccion;
    expect(v(e, 'cantidad')).toBe('1175');
    expect(v(e, 'clave_unidad')).not.toBe('20');
    expect(v(e, 'embalaje_descripcion')).toBe('CARTONES');
  });
  it('CORTADA en «FRACCIÓN ARANCELARIA» sin valor: captura_incompleta con su incidencia y sin fracción inventada', () => {
    const c = leerCorreoF3(correo(textoF3(true)));
    expect(c.capturaIncompleta).toEqual({ ultimoRotulo: 'FRACCIÓN ARANCELARIA' });
    expect(c.incidencias.some((i) => i.codigo === 'captura_incompleta')).toBe(true);
    expect(v(c.extraccion, 'fraccion_arancelaria')).toBeNull();
    expect(v(c.extraccion, 'peso_kg')).toBe('11385.75'); // lo que sí venía se conserva
  });
  it('un correo sin domicilio ni rótulos no se toma por F3', () => {
    expect(leerCorreoF3(correo('Buen día, equipo.\nGracias.')).leido).toBe(false);
  });
});

describe('el reconocimiento por firma elige la variante', () => {
  it.each([['F1', textoF1()], ['F2', textoF2()], ['F3', textoF3()], ['F3', textoF3(true)]] as const)('%s', (f, t) => {
    expect(clasificarFormato({ contenido: correo(t) }).formato).toBe(f);
  });
});

describe('integración con el extractor (correo en texto y capturas PNG sintéticas)', () => {
  const llmNoDebeLlamarse = llmFalso((e) => salida(e.nivel, {}, []));

  it('F1 y F2 como texto: el lector llena la extracción sin llamar al modelo y deja su rastro', async () => {
    for (const [f, t] of [['F1', textoF1()], ['F2', textoF2()]] as const) {
      const r = await extraerDocumento(correo(t), { llm: llmFalso((e) => salida(e.nivel, {}, [])), nivelMaximo: 1 });
      expect(r.lector?.formato).toBe(f);
      expect(r.capturaIncompleta).toBeNull();
      expect(r.extraccion.mercancias[0].bienes_transp.valor).toMatch(/^\d{8}$/);
    }
  });

  it('las tres capturas PNG (820×409, 763×420, 337×526): F1 y F2 leen, F3 cortada devuelve captura_incompleta', async () => {
    const visión = transcriptorFalso();
    const casos = [
      { f: 'F1', texto: textoF1(), w: 820, h: 409 },
      { f: 'F2', texto: textoF2(), w: 763, h: 420 },
      { f: 'F3', texto: textoF3(true), w: 337, h: 526 },
    ] as const;
    const salidas: Record<string, Awaited<ReturnType<typeof extraerDocumento>>> = {};
    for (const k of casos) {
      const c = await desdeBytes(await capturaPng(k.texto, k.w, k.h));
      expect(c.formato).toBe('imagen');
      expect(c.resolucion).toEqual({ ancho: k.w, alto: k.h });
      visión.registrar(c.imagenes[0], k.texto);
      salidas[k.f] = await extraerDocumento(c, { llm: llmNoDebeLlamarse, nivelMaximo: 1, transcribir: visión.transcribir });
    }
    expect(visión.llamadas).toBe(3);
    expect(salidas.F1.lector?.formato).toBe('F1');
    expect(salidas.F1.extraccion.mercancias[0].peso_kg.valor).toBe('12000.5');
    expect(salidas.F1.extraccion.mercancias[0].peso_kg.origen).toBe('llm'); // leído de una captura transcrita: no se disfraza de lectura de texto
    expect(salidas.F1.capturaIncompleta).toBeNull();
    expect(salidas.F2.lector?.formato).toBe('F2');
    expect(salidas.F2.extraccion.campos.origen_cp.valor).toBe('45200');
    expect(salidas.F2.capturaIncompleta).toBeNull();
    expect(salidas.F3.lector?.formato).toBe('F3');
    expect(salidas.F3.capturaIncompleta).toEqual({ ultimoRotulo: 'FRACCIÓN ARANCELARIA' });
    // 337×526 = 177 mil píxeles: baja resolución, confianza baja en todo lo leído (obliga a confirmar).
    expect(salidas.F3.lector?.incidencias.some((i) => i.codigo === 'baja_resolucion')).toBe(true);
    expect(salidas.F3.extraccion.mercancias[0].peso_kg.confianza).toBeLessThanOrEqual(0.55);
    // 820×409 y 763×420 NO son de baja resolución.
    expect(salidas.F1.lector?.incidencias.some((i) => i.codigo === 'baja_resolucion')).toBe(false);
  });

  it('la captura cortada BLOQUEA al validar (y la completa no)', async () => {
    const cortada = await extraerDocumento(correo(textoF3(true)), { llm: llmNoDebeLlamarse, nivelMaximo: 1 });
    const v1 = validarExtraccion(cortada.extraccion, { capturaIncompleta: cortada.capturaIncompleta });
    expect(v1.hallazgos.find((h) => h.codigo === 'captura_incompleta')).toMatchObject({ severidad: 'bloqueo' });
    const completa = await extraerDocumento(correo(textoF3()), { llm: llmNoDebeLlamarse, nivelMaximo: 1 });
    expect(validarExtraccion(completa.extraccion, { capturaIncompleta: completa.capturaIncompleta }).hallazgos.some((h) => h.codigo === 'captura_incompleta')).toBe(false);
  });

  it('una imagen sin puerto de transcripción no inventa nada: sigue el camino de siempre', async () => {
    const c = await desdeBytes(await capturaPng(textoF1(), 820, 409));
    const r = await extraerDocumento(c, { llm: llmNoDebeLlamarse, nivelMaximo: 1 });
    expect(r.lector).toBeUndefined();
    expect(r.capturaIncompleta).toBeNull();
  });

  it('el .eml se lee igual que el texto pegado', async () => {
    const c = await desdeBytes(Buffer.from(emlDeCorreo(textoF2())));
    expect(c.formato).toBe('correo');
    const r = await extraerDocumento(c, { llm: llmNoDebeLlamarse, nivelMaximo: 1 });
    expect(r.lector?.formato).toBe('F2');
    expect(r.extraccion.campos.origen_estado.valor).toBe('JAL');
  });
});
