import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { estatusViaje, estadiasDelPeriodo, estadiasDeViaje, evidenciaJornadaDeViaje } = await import('./servicios');
const { armarFilasEstadias, rangoDeDias } = await import('./estadias_lectura');
const { construirEstatus } = await import('./estatus_viaje');
const { evidenciaJornadaDeHitos } = await import('./jornada_hitos');
const { CONFIG_CONDUCTOR_DEFAULT } = await import('./config');
const { hitoVacio } = await import('./memoria.fixture');
type Deps = import('./servicios').DepsServicios;
type ViajeTablero = import('./repo_validacion').ViajeTablero;
type HitoFila = import('./tipos').HitoFila;
type TipoHito = import('./tipos').TipoHito;

const V1 = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001';
const V2 = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d002';
const AHORA = new Date('2026-10-02T18:00:00.000Z'); // 12:00 MX
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();

const viaje = (id = V1, p: Partial<ViajeTablero> = {}): ViajeTablero => ({
  id, folio: 'F-1042', origen: 'Zapopan', destino: 'Monterrey', estatus: 'abierto', operadorId: 'o1', operadorNombre: 'Juan Pérez', terminalId: null,
  terminalNombre: 'Tlaquepaque', clienteId: 'c1', clienteNombre: 'Cliente A', unidadId: null, aceptadoEn: hace(900), citaOrigenEn: null, citaDestinoEn: null,
  etaOrigenEn: null, etaDestinoEn: null, origenSitioId: null, destinoSitioId: null, ...p,
});
const hitos = (viajeId: string, e: Partial<Record<TipoHito, string | Partial<HitoFila>>>, tenantId = 't1'): HitoFila[] =>
  (['llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso'] as TipoHito[]).map((tipo) => {
    const x = e[tipo];
    const extra: Partial<HitoFila> = typeof x === 'string' ? { estado: 'recibido', fuente: 'texto', mensajeEn: x, recibidoEn: x } : (x ?? {});
    return hitoVacio({ id: `${viajeId}-${tipo}`, tipo, viajeId, tenantId, ...extra });
  });

function deps(o: Partial<Deps> = {}): Deps {
  return {
    config: async () => ({ ...CONFIG_CONDUCTOR_DEFAULT }),
    viajeConHitos: async () => null,
    datosEstadias: async () => ({ viajes: [], hitos: [], veredictos: [], evidencias: [], sitios: new Map(), truncada: false }),
    politicas: async () => ({ flota: null, porCliente: new Map() }),
    hitosDeOperador: async () => [],
    ...o,
  };
}

describe('estatusViaje (para el Vigía)', () => {
  it('trae el último hito, el siguiente con su cita/ETA y que no está en andén', async () => {
    const v = viaje(V1, { etaDestinoEn: new Date(AHORA.getTime() + 3_600_000).toISOString() });
    const d = deps({ viajeConHitos: async () => ({ viaje: v, hitos: hitos(V1, { llegada_carga: hace(300), salida_carga: hace(240) }) }) });
    const s = await estatusViaje('t1', V1, AHORA, d);
    expect(s).toMatchObject({
      viajeId: V1, folio: 'F-1042', semaforo: 'a_tiempo', completo: false, enAnden: null,
      ultimoHito: { tipo: 'salida_carga', hora: hace(240) },
      siguienteHito: { tipo: 'llegada_descarga', cita: { en: v.etaDestinoEn, fuente: 'eta' }, escalado: false },
    });
  });

  // ── ADVERSARIAL RONDA 03: un «ya llegué» sin ubicación que lo respalde no es «en destino» para el cliente ──
  describe('llegada por confirmar (el chofer avisó; ninguna posición lo respalda)', () => {
    const sitioDestino = { destinoSitioId: 's-desc' };
    const hs = (extra: Partial<HitoFila> = {}) => hitos(V1, {
      llegada_carga: hace(300), salida_carga: hace(240), llegada_descarga: { estado: 'recibido', fuente: 'texto', mensajeEn: hace(20), recibidoEn: hace(20), ...extra },
    });
    const ver = (resultado: string, motivo: string | null) => new Map([[`${V1}-llegada_descarga`, { resultado, motivo }]]);

    it('sin veredicto o con sin_dato por falta de posición: el último hito sigue siendo la salida, no hay andén y la cita sigue vigente', () => {
      for (const vs of [null, ver('sin_dato', 'sin_ubicacion'), ver('sin_dato', 'ubicacion_fuera_de_ventana'), ver('sin_coincidencia', null)]) {
        const v = viaje(V1, { ...sitioDestino, etaDestinoEn: hace(-30) });
        const s = construirEstatus(v, hs(), { ...CONFIG_CONDUCTOR_DEFAULT }, AHORA, vs);
        expect(s.ultimoHito).toMatchObject({ tipo: 'salida_carga' });
        expect(s.llegadaPorConfirmar).toEqual({ tipo: 'llegada_descarga', hora: hace(20) });
        expect(s.enAnden).toBeNull();
        expect(s.citas.descarga).toEqual({ en: hace(-30), fuente: 'eta' }); // el Vigía aún puede dar la hora estimada
      }
    });

    it('el Vigía NO dice «en destino»: la etapa que le llega es «en ruta»', async () => {
      const { parteDelConductor } = await import('../vigia/desde_conductor');
      const s = construirEstatus(viaje(V1, sitioDestino), hs(), { ...CONFIG_CONDUCTOR_DEFAULT }, AHORA, ver('sin_dato', 'sin_ubicacion'));
      expect(parteDelConductor(s).etapa).toBe('en_ruta');
    });

    it('confirmada (validado por GPS u oficina) sí es el último hito y abre el andén', () => {
      const s = construirEstatus(viaje(V1, sitioDestino), hs({ estado: 'validado', validadoPor: 'gps', validadoEn: hace(15) }), { ...CONFIG_CONDUCTOR_DEFAULT }, AHORA);
      expect(s.ultimoHito).toMatchObject({ tipo: 'llegada_descarga' });
      expect(s.llegadaPorConfirmar).toBeNull();
      expect(s.enAnden).not.toBeNull();
    });

    it('lo declarado por la oficina no se pone en duda', () => {
      const s = construirEstatus(viaje(V1, sitioDestino), hs({ fuente: 'oficina' }), { ...CONFIG_CONDUCTOR_DEFAULT }, AHORA);
      expect(s.ultimoHito).toMatchObject({ tipo: 'llegada_descarga' });
    });

    it('sin sitio asignado no hay con qué compararlo: se cuenta como siempre (no se deja mudo el destino)', () => {
      const s = construirEstatus(viaje(V1), hs(), { ...CONFIG_CONDUCTOR_DEFAULT }, AHORA, ver('sin_dato', 'sin_sitio'));
      expect(s.ultimoHito).toMatchObject({ tipo: 'llegada_descarga' });
      expect(s.llegadaPorConfirmar).toBeNull();
    });

    it('una flota que apagó la validación de ubicación cuenta el aviso del chofer como siempre', () => {
      const s = construirEstatus(viaje(V1, sitioDestino), hs(), { ...CONFIG_CONDUCTOR_DEFAULT, validarUbicacion: false }, AHORA);
      expect(s.ultimoHito).toMatchObject({ tipo: 'llegada_descarga' });
    });

    it('estatusViaje lee los veredictos de ESA flota; si no se pueden leer, no afirma la llegada', async () => {
      const v = viaje(V1, sitioDestino);
      const leidos = vi.fn(async () => [{ hitoId: `${V1}-llegada_descarga`, ciclo: 1, resultado: 'sin_dato' as const, motivo: 'sin_ubicacion' as const, fuente: null, distanciaM: null, radioM: null, toleranciaM: 150, sitioId: null, medidaEn: null }]);
      const s = await estatusViaje('t1', V1, AHORA, deps({ viajeConHitos: async () => ({ viaje: v, hitos: hs() }), veredictos: leidos }));
      expect(leidos).toHaveBeenCalledWith('t1', V1);
      expect(s?.llegadaPorConfirmar).not.toBeNull();
      const roto = await estatusViaje('t1', V1, AHORA, deps({ viajeConHitos: async () => ({ viaje: v, hitos: hs() }), veredictos: async () => { throw new Error('base caída'); } }));
      expect(roto?.ultimoHito).toMatchObject({ tipo: 'salida_carga' });
    });
  });

  it('la cita manda sobre la ETA', () => {
    const v = viaje(V1, { citaOrigenEn: hace(-30), etaOrigenEn: hace(-90) });
    const s = construirEstatus(v, hitos(V1, {}), { ...CONFIG_CONDUCTOR_DEFAULT }, AHORA);
    expect(s.siguienteHito?.cita).toEqual({ en: hace(-30), fuente: 'cita' });
  });

  it('en andén: dice cuál parada y cuántos minutos', () => {
    const s = construirEstatus(viaje(), hitos(V1, { llegada_carga: hace(75) }), { ...CONFIG_CONDUCTOR_DEFAULT }, AHORA);
    expect(s.enAnden).toMatchObject({ lugar: 'carga', minutos: 75, desde: hace(75) });
    expect(s.ultimoHito?.tipo).toBe('llegada_carga');
  });

  it('viaje completo: sin siguiente hito', () => {
    const s = construirEstatus(viaje(), hitos(V1, { llegada_carga: hace(500), salida_carga: hace(400), llegada_descarga: hace(300), salida_descarga: hace(200), regreso: hace(100) }), { ...CONFIG_CONDUCTOR_DEFAULT }, AHORA);
    expect(s).toMatchObject({ completo: true, siguienteHito: null, semaforo: 'completo', ultimoHito: { tipo: 'regreso' } });
  });

  it('escalado: el semáforo es sin_reporte y dice si ya lo atendieron', () => {
    const s = construirEstatus(viaje(), hitos(V1, { llegada_carga: { estado: 'escalado', escaladoEn: hace(10), escalacionNivel: 1, escalacionAtendidaEn: hace(2) } }), { ...CONFIG_CONDUCTOR_DEFAULT }, AHORA);
    expect(s).toMatchObject({ semaforo: 'sin_reporte', siguienteHito: { escalado: true, atendido: true } });
  });

  it('el «último» hito es el de mayor hora, aunque se capturó fuera de secuencia', () => {
    const s = construirEstatus(viaje(), hitos(V1, { llegada_carga: hace(10), salida_carga: hace(200) }), { ...CONFIG_CONDUCTOR_DEFAULT }, AHORA);
    expect(s.ultimoHito?.tipo).toBe('llegada_carga');
  });

  it('un viaje que no existe en esa flota (o un id que no es uuid) es null, no un dato', async () => {
    expect(await estatusViaje('t1', V1, AHORA, deps())).toBeNull();
    expect(await estatusViaje('t1', 'no-uuid', AHORA, deps({ viajeConHitos: async () => { throw new Error('no debe consultarse'); } }))).toBeNull();
  });

  it('el tenant llega a la consulta tal cual (un viaje de otra flota no se pide con otra)', async () => {
    const espia = vi.fn(async () => null);
    await estatusViaje('flota-de-la-sesion', V1.toUpperCase(), AHORA, deps({ viajeConHitos: espia }));
    expect(espia).toHaveBeenCalledWith('flota-de-la-sesion', V1);
  });

  it('si la config no se puede leer usa los defaults (el estatus es lectura, no acción)', async () => {
    const d = deps({ config: async () => { throw new Error('base'); }, viajeConHitos: async () => ({ viaje: viaje(), hitos: hitos(V1, {}) }) });
    expect(await estatusViaje('t1', V1, AHORA, d)).not.toBeNull();
  });
});

describe('estadías: periodo, viaje y liquidación', () => {
  const datosDe = (v: ViajeTablero, hs: HitoFila[]) => ({ viajes: [v], hitos: hs, veredictos: [], evidencias: [], sitios: new Map<string, string>(), truncada: false });
  const pacto = { flota: null, porCliente: new Map([['c1', { horasLibres: 2, tarifaHora: 500, moneda: 'MXN' }]]) };

  it('el periodo valora con el pacto del cliente y resume lo cerrado', async () => {
    const hs = hitos(V1, { llegada_carga: hace(400), salida_carga: hace(150) }); // 250 min en carga
    const r = await estadiasDelPeriodo('t1', new Date(0), new Date(), {}, AHORA, deps({ datosEstadias: async () => datosDe(viaje(), hs), politicas: async () => pacto }));
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].detencion).toMatchObject({ minutosExcedentes: 130, monto: 1500 });
    expect(r.resumen).toMatchObject({ cerradas: 1, montoPropuesto: { MXN: 1500 } });
    expect(r.truncada).toBe(false);
  });

  it('la truncada del lector sobrevive (el export lo declara)', () => {
    const r = armarFilasEstadias({ ...datosDe(viaje(), []), truncada: true }, AHORA, pacto);
    expect(r.truncada).toBe(true);
  });

  it('las filas van de la llegada más reciente a la más vieja', () => {
    const d = {
      viajes: [viaje(V1), viaje(V2, { folio: 'F-2' })],
      hitos: [...hitos(V1, { llegada_carga: hace(500), salida_carga: hace(400) }), ...hitos(V2, { llegada_carga: hace(100), salida_carga: hace(50) })],
      veredictos: [], evidencias: [], sitios: new Map<string, string>(), truncada: false,
    };
    expect(armarFilasEstadias(d, AHORA, pacto).filas.map((f) => f.viaje.folio)).toEqual(['F-2', 'F-1042']);
  });

  it('el veredicto y la evidencia del CICLO vigente viajan a la fila', () => {
    const hs = hitos(V1, { llegada_carga: { estado: 'recibido', fuente: 'texto', mensajeEn: hace(400), recibidoEn: hace(400), ciclo: 2 }, salida_carga: hace(300) });
    const d = {
      viajes: [viaje()], hitos: hs, sitios: new Map<string, string>(), truncada: false,
      veredictos: [
        { hitoId: `${V1}-llegada_carga`, ciclo: 1, resultado: 'validado' as const, motivo: null, fuente: 'pin' as const, distanciaM: 5, radioM: 300, toleranciaM: 150, sitioId: null, medidaEn: null },
        { hitoId: `${V1}-llegada_carga`, ciclo: 2, resultado: 'sin_coincidencia' as const, motivo: null, fuente: 'gps' as const, distanciaM: 900, radioM: 300, toleranciaM: 150, sitioId: null, medidaEn: null },
      ],
      evidencias: [{ id: 'e', hitoId: `${V1}-salida_carga`, ciclo: 1, tipo: 'sello' as const, ruta: 'x', creadaEn: hace(299) }],
    };
    const [f] = armarFilasEstadias(d, AHORA, pacto).filas;
    expect(f.estancia.llegada?.validacion).toBe('sin_coincidencia');
    expect(f.estancia.salida?.evidencias).toBe(1);
  });

  it('la liquidación: las estancias de UN viaje de ESA flota', async () => {
    const hs = hitos(V1, { llegada_descarga: hace(300), salida_descarga: hace(120) }); // 180 min
    const r = await estadiasDeViaje('t1', V1, AHORA, deps({ viajeConHitos: async () => ({ viaje: viaje(), hitos: hs }), politicas: async () => pacto }));
    expect(r?.filas).toHaveLength(1);
    expect(r?.filas[0].detencion).toMatchObject({ minutosExcedentes: 60, horasCobrables: 1, monto: 500 });
  });

  it('un viaje que no es de esa flota (o con id raro) no devuelve nada', async () => {
    expect(await estadiasDeViaje('t1', V1, AHORA, deps())).toBeNull();
    expect(await estadiasDeViaje('t1', "x'; drop", AHORA, deps())).toBeNull();
    // Un doble que devolviera OTRO viaje tampoco pasa.
    expect(await estadiasDeViaje('t1', V1, AHORA, deps({ viajeConHitos: async () => ({ viaje: viaje(V2), hitos: [] }) }))).toBeNull();
  });

  it('rangoDeDias: días de México, máximo del periodo y fechas absurdas', () => {
    const r = rangoDeDias('2026-10-01', '2026-10-02');
    expect(r).toEqual({ desde: new Date('2026-10-01T06:00:00.000Z'), hasta: new Date('2026-10-03T06:00:00.000Z') });
    expect(rangoDeDias('2026-10-02', '2026-10-01')).toHaveProperty('error');
    expect(rangoDeDias('2026-01-01', '2026-12-31')).toMatchObject({ error: expect.stringMatching(/máximo/) });
    expect(rangoDeDias('ayer', 'hoy')).toHaveProperty('error');
    expect(rangoDeDias('2026-02-31', '2026-03-01')).toBeDefined();
  });
});

describe('evidencia de jornada (el agente de jornada)', () => {
  const dia = '2026-10-02';
  it('el último hito del día es cota inferior del fin; el primero NO se usa como inicio', () => {
    const hs = hitos(V1, { llegada_carga: '2026-10-02T14:00:00.000Z', salida_carga: '2026-10-02T16:00:00.000Z', llegada_descarga: '2026-10-02T23:30:00.000Z' });
    const e = evidenciaJornadaDeHitos(hs, dia);
    expect(e.hitos).toBe(3);
    expect(e.ultimoHito).toMatchObject({ tipo: 'llegada_descarga', momento: '2026-10-02T23:30:00.000Z', origenRef: `viaje:${V1}:hito:llegada_descarga:c1` });
    expect(e.primerHito?.tipo).toBe('llegada_carga');
    expect(e.usoPermitido).toEqual({ inicio: false, fin: 'cota_inferior' });
  });

  it('el día es el de MÉXICO: un hito a las 03:00Z pertenece al día anterior', () => {
    const hs = hitos(V1, { llegada_carga: '2026-10-03T03:00:00.000Z' });
    expect(evidenciaJornadaDeHitos(hs, '2026-10-02').hitos).toBe(1);
    expect(evidenciaJornadaDeHitos(hs, '2026-10-03').hitos).toBe(0);
  });

  it('un día sin hitos devuelve nulos (jamás una hora inventada)', () => {
    expect(evidenciaJornadaDeHitos([], dia)).toMatchObject({ primerHito: null, ultimoHito: null, hitos: 0 });
  });

  it('solo cuentan los hitos resueltos (un omitido o escalado no es evidencia de nada)', () => {
    const hs = hitos(V1, { llegada_carga: { estado: 'omitido', omitidoMotivo: 'x' }, salida_carga: { estado: 'escalado', escaladoEn: '2026-10-02T15:00:00.000Z', escalacionNivel: 1 } });
    expect(evidenciaJornadaDeHitos(hs, dia).hitos).toBe(0);
  });

  it('hora inválida se ignora', () => {
    expect(evidenciaJornadaDeHitos(hitos(V1, { llegada_carga: 'basura' }), dia).hitos).toBe(0);
  });

  it('el servicio pide la ventana del día de México (±) y filtra por la flota', async () => {
    const espia = vi.fn(async () => [
      ...hitos(V1, { llegada_carga: '2026-10-02T14:00:00.000Z' }, 't1'),
      ...hitos(V2, { llegada_carga: '2026-10-02T20:00:00.000Z' }, 'otra-flota'),
    ]);
    const e = await evidenciaJornadaDeViaje('t1', 'o1', dia, deps({ hitosDeOperador: espia }));
    expect(espia.mock.calls[0].slice(0, 2)).toEqual(['t1', 'o1']);
    expect(e.hitos).toBe(1);
    expect(e.ultimoHito?.viajeId).toBe(V1);
  });

  it('un día mal escrito no llega a la consulta', async () => {
    await expect(evidenciaJornadaDeViaje('t1', 'o1', '02/10/2026', deps())).rejects.toThrow(/AAAA-MM-DD/);
  });
});
