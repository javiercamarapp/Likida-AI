import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./repo', async () => (await import('./repo_falso.fixture')).api);
const bitacora = vi.hoisted(() => ({ anotarBitacora: vi.fn(async (_entrada: unknown, _opciones?: unknown) => true) }));
vi.mock('../bitacora_escritura', () => bitacora);
vi.mock('../carta_porte_datos', async (orig) => ({ ...(await orig<typeof import('../carta_porte_datos')>()), getBorradorViaje: async () => null }));

import { estado, reset } from './repo_falso.fixture';
import { A, ACTOR, lecturaAtlas, sembrarFlotas, subirYProcesar } from './escenario.fixture';
import { aprobarDocumento, corregirCampos, rechazarDocumento } from './bandeja';
import { EMBARQUE_ATLAS, excelAtlas, extraccionAtlasOk, filaAtlas, cv } from './documentos_sinteticos.fixture';
import { llmFalso } from './llm_falso.fixture';
import { revisionDe } from './presentacion';
import { validarExtraccion } from './validacion';
import { UMBRAL_BAJA_CONFIANZA, lineasDelOriginal, marcaDeFila, resumenDeMarcas } from './revision_formato';
import type { DocumentoFila } from './repo';

beforeEach(() => { reset(); sembrarFlotas(); bitacora.anotarBitacora.mockClear(); });

const tipos = (id: string) => estado.eventos.filter((e) => e.documentoId === id).map((e) => e.tipo);
const excel = (folio: string) => excelAtlas([filaAtlas({ ...EMBARQUE_ATLAS, folio })]);

async function aprobarPrimero(folio: string) {
  const r = await subirYProcesar(A, excel(folio), llmFalso((e) => lecturaAtlas(e.nivel, folio)), `${folio}.xlsx`, { clienteId: 'cli-boreal' });
  const d = () => estado.docs.get(r.documentoId)!;
  const confirmar = d().validacion!.hallazgos.filter((h) => h.severidad === 'confirmar').map((h) => ({
    campo: h.campo, renglon: h.renglon, valor: (h.renglon === null ? d().extraccion!.campos[h.campo] : d().extraccion!.mercancias[h.renglon][h.campo]).valor, confirmar: true,
  }));
  if (confirmar.length > 0) await corregirCampos(A, r.documentoId, d().version, confirmar, ACTOR.id);
  await aprobarDocumento(A, r.documentoId, d().version, ACTOR);
  estado.viajes.forEach((v) => { v.estatus = 'liquidado'; });
  return [...estado.perfiles.values()][0];
}

describe('marcas de revisión (qué se resalta)', () => {
  it('un valor del catálogo o calculado es INFERIDO; uno leído del documento no', () => {
    expect(marcaDeFila({ origen: 'catalogo', confianza: 0.95, valor: '000777' })).toMatchObject({ inferido: true, bajaConfianza: false });
    expect(marcaDeFila({ origen: 'derivado', confianza: 0.95, valor: '8400' }).inferido).toBe(true);
    for (const o of ['xml', 'perfil', 'llm', 'humano'] as const) expect(marcaDeFila({ origen: o, confianza: 0.95, valor: 'x' }).inferido, o).toBe(false);
  });

  it('un inferido nunca se rotula como leído: su aviso dice que el documento no lo trae', () => {
    const m = marcaDeFila({ origen: 'catalogo', confianza: 1, valor: '000777' });
    expect(m.avisos.join(' ')).toMatch(/el documento no lo trae/);
    expect(m.avisos.join(' ')).toMatch(/catálogo del cliente/);
  });

  it('poco seguro = valor presente con confianza bajo el umbral; sin valor no se resalta', () => {
    expect(marcaDeFila({ origen: 'llm', confianza: UMBRAL_BAJA_CONFIANZA - 0.01, valor: 'x' }).bajaConfianza).toBe(true);
    expect(marcaDeFila({ origen: 'llm', confianza: UMBRAL_BAJA_CONFIANZA, valor: 'x' }).bajaConfianza).toBe(false);
    expect(marcaDeFila({ origen: null, confianza: null, valor: '' })).toEqual({ inferido: false, bajaConfianza: false, avisos: [] });
    expect(marcaDeFila({ origen: 'llm', confianza: 0.2, valor: '  ' }).bajaConfianza).toBe(false);
  });

  const doc = (): Pick<DocumentoFila, 'extraccion' | 'validacion'> => {
    const e = extraccionAtlasOk();
    e.campos.origen_cp = { ...cv('44100', 0.6), evidencia: 'CP Origen: 44100' };
    e.campos.unidad_placas = cv('ABC1234', 0.95, 'catalogo');
    return { extraccion: e, validacion: validarExtraccion(e) };
  };

  it('el resumen cuenta inferidos y poco seguros sobre toda la revisión', () => {
    expect(resumenDeMarcas(revisionDe(doc())!)).toEqual({ inferidos: 1, pocoSeguros: 1 });
  });

  it('en el documento original se resalta la línea del valor poco seguro, no la de uno seguro ni la de un inferido', () => {
    const texto = ['Folio | ATL-20481', 'CP Origen: 44100', 'Placas: ABC1234'].join('\n');
    const { lineas, recortado } = lineasDelOriginal(texto, revisionDe(doc()));
    expect(recortado).toBe(false);
    expect(lineas.map((l) => l.resaltada)).toEqual([false, true, false]);
  });

  it('sin revisión no se resalta nada y un texto enorme se recorta', () => {
    const grande = Array.from({ length: 700 }, (_, i) => `línea ${i}`).join('\n');
    const r = lineasDelOriginal(grande, null);
    expect(r.recortado).toBe(true);
    expect(r.lineas).toHaveLength(600);
    expect(r.lineas.some((l) => l.resaltada)).toBe(false);
  });
});

describe('aprendizaje del formato aprobado (de punta a punta)', () => {
  it('corregir un campo INFERIDO y aprobar crea el perfil v2; la v1 queda intacta', async () => {
    const perfil = await aprobarPrimero('ATL-1');
    // El perfil v1 no conoce la columna de placas (simula un formato recién visto): el campo llega inferido del catálogo, mal.
    const v1 = estado.versiones.find((v) => v.perfilId === perfil.id && v.version === 1)!;
    v1.mapeos = (v1.mapeos as Array<{ campo: string }>).filter((m) => m.campo !== 'unidad_placas');
    const r = await subirYProcesar(A, excel('ATL-2'), llmFalso((e) => lecturaAtlas(e.nivel, 'ATL-2')), 'ATL-2.xlsx');
    const d = () => estado.docs.get(r.documentoId)!;
    d().extraccion!.campos.unidad_placas = { valor: 'ZZZ0000', confianza: 0.7, evidencia: null, origen: 'catalogo' };
    expect(marcaDeFila({ origen: 'catalogo', confianza: 0.7, valor: 'ZZZ0000' })).toMatchObject({ inferido: true, bajaConfianza: true });

    const confirmar = d().validacion!.hallazgos.filter((h) => h.severidad === 'confirmar' && h.campo !== 'unidad_placas').map((h) => ({
      campo: h.campo, renglon: h.renglon, valor: (h.renglon === null ? d().extraccion!.campos[h.campo] : d().extraccion!.mercancias[h.renglon][h.campo]).valor, confirmar: true,
    }));
    await corregirCampos(A, r.documentoId, d().version, [{ campo: 'unidad_placas', renglon: null, valor: 'ABC1234' }, ...confirmar], ACTOR.id);
    expect(d().extraccion!.campos.unidad_placas).toMatchObject({ valor: 'ABC1234', origen: 'humano' });
    const ap = await aprobarDocumento(A, r.documentoId, d().version, ACTOR);

    expect(ap.perfil).toMatchObject({ accion: 'nueva_version', version: 2 });
    expect(ap.perfil.cambios?.join(' ')).toMatch(/unidad_placas/);
    expect(estado.versiones.filter((v) => v.perfilId === perfil.id).map((v) => v.version)).toEqual([1, 2]);
    expect((estado.versiones.find((v) => v.version === 1)!.mapeos as Array<{ campo: string }>).some((m) => m.campo === 'unidad_placas')).toBe(false);
    expect((estado.versiones.find((v) => v.version === 2)!.mapeos as Array<{ campo: string }>).some((m) => m.campo === 'unidad_placas')).toBe(true);
    expect(tipos(r.documentoId)).toContain('perfil_aprendido');
  });

  it('el siguiente documento del mismo formato sale SIN llamar al modelo y con la columna aprendida', async () => {
    const perfil = await aprobarPrimero('ATL-1');
    const v1 = estado.versiones.find((v) => v.perfilId === perfil.id && v.version === 1)!;
    v1.mapeos = (v1.mapeos as Array<{ campo: string }>).filter((m) => m.campo !== 'unidad_placas');
    const r = await subirYProcesar(A, excel('ATL-2'), llmFalso((e) => lecturaAtlas(e.nivel, 'ATL-2')), 'ATL-2.xlsx');
    const d = () => estado.docs.get(r.documentoId)!;
    const confirmar = d().validacion!.hallazgos.filter((h) => h.severidad === 'confirmar').map((h) => ({
      campo: h.campo, renglon: h.renglon, valor: (h.renglon === null ? d().extraccion!.campos[h.campo] : d().extraccion!.mercancias[h.renglon][h.campo]).valor, confirmar: true,
    }));
    await corregirCampos(A, r.documentoId, d().version, [{ campo: 'unidad_placas', renglon: null, valor: 'ABC1234' }, ...confirmar], ACTOR.id);
    await aprobarDocumento(A, r.documentoId, d().version, ACTOR);
    estado.viajes.forEach((v) => { v.estatus = 'liquidado'; });

    const sinModelo = llmFalso(() => { throw new Error('el perfil v2 debía bastar'); });
    const sig = await subirYProcesar(A, excel('ATL-3'), sinModelo, 'ATL-3.xlsx');
    expect(sig.proceso).toMatchObject({ ok: true, origen: 'perfil', nivel: 0, costoUsd: 0 });
    expect(sinModelo.llamadas).toHaveLength(0);
    const d3 = estado.docs.get(sig.documentoId)!;
    expect(d3.perfilVersion).toBe(2);
    expect(d3.extraccion!.campos.unidad_placas).toMatchObject({ valor: 'ABC1234', origen: 'perfil' });
  });

  it('un RECHAZO no crea perfil ni versión nueva', async () => {
    // Sin perfil previo: el rechazo no crea ninguno.
    const r = await subirYProcesar(A, excel('ATL-7'), llmFalso((e) => lecturaAtlas(e.nivel, 'ATL-7')), 'ATL-7.xlsx', { clienteId: 'cli-boreal' });
    await rechazarDocumento(A, r.documentoId, estado.docs.get(r.documentoId)!.version, 'No es un embarque nuestro', ACTOR.id);
    expect(estado.docs.get(r.documentoId)!.estado).toBe('rechazado');
    expect(estado.perfiles.size).toBe(0);
    expect(estado.versiones).toHaveLength(0);
    expect(tipos(r.documentoId)).not.toContain('perfil_aprendido');

    // Con perfil previo: tampoco suma versión.
    const perfil = await aprobarPrimero('ATL-8');
    const antes = estado.versiones.filter((v) => v.perfilId === perfil.id).length;
    const r2 = await subirYProcesar(A, excel('ATL-9'), llmFalso((e) => lecturaAtlas(e.nivel, 'ATL-9')), 'ATL-9.xlsx');
    await rechazarDocumento(A, r2.documentoId, estado.docs.get(r2.documentoId)!.version, 'Duplicado', ACTOR.id);
    expect(estado.versiones.filter((v) => v.perfilId === perfil.id)).toHaveLength(antes);
    expect(perfil.versionActiva).toBe(1);
    expect(tipos(r2.documentoId)).not.toContain('perfil_aprendido');
  });
});
