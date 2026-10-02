/* eslint-disable @typescript-eslint/no-explicit-any -- las respuestas de las herramientas son JSON libre que el modelo lee; la prueba las recorre por forma, no por tipo. */
import { afterEach, describe, expect, it, vi } from 'vitest';

const AHORA = Date.parse('2026-10-02T18:00:00.000Z');
vi.mock('@/lib/saludo', () => ({ ahoraMs: () => AHORA }));

const { makeExecutor, toolSchemas } = await import('@/lib/llm/tool-executor');
const { conPermisos } = await import('./herramientas');
const { ponerFuentes } = await import('./fuentes');
const { crearFuentesEnMemoria, datosVacios } = await import('./fuentes.fixture');
const { AREA_POR_HERRAMIENTA } = await import('./permisos');

const A = 'flota-a';
const B = 'flota-b';
const NUEVAS = ['convenio_viaje', 'estado_liquidacion_externa', 'reclamacion_peajes', 'estado_jornada'];

const liq = (id: string, p: Record<string, unknown> = {}) => ({
  id, tenantId: A, claveExterna: `ext-${id}`, huella: 'h', sistemaOrigen: null, operadorId: 'o1', operadorNombre: 'Chofer Privado', operadorTelefono: '5215551234567',
  foliosViaje: ['F-1', 'F-2'], viajeIds: ['v1'], periodoDesde: '2026-09-21', periodoHasta: '2026-09-27', conceptos: [], total: 45320.5, moneda: 'MXN', pdfRuta: 'liq/secreto.pdf',
  pdfOrigen: 'generado', estado: 'fallida', via: 'plantilla', generacion: 1, intentos: 3, proximoIntentoEn: '2026-10-03T00:00:00Z', ultimoError: 'Meta rechazó la plantilla',
  wamid: null, enviadaEn: '2026-10-02T15:00:00Z', acuseTipo: null, acuseEn: null, acuseConfirmadoEn: null, creadaEn: '2026-10-01T00:00:00Z', ...p,
});

function mundos() {
  return {
    [A]: {
      datos: datosVacios(),
      convenios: {
        'F-1': {
          folio: 'F-1', origen: 'Zapopan', destino: 'Monterrey', cliente: 'Cliente Alfa', convenioNombre: 'Convenio Alfa Norte', ligadoPor: 'auto' as const, despachoEnviado: true,
          instrucciones: [{ categoria: 'puerta' as const, texto: 'Entra por la puerta 3, caseta de vigilancia.', momento: 'ambos' as const, lugar: 'origen' as const, orden: 1 }],
        },
        'F-2': { folio: 'F-2', origen: null, destino: null, cliente: null, convenioNombre: null, ligadoPor: null, despachoEnviado: false, instrucciones: [] },
      },
      liquidacionExterna: {
        porEstado: { pendiente: 0, en_cola: 1, enviada: 4, acusada: 9, fallida: 2 } as any, noCoincide: 1,
        fallidas: [liq('l1')] as any, conAcuseNoCoincide: [liq('l2', { estado: 'acusada', acuseTipo: 'no_coincide', ultimoError: null })] as any,
      },
      reclamacionPeajes: {
        desglose: { id: 'd1', proveedor: 'Proveedor Peaje', periodoDesde: '2026-09-01', periodoHasta: '2026-09-15' },
        reporte: {
          desgloseId: 'd1', proveedor: 'Proveedor Peaje', periodoDesde: '2026-09-01', periodoHasta: '2026-09-15', leyendas: [],
          resumen: { lineas: 40, reclamables: 2, montoReclamable: 310, porMotivo: { gps_lejos_de_caseta: { n: 1, monto: 150 }, unidad_en_zona_no_autorizada: { n: 0, monto: 0 }, doble_cobro: { n: 1, monto: 160 } }, confirmadas: 30, sinDatos: 8, sinEvaluar: 0 },
          cruces: [{ indice: 3, fecha: '2026-09-03', hora: '10:00', caseta: 'Caseta Uno', casetaCatalogo: 'C1', tag: 'TAG-SECRETO-1', unidad: 'T-12', monto: 150, motivo: 'gps_lejos_de_caseta', confianza: 'alta', porQue: 'x', distanciaM: 900, radioCasetaM: 300, evidencia: [], zona: null, duplicadoDeLinea: null }],
        } as any,
      },
      jornada: {
        dias: [
          { id: 'j1', operadorId: 'o1', dia: '2026-10-01', estado: 'cerrado', cerradoEn: 'x', cerradoPorEmail: 'oficina@privado.example', conformeOperadorEn: 'y', conformeWaMessageId: 'w', asientos: [] },
          { id: 'j2', operadorId: 'o2', dia: '2026-10-01', estado: 'cerrado', cerradoEn: 'x', cerradoPorEmail: null, conformeOperadorEn: null, conformeWaMessageId: null, asientos: [] },
          { id: 'j3', operadorId: 'o2', dia: '2026-10-02', estado: 'abierto', cerradoEn: null, cerradoPorEmail: null, conformeOperadorEn: null, conformeWaMessageId: null, asientos: [] },
        ] as any,
        truncada: false,
      },
      folios: ['F-1', 'F-2'],
    },
    [B]: { datos: datosVacios() },   // la otra flota no tiene convenios, liquidaciones, peajes ni jornada activos
  };
}

function armar(rol: string | undefined, tenantId = A) {
  const m = crearFuentesEnMemoria(mundos());
  ponerFuentes(m.fuentes);
  const exec = conPermisos(rol, makeExecutor({ tenantId, rol, usuarioId: 'u-1', runId: 'r1', conversationId: 'r1' }));
  const llamar = async (nombre: string, args: Record<string, unknown> = {}) => (await exec(nombre, args)).result as Record<string, any>;
  return { m, llamar };
}
afterEach(() => ponerFuentes(null));

describe('contrato de las herramientas nuevas (P6)', () => {
  it('están registradas, con área declarada, y ninguna acepta flota ni consulta como parámetro', () => {
    const esquemas = toolSchemas(NUEVAS);
    expect(esquemas.map((s) => (s as any).function.name)).toEqual(NUEVAS);
    for (const s of esquemas) {
      const p = (s as any).function.parameters;
      expect(p.additionalProperties).toBe(false);
      for (const [k, def] of Object.entries<any>(p.properties)) {
        expect(k).not.toMatch(/tenant|flota_id|sql|query|url|telefono|correo/i);
        if (def.type === 'string') expect(def.enum !== undefined || typeof def.maxLength === 'number').toBe(true);
      }
    }
    for (const n of NUEVAS) expect(Object.keys(AREA_POR_HERRAMIENTA)).toContain(n);
  });
});

describe('permisos por rol (fallan cerrado)', () => {
  it('el encargado ve convenio y jornada, y NO la liquidación externa ni los peajes (dinero): se niega sin tocar la fuente', async () => {
    const { m, llamar } = armar('encargado');
    expect((await llamar('convenio_viaje', { folio: 'F-1' })).encontrado).toBe(true);
    expect((await llamar('estado_jornada')).expedientes).toBe(3);
    const n = m.llamadas.length;
    for (const t of ['estado_liquidacion_externa', 'reclamacion_peajes']) expect((await llamar(t)).error).toBe('sin_permiso');
    expect(m.llamadas.length).toBe(n);
  });

  it('el contador ve liquidación externa y peajes, y NO convenio ni jornada', async () => {
    const { m, llamar } = armar('contador');
    expect((await llamar('estado_liquidacion_externa')).porEstado.fallida).toBe(2);
    expect((await llamar('reclamacion_peajes')).hayDesglose).toBe(true);
    const n = m.llamadas.length;
    expect((await llamar('convenio_viaje', { folio: 'F-1' })).error).toBe('sin_permiso');
    expect((await llamar('estado_jornada')).error).toBe('sin_permiso');
    expect(m.llamadas.length).toBe(n);
  });

  it('sin rol o con rol desconocido no se ejecuta ninguna', async () => {
    for (const rol of [undefined, 'operador', 'inventado']) {
      const { m, llamar } = armar(rol);
      for (const t of NUEVAS) expect((await llamar(t, { folio: 'F-1' })).error).toBe('sin_permiso');
      expect(m.llamadas).toHaveLength(0);
    }
  });
});

describe('convenio_viaje', () => {
  it('trae el convenio y las instrucciones de planta, sin tarifas', async () => {
    const { llamar } = armar('flota_admin');
    const r = await llamar('convenio_viaje', { folio: 'F-1' });
    expect(r).toMatchObject({ encontrado: true, folio: 'F-1', convenio: 'Convenio Alfa Norte', ligadoPor: 'auto', instruccionesAlOperadorEnviadas: true, totalInstrucciones: 1 });
    expect(r.instrucciones[0]).toMatchObject({ categoria: 'Por dónde entras', texto: 'Entra por la puerta 3, caseta de vigilancia.' });
    expect(JSON.stringify(r)).not.toMatch(/tarifa|precio|monto/i);
  });

  it('un viaje sin convenio lo dice y no inventa instrucciones', async () => {
    const { llamar } = armar('flota_admin');
    const r = await llamar('convenio_viaje', { folio: 'F-2' });
    expect(r.encontrado).toBe(true);
    expect(r.convenio).toBeNull();
    expect(r.nota).toMatch(/inventes/i);
  });

  it('folio inexistente, folio mal formado y base sin convenios: tres respuestas honestas distintas', async () => {
    const { llamar } = armar('flota_admin');
    expect((await llamar('convenio_viaje', { folio: 'NO-EXISTE' })).encontrado).toBe(false);
    expect((await llamar('convenio_viaje', { folio: "F-1'; drop table viaje;--" })).error).toBe('folio_invalido');
    const b = armar('flota_admin', B);
    expect((await b.llamar('convenio_viaje', { folio: 'F-1' })).disponible).toBe(false);
  });

  it('el folio de A no se encuentra con la sesión de B y solo se le pregunta a la flota de la sesión', async () => {
    const { m, llamar } = armar('flota_admin', B);
    const r = await llamar('convenio_viaje', { folio: 'F-1', tenant: A });
    expect(JSON.stringify(r)).not.toMatch(/Alfa|Zapopan/);
    expect(m.llamadas.every((l) => l.tenantId === B)).toBe(true);
  });
});

describe('estado_liquidacion_externa', () => {
  it('cuenta por estado y lista las fallidas, SIN montos, teléfonos, nombres del chofer ni rutas de archivo', async () => {
    const { llamar } = armar('contador');
    const r = await llamar('estado_liquidacion_externa');
    expect(r.porEstado).toEqual({ pendiente: 0, en_cola: 1, enviada: 4, acusada: 9, fallida: 2 });
    expect(r.choferesDijeronNoCoincide).toBe(1);
    expect(r.fallidas[0]).toMatchObject({ folios: ['F-1', 'F-2'], estado: 'fallida', intentos: 3, ultimoError: 'Meta rechazó la plantilla' });
    expect(r.conAcuseNoCoincide[0].acuse).toBe('no_coincide');
    const txt = JSON.stringify(r);
    expect(txt).not.toMatch(/45320|5215551234567|Chofer Privado|secreto\.pdf|ext-l1/);
  });

  it('una base sin la liquidación externa lo dice (no pinta ceros)', async () => {
    const { llamar } = armar('contador', B);
    expect((await llamar('estado_liquidacion_externa')).disponible).toBe(false);
  });
});

describe('reclamacion_peajes', () => {
  it('resume el último desglose: reclamables, monto, motivos y principales cruces, sin TAGs, y lo llama señal', async () => {
    const { llamar } = armar('flota_admin');
    const r = await llamar('reclamacion_peajes');
    expect(r).toMatchObject({ hayDesglose: true, proveedor: 'Proveedor Peaje', lineas: 40, reclamables: 2, montoReclamableMxn: 310, confirmadasPorGps: 30, sinDatos: 8 });
    expect(r.porMotivo['GPS lejos de la caseta']).toEqual({ n: 1, monto: 150 });
    expect(r.principales[0]).toMatchObject({ caseta: 'Caseta Uno', unidad: 'T-12', confianza: 'alta', montoMxn: 150 });
    expect(JSON.stringify(r)).not.toMatch(/TAG-SECRETO/);
    expect(r.nota).toMatch(/señal/i);
  });

  it('sin desglose no inventa cifras; sin peajes activos lo dice', async () => {
    const m = crearFuentesEnMemoria({ [A]: { datos: datosVacios(), reclamacionPeajes: { desglose: null, reporte: null } } });
    ponerFuentes(m.fuentes);
    const exec = conPermisos('flota_admin', makeExecutor({ tenantId: A, rol: 'flota_admin', usuarioId: 'u', runId: 'r', conversationId: 'r' }));
    const r = (await exec('reclamacion_peajes', {})).result as Record<string, any>;
    expect(r.hayDesglose).toBe(false);
    expect(r.nota).toMatch(/no inventes/i);
    const b = armar('flota_admin', B);
    expect((await b.llamar('reclamacion_peajes')).disponible).toBe(false);
  });
});

describe('estado_jornada', () => {
  it('cuenta expedientes, abiertos, cerrados y cerrados sin conformidad, sin nombres ni correos', async () => {
    const { llamar } = armar('encargado');
    const r = await llamar('estado_jornada');
    expect(r).toMatchObject({ expedientes: 3, operadoresConJornada: 2, abiertos: 1, cerrados: 2, cerradosSinConformidadDelOperador: 1, incompleto: false, ventana: '2026-09-26 a 2026-10-02' });
    expect(JSON.stringify(r)).not.toMatch(/privado\.example/);
    expect(r.nota).toMatch(/no un dictamen/i);
  });

  it('una lectura truncada se dice incompleta (los números son un mínimo)', async () => {
    const mundo = mundos();
    (mundo[A].jornada as any).truncada = true;
    const m = crearFuentesEnMemoria(mundo);
    ponerFuentes(m.fuentes);
    const exec = conPermisos('encargado', makeExecutor({ tenantId: A, rol: 'encargado', usuarioId: 'u', runId: 'r', conversationId: 'r' }));
    const r = (await exec('estado_jornada', {})).result as Record<string, any>;
    expect(r.incompleto).toBe(true);
    expect(r.notaIncompleto).toMatch(/mínimo/);
  });

  it('una base sin jornada lo dice', async () => {
    const { llamar } = armar('encargado', B);
    expect((await llamar('estado_jornada')).disponible).toBe(false);
  });
});
