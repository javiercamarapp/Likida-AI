import { describe, expect, it, vi } from 'vitest';
import {
  decidirFotoDocumento, documentosARequerir, documentoDeCaption, estadoDeAccion, listaDocumentos, MAX_REINTENTOS_LEGIBILIDAD,
  mensajeFotoDocumento, motivoIlegible, PX_ANCHO_MIN_LEGIBLE, preguntarDocumentosCierre, resumenDocumentosCierre,
  type DocumentoCierreFila, type PuertosDocumentosCierre,
} from './documentos_cierre';
import type { CatalogoDeCliente, DocumentoCliente } from './documentos_cliente';
import type { ViajeContexto } from './repo';

const doc = (over: Partial<DocumentoCliente> = {}): DocumentoCliente => ({
  id: 'd1', clienteId: 'c1', nombre: 'Carta porte firmada', tipo: 'basico', requiereFirma: true, requiereSello: true, ...over,
});

const fila = (over: Partial<DocumentoCierreFila> = {}): DocumentoCierreFila => ({
  id: 'dc1', tenantId: 't1', viajeId: 'v1', documentoRequeridoId: 'd1', nombreSolicitado: 'Carta porte firmada', tipoSolicitado: 'basico',
  solicitadoEn: '2026-10-18T10:00:00.000Z', recibidoEn: null, viajeHitoEvidenciaId: null, intentosLegibilidad: 0, estado: 'pendiente', respuestaChofer: null,
  ...over,
});

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-53 — el snapshot a pedir y qué falta
// ═══════════════════════════════════════════════════════════════════════════

describe('documentosARequerir', () => {
  it('cliente sin catálogo propio: nada que pedir (solo el POD de siempre, sin romper nada)', () => {
    const sinCatalogo: CatalogoDeCliente = { usaCatalogo: false, basicos: [], complementarios: [] };
    expect(documentosARequerir(sinCatalogo)).toEqual([]);
  });

  it('básicos antes que complementarios, con el id/nombre/tipo de cada uno', () => {
    const catalogo: CatalogoDeCliente = {
      usaCatalogo: true,
      basicos: [doc({ id: 'b1', nombre: 'Carta porte firmada' })],
      complementarios: [doc({ id: 'c1', nombre: 'Pedimento', tipo: 'complementario' })],
    };
    expect(documentosARequerir(catalogo)).toEqual([
      { documentoRequeridoId: 'b1', nombre: 'Carta porte firmada', tipo: 'basico' },
      { documentoRequeridoId: 'c1', nombre: 'Pedimento', tipo: 'complementario' },
    ]);
  });
});

describe('resumenDocumentosCierre', () => {
  it('sin filas: sin catálogo (no se pinta nada, no es lo mismo que "faltan 0 de 0")', () => {
    expect(resumenDocumentosCierre([])).toEqual({ usaCatalogo: false, total: 0, recibidos: 0, faltantes: [], conProblemaDeCalidad: [] });
  });

  it('todos los documentos recibidos', () => {
    const r = resumenDocumentosCierre([fila({ id: 'a', estado: 'recibido', recibidoEn: '2026-10-18T12:00:00.000Z' }), fila({ id: 'b', estado: 'recibido', recibidoEn: '2026-10-18T12:00:00.000Z' })]);
    expect(r).toMatchObject({ usaCatalogo: true, total: 2, recibidos: 2 });
    expect(r.faltantes).toEqual([]);
  });

  it('falta uno: el resumen lo aísla exacto', () => {
    const recibido = fila({ id: 'a', estado: 'recibido', recibidoEn: '2026-10-18T12:00:00.000Z' });
    const pendiente = fila({ id: 'b', documentoRequeridoId: 'd2', nombreSolicitado: 'Pedimento', estado: 'pendiente' });
    const r = resumenDocumentosCierre([recibido, pendiente]);
    expect(r.total).toBe(2);
    expect(r.recibidos).toBe(1);
    expect(r.faltantes).toEqual([pendiente]);
  });

  it('«revisar» cuenta como recibido (la foto llegó) pero marca el problema de calidad', () => {
    const r = resumenDocumentosCierre([fila({ estado: 'revisar', recibidoEn: '2026-10-18T12:00:00.000Z', intentosLegibilidad: 2 })]);
    expect(r.recibidos).toBe(1);
    expect(r.conProblemaDeCalidad).toHaveLength(1);
  });
});

describe('listaDocumentos', () => {
  it('une los nombres en una sola línea, recortados a 60 caracteres cada uno', () => {
    expect(listaDocumentos(['Carta porte firmada', 'Pedimento'])).toBe('Carta porte firmada, Pedimento');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-53 — clasificar la foto por el caption
// ═══════════════════════════════════════════════════════════════════════════

describe('documentoDeCaption', () => {
  const pendientes = [
    { documentoRequeridoId: 'd1', nombreSolicitado: 'Carta porte firmada' },
    { documentoRequeridoId: 'd2', nombreSolicitado: 'Pedimento' },
  ];

  it.each([
    ['Carta porte firmada', 'd1'],
    ['carta porte firmada', 'd1'],
    ['CARTA PORTE FIRMADA!!', 'd1'],
    ['  carta   porte   firmada  ', 'd1'],
    ['Pedimento', 'd2'],
  ])('«%s» clasifica al documento %s', (caption, esperado) => {
    expect(documentoDeCaption(caption, pendientes)).toBe(esperado);
  });

  it.each(['', '   ', undefined, 'algo que no es ninguno de los dos', 'x'.repeat(61)])('«%s»: sin categoría clara (null, queda por revisar)', (caption) => {
    expect(documentoDeCaption(caption, pendientes)).toBeNull();
  });

  it('un documento ya recibido (no viene en `pendientes`) no se vuelve a clasificar', () => {
    expect(documentoDeCaption('Pedimento', [pendientes[0]])).toBeNull();
  });

  it('sin pendientes, nunca clasifica nada', () => {
    expect(documentoDeCaption('Carta porte firmada', [])).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-53 — la pregunta N11 (pura, con puertos inyectados)
// ═══════════════════════════════════════════════════════════════════════════

const VIAJE: ViajeContexto = {
  id: 'v1', tenantId: 't1', folio: 'F-1042', origen: 'Monterrey', destino: 'Nuevo Laredo', estatus: 'abierto',
  operadorId: 'op1', operadorNombre: 'Juan Pérez', operadorTelefono: '528199999999', terminalId: null, unidadId: null,
  aceptadoEn: null, citaOrigenEn: null, citaDestinoEn: null, etaOrigenEn: null, etaDestinoEn: null,
};

describe('preguntarDocumentosCierre', () => {
  const puertos = (filas: DocumentoCierreFila[]): PuertosDocumentosCierre => ({
    leer: vi.fn(async () => filas),
    crear: vi.fn(async () => filas),
  });

  it('apagada (config por omisión): null, nunca consulta nada que no se necesite', async () => {
    const p = puertos([fila()]);
    const r = await preguntarDocumentosCierre(p, { pedirDocumentosCierreActivo: false }, VIAJE, { tipo: 'salida_descarga' });
    expect(r).toBeNull();
  });

  it('encendida pero el hito no es salida_descarga: null', async () => {
    const p = puertos([fila()]);
    const r = await preguntarDocumentosCierre(p, { pedirDocumentosCierreActivo: true }, VIAJE, { tipo: 'llegada_descarga' });
    expect(r).toBeNull();
  });

  it('sin catálogo del cliente (sin filas): null, no se inventa nada que pedir', async () => {
    const p = puertos([]);
    const r = await preguntarDocumentosCierre(p, { pedirDocumentosCierreActivo: true }, VIAJE, { tipo: 'salida_descarga' });
    expect(r).toBeNull();
  });

  it('ya está todo recibido: null, no se vuelve a preguntar', async () => {
    const p = puertos([fila({ estado: 'recibido', recibidoEn: '2026-10-18T12:00:00.000Z' })]);
    const r = await preguntarDocumentosCierre(p, { pedirDocumentosCierreActivo: true }, VIAJE, { tipo: 'salida_descarga' });
    expect(r).toBeNull();
  });

  it('con pendientes: la pregunta trae la lista y los dos botones de N11', async () => {
    const pend = fila({ nombreSolicitado: 'Carta porte firmada' });
    const p = puertos([pend]);
    const r = await preguntarDocumentosCierre(p, { pedirDocumentosCierreActivo: true }, VIAJE, { tipo: 'salida_descarga' });
    expect(r?.texto).toContain('F-1042');
    expect(r?.texto).toContain('Carta porte firmada');
    expect(r?.botones).toEqual([
      { id: `evid_listo:${VIAJE.id}`, titulo: 'Ya los envié' },
      { id: `evid_falta:${VIAJE.id}`, titulo: 'Me falta uno' },
    ]);
  });

  it('sin solicitud armada todavía, la crea (idempotente del lado del puerto) y pregunta con lo creado', async () => {
    const pend = fila();
    const leer = vi.fn(async () => []);
    const crear = vi.fn(async () => [pend]);
    const r = await preguntarDocumentosCierre({ leer, crear }, { pedirDocumentosCierreActivo: true }, VIAJE, { tipo: 'salida_descarga' });
    expect(crear).toHaveBeenCalledWith(VIAJE.tenantId, VIAJE.id, null, expect.any(Date));
    expect(r).not.toBeNull();
  });

  it('una lectura que falla no rompe el acuse del hito: null', async () => {
    const p: PuertosDocumentosCierre = { leer: vi.fn(async () => { throw new Error('boom'); }), crear: vi.fn(async () => []) };
    const r = await preguntarDocumentosCierre(p, { pedirDocumentosCierreActivo: true }, VIAJE, { tipo: 'salida_descarga' });
    expect(r).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-54 — legibilidad y contingencia de fotos de gama baja
// ═══════════════════════════════════════════════════════════════════════════

describe('motivoIlegible', () => {
  it('sin metadatos (fase 1, sin analizador de imagen): siempre legible, nunca bloquea', () => {
    expect(motivoIlegible(undefined)).toBeNull();
    expect(motivoIlegible(null)).toBeNull();
  });

  it('foto buena (ancho suficiente, ni oscura ni borrosa): legible', () => {
    expect(motivoIlegible({ anchoPx: 1200, oscura: false, borrosa: false })).toBeNull();
  });

  it(`foto chica (< ${PX_ANCHO_MIN_LEGIBLE} px): «pequena»`, () => {
    expect(motivoIlegible({ anchoPx: 799 })).toBe('pequena');
    expect(motivoIlegible({ anchoPx: PX_ANCHO_MIN_LEGIBLE })).toBeNull();
  });

  it('foto oscura: «oscura»', () => {
    expect(motivoIlegible({ anchoPx: 1200, oscura: true })).toBe('oscura');
  });

  it('foto borrosa: «borrosa»', () => {
    expect(motivoIlegible({ anchoPx: 1200, borrosa: true })).toBe('borrosa');
  });
});

describe('decidirFotoDocumento', () => {
  it('foto buena: se acepta y el contador no se toca', () => {
    expect(decidirFotoDocumento({ motivo: null, intentosPrevios: 0 })).toEqual({ accion: 'aceptar_ok', intentos: 0 });
    expect(decidirFotoDocumento({ motivo: null, intentosPrevios: 1 })).toEqual({ accion: 'aceptar_ok', intentos: 1 });
  });

  it('foto chica, primer intento: pide repetir UNA vez', () => {
    expect(decidirFotoDocumento({ motivo: 'pequena', intentosPrevios: 0 })).toEqual({ accion: 'pedir_repetir', intentos: 1 });
  });

  it('foto oscura, primer intento: pide repetir', () => {
    expect(decidirFotoDocumento({ motivo: 'oscura', intentosPrevios: 0 })).toEqual({ accion: 'pedir_repetir', intentos: 1 });
  });

  it(`dos intentos fallidos consecutivos: al llegar a ${MAX_REINTENTOS_LEGIBILIDAD} se acepta igual, marcada «revisar»`, () => {
    const r1 = decidirFotoDocumento({ motivo: 'borrosa', intentosPrevios: 0 });
    expect(r1).toEqual({ accion: 'pedir_repetir', intentos: 1 });
    const r2 = decidirFotoDocumento({ motivo: 'borrosa', intentosPrevios: r1.intentos });
    expect(r2).toEqual({ accion: 'aceptar_revisar', intentos: 2 });
  });

  it('nunca bloquea el viaje: toda acción es una de las tres aceptadas, ninguna "rechazar"', () => {
    for (const motivo of ['pequena', 'oscura', 'borrosa', null] as const) {
      for (const intentosPrevios of [0, 1, 2, 5]) {
        const r = decidirFotoDocumento({ motivo, intentosPrevios });
        expect(['aceptar_ok', 'pedir_repetir', 'aceptar_revisar']).toContain(r.accion);
      }
    }
  });

  it('el contador es POR DOCUMENTO: dos documentos distintos del mismo viaje no comparten intentos', () => {
    // Documento A ya lleva 1 intento fallido; documento B (otro, del mismo viaje) empieza en 0.
    const docA = decidirFotoDocumento({ motivo: 'oscura', intentosPrevios: 1 });
    const docB = decidirFotoDocumento({ motivo: 'oscura', intentosPrevios: 0 });
    expect(docA).toEqual({ accion: 'aceptar_revisar', intentos: 2 }); // A ya iba en su segundo intento fallido
    expect(docB).toEqual({ accion: 'pedir_repetir', intentos: 1 }); // B apenas en su primero: el contador de A no lo contaminó
  });
});

describe('estadoDeAccion', () => {
  it('mapea cada acción al estado que se guarda en viaje_documento_cierre', () => {
    expect(estadoDeAccion('aceptar_ok')).toBe('recibido');
    expect(estadoDeAccion('pedir_repetir')).toBe('pendiente');
    expect(estadoDeAccion('aceptar_revisar')).toBe('revisar');
  });
});

describe('mensajeFotoDocumento', () => {
  it('cada acción tiene su propio texto, siempre nombrando el documento', () => {
    expect(mensajeFotoDocumento('aceptar_ok', 'Carta porte firmada')).toContain('Carta porte firmada');
    expect(mensajeFotoDocumento('pedir_repetir', 'Carta porte firmada')).toContain('Carta porte firmada');
    expect(mensajeFotoDocumento('aceptar_revisar', 'Carta porte firmada')).toContain('Carta porte firmada');
    expect(mensajeFotoDocumento('pedir_repetir', 'X')).not.toBe(mensajeFotoDocumento('aceptar_ok', 'X'));
  });
});
