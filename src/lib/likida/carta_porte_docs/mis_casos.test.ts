import { describe, expect, it } from 'vitest';
import { casoDe, medicionDeRevisor, misCasos } from './mis_casos';
import { validarExtraccion } from './validacion';
import { cv, extraccionAtlasOk } from './documentos_sinteticos.fixture';
import type { DocumentoFila } from './repo';

const YO = 'u-yo';
const OTRA = 'u-otra';
const AHORA = new Date('2026-10-03T16:00:00.000Z');

const doc = (over: Partial<DocumentoFila> = {}, ext = extraccionAtlasOk()): DocumentoFila => ({
  id: 'd1', tenantId: 't', canal: 'correo', formato: 'excel', nombreArchivo: 'plan.xlsx', mime: null, bytes: 1, sha256: 'a'.repeat(64), storageRuta: 'x', estado: 'por_revisar', version: 1,
  clienteId: 'c1', perfilId: null, perfilVersion: null, remitente: null, asunto: null, remitenteReconocido: true, textoExtracto: null, riesgoInyeccion: false,
  extraccion: { ...ext, meta: { origen: 'llm', nivel: 2, escalamientos: [], avisos: [], notasModelo: [], indiciosInyeccion: [] } }, validacion: validarExtraccion(ext),
  confianzaMin: 0.9, nivelModelo: 2, modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0, viajeId: null, procesandoHasta: null, intentos: 1, ultimoError: null, abiertoEn: null,
  revisadoPor: null, aprobadoPor: null, aprobadoEn: null, rechazoMotivo: null, tiempoRevisionSeg: null, exportadoEn: null, retenerHasta: '', purgadoEn: null,
  createdAt: '2026-10-01T16:00:00.000Z', updatedAt: '', ...over,
});

describe('casoDe: estado por campo', () => {
  it('un documento limpio no trae problemas y cuenta sus campos con valor como ✔', () => {
    const c = casoDe(doc({}, extraccionAtlasOk('llm', 0.99)), AHORA);
    expect(c.conLectura).toBe(true);
    expect(c.ok).toBeGreaterThan(0);
    expect(c.bloqueados).toBe(0);
  });

  it('un dato crítico que el documento no trae es ✗ con su porqué, y va primero', () => {
    const e = extraccionAtlasOk();
    e.campos.origen_cp = cv(null, 0, 'llm');
    const c = casoDe(doc({}, e), AHORA);
    expect(c.bloqueados).toBeGreaterThan(0);
    const p = c.problemas[0];
    expect(p.marca).toBe('✗');
    expect(p.motivo.length).toBeGreaterThan(0);
  });

  it('un valor poco seguro es ◐ y lo dice', () => {
    const e = extraccionAtlasOk();
    e.campos.operador_nombre = cv('Operador Ejemplo', 0.4, 'llm');
    const c = casoDe(doc({}, e), AHORA);
    const p = c.problemas.find((x) => x.marca === '◐');
    expect(p).toBeDefined();
    expect(p?.motivo).toMatch(/Poco seguro|confirm/i);
  });

  it('una discrepancia entre fuentes se marca como conflicto', () => {
    const base = doc();
    const v = base.validacion!;
    const conflicto = { ...v, bloqueos: v.bloqueos + 1, hallazgos: [...v.hallazgos, { campo: 'documento', renglon: null, severidad: 'bloqueo' as const, codigo: 'fuentes_en_conflicto', mensaje: 'El peso no coincide entre el correo y el libro.' }] };
    const c = casoDe({ ...base, validacion: conflicto }, AHORA);
    expect(c.problemas.some((p) => p.conflicto && p.marca === '✗' && /peso/.test(p.motivo))).toBe(true);
  });

  it('sin lectura no hay campos que contar (no se inventa un ✔)', () => {
    const c = casoDe(doc({ extraccion: null, validacion: null }), AHORA);
    expect(c).toMatchObject({ conLectura: false, ok: 0, porConfirmar: 0, bloqueados: 0, problemas: [] });
  });

  it('la antigüedad sale del reloj que se le pasa; una fecha inválida no se inventa', () => {
    expect(casoDe(doc(), AHORA).antiguedadHoras).toBe(48);
    expect(casoDe(doc({ createdAt: 'no-es-fecha' }), AHORA).antiguedadHoras).toBeNull();
  });
});

describe('misCasos', () => {
  const filas = [
    doc({ id: 'nuevo', createdAt: '2026-10-03T10:00:00.000Z' }), doc({ id: 'viejo', createdAt: '2026-10-01T10:00:00.000Z' }),
    doc({ id: 'ajeno' }), doc({ id: 'sin-asignar' }), doc({ id: 'aprobado-mio', estado: 'aprobado' }),
  ];
  const asignados = { nuevo: YO, viejo: YO, ajeno: OTRA, 'aprobado-mio': YO };

  it('solo los por revisar asignados a la persona, el más antiguo primero', () => {
    expect(misCasos(filas, asignados, YO, AHORA).map((c) => c.id)).toEqual(['viejo', 'nuevo']);
  });
  it('lo sin asignar NO es suyo; sin casos, lista vacía', () => {
    expect(misCasos(filas, {}, YO, AHORA)).toEqual([]);
  });
});

describe('medicionDeRevisor', () => {
  const aprobado = (id: string, por: string | null, seg: number | null) => doc({ id, estado: 'aprobado', aprobadoPor: por, tiempoRevisionSeg: seg });

  it('sin aprobados suyos: nada es medible y dice qué falta (jamás ceros)', () => {
    const m = medicionDeRevisor([aprobado('a', OTRA, 60), doc({ id: 'p' })], new Map(), YO);
    expect(m.casosRevisados).toBeNull();
    expect(m.minutosPromedio).toBeNull();
    expect(m.camposCorregidos).toBeNull();
    expect(m.faltaCasos).toBe('aprobados_de_la_persona');
    expect(m.faltaTiempo).toBe('aprobados_de_la_persona');
    expect(m.faltaCorrecciones).toBe('aprobados_de_la_persona');
  });

  it('cuenta solo lo que aprobó la persona: tiempo medio sobre los medidos y correcciones de sus documentos', () => {
    const filas = [aprobado('a', YO, 120), aprobado('b', YO, 240), aprobado('c', OTRA, 6000), aprobado('d', YO, null)];
    const m = medicionDeRevisor(filas, new Map([['a', 2], ['b', 0], ['c', 9], ['d', 1]]), YO);
    expect(m.casosRevisados).toBe(3);
    expect(m.minutosPromedio).toBe(3);
    expect(m.conTiempoMedido).toBe(2);
    expect(m.camposCorregidos).toBe(3);
    expect(m.faltaTiempo).toBeNull();
  });

  it('aprobados sin marca de apertura: los casos se cuentan, el tiempo NO es medible', () => {
    const m = medicionDeRevisor([aprobado('a', YO, null)], new Map(), YO);
    expect(m.casosRevisados).toBe(1);
    expect(m.minutosPromedio).toBeNull();
    expect(m.faltaTiempo).toBe('marca_de_apertura');
    expect(m.camposCorregidos).toBe(0);
  });

  it('si las correcciones no se pudieron leer, no se pinta un 0', () => {
    const m = medicionDeRevisor([aprobado('a', YO, 60)], null, YO);
    expect(m.camposCorregidos).toBeNull();
    expect(m.faltaCorrecciones).toBe('correcciones_del_periodo');
  });
});
