import { describe, expect, it } from 'vitest';
import { CONFIG_CONDUCTOR_DEFAULT, type ConfigConductor } from './config';
import { hitoVacio } from './memoria.fixture';
import type { AccionOficinaFila, DatosTablero, EvidenciaFila, VeredictoFila, ViajeTablero } from './repo_validacion';
import { nivelesSinDestino } from './escalamiento';
import { armarTablero, filtrarPorSemaforo, indicadoresVista } from './tablero';
import type { HitoFila, TipoHito } from './tipos';

// 2026-10-02 18:00Z = 12:00 en México.
const AHORA = new Date('2026-10-02T18:00:00.000Z');
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();
const cfg = (p: Partial<ConfigConductor> = {}): ConfigConductor => ({ ...CONFIG_CONDUCTOR_DEFAULT, solicitudesMin: [...CONFIG_CONDUCTOR_DEFAULT.solicitudesMin], diasSemana: [...CONFIG_CONDUCTOR_DEFAULT.diasSemana], ...p });

function viaje(id: string, p: Partial<ViajeTablero> = {}): ViajeTablero {
  return {
    id, folio: `F-${id}`, origen: 'Zapopan', destino: 'Monterrey', estatus: 'abierto', operadorId: `o-${id}`, operadorNombre: `Chofer ${id}`,
    terminalId: 'tm1', terminalNombre: 'Tlaquepaque', clienteId: 'c1', clienteNombre: 'Cliente A', unidadId: null,
    aceptadoEn: hace(600), citaOrigenEn: null, citaDestinoEn: null, etaOrigenEn: null, etaDestinoEn: null, origenSitioId: null, destinoSitioId: null, ...p,
  };
}
function hitos(viajeId: string, estados: Partial<Record<TipoHito, Partial<HitoFila> | string>>): HitoFila[] {
  return (['llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso'] as TipoHito[]).map((tipo) => {
    const e = estados[tipo];
    const extra: Partial<HitoFila> = typeof e === 'string'
      ? { estado: 'recibido', fuente: 'texto', mensajeEn: e, recibidoEn: e }
      : (e ?? {});
    return hitoVacio({ id: `${viajeId}-${tipo}`, tipo, viajeId, ...extra });
  });
}
const datos = (viajes: ViajeTablero[], hs: HitoFila[], extra: Partial<DatosTablero> = {}): DatosTablero => ({
  viajes, hayMas: false, hitos: hs, veredictos: [], evidencias: [], acciones: [], sitios: new Map(), ...extra,
});

describe('semáforo', () => {
  it('a_tiempo: el hito que toca todavía no vence (cita en 2 h)', () => {
    const v = viaje('1', { citaOrigenEn: new Date(AHORA.getTime() + 120 * 60_000).toISOString() });
    const t = armarTablero(datos([v], hitos('1', {})), cfg(), AHORA);
    expect(t.filas[0].semaforo).toBe('a_tiempo');
    expect(t.filas[0].motivo).toMatch(/toca en/);
    expect(t.excepciones).toEqual([]);
  });

  it('a_tiempo: acaba de tocar y no pasó el primer recordatorio', () => {
    const t = armarTablero(datos([viaje('1', { aceptadoEn: hace(125) })], hitos('1', {})), cfg(), AHORA);
    expect(t.filas[0].semaforo).toBe('a_tiempo');
    expect(t.filas[0].minutosVencido).toBe(5);
  });

  it('atrasado: pasó el primer recordatorio (15 min) sin respuesta', () => {
    const t = armarTablero(datos([viaje('1', { aceptadoEn: hace(120 + 20) })], hitos('1', {})), cfg(), AHORA);
    expect(t.filas[0].semaforo).toBe('atrasado');
    expect(t.excepciones.map((e) => e.tipo)).toEqual(['atrasado']);
    expect(t.excepciones[0].gravedad).toBe(1);
  });

  it('sin_reporte: pasó el umbral de escalación aunque el cron todavía no escale (la pantalla no espera al cron)', () => {
    const t = armarTablero(datos([viaje('1', { aceptadoEn: hace(120 + 100) })], hitos('1', {})), cfg(), AHORA);
    expect(t.filas[0].semaforo).toBe('sin_reporte');
    expect(t.excepciones.map((e) => e.tipo)).toEqual(['sin_reporte']);
    expect(t.excepciones[0].texto).toMatch(/aún no escala/);
  });

  it('sin_reporte: un hito escalado SIN atender es excepción urgente (gravedad 3)', () => {
    const hs = hitos('1', { llegada_carga: { estado: 'escalado', escaladoEn: hace(10), escalacionNivel: 1 } });
    const t = armarTablero(datos([viaje('1')], hs), cfg(), AHORA);
    expect(t.filas[0].semaforo).toBe('sin_reporte');
    expect(t.excepciones).toHaveLength(1);
    expect(t.excepciones[0]).toMatchObject({ tipo: 'escalado_sin_atender', gravedad: 3, hitoTipo: 'llegada_carga' });
  });

  it('un escalado YA ATENDIDO sigue en rojo pero deja de ser excepción', () => {
    const hs = hitos('1', { llegada_carga: { estado: 'escalado', escaladoEn: hace(30), escalacionNivel: 1, escalacionAtendidaEn: hace(5) } });
    const t = armarTablero(datos([viaje('1')], hs), cfg(), AHORA);
    expect(t.filas[0].semaforo).toBe('sin_reporte');
    expect(t.filas[0].motivo).toMatch(/atendido por la oficina/);
    expect(t.excepciones).toEqual([]);
  });

  it('completo: los cinco resueltos u omitidos', () => {
    const hs = hitos('1', {
      llegada_carga: hace(500), salida_carga: { estado: 'omitido', omitidoMotivo: 'inferido_por_llegada_descarga' },
      llegada_descarga: hace(300), salida_descarga: hace(200), regreso: hace(100),
    });
    const t = armarTablero(datos([viaje('1')], hs), cfg(), AHORA);
    expect(t.filas[0]).toMatchObject({ semaforo: 'completo', hitoActivo: null });
    expect(t.conteos.completo).toBe(1);
  });

  it('un viaje sin hitos sembrados NO se pinta verde: se dice', () => {
    const t = armarTablero(datos([viaje('1')], []), cfg(), AHORA);
    expect(t.filas[0].semaforo).toBe('sin_ancla');
    expect(t.filas[0].motivo).toMatch(/siembra/);
  });

  it('sin ancla (viaje sin aceptación ni cita): sin_ancla, no a_tiempo', () => {
    const t = armarTablero(datos([viaje('1', { aceptadoEn: null })], hitos('1', {})), cfg(), AHORA);
    expect(t.filas[0].semaforo).toBe('sin_ancla');
  });

  it('usa la escalera DE LA FLOTA: con escalar a los 30 min, 40 min vencido ya es sin_reporte', () => {
    const t = armarTablero(datos([viaje('1', { aceptadoEn: hace(120 + 40) })], hitos('1', {})), cfg({ escalarTrasMin: 30, solicitudesMin: [0, 10, 20] }), AHORA);
    expect(t.filas[0].semaforo).toBe('sin_reporte');
  });

  it('el hito posterior se ancla al anterior registrado: salida de carga pedida a las 2 h de la llegada', () => {
    const hs = hitos('1', { llegada_carga: hace(140) }); // espera de carga = 120 → ancla hace 20 min
    const t = armarTablero(datos([viaje('1')], hs), cfg(), AHORA);
    expect(t.filas[0]).toMatchObject({ hitoActivo: 'salida_carga', semaforo: 'atrasado', minutosVencido: 20 });
  });

  it('«voy con retraso» (pospuesto) mantiene el hito a tiempo hasta que venza el aplazamiento', () => {
    const hs = hitos('1', { llegada_carga: { pospuestoHasta: new Date(AHORA.getTime() + 30 * 60_000).toISOString() } });
    const t = armarTablero(datos([viaje('1', { aceptadoEn: hace(600) })], hs), cfg(), AHORA);
    expect(t.filas[0].semaforo).toBe('a_tiempo');
  });
});

describe('la línea de tiempo del viaje', () => {
  it('trae los 5 hitos en orden con hora del mensaje, contacto, fuente y quién actuó desde la oficina', () => {
    const hs = hitos('1', {
      llegada_carga: { estado: 'validado', fuente: 'texto', mensajeEn: hace(300), recibidoEn: hace(299), contactoNombre: 'Pedro', contactoArea: 'recibo', validadoEn: hace(298), validadoPor: 'gps' },
      salida_carga: { estado: 'recibido', fuente: 'oficina', mensajeEn: hace(200), recibidoEn: hace(100) },
    });
    const acciones: AccionOficinaFila[] = [{ hitoId: '1-salida_carga', viajeId: '1', accion: 'captura_manual', usuarioEmail: 'jefe@flota.mx', motivo: 'avisó por radio', horaDeclarada: hace(200), creadaEn: hace(100) }];
    const t = armarTablero(datos([viaje('1')], hs, { acciones }), cfg(), AHORA);
    const h = t.filas[0].hitos;
    expect(h.map((x) => x.tipo)).toEqual(['llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso']);
    expect(h[0]).toMatchObject({ estado: 'validado', contacto: 'Pedro (recibo)', validadoPor: 'gps', horaMensaje: hace(300) });
    expect(h[1]).toMatchObject({ fuente: 'oficina' });
    expect(h[1].accionesOficina[0]).toMatchObject({ accion: 'captura_manual', email: 'jefe@flota.mx', motivo: 'avisó por radio' });
    expect(h[2].horaMensaje).toBeNull();
  });

  it('el hito pendiente trae desde cuándo «toca»; los demás no', () => {
    const t = armarTablero(datos([viaje('1')], hitos('1', {})), cfg(), AHORA);
    expect(t.filas[0].hitos[0].tocaDesde).not.toBeNull();
    expect(t.filas[0].hitos.slice(1).every((h) => h.tocaDesde === null)).toBe(true);
  });

  it('el veredicto vigente (del ciclo actual) aparece; el de un ciclo viejo NO', () => {
    const hs = hitos('1', { llegada_carga: { estado: 'recibido', fuente: 'texto', mensajeEn: hace(30), recibidoEn: hace(30), ciclo: 2 } });
    const veredictos: VeredictoFila[] = [
      { hitoId: '1-llegada_carga', ciclo: 1, resultado: 'validado', motivo: null, fuente: 'pin', distanciaM: 10, radioM: 300, toleranciaM: 150, sitioId: 's1', medidaEn: hace(30) },
    ];
    const t = armarTablero(datos([viaje('1')], hs, { veredictos }), cfg(), AHORA);
    expect(t.filas[0].hitos[0].validacion).toBeNull();
    veredictos.push({ hitoId: '1-llegada_carga', ciclo: 2, resultado: 'sin_dato', motivo: 'sin_ubicacion', fuente: null, distanciaM: null, radioM: 300, toleranciaM: 150, sitioId: 's1', medidaEn: null });
    const t2 = armarTablero(datos([viaje('1')], hs, { veredictos }), cfg(), AHORA);
    expect(t2.filas[0].hitos[0].validacion?.resultado).toBe('sin_dato');
  });

  it('cuenta solo las evidencias del ciclo vigente y con archivo (las purgadas no cuentan)', () => {
    const hs = hitos('1', { salida_carga: { estado: 'recibido', fuente: 'texto', mensajeEn: hace(30), recibidoEn: hace(30), ciclo: 2 } });
    const evidencias: EvidenciaFila[] = [
      { id: 'e1', hitoId: '1-salida_carga', ciclo: 1, tipo: 'sello', ruta: 'x', creadaEn: hace(60) },
      { id: 'e2', hitoId: '1-salida_carga', ciclo: 2, tipo: 'sello', ruta: 'y', creadaEn: hace(20) },
      { id: 'e3', hitoId: '1-salida_carga', ciclo: 2, tipo: 'otra', ruta: null, creadaEn: hace(20) },
    ];
    const t = armarTablero(datos([viaje('1')], hs, { evidencias }), cfg(), AHORA);
    expect(t.filas[0].hitos[1].evidencias).toBe(1);
    expect(t.filas[0].hitos[1].fotos).toEqual([{ id: 'e2', tipo: 'sello' }]);
  });

  it('los nombres de sitio salen del catálogo', () => {
    const t = armarTablero(datos([viaje('1', { origenSitioId: 's1', destinoSitioId: 's2' })], hitos('1', {}), { sitios: new Map([['s1', 'Planta Zapopan'], ['s2', 'CEDIS MTY']]) }), cfg(), AHORA);
    expect(t.filas[0]).toMatchObject({ sitioCarga: 'Planta Zapopan', sitioDescarga: 'CEDIS MTY' });
  });
});

describe('la cola de excepciones', () => {
  it('sin coincidencia es excepción mientras el hito siga recibido; una vez validado por la oficina, deja de serlo', () => {
    const veredictos: VeredictoFila[] = [{ hitoId: '1-llegada_carga', ciclo: 1, resultado: 'sin_coincidencia', motivo: null, fuente: 'gps', distanciaM: 900, radioM: 300, toleranciaM: 150, sitioId: 's1', medidaEn: hace(10) }];
    const recibido = hitos('1', { llegada_carga: hace(10) });
    const t = armarTablero(datos([viaje('1')], recibido, { veredictos, sitios: new Map([['s1', 'Planta Zapopan']]) }), cfg(), AHORA);
    const e = t.excepciones.find((x) => x.tipo === 'sin_coincidencia');
    expect(e).toMatchObject({ gravedad: 2, hitoTipo: 'llegada_carga' });
    expect(e?.texto).toMatch(/revísalo antes de dar por mala la llegada/);

    const validado = hitos('1', { llegada_carga: { estado: 'validado', fuente: 'texto', mensajeEn: hace(10), recibidoEn: hace(10), validadoEn: hace(1), validadoPor: 'oficina' } });
    const t2 = armarTablero(datos([viaje('1')], validado, { veredictos }), cfg(), AHORA);
    expect(t2.excepciones.find((x) => x.tipo === 'sin_coincidencia')).toBeUndefined();
  });

  it('«sin dato» NO es excepción (no se acusa lo que no se pudo medir)', () => {
    const veredictos: VeredictoFila[] = [{ hitoId: '1-llegada_carga', ciclo: 1, resultado: 'sin_dato', motivo: 'sin_sitio', fuente: null, distanciaM: null, radioM: null, toleranciaM: 150, sitioId: null, medidaEn: null }];
    const t = armarTablero(datos([viaje('1')], hitos('1', { llegada_carga: hace(10) }), { veredictos }), cfg(), AHORA);
    expect(t.excepciones.find((x) => x.tipo === 'sin_coincidencia')).toBeUndefined();
  });

  describe('llegada sin confirmar (adversarial ronda 03): el «ya llegué» que ninguna posición respalda es visible', () => {
    const sinDato = (motivo: string): VeredictoFila[] => [{ hitoId: '1-llegada_carga', ciclo: 1, resultado: 'sin_dato', motivo: motivo as VeredictoFila['motivo'], fuente: null, distanciaM: null, radioM: null, toleranciaM: 150, sitioId: null, medidaEn: null }];
    const conSitio = { origenSitioId: 's1' };

    it('sin posición (sin_ubicacion) o con la posición fuera de ventana: excepción «Vigilar», dicha sin acusar', () => {
      for (const motivo of ['sin_ubicacion', 'ubicacion_fuera_de_ventana']) {
        const t = armarTablero(datos([viaje('1', conSitio)], hitos('1', { llegada_carga: hace(30) }), { veredictos: sinDato(motivo) }), cfg(), AHORA);
        const e = t.excepciones.find((x) => x.tipo === 'llegada_sin_confirmar');
        expect(e).toMatchObject({ gravedad: 1, hitoTipo: 'llegada_carga', hitoId: '1-llegada_carga' });
        expect(e?.texto).toMatch(/sin confirmar/i);
        expect(e?.texto).not.toMatch(/mintió|falso/i);
      }
    });

    it('sin veredicto y con sitio asignado también (la validación pudo fallar); sin sitio no hay nada que confirmar', () => {
      const con = armarTablero(datos([viaje('1', conSitio)], hitos('1', { llegada_carga: hace(30) })), cfg(), AHORA);
      expect(con.excepciones.find((x) => x.tipo === 'llegada_sin_confirmar')).toBeDefined();
      const sin = armarTablero(datos([viaje('1')], hitos('1', { llegada_carga: hace(30) })), cfg(), AHORA);
      expect(sin.excepciones.find((x) => x.tipo === 'llegada_sin_confirmar')).toBeUndefined();
      const sinSitio = armarTablero(datos([viaje('1', conSitio)], hitos('1', { llegada_carga: hace(30) }), { veredictos: sinDato('sin_sitio') }), cfg(), AHORA);
      expect(sinSitio.excepciones.find((x) => x.tipo === 'llegada_sin_confirmar')).toBeUndefined();
    });

    it('SIN SITIO asignado el «ya llegué» sale como «llegada sin sitio para conciliar» (con o sin veredicto «sin sitio»), no como «sin confirmar»', () => {
      const sinVeredicto = armarTablero(datos([viaje('1')], hitos('1', { llegada_carga: hace(30) })), cfg(), AHORA);
      const e = sinVeredicto.excepciones.find((x) => x.tipo === 'llegada_sin_sitio');
      expect(e).toMatchObject({ gravedad: 1, hitoTipo: 'llegada_carga', hitoId: '1-llegada_carga' });
      expect(e?.texto).toMatch(/no tiene sitio de carga asignado/);
      expect(e?.texto).not.toMatch(/mintió|falso/i);
      expect(sinVeredicto.excepciones.find((x) => x.tipo === 'llegada_sin_confirmar')).toBeUndefined();

      const conVeredicto = armarTablero(datos([viaje('1', conSitio)], hitos('1', { llegada_carga: hace(30) }), { veredictos: sinDato('sin_sitio') }), cfg(), AHORA);
      expect(conVeredicto.excepciones.find((x) => x.tipo === 'llegada_sin_sitio')).toBeDefined();
      expect(conVeredicto.excepciones.find((x) => x.tipo === 'llegada_sin_confirmar')).toBeUndefined();
    });

    it('la de «sin sitio» respeta lo mismo que las demás: gracia de minutos, oficina, validación apagada, y con sitio no aparece', () => {
      expect(armarTablero(datos([viaje('1')], hitos('1', { llegada_carga: hace(3) })), cfg(), AHORA).excepciones.find((x) => x.tipo === 'llegada_sin_sitio')).toBeUndefined();
      const ofi = hitos('1', { llegada_carga: { estado: 'recibido', fuente: 'oficina', mensajeEn: hace(30), recibidoEn: hace(30) } });
      expect(armarTablero(datos([viaje('1')], ofi), cfg(), AHORA).excepciones.find((x) => x.tipo === 'llegada_sin_sitio')).toBeUndefined();
      expect(armarTablero(datos([viaje('1')], hitos('1', { llegada_carga: hace(30) })), cfg({ validarUbicacion: false }), AHORA).excepciones.find((x) => x.tipo === 'llegada_sin_sitio')).toBeUndefined();
      expect(armarTablero(datos([viaje('1', conSitio)], hitos('1', { llegada_carga: hace(30) })), cfg(), AHORA).excepciones.find((x) => x.tipo === 'llegada_sin_sitio')).toBeUndefined();
    });

    it('un aviso de hace pocos minutos todavía no es excepción (el GPS reporta con retraso)', () => {
      const t = armarTablero(datos([viaje('1', conSitio)], hitos('1', { llegada_carga: hace(3) }), { veredictos: sinDato('sin_ubicacion') }), cfg(), AHORA);
      expect(t.excepciones.find((x) => x.tipo === 'llegada_sin_confirmar')).toBeUndefined();
    });

    it('validada, declarada por la oficina o con la validación apagada: no es excepción', () => {
      const validado = hitos('1', { llegada_carga: { estado: 'validado', fuente: 'texto', mensajeEn: hace(30), recibidoEn: hace(30), validadoEn: hace(20), validadoPor: 'gps' } });
      const ofi = hitos('1', { llegada_carga: { estado: 'recibido', fuente: 'oficina', mensajeEn: hace(30), recibidoEn: hace(30) } });
      for (const hs of [validado, ofi]) {
        const t = armarTablero(datos([viaje('1', conSitio)], hs, { veredictos: sinDato('sin_ubicacion') }), cfg(), AHORA);
        expect(t.excepciones.find((x) => x.tipo === 'llegada_sin_confirmar')).toBeUndefined();
      }
      const apagada = armarTablero(datos([viaje('1', conSitio)], hitos('1', { llegada_carga: hace(30) }), { veredictos: sinDato('sin_ubicacion') }), cfg({ validarUbicacion: false }), AHORA);
      expect(apagada.excepciones.find((x) => x.tipo === 'llegada_sin_confirmar')).toBeUndefined();
    });

    it('«sin coincidencia» conserva SU excepción y no se duplica con la de «sin confirmar»', () => {
      const v: VeredictoFila[] = [{ hitoId: '1-llegada_carga', ciclo: 1, resultado: 'sin_coincidencia', motivo: null, fuente: 'gps', distanciaM: 900, radioM: 300, toleranciaM: 150, sitioId: 's1', medidaEn: hace(10) }];
      const t = armarTablero(datos([viaje('1', conSitio)], hitos('1', { llegada_carga: hace(30) }), { veredictos: v }), cfg(), AHORA);
      expect(t.excepciones.filter((x) => x.hitoId === '1-llegada_carga' && ['sin_coincidencia', 'llegada_sin_confirmar'].includes(x.tipo)).map((x) => x.tipo)).toEqual(['sin_coincidencia']);
    });
  });

  it('estadía excedida: parada en curso sobre el umbral de la flota', () => {
    const hs = hitos('1', { llegada_carga: hace(200) });
    const t = armarTablero(datos([viaje('1')], hs), cfg({ estadiaAlertaCargaMin: 120 }), AHORA);
    expect(t.excepciones.find((x) => x.tipo === 'estadia_excedida')).toMatchObject({ gravedad: 2, hitoTipo: 'llegada_carga' });
    const apagada = armarTablero(datos([viaje('1')], hs), cfg({ estadiaAlertaCargaMin: null }), AHORA);
    expect(apagada.excepciones.find((x) => x.tipo === 'estadia_excedida')).toBeUndefined();
  });

  it('horas incoherentes (salida antes que llegada) se marcan para corregir', () => {
    const hs = hitos('1', { llegada_carga: hace(60), salida_carga: hace(120) });
    const t = armarTablero(datos([viaje('1')], hs), cfg(), AHORA);
    expect(t.excepciones.find((x) => x.tipo === 'horas_incoherentes')).toMatchObject({ gravedad: 1, hitoTipo: 'salida_carga' });
  });

  it('ordena: lo más grave primero y, a igual gravedad, lo más viejo primero', () => {
    const hs = [
      ...hitos('1', { llegada_carga: { estado: 'escalado', escaladoEn: hace(50), escalacionNivel: 1 } }),
      ...hitos('2', { llegada_carga: { estado: 'escalado', escaladoEn: hace(100), escalacionNivel: 2 } }),
      ...hitos('3', {}),
    ];
    const t = armarTablero(datos([viaje('1'), viaje('2'), viaje('3', { aceptadoEn: hace(120 + 20) })], hs), cfg(), AHORA);
    expect(t.excepciones.map((e) => [e.tipo, e.viajeId])).toEqual([['escalado_sin_atender', '2'], ['escalado_sin_atender', '1'], ['atrasado', '3']]);
  });

  it('las filas van de lo más urgente a lo menos y los conteos suman todas', () => {
    const hs = [
      ...hitos('a', { llegada_carga: hace(500), salida_carga: hace(400), llegada_descarga: hace(300), salida_descarga: hace(200), regreso: hace(100) }),
      ...hitos('b', {}),
      ...hitos('c', { llegada_carga: { estado: 'escalado', escaladoEn: hace(5), escalacionNivel: 1 } }),
    ];
    const t = armarTablero(datos([viaje('a'), viaje('b', { citaOrigenEn: new Date(AHORA.getTime() + 3_600_000).toISOString() }), viaje('c')], hs), cfg(), AHORA);
    expect(t.filas.map((f) => f.viaje.id)).toEqual(['c', 'b', 'a']);
    expect(Object.values(t.conteos).reduce((x, y) => x + y, 0)).toBe(3);
  });

  it('hayMas del lector se conserva (el tablero lo dice, no esconde el resto)', () => {
    expect(armarTablero(datos([], [], { hayMas: true }), cfg(), AHORA).hayMas).toBe(true);
  });
});

describe('filtrarPorSemaforo', () => {
  it('el filtro mueve TODO lo que hay debajo: filas y cola', () => {
    const hs = [
      ...hitos('1', { llegada_carga: { estado: 'escalado', escaladoEn: hace(5), escalacionNivel: 1 } }),
      // Las llegadas de un viaje completo las declaró la oficina: un «ya llegué» sin conciliar sería otra excepción, y aquí no la hay.
      ...hitos('2', {
        llegada_carga: { estado: 'recibido', fuente: 'oficina', mensajeEn: hace(500), recibidoEn: hace(500) }, salida_carga: hace(400),
        llegada_descarga: { estado: 'recibido', fuente: 'oficina', mensajeEn: hace(300), recibidoEn: hace(300) }, salida_descarga: hace(200), regreso: hace(100),
      }),
    ];
    const t = armarTablero(datos([viaje('1'), viaje('2')], hs), cfg(), AHORA);
    const f = filtrarPorSemaforo(t, 'completo');
    expect(f.filas.map((x) => x.viaje.id)).toEqual(['2']);
    expect(f.excepciones).toEqual([]);
    expect(filtrarPorSemaforo(t, 'sin_reporte').excepciones).toHaveLength(1);
    expect(filtrarPorSemaforo(t, null)).toBe(t);
  });
});

describe('indicadoresVista', () => {
  const crudos = { recibidos: 40, sinInsistencia: 30, conRespuestaMedida: 25, minutosRespuestaPromedio: 12.4, escalados: 3, omitidos: 2, validadosUbicacion: 20, sinCoincidencia: 1, capturadosOficina: 4 };
  it('la tasa de hitos reportados sin insistencia y el tiempo medio de respuesta', () => {
    expect(indicadoresVista(crudos)).toMatchObject({ tasaSinInsistencia: 0.75, minutosRespuestaPromedio: 12.4, escalados: 3 });
  });
  it('sin hitos recibidos la tasa es null (no un 0% que parezca medición)', () => {
    expect(indicadoresVista({ ...crudos, recibidos: 0, sinInsistencia: 0 }).tasaSinInsistencia).toBeNull();
  });
  it('sin respuestas medibles el tiempo medio es null aunque la base mande un número', () => {
    expect(indicadoresVista({ ...crudos, conRespuestaMedida: 0, minutosRespuestaPromedio: 0 }).minutosRespuestaPromedio).toBeNull();
  });
});

describe('excepción «sin a quién escalar» (T-A5-23)', () => {
  const hs = hitos('1', {});
  const faltan = nivelesSinDestino([], null, 'tm1', 'Tlaquepaque');
  const alertas = (t: ReturnType<typeof armarTablero>) => t.excepciones.filter((e) => e.tipo === 'sin_a_quien_escalar');

  it('sin datos de escalamiento no inventa alerta', () => {
    expect(alertas(armarTablero(datos([viaje('1')], hs), cfg(), AHORA))).toEqual([]);
  });

  it('terminal sin contactos ni jefe: una excepción por nivel, con el texto exacto, el nivel 1 como urgente', () => {
    const ex = alertas(armarTablero(datos([viaje('1')], hs, { sinDestino: faltan }), cfg(), AHORA));
    expect(ex.map((e) => e.gravedad)).toEqual([3, 2]);
    expect(ex[0].texto).toBe('El nivel 1 (Patio responsable) de Tlaquepaque no tiene a quién avisar. Agrega un contacto en Configuración.');
  });

  it('con contacto en ambos niveles o con jefe de respaldo no hay nada que avisar', () => {
    const con = [{ nivel: 1 as const, terminalId: null, telefono: '523312345678', nombre: 'A' }, { nivel: 2 as const, terminalId: null, telefono: '523398765432', nombre: 'B' }]; // grep-limpio:ok
    expect(alertas(armarTablero(datos([viaje('1')], hs, { sinDestino: nivelesSinDestino(con, null, 'tm1', 'T') }), cfg(), AHORA))).toEqual([]);
    expect(alertas(armarTablero(datos([viaje('1')], hs, { sinDestino: nivelesSinDestino([], '523312345678', 'tm1', 'T') }), cfg(), AHORA))).toEqual([]); // grep-limpio:ok
  });

  it('un hueco de una terminal sin viajes listados no aparece', () => {
    expect(alertas(armarTablero(datos([viaje('1')], hs, { sinDestino: nivelesSinDestino([], null, 'otra', 'Otra') }), cfg(), AHORA))).toEqual([]);
  });
});

// ── T-A5-21: estados de frontera como hito OPCIONAL visible (informativo, no escala) ─────────────────────────────
describe('estados de frontera (T-A5-21)', () => {
  const tr = (id: string, estado: 'en_patio' | 'en_ruta' | 'pendiente_cruce' | 'otro', textoOrigen: string | null, min: number | null) =>
    new Map([[id, { estado, textoOrigen, actualizadoEn: min === null ? null : hace(min) }]]);
  const con = (extra: Partial<ConfigConductor>, t: DatosTablero['transito'], aceptado = 30) =>
    armarTablero(datos([viaje('1', { aceptadoEn: hace(aceptado) })], hitos('1', {}), { transito: t }), cfg(extra), AHORA);

  it('casilla encendida: «En patio NLD desde hace 7 h» con el texto exacto', () => {
    const t = con({ mostrarEstadosFrontera: true }, tr('1', 'en_patio', 'PATIO NLD', 7 * 60));
    expect(t.filas[0].transito).toEqual({ estado: 'en_patio', texto: 'En patio NLD desde hace 7 h', minutos: 420 });
  });

  it('los demás estados y el borde de minutos', () => {
    expect(con({ mostrarEstadosFrontera: true }, tr('1', 'en_ruta', 'EN RUTA', 90)).filas[0].transito?.texto).toBe('En ruta desde hace 1 h 30 min');
    expect(con({ mostrarEstadosFrontera: true }, tr('1', 'pendiente_cruce', 'PEND CRUCE', 20)).filas[0].transito?.texto).toBe('Pendiente de cruce desde hace 20 min');
    expect(con({ mostrarEstadosFrontera: true }, tr('1', 'en_patio', 'patio', 5)).filas[0].transito?.texto).toBe('En patio desde hace 5 min');
    expect(con({ mostrarEstadosFrontera: true }, tr('1', 'otro', 'REVISION X', 10)).filas[0].transito?.texto).toBe('Tránsito: REVISION X desde hace 10 min');
  });

  it('sin fecha de actualización lo dice en vez de inventar horas', () => {
    expect(con({ mostrarEstadosFrontera: true }, tr('1', 'en_patio', 'PATIO NLD', null)).filas[0].transito)
      .toEqual({ estado: 'en_patio', texto: 'En patio NLD (sin fecha de actualización)', minutos: null });
  });

  it('casilla apagada (o dato ausente / sin lectura): la columna no existe', () => {
    expect(con({ mostrarEstadosFrontera: false }, tr('1', 'pendiente_cruce', 'PEND CRUCE', 500)).filas[0].transito).toBeNull();
    expect(con({ mostrarEstadosFrontera: true }, undefined).filas[0].transito).toBeNull();
    expect(con({ mostrarEstadosFrontera: true }, new Map()).filas[0].transito).toBeNull();
  });

  it('excepción de lectura SOLO con umbral configurado y pendiente_cruce por encima; desactivada por omisión', () => {
    const t = tr('1', 'pendiente_cruce', 'PEND CRUCE', 7 * 60);
    expect(con({ mostrarEstadosFrontera: true }, t).excepciones).toEqual([]);
    expect(con({ mostrarEstadosFrontera: true, umbralPendienteCruceH: null }, t).excepciones).toEqual([]);
    const ex = con({ mostrarEstadosFrontera: true, umbralPendienteCruceH: 6 }, t).excepciones;
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ tipo: 'pendiente_cruce_largo', gravedad: 1, hitoId: null });
    expect(ex[0].texto).toContain('Pendiente de cruce desde hace 7 h');
    // exactamente en el umbral cuenta; un minuto antes no
    expect(con({ mostrarEstadosFrontera: true, umbralPendienteCruceH: 7 }, t).excepciones).toHaveLength(1);
    expect(con({ mostrarEstadosFrontera: true, umbralPendienteCruceH: 8 }, t).excepciones).toEqual([]);
    // otro estado largo o casilla apagada: nada
    expect(con({ mostrarEstadosFrontera: true, umbralPendienteCruceH: 6 }, tr('1', 'en_patio', 'PATIO NLD', 900)).excepciones).toEqual([]);
    expect(con({ mostrarEstadosFrontera: false, umbralPendienteCruceH: 6 }, t).excepciones).toEqual([]);
  });

  it('es informativo: no cambia semáforo, motivo, hitos, conteos ni excepciones de hitos', () => {
    const t = tr('1', 'pendiente_cruce', 'PEND CRUCE', 900);
    const sin = con({ mostrarEstadosFrontera: false }, t, 140);
    const con1 = con({ mostrarEstadosFrontera: true }, t, 140);
    expect(con1.filas[0].semaforo).toBe(sin.filas[0].semaforo);
    expect(con1.filas[0].motivo).toBe(sin.filas[0].motivo);
    expect(con1.filas[0].hitos).toEqual(sin.filas[0].hitos);
    expect(con1.conteos).toEqual(sin.conteos);
    expect(con1.excepciones).toEqual(sin.excepciones);
  });
});

// ── T-A5-57: viaje local «abierto sin Carta Porte» visible (solo lectura; no cierra ni emite nada) ─────────────────
describe('viaje local abierto sin Carta Porte (T-A5-57)', () => {
  const tr = (estado: 'en_ruta' | 'otro', textoOrigen: string, min: number | null) =>
    new Map([['1', { estado, textoOrigen, actualizadoEn: min === null ? null : hace(min) }]]);
  const con = (extra: Partial<ConfigConductor>, t: DatosTablero['transito'], ccp?: ReadonlySet<string>) =>
    armarTablero(datos([viaje('1', { aceptadoEn: hace(600) })], hitos('1', {}), { transito: t, ccpLigado: ccp }), cfg(extra), AHORA);
  const local = tr('otro', 'LOCAL ABIERTO', 150);
  const sinCcp = (t: ReturnType<typeof con>) => t.excepciones.filter((e) => e.tipo === 'local_abierto_sin_ccp');

  it('local abierto sin complemento ligado: excepción con los minutos transcurridos', () => {
    const ex = sinCcp(con({ mostrarEstadosFrontera: true }, local, new Set()));
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ tipo: 'local_abierto_sin_ccp', viajeId: '1', gravedad: 1, hitoId: null, hitoTipo: null });
    expect(ex[0].texto).toContain('sin Carta Porte (viaje local abierto)');
    expect(ex[0].texto).toContain('2 h 30 min');
    expect(ex[0].desde).not.toBeNull();
  });

  it('la excepción desaparece al llegar la Carta Porte', () => {
    expect(sinCcp(con({ mostrarEstadosFrontera: true }, local, new Set(['1'])))).toEqual([]);
  });

  it('sin lectura de complementos no se afirma «sin Carta Porte»', () => {
    expect(sinCcp(con({ mostrarEstadosFrontera: true }, local, undefined))).toEqual([]);
  });

  it('casilla de estados apagada o viaje que no es local abierto: nada (sin regresión de otros estados)', () => {
    expect(sinCcp(con({ mostrarEstadosFrontera: false }, local, new Set()))).toEqual([]);
    expect(sinCcp(con({ mostrarEstadosFrontera: true }, tr('en_ruta', 'EN RUTA', 150), new Set()))).toEqual([]);
    expect(sinCcp(con({ mostrarEstadosFrontera: true }, tr('otro', 'EN TALLER', 150), new Set()))).toEqual([]);
  });

  it('sin fecha de actualización lo dice en vez de inventar minutos', () => {
    const ex = sinCcp(con({ mostrarEstadosFrontera: true }, tr('otro', 'local abierto', null), new Set()));
    expect(ex).toHaveLength(1);
    expect(ex[0].desde).toBeNull();
    expect(ex[0].texto).toContain('sin fecha de actualización');
  });

  it('solo lectura: no cambia semáforo, motivo, hitos ni conteos, y el viaje sigue en la lista (no se cierra ni sale «fuera de ruta»)', () => {
    const sin = con({ mostrarEstadosFrontera: false }, local, new Set());
    const con1 = con({ mostrarEstadosFrontera: true }, local, new Set());
    expect(con1.filas).toHaveLength(1);
    expect(con1.filas[0].semaforo).toBe(sin.filas[0].semaforo);
    expect(con1.filas[0].motivo).toBe(sin.filas[0].motivo);
    expect(con1.filas[0].hitos).toEqual(sin.filas[0].hitos);
    expect(con1.conteos).toEqual(sin.conteos);
    expect(con1.filas[0].transito?.texto).toContain('Local abierto');
  });
});


// ── T-A5-49: viaje aceptado sin ruta autorizada vigente = excepción visible (el chofer recibió «consulta con tu supervisor») ──
describe('sin ruta autorizada (T-A5-49)', () => {
  const URL = 'https://maps.app.goo.gl/EjemploSintetico';
  const ruta = (p: Record<string, unknown> = {}) => ({ id: 'r1', corredor: 'monterrey', sitioOrigen: null, sitioDestino: null, url: URL, vigenteHasta: null, revisadaEn: null, ...p });
  const con = (rutas: DatosTablero['rutasAutorizadas'], v: Partial<ViajeTablero> = {}, extra: Partial<DatosTablero> = {}) =>
    armarTablero(datos([viaje('1', { aceptadoEn: hace(600), ...v })], hitos('1', {}), { rutasAutorizadas: rutas, ...extra }), cfg(), AHORA);
  const sinRuta = (t: ReturnType<typeof con>) => t.excepciones.filter((e) => e.tipo === 'sin_ruta_autorizada');

  it('con la base de rutas en uso y ninguna que le quede al viaje: excepción visible, de revisar, sin tocar el semáforo', () => {
    const t = con([ruta({ corredor: 'tijuana' })]);
    const ex = sinRuta(t);
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ tipo: 'sin_ruta_autorizada', viajeId: '1', folio: 'F-1', gravedad: 2, hitoId: null, hitoTipo: null });
    expect(ex[0].texto).toMatch(/consulta con tu supervisor/);
    expect(t.filas[0].semaforo).toBe(con([ruta()]).filas[0].semaforo);
  });

  it('si hay ruta vigente del corredor (destino del viaje = Monterrey) no hay excepción', () => {
    expect(sinRuta(con([ruta()]))).toEqual([]);
  });

  it('con el código del sitio de origen, la ruta de ese sitio sirve; la de otro sitio no', () => {
    const sitioCodigos = new Map([['g1', 'pl-01']]);
    expect(sinRuta(con([ruta({ sitioOrigen: 'pl-01' })], { origenSitioId: 'g1' }, { sitioCodigos }))).toEqual([]);
    expect(sinRuta(con([ruta({ sitioOrigen: 'pl-77' })], { origenSitioId: 'g1' }, { sitioCodigos }))).toHaveLength(1);
  });

  it('una ruta vencida cuenta como ausente (la fecha es la del día en México)', () => {
    expect(sinRuta(con([ruta({ vigenteHasta: '2026-10-01' })]))).toHaveLength(1);
    expect(sinRuta(con([ruta({ vigenteHasta: '2026-10-02' })]))).toEqual([]);
  });

  it('flota que aún no cargó ninguna ruta, o lectura que no se pudo hacer: no se afirma nada', () => {
    expect(sinRuta(con([]))).toEqual([]);
    expect(sinRuta(con(undefined))).toEqual([]);
  });
});
