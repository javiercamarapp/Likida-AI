// T-A3-46 — campos aduaneros: régimen, pedimento, tipo de materia, RFC del importador, clave de material peligroso y caja.
// Todo sintético: la forma de cada fuente (correo en texto, orden de remisión, BOL con Notes), nunca un dato real.
import { describe, expect, it } from 'vitest';
import { campoDoc, campoMercancia } from './campos';
import { detectarFormato, prepararContenido, type ContenidoDoc } from './contenido';
import { completarDerivados, metadatosNombreArchivo } from './derivar';
import { extraerDocumento } from './extractor';
import { normalizarClavePeligroso, normalizarPedimento, normalizarRegimen, normalizarValor } from './normalizar';
import { RFC, cv } from './documentos_sinteticos.fixture';
import { llmFalso, salida, type Fila } from './llm_falso.fixture';

async function contenido(texto: string): Promise<ContenidoDoc> {
  const bytes = Buffer.from(texto);
  const d = detectarFormato(bytes);
  if (!d.ok) throw new Error(d.motivo);
  return prepararContenido(bytes, d.clase);
}

const PED = '26 47 1234 5670001'; // sintético
const BASE_DOC: Fila = { folio_cliente: ['IM-100', 0.97, 'Folio: IM-100'] };
const mercancia = (extra: Fila): Fila => ({
  descripcion: ['Piezas de plastico', 0.97, 'Mercancia: Piezas de plastico'],
  bienes_transp: ['24121500', 0.97, 'clave 24121500'],
  cantidad: ['10', 0.97, 'Cantidad: 10'],
  clave_unidad: ['H87', 0.97, 'Unidad: H87'],
  peso_kg: ['100', 0.97, 'Peso: 100'],
  ...extra,
});

describe('T-A3-46: los campos aduaneros ya se le piden al modelo', () => {
  it('ninguno es solo de enriquecimiento y rfc_importador existe', () => {
    for (const k of ['pedimento', 'regimen_aduanero', 'tipo_materia', 'clave_material_peligroso', 'rfc_importador']) {
      expect(campoMercancia(k), k).toBeDefined();
      expect(campoMercancia(k)?.soloEnriquecimiento, k).toBeFalsy();
    }
    expect(campoDoc('caja_numero')?.soloEnriquecimiento).toBeFalsy();
    expect(campoMercancia('rfc_importador')?.tipo).toBe('rfc');
  });
});

describe('normalizar pedimento', () => {
  it.each([
    ['26 47 1234 5670001', PED],
    ['26474-1234-5670001'.replace('26474', '2647'), PED],
    ['264712345670001', PED],
    ['26-47-1234-5670001', PED],
  ])('%s → 15 dígitos con espacios', (crudo, esperado) => {
    expect(normalizarPedimento(crudo).valor).toBe(esperado);
  });
  it('ya correcto: sin nota ni penalización', () => {
    const r = normalizarPedimento(PED);
    expect(r.notas).toEqual([]);
    expect(r.penalizacion).toBe(0);
  });
  it('patente-consecutivo queda incompleto, con aviso', () => {
    const r = normalizarPedimento('1234-5670001');
    expect(r.valor).toBe('1234-5670001');
    expect(r.notas.join(' ')).toMatch(/faltan el año y la aduana/);
    expect(r.penalizacion).toBeGreaterThan(0);
  });
  it('largo raro o letras: se conserva y se avisa, no se adivina', () => {
    expect(normalizarPedimento('26 47 1234').notas.join(' ')).toMatch(/debería traer 15/);
    expect(normalizarPedimento('PENDIENTE').notas.join(' ')).toMatch(/forma de pedimento/);
  });
  it('por normalizarValor, con el campo real', () => {
    expect(normalizarValor(campoMercancia('pedimento')!, '264712345670001').valor).toBe(PED);
  });
});

describe('normalizar régimen y clave de peligroso', () => {
  it('régimen: clave en mayúsculas; nombre inequívoco → clave; lo demás igual', () => {
    expect(normalizarRegimen('imd').valor).toBe('IMD');
    expect(normalizarRegimen('Importación definitiva').valor).toBe('IMD');
    expect(normalizarRegimen('EXPORTACION DEFINITIVA').valor).toBe('EXD');
    expect(normalizarRegimen('Importación temporal').valor).toBe('IMPORTACIÓN TEMPORAL'); // ambiguo (ITR/ITE): no se traduce
  });
  it('clave ONU: UN 1203 / 1203 / 203 → 4 dígitos; N/A intacto', () => {
    expect(normalizarClavePeligroso('UN 1203').valor).toBe('1203');
    expect(normalizarClavePeligroso('1203').notas).toEqual([]);
    expect(normalizarClavePeligroso('203').valor).toBe('0203');
    expect(normalizarClavePeligroso('N/A').valor).toBe('N/A');
  });
  it('tipo de materia numérico sigue completándose a 2', () => {
    expect(normalizarValor(campoMercancia('tipo_materia')!, 5).valor).toBe('05');
  });
  it('RFC del importador se normaliza como RFC', () => {
    expect(normalizarValor(campoMercancia('rfc_importador')!, ` ${RFC.atlas.toLowerCase()} `).valor).toBe(RFC.atlas);
  });
});

describe('correo en texto con rótulos aduaneros', () => {
  const correo = [
    'Buen día, el embarque de importación:',
    'Folio: IM-100',
    'Mercancia: Piezas de plastico',
    'Régimen aduanero: Importación definitiva',
    'Tipo de materia: 05',
    `Pedimento: ${PED}`,
    `RFC importador: ${RFC.atlas}`,
    'Clave material peligroso: UN 1203',
    'Caja: TX-4471',
  ].join('\n');

  it('cada campo sale normalizado, con su evidencia y confianza', async () => {
    const llm = llmFalso((e) => salida(e.nivel, {
      ...BASE_DOC, caja_numero: ['TX-4471', 0.96, 'Caja: TX-4471'],
    }, [mercancia({
      regimen_aduanero: ['Importación definitiva', 0.96, 'Régimen aduanero: Importación definitiva'],
      tipo_materia: ['05', 0.96, 'Tipo de materia: 05'],
      pedimento: [PED, 0.96, `Pedimento: ${PED}`],
      rfc_importador: [RFC.atlas, 0.96, `RFC importador: ${RFC.atlas}`],
      material_peligroso: ['si', 0.9, 'Clave material peligroso: UN 1203'],
      clave_material_peligroso: ['UN 1203', 0.96, 'Clave material peligroso: UN 1203'],
    })]));
    const r = await extraerDocumento(await contenido(correo), { llm, nivelMaximo: 1 });
    const f = r.extraccion.mercancias[0];
    expect(f.regimen_aduanero).toMatchObject({ valor: 'IMD' });
    expect(f.tipo_materia).toMatchObject({ valor: '05' });
    expect(f.pedimento).toMatchObject({ valor: PED });
    expect(f.rfc_importador).toMatchObject({ valor: RFC.atlas });
    expect(f.clave_material_peligroso).toMatchObject({ valor: '1203' });
    expect(r.extraccion.campos.caja_numero).toMatchObject({ valor: 'TX-4471' });
    for (const k of ['regimen_aduanero', 'tipo_materia', 'pedimento', 'rfc_importador', 'clave_material_peligroso']) {
      expect(f[k].evidencia, k).toBeTruthy();
      expect(f[k].confianza, k).toBeGreaterThanOrEqual(0.85);
      expect(f[k].origen, k).toBe('llm');
    }
  });

  it('el prompt le pide los campos aduaneros al modelo', async () => {
    const llm = llmFalso((e) => salida(e.nivel, {}, [mercancia({})]));
    await extraerDocumento(await contenido(correo), { llm, nivelMaximo: 1 });
    expect(llm.llamadas).toHaveLength(1);
  });
});

describe('orden de remisión con patente-consecutivo', () => {
  const orden = ['ORDEN DE REMISION', 'Folio: IM-100', 'Mercancia: Piezas de plastico', 'Pedimento: 1234-5670001'].join('\n');
  const guion = () => llmFalso((e) => salida(e.nivel, BASE_DOC, [mercancia({ pedimento: ['1234-5670001', 0.96, 'Pedimento: 1234-5670001'] })]));

  it('con año y aduana del perfil se completa, con aviso de confirmar y confianza topada', async () => {
    const r = await extraerDocumento(await contenido(orden), { llm: guion(), nivelMaximo: 1, pedimentoPerfil: { anio: '26', aduana: '47' } });
    const p = r.extraccion.mercancias[0].pedimento;
    expect(p.valor).toBe(PED);
    expect(p.origen).toBe('derivado');
    expect(p.confianza).toBeLessThanOrEqual(0.7);
    expect(p.notas?.join(' ')).toMatch(/Se completó el año \(26\) y la aduana \(47\).*confírmalos/);
  });

  it('sin perfil queda incompleto y avisado: no se inventan año ni aduana', async () => {
    const r = await extraerDocumento(await contenido(orden), { llm: guion(), nivelMaximo: 1 });
    const p = r.extraccion.mercancias[0].pedimento;
    expect(p.valor).toBe('1234-5670001');
    expect(p.notas?.join(' ')).toMatch(/faltan el año y la aduana/);
  });

  it('un año o aduana del perfil mal formados se ignoran', async () => {
    const r = await extraerDocumento(await contenido(orden), { llm: guion(), nivelMaximo: 1, pedimentoPerfil: { anio: '2026', aduana: 'NL' } });
    expect(r.extraccion.mercancias[0].pedimento.valor).toBe('1234-5670001');
  });

  it('es idempotente: completar dos veces no cambia el resultado', async () => {
    const r = await extraerDocumento(await contenido(orden), { llm: guion(), nivelMaximo: 1, pedimentoPerfil: { anio: '26', aduana: '47' } });
    const antes = JSON.stringify(r.extraccion);
    completarDerivados(r.extraccion, { pedimentoPerfil: { anio: '26', aduana: '47' } });
    completarDerivados(r.extraccion);
    expect(JSON.stringify(r.extraccion)).toBe(antes);
  });

  it('un pedimento corregido por una persona no se toca', () => {
    const e = { campos: {}, mercancias: [{ pedimento: cv('1234-5670001', 1, 'humano') }] };
    completarDerivados(e, { pedimentoPerfil: { anio: '26', aduana: '47' } });
    expect(e.mercancias[0].pedimento.valor).toBe('1234-5670001');
  });
});

describe('BOL en inglés con datos fiscales en Notes', () => {
  const bol = [
    'BILL OF LADING', 'Folio: IM-100', 'Mercancia: Piezas de plastico',
    `Notes: REGIMEN ADUANERO IMD / PEDIMENTO ${PED} / RFC IMPORTADOR ${RFC.atlas} / TIPO MATERIA 01`,
  ].join('\n');
  it('lee régimen, pedimento, RFC del importador y tipo de materia de las Notes', async () => {
    const ev = `Notes: REGIMEN ADUANERO IMD / PEDIMENTO ${PED} / RFC IMPORTADOR ${RFC.atlas} / TIPO MATERIA 01`;
    const llm = llmFalso((e) => salida(e.nivel, BASE_DOC, [mercancia({
      regimen_aduanero: ['IMD', 0.95, 'REGIMEN ADUANERO IMD'], pedimento: [PED, 0.95, `PEDIMENTO ${PED}`],
      rfc_importador: [RFC.atlas, 0.95, `RFC IMPORTADOR ${RFC.atlas}`], tipo_materia: ['01', 0.95, 'TIPO MATERIA 01'],
    })]));
    expect(ev).toContain(PED);
    const f = (await extraerDocumento(await contenido(bol), { llm, nivelMaximo: 1 })).extraccion.mercancias[0];
    expect(f).toMatchObject({ regimen_aduanero: { valor: 'IMD' }, pedimento: { valor: PED }, rfc_importador: { valor: RFC.atlas }, tipo_materia: { valor: '01' } });
  });
});

describe('exportación: el pedimento queda vacío', () => {
  const texto = ['Folio: EX-200', 'Mercancia: Piezas de plastico', 'Régimen aduanero: EXD', `Pedimento: ${PED}`, `RFC importador: ${RFC.atlas}`].join('\n');
  const guion = (conPed = true) => llmFalso((e) => salida(e.nivel, { folio_cliente: ['EX-200', 0.97, 'Folio: EX-200'] }, [mercancia({
    regimen_aduanero: ['EXD', 0.97, 'Régimen aduanero: EXD'],
    ...(conPed ? { pedimento: [PED, 0.97, `Pedimento: ${PED}`], rfc_importador: [RFC.atlas, 0.97, `RFC importador: ${RFC.atlas}`] } : {}),
  })]));

  it('aunque el texto lo mencione, pedimento y RFC del importador salen vacíos con la razón', async () => {
    const f = (await extraerDocumento(await contenido(texto), { llm: guion(), nivelMaximo: 1 })).extraccion.mercancias[0];
    expect(f.regimen_aduanero.valor).toBe('EXD');
    expect(f.pedimento.valor).toBeNull();
    expect(f.rfc_importador.valor).toBeNull();
    expect(f.pedimento.notas?.join(' ')).toMatch(/exportación/);
  });

  it('también cuando el régimen sale solo del nombre del archivo (EXPO)', async () => {
    const sinRegimen = llmFalso((e) => salida(e.nivel, BASE_DOC, [mercancia({ pedimento: [PED, 0.97, `Pedimento: ${PED}`] })]));
    const r = await extraerDocumento(await contenido(texto), { llm: sinRegimen, nivelMaximo: 1, nombreArchivo: 'CCP Transportes-Cliente EXPO TX4471 15-10-26.pdf' });
    const f = r.extraccion.mercancias[0];
    expect(f.regimen_aduanero).toMatchObject({ valor: 'EXD', origen: 'derivado' });
    expect(f.pedimento.valor).toBeNull();
  });

  it('exportación (EXD) con RFC del importador y SIN pedimento: el RFC también sale vacío', () => {
    const e = { campos: {}, mercancias: [{ regimen_aduanero: cv('EXD'), rfc_importador: cv(RFC.atlas) }] };
    completarDerivados(e);
    expect(e.mercancias[0].rfc_importador.valor).toBeNull();
    expect(e.mercancias[0].rfc_importador.notas?.join(' ')).toMatch(/exportación/);
  });

  it('importación con RFC del importador y sin pedimento conserva el RFC', () => {
    const e = { campos: {}, mercancias: [{ regimen_aduanero: cv('IMD'), rfc_importador: cv(RFC.atlas) }] };
    completarDerivados(e);
    expect(e.mercancias[0].rfc_importador.valor).toBe(RFC.atlas);
  });

  it('un pedimento puesto por una persona en exportación no se borra', () => {
    const e = { campos: {}, mercancias: [{ regimen_aduanero: cv('EXD'), pedimento: cv(PED, 1, 'humano') }] };
    completarDerivados(e);
    expect(e.mercancias[0].pedimento.valor).toBe(PED);
  });
});

describe('régimen y caja desde el nombre del archivo', () => {
  it.each([
    ['CCP Transportes-Cliente IMPO TX4471 15-10-26.pdf', 'importacion', 'TX4471'],
    ['CCP Transportes-Cliente EXPO 8812 15-10-26 (1).xlsx', 'exportacion', '8812'],
    ['CCPÂ Transportes-Cliente IMPO CAJA-77 01-10-26.pdf', 'importacion', 'CAJA-77'],
    ['CCP Transportes-Cliente IMPO 15-10-26.pdf', 'importacion', null],
    ['Embarque cualquiera.pdf', null, null],
    ['IMPORTE total.pdf', null, null],
  ])('%s', (nombre, operacion, caja) => {
    expect(metadatosNombreArchivo(nombre)).toEqual({ operacion, caja });
  });

  it('IMPO → IMD con confianza baja y aviso; sin nombre no se deduce nada', async () => {
    const llm = () => llmFalso((e) => salida(e.nivel, BASE_DOC, [mercancia({})]));
    const con = await extraerDocumento(await contenido('Folio: IM-100\nMercancia: Piezas'), { llm: llm(), nivelMaximo: 1, nombreArchivo: 'CCP A-B IMPO TX4471 15-10-26.pdf' });
    expect(con.extraccion.mercancias[0].regimen_aduanero).toMatchObject({ valor: 'IMD', origen: 'derivado' });
    expect(con.extraccion.mercancias[0].regimen_aduanero.confianza).toBeLessThanOrEqual(0.6);
    expect(con.extraccion.mercancias[0].regimen_aduanero.notas?.join(' ')).toMatch(/nombre del archivo/);
    expect(con.extraccion.campos.caja_numero).toMatchObject({ valor: 'TX4471', origen: 'derivado' });
    const sin = await extraerDocumento(await contenido('Folio: IM-100\nMercancia: Piezas'), { llm: llm(), nivelMaximo: 1 });
    expect(sin.extraccion.mercancias[0].regimen_aduanero).toBeUndefined();
    expect(sin.extraccion.campos.caja_numero).toBeUndefined();
  });

  it('lo que el documento dice gana sobre el nombre del archivo', async () => {
    const llm = llmFalso((e) => salida(e.nivel, { ...BASE_DOC, caja_numero: ['AB-1', 0.97, 'Caja: AB-1'] }, [mercancia({ regimen_aduanero: ['ITR', 0.97, 'Régimen: ITR'] })]));
    const r = await extraerDocumento(await contenido('Folio: IM-100\nCaja: AB-1\nRégimen: ITR\nMercancia: Piezas'), { llm, nivelMaximo: 1, nombreArchivo: 'CCP A-B IMPO TX4471 15-10-26.pdf' });
    expect(r.extraccion.mercancias[0].regimen_aduanero.valor).toBe('ITR');
    expect(r.extraccion.campos.caja_numero.valor).toBe('AB-1');
  });
});

describe('guardias: el modelo falso no inventa', () => {
  it('sin pedimento en la salida del modelo no aparece pedimento (ni con perfil)', async () => {
    const llm = llmFalso((e) => salida(e.nivel, BASE_DOC, [mercancia({})]));
    const r = await extraerDocumento(await contenido('Folio: IM-100\nMercancia: Piezas'), { llm, nivelMaximo: 1, pedimentoPerfil: { anio: '26', aduana: '47' } });
    expect(r.extraccion.mercancias[0].pedimento).toBeUndefined();
  });

  it('un pedimento que el documento no contiene pierde confianza y se avisa', async () => {
    const llm = llmFalso((e) => salida(e.nivel, BASE_DOC, [mercancia({ pedimento: [PED, 0.99, `Pedimento: ${PED}`] })]));
    const r = await extraerDocumento(await contenido('Folio: IM-100\nMercancia: Piezas\nPedimento: pendiente'), { llm, nivelMaximo: 1 });
    const p = r.extraccion.mercancias[0].pedimento;
    expect(p.confianza).toBeLessThanOrEqual(0.5);
    expect(p.notas?.join(' ')).toMatch(/no aparece en el texto/);
  });

  it('ningún texto de nota, aviso ni evidencia imprime un pedimento de otro renglón', async () => {
    const llm = llmFalso((e) => salida(e.nivel, BASE_DOC, [mercancia({ pedimento: ['1234-5670001', 0.96, 'Pedimento: 1234-5670001'] })]));
    const r = await extraerDocumento(await contenido('Folio: IM-100\nMercancia: Piezas\nPedimento: 1234-5670001'), { llm, nivelMaximo: 1, pedimentoPerfil: { anio: '26', aduana: '47' } });
    expect(r.avisos.join(' ')).not.toMatch(/\d{4}-\d{7}|\d{2} \d{2} \d{4} \d{7}/);
  });
});
