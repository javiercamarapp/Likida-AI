// T-A3-68 (e)(f)(h) y (a): la cascada por confianza compuesta, DENTRO del flujo real (extraerDocumento y procesarDocumento).
// Todo sintético: ningún valor es de un documento real y ningún modelo se llama.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./repo', async () => (await import('./repo_falso.fixture')).api);
vi.mock('../bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => true) }));

import { estado, reset } from './repo_falso.fixture';
import { A, sembrarFlotas, subir } from './escenario.fixture';
import { procesarDocumento } from './servicio';
import { sinAgenteApagado } from './escenario.fixture';
import type { ContenidoDoc } from './contenido';
import { extraerDocumento, type NivelModelo } from './extractor';
import { contadoresDeEscalamientos, reiniciarEscalamientos } from './contador_escalamientos';
import { ordenDeNiveles, leerOrden, tipoDeLectura } from './orden_niveles';
import { pdfBoreal, RFC } from './documentos_sinteticos.fixture';
import { lecturaBoreal, llmFalso, salida, type Fila } from './llm_falso.fixture';
import { validarExtraccion } from './validacion';
import { rfcChecksumOk } from '../intake/cfdi';

/** Un RFC de forma correcta cuyo dígito verificador NO cuadra. */
const rfcMalo = (): string => { const b = RFC.boreal.slice(0, 11); return b + Array.from({ length: 11 }, (_, i) => (i < 10 ? String(i) : 'A')).find((d) => !rfcChecksumOk(b + d))!; };

/** Una captura (visión: sin texto, así que nada se ancla y la confianza que declara el modelo llega entera). */
const captura = (): ContenidoDoc => ({ formato: 'imagen', texto: null, imagenes: ['data:image/png;base64,AAAA'], tabla: null, xml: null, avisos: [] });

/** Lo que lee un buen modelo de la captura sintética: todo válido, peso 8 400 kg con su rótulo de bruto. */
const campos = (extra: Fila = {}): Fila => ({
  folio_cliente: ['SIN-001', 0.99, null], origen_nombre: ['Remitente Sintetico SA de CV', 0.99, null], origen_rfc: [RFC.boreal, 0.99, null], origen_cp: ['66600', 0.99, null],
  origen_estado: ['NLE', 0.99, null], destino_nombre: ['Destinatario Sintetico SA de CV', 0.99, null], destino_rfc: [RFC.destino2, 0.99, null], destino_cp: ['06600', 0.99, null],
  destino_estado: ['CMX', 0.99, null], ...extra,
});
const merc = (extra: Fila = {}): Fila => ({
  descripcion: ['Mercancia sintetica', 0.99, null], bienes_transp: ['50202300', 0.99, null], cantidad: ['100', 0.99, null], clave_unidad: ['XBX', 0.99, null],
  peso_kg: ['8400', 0.99, 'Peso total bruto: 8400'], ...extra,
});
const lectura = (nivel: NivelModelo, c: Fila = {}, m: Fila = {}) => salida(nivel, campos(c), [merc(m)]);

beforeEach(() => { reset(); sembrarFlotas(); reiniciarEscalamientos(); });

describe('(e) un campo CRÍTICO que falla un validador ESCALA aunque el modelo diga 0.99', () => {
  it('CP de destino que no corresponde al estado: el nivel 1 dice 0.99, escala al 2 y el 2 lo deja bien (se registra el motivo)', async () => {
    const llm = llmFalso((e) => (e.nivel === 1 ? lectura(1, { destino_estado: ['NLE', 0.99, null] }) : lectura(e.nivel)));
    const r = await extraerDocumento(captura(), { llm, niveles: [1, 2, 3] });
    expect(llm.llamadas.map((l) => l.nivel)).toEqual([1, 2]);
    expect(r.escalamientos).toEqual([{ de: 1, a: 2, codigo: 'validador', motivo: expect.stringContaining('destino_cp (cp_estado)') }]);
    expect(r.extraccion.campos.destino_estado.valor).toBe('CMX');
    expect(r.revisionHumana).toEqual([]);
    expect(contadoresDeEscalamientos()['1>2:validador']).toBe(1);
  });

  it('RFC con dígito verificador imposible a 0.99: escala; sin validador (control) NO escalaría', async () => {
    const llm = llmFalso((e) => (e.nivel === 1 ? lectura(1, { origen_rfc: [rfcMalo(), 0.99, null] }) : lectura(e.nivel)));
    const r = await extraerDocumento(captura(), { llm, niveles: [1, 2, 3] });
    expect(r.escalamientos[0]).toMatchObject({ de: 1, a: 2, codigo: 'validador' });
    expect(r.extraccion.campos.origen_rfc.valor).toBe(RFC.boreal);
    // Control: la misma captura bien leída en el nivel 1 no escala.
    const bien = llmFalso((e) => lectura(e.nivel));
    expect((await extraerDocumento(captura(), { llm: bien, niveles: [1, 2, 3] })).escalamientos).toEqual([]);
    expect(bien.llamadas).toHaveLength(1);
  });

  it('el peso leído del rótulo «por embalaje» escala; el nivel 2 trae el bruto', async () => {
    const llm = llmFalso((e) => (e.nivel === 1 ? lectura(1, {}, { peso_kg: ['400', 0.99, 'Peso por embalaje: 400'] }) : lectura(e.nivel)));
    const r = await extraerDocumento(captura(), { llm, niveles: [1, 2, 3] });
    expect(r.escalamientos[0].motivo).toMatch(/peso_kg#0 \(peso_rotulo_no_bruto\)/);
    expect(r.extraccion.mercancias[0].peso_kg.valor).toBe('8400');
    expect(r.revisionHumana).toEqual([]);
  });

  it('(b) el total con punto de miles se resuelve contra la suma y NO escala', async () => {
    const llm = llmFalso((e) => salida(e.nivel, campos({ peso_bruto_total: ['14.029', 0.99, 'Total: 14.029'] }), [merc({ peso_kg: ['9000', 0.99, 'Peso total bruto: 9000'] }), merc({ peso_kg: ['5029', 0.99, 'Peso total bruto: 5029'] })]));
    const r = await extraerDocumento(captura(), { llm, niveles: [1, 2, 3] });
    expect(llm.llamadas).toHaveLength(1);
    expect(r.extraccion.campos.peso_bruto_total.valor).toBe('14029');
    expect(r.avisos.join(' ')).toMatch(/cuadra con la suma/);
  });

  it('ningún nivel cuadra: REVISIÓN HUMANA con los valores en conflicto, confianza ≤ 0.5 y NUNCA se aprueba solo', async () => {
    const llm = llmFalso((e) => lectura(e.nivel, { destino_estado: [e.nivel === 3 ? 'JAL' : 'NLE', 0.99, null] }));
    const r = await extraerDocumento(captura(), { llm, niveles: [1, 2, 3] });
    expect(llm.llamadas).toHaveLength(3);
    expect(r.escalamientos.map((x) => `${x.de}>${x.a}`)).toEqual(['1>2', '2>3']);
    const h = r.revisionHumana.find((x) => x.campo === 'destino_cp');
    expect(h).toBeTruthy();
    expect(h!.valores).toEqual(expect.arrayContaining(['06600', 'NLE']));
    expect(r.extraccion.campos.destino_cp.confianza).toBeLessThanOrEqual(0.5);
    expect(r.avisos.join(' ')).toMatch(/Revisión humana: .*Valores en conflicto/);
    expect(validarExtraccion(r.extraccion).listoParaAprobar).toBe(false);
  });

  it('dos niveles que coinciden en un valor que un validador rechaza NO lo salvan', async () => {
    const llm = llmFalso((e) => lectura(e.nivel, { origen_rfc: [rfcMalo(), 0.99, null] }));
    const r = await extraerDocumento(captura(), { llm, niveles: [1, 2, 3] });
    expect(r.extraccion.campos.origen_rfc.confianza).toBeLessThanOrEqual(0.5);
    expect(r.revisionHumana.map((x) => x.campo)).toContain('origen_rfc');
  });

  it('si el nivel 1 falla un validador y el 2 lo cumple pero DIFIERE, gana el que cumple (con tope 0.85 y nota)', async () => {
    const llm = llmFalso((e) => lectura(e.nivel, { origen_rfc: [e.nivel === 1 ? rfcMalo() : RFC.boreal, 0.99, null] }));
    const r = await extraerDocumento(captura(), { llm, niveles: [1, 2, 3] });
    const c = r.extraccion.campos.origen_rfc;
    expect(c.valor).toBe(RFC.boreal);
    expect(c.confianza).toBeLessThanOrEqual(0.85);
    expect(c.notas?.join(' ')).toMatch(/no pasaba un validador/);
    expect(r.revisionHumana).toEqual([]);
    expect(llm.llamadas).toHaveLength(2);
  });
});

describe('un nivel que falla no tumba el documento si hay otro nivel', () => {
  it('el nivel 1 entrega una salida inválida: se escala al 2 con motivo error_modelo (y se cuenta)', async () => {
    const llm = llmFalso((e) => { if (e.nivel === 1) throw new Error('Validación falló: salida truncada'); return lectura(e.nivel); });
    const r = await extraerDocumento(captura(), { llm, niveles: [1, 2, 3] });
    expect(r.escalamientos).toEqual([{ de: 1, a: 2, codigo: 'error_modelo', motivo: expect.stringContaining('Validación falló') }]);
    expect(r.nivel).toBe(2);
    expect(contadoresDeEscalamientos()['1>2:error_modelo']).toBe(1);
  });
  it('un error fatal (presupuesto agotado) o el fallo del ÚLTIMO nivel se relanzan', async () => {
    const fatal = llmFalso(() => { throw new Error('presupuesto'); });
    await expect(extraerDocumento(captura(), { llm: fatal, niveles: [1, 2], errorFatal: () => true })).rejects.toThrow('presupuesto');
    expect(fatal.llamadas).toHaveLength(1);
    const todos = llmFalso(() => { throw new Error('caído'); });
    await expect(extraerDocumento(captura(), { llm: todos, niveles: [1, 2] })).rejects.toThrow('caído');
    expect(todos.llamadas).toHaveLength(2);
  });
});

describe('(f) el orden de los niveles es configurable por tipo de documento', () => {
  it('niveles [2, 3] en el contexto: la primera llamada es al nivel 2 y el 1 no se usa', async () => {
    const llm = llmFalso((e) => lectura(e.nivel));
    await extraerDocumento(captura(), { llm, niveles: [2, 3] });
    expect(llm.llamadas.map((l) => l.nivel)).toEqual([2]);
  });
  it('nivelMaximo sigue siendo «cuántos niveles se recorren» (1 = nunca escalar)', async () => {
    const llm = llmFalso((e) => lectura(e.nivel, { origen_rfc: [rfcMalo(), 0.99, null] }));
    await extraerDocumento(captura(), { llm, niveles: [2, 3], nivelMaximo: 1 });
    expect(llm.llamadas.map((l) => l.nivel)).toEqual([2]);
  });
  it('por omisión sale del tipo (texto o visión) y se ajusta por variable de entorno, sin tocar el código', () => {
    expect(tipoDeLectura({ texto: null, imagenes: ['x'] })).toBe('vision');
    expect(tipoDeLectura({ texto: 'hola', imagenes: [] })).toBe('texto');
    expect(ordenDeNiveles('vision', { LIKIDA_CARTAPORTE_NIVELES_VISION: '2,3' })).toEqual([2, 3]);
    expect(ordenDeNiveles('texto', { LIKIDA_CARTAPORTE_NIVELES_TEXTO: '3' })).toEqual([3]);
  });
  it('una variable inválida (repetidos, niveles que no existen, vacío) se ignora y rige el orden por omisión', () => {
    for (const malo of ['2,2', '4', '1,x', '', ' ']) expect(leerOrden(malo)).toBeNull();
    expect(ordenDeNiveles('vision', { LIKIDA_CARTAPORTE_NIVELES_VISION: '9' })).toEqual(ordenDeNiveles('vision', {}));
  });
  it('sin ctx.niveles, el extractor usa el orden del tipo de documento (la variable de entorno llega al flujo real)', async () => {
    vi.stubEnv('LIKIDA_CARTAPORTE_NIVELES_VISION', '2,3');
    try {
      const llm = llmFalso((e) => lectura(e.nivel));
      await extraerDocumento(captura(), { llm });
      expect(llm.llamadas.map((l) => l.nivel)).toEqual([2]);
    } finally { vi.unstubAllEnvs(); }
  });
});

describe('integración: entra por el SERVICIO (procesarDocumento) y deja el rastro en la bitácora y en el meta', () => {
  it('escalamientos con motivo y código, revisión humana y caídas del modelo quedan guardados; el documento NO queda listo para aprobar', async () => {
    const llm = llmFalso((e) => ({
      ...lecturaBoreal(e.nivel),
      // La lectura de siempre, pero con el estado de destino mal en TODOS los niveles (el texto del PDF dice CDMX).
      campos: lecturaBoreal(e.nivel).campos.map((c) => (c.clave === 'destino_estado' ? { ...c, valor: 'NL', evidencia: 'Estado destino: CDMX' } : c)),
      ...(e.nivel === 1 ? { caidas: [{ tipo: 'modo_json' as const, rol: 'cartaporte_extractor', de: 'google/gemini-3.5-flash-lite', a: 'google/gemini-3.5-flash-lite', motivo: 'modelo_sin_esquema_estricto' as const }] } : {}),
    }));
    const r = await subir(A, await pdfBoreal(), 'boreal.pdf');
    const p = await procesarDocumento(A, r.documentoId, { ...sinAgenteApagado, llm: () => llm });
    expect(p).toMatchObject({ ok: true, listoParaAprobar: false });
    const d = estado.docs.get(r.documentoId)!;
    expect(d.extraccion?.meta?.escalamientos?.map((x) => x.codigo)).toEqual(['validador', 'validador']);
    expect(d.extraccion?.meta?.revisionHumana?.some((h) => h.campo === 'destino_cp' && h.valores.includes('NLE'))).toBe(true);
    expect(d.extraccion?.meta?.caidas).toEqual([expect.objectContaining({ tipo: 'modo_json', motivo: 'modelo_sin_esquema_estricto' })]);
    const escaladas = estado.eventos.filter((x) => x.documentoId === r.documentoId && x.tipo === 'escalada');
    expect(escaladas.map((x) => (x.detalle as { codigo: string }).codigo)).toEqual(['validador', 'validador']);
    expect(contadoresDeEscalamientos()['1>2:validador']).toBe(1);
  });
});
