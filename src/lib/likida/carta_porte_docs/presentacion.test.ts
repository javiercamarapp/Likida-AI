import { describe, expect, it } from 'vitest';
import { CAMPOS_DOC, CAMPOS_MERCANCIA } from './campos';
import { prioridadEstado, revisionDe } from './presentacion';
import { validarExtraccion } from './validacion';
import { cv, extraccionAtlasOk } from './documentos_sinteticos.fixture';

const doc = (e = extraccionAtlasOk()) => ({ extraccion: e, validacion: validarExtraccion(e) });

describe('revisionDe', () => {
  it('sin extracción no hay revisión', () => expect(revisionDe({ extraccion: null, validacion: null })).toBeNull());

  it('TODOS los campos del complemento aparecen, también los que el documento no trae', () => {
    const r = revisionDe(doc())!;
    const claves = r.grupos.flatMap((g) => g.filas.map((f) => f.clave));
    expect(claves.sort()).toEqual(CAMPOS_DOC.map((d) => d.clave).sort());
    expect(r.mercancias[0].filas.map((f) => f.clave)).toEqual(CAMPOS_MERCANCIA.map((d) => d.clave));
    const vacio = r.grupos.flatMap((g) => g.filas).find((f) => f.clave === 'operador_rfc')!;
    expect(vacio).toMatchObject({ valor: '', confianza: null, origen: null });
  });

  it('los nombres de la forma siguen el contrato c:/m:/k:', () => {
    const r = revisionDe(doc())!;
    const f = r.grupos.flatMap((g) => g.filas).find((x) => x.clave === 'origen_cp')!;
    expect(f).toMatchObject({ nombre: 'c:origen_cp', nombreConfirmar: 'k:c:origen_cp', renglon: null });
    expect(r.mercancias[0].filas[0]).toMatchObject({ nombre: 'm:0:descripcion', nombreConfirmar: 'k:m:0:descripcion', renglon: 0 });
  });

  it('siempre hay UNA fila vacía de mercancía nueva al final', () => {
    const r = revisionDe(doc())!;
    expect(r.mercancias).toHaveLength(2);
    expect(r.mercancias[1]).toMatchObject({ indice: 1, esNuevo: true });
    expect(r.mercancias[1].filas.every((f) => f.valor === '' && f.nombre.startsWith('m:1:'))).toBe(true);
  });

  it('los hallazgos cuelgan de su campo, y los «relacionados» también', () => {
    const e = extraccionAtlasOk(); e.campos.origen_estado = cv('NLE'); e.campos.origen_cp = cv('44100', 0.6);
    const r = revisionDe(doc(e))!;
    const todas = r.grupos.flatMap((g) => g.filas);
    const cp = todas.find((f) => f.clave === 'origen_cp')!;
    const estado = todas.find((f) => f.clave === 'origen_estado')!;
    expect(cp.hallazgos.map((h) => h.codigo).sort()).toEqual(['confianza_baja', 'cp_estado']);
    expect(estado.hallazgos.map((h) => h.codigo)).toEqual(['cp_estado']);
    expect(cp.porConfirmar).toBe(true);
    expect(r.listoParaAprobar).toBe(false);
    expect(r.porConfirmar).toBe(2);
  });

  it('un campo crítico ausente aparece bloqueado, con su mensaje', () => {
    const e = extraccionAtlasOk(); delete e.campos.destino_rfc;
    const f = revisionDe(doc(e))!.grupos.flatMap((g) => g.filas).find((x) => x.clave === 'destino_rfc')!;
    expect(f.bloqueado).toBe(true);
    expect(f.hallazgos[0].mensaje).toMatch(/no lo trae/);
  });

  it('los hallazgos de mercancía cuelgan del renglón correcto', () => {
    const e = extraccionAtlasOk(); e.mercancias.push({ ...e.mercancias[0], bienes_transp: cv('123') });
    const r = revisionDe(doc(e))!;
    expect(r.mercancias[0].filas.every((f) => !f.bloqueado)).toBe(true);
    expect(r.mercancias[1].filas.find((f) => f.clave === 'bienes_transp')!.bloqueado).toBe(true);
  });

  it('los hallazgos generales (documento) no cuelgan de ningún campo', () => {
    const e = extraccionAtlasOk();
    const r = revisionDe({ extraccion: e, validacion: validarExtraccion(e, { remitenteReconocido: false }) })!;
    expect(r.generales.map((h) => h.codigo)).toEqual(['remitente_no_reconocido']);
  });

  it('prioridad: lo que necesita a una persona va primero', () => {
    expect(['aprobado', 'por_revisar', 'fallido', 'recibido'].sort((a, b) => prioridadEstado(a as never) - prioridadEstado(b as never))).toEqual(['por_revisar', 'fallido', 'recibido', 'aprobado']);
  });
});
