import { describe, expect, it } from 'vitest';
import { calcularInsights, MENSAJE_SIN_LINEA_BASE, SIN_DATO, type CruceParaInsights, type EntradaInsights, type HitoParaInsights } from './insights';

const T0 = Date.parse('2026-03-02T12:00:00.000Z');
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();

const hito = (p: Partial<HitoParaInsights>): HitoParaInsights => ({ estado: 'recibido', fuente: 'sistema', mensajeEn: null, recibidoEn: null, ...p });

/** 20 hitos sintéticos: 14 por GPS, 4 por botón, 2 de oficina. */
function dataset(): { hitos: HitoParaInsights[]; cruces: CruceParaInsights[] } {
  const hitos: HitoParaInsights[] = [];
  const cruces: CruceParaInsights[] = [];
  for (let i = 0; i < 14; i++) {
    hitos.push(hito({ fuente: 'sistema', estado: 'validado' }));
    // retrasos del sistema: 1..14 min → promedio exacto 7.5
    cruces.push({ detectadoEn: iso(i * 10), registradoEn: iso(i * 10 + (i + 1)) });
  }
  // botón: retrasos de entrega 2, 4, 6, 8 → promedio exacto 5
  for (const r of [2, 4, 6, 8]) hitos.push(hito({ fuente: 'boton', mensajeEn: iso(0), recibidoEn: iso(r) }));
  for (let i = 0; i < 2; i++) hitos.push(hito({ fuente: 'oficina', estado: 'validado' }));
  return { hitos, cruces };
}

const entrada = (p: Partial<EntradaInsights> = {}): EntradaInsights => ({
  ...dataset(), episodios: [], viajesSinSitio: null, lineaBase: null, ...p,
});

describe('insights del Conductor (T-A5-31)', () => {
  it('sin intervención = 18 de 20 (90 %): los hitos de oficina NO cuentan', () => {
    const r = calcularInsights(entrada());
    expect(r.hitosRegistrados.valor).toBe(20);
    expect(r.sinIntervencion.valor).toBe(18);
    expect(r.sinIntervencion.porcentaje).toBe(90);
    expect(r.deOficina.valor).toBe(2);
    expect(r.sinIntervencion).toMatchObject({ fuente: 'viaje_hito.fuente', rotulo: 'medido' });
  });

  it('retrasos con promedio exacto, GPS y chofer por separado', () => {
    const r = calcularInsights(entrada());
    expect(r.retrasoGps.promedioMin).toBe(7.5);
    expect(r.retrasoGps.mediciones).toBe(14);
    expect(r.retrasoChofer.promedioMin).toBe(5);
    expect(r.retrasoChofer.mediciones).toBe(4);
    expect(r.retrasoGps.fuente).toContain('viaje_cruce_geocerca');
    expect(r.retrasoChofer.fuente).toContain('viaje_hito');
    expect(r.retrasoChofer.nota).toMatch(/no mide cuándo ocurrió el evento físico/);
  });

  it('el tiempo del chofer no se mezcla con el del GPS: un hito del sistema no aporta al del chofer', () => {
    const r = calcularInsights({
      hitos: [hito({ fuente: 'sistema', mensajeEn: iso(0), recibidoEn: iso(100) })],
      cruces: [], episodios: [], viajesSinSitio: null, lineaBase: null,
    });
    expect(r.retrasoChofer.promedioMin).toBeNull();
    expect(r.retrasoGps.promedioMin).toBeNull();
  });

  it('retrasos negativos o sin fecha se descartan y se cuentan, no se promedian', () => {
    const r = calcularInsights({
      hitos: [hito({ fuente: 'texto', mensajeEn: iso(10), recibidoEn: iso(0) }), hito({ fuente: 'texto', mensajeEn: null, recibidoEn: iso(1) }), hito({ fuente: 'texto', mensajeEn: iso(0), recibidoEn: iso(3) })],
      cruces: [{ detectadoEn: iso(5), registradoEn: iso(1) }], episodios: [], viajesSinSitio: null, lineaBase: null,
    });
    expect(r.retrasoChofer).toMatchObject({ promedioMin: 3, mediciones: 1, descartadas: 2 });
    expect(r.retrasoGps).toMatchObject({ promedioMin: null, mediciones: 0, descartadas: 1 });
  });

  it('sin línea base: llamadasEvitadas es null y trae el mensaje que la pide', () => {
    for (const lineaBase of [null, { llamadasPorViaje: null, registradaEn: null }, { llamadasPorViaje: 0, registradaEn: '2026-03-01' }]) {
      const r = calcularInsights(entrada({ lineaBase }));
      expect(r.llamadasEvitadas.valor).toBeNull();
      expect(r.llamadasEvitadas.mensaje).toBe(MENSAJE_SIN_LINEA_BASE);
    }
  });

  it('con línea base de 2 llamadas por hito: 36, rotulada estimación con su fecha', () => {
    const r = calcularInsights(entrada({ lineaBase: { llamadasPorViaje: 2, registradaEn: '2026-03-01' } }));
    expect(r.llamadasEvitadas.valor).toBe(36);
    expect(r.llamadasEvitadas.rotulo).toBe('estimación');
    expect(r.llamadasEvitadas.mensaje).toBe('Estimación con tu línea base de 2026-03-01');
    expect(r.llamadasEvitadas.fuente).toContain('linea_base_llamadas_por_viaje');
  });

  it('un hito esperado, omitido o escalado no es «registrado»; foto y sin fuente no cuentan como sin intervención', () => {
    const r = calcularInsights({
      hitos: [
        hito({ estado: 'esperado', fuente: null }), hito({ estado: 'omitido', fuente: null }), hito({ estado: 'escalado', fuente: null }),
        hito({ fuente: 'foto' }), hito({ fuente: null }), hito({ fuente: 'texto' }),
      ],
      cruces: [], episodios: [], viajesSinSitio: 3, lineaBase: null,
    });
    expect(r.hitosRegistrados.valor).toBe(3);
    expect(r.sinIntervencion.valor).toBe(1);
    expect(r.otraFuente.valor).toBe(2);
    expect(r.excepciones.sinRespuesta.valor).toBe(1);
    expect(r.excepciones.sinSitio.valor).toBe(3);
  });

  it('sin hitos: porcentaje null, nada se inventa', () => {
    const r = calcularInsights({ hitos: [], cruces: [], episodios: [], viajesSinSitio: null, lineaBase: { llamadasPorViaje: 2, registradaEn: null } });
    expect(r.sinIntervencion.porcentaje).toBeNull();
    expect(r.llamadasEvitadas.valor).toBe(0);
    expect(r.llamadasEvitadas.mensaje).toBe('Estimación con tu línea base de fecha no registrada');
    expect(r.excepciones.sinSitio.valor).toBeNull();
  });

  it('cuenta la escalera de avisos: 1, 2 y jefe, y los episodios sin señal', () => {
    const r = calcularInsights(entrada({
      episodios: [
        { motivo: 'gps_obsoleto', aviso1En: iso(0), aviso2En: null, escaladoEn: null },
        { motivo: 'gps_detenido', aviso1En: iso(0), aviso2En: iso(20), escaladoEn: null },
        { motivo: 'gps_obsoleto', aviso1En: iso(0), aviso2En: iso(20), escaladoEn: iso(40) },
      ],
    }));
    expect(r.excepciones.sinSenal.valor).toBe(3);
    expect([r.escalera.aviso1.valor, r.escalera.aviso2.valor, r.escalera.jefe.valor]).toEqual([3, 2, 1]);
  });

  it('toda cifra trae fuente y rótulo', () => {
    const r = calcularInsights(entrada({ lineaBase: { llamadasPorViaje: 2, registradaEn: '2026-03-01' } }));
    const cifras = [r.hitosRegistrados, r.sinIntervencion, r.deOficina, r.otraFuente, r.llamadasEvitadas, ...Object.values(r.excepciones), ...Object.values(r.escalera)];
    for (const c of cifras) {
      expect(c.fuente.length).toBeGreaterThan(0);
      expect(['medido', 'estimación']).toContain(c.rotulo);
    }
    expect(r.retrasoGps.rotulo).toBe('medido');
  });
});

describe('KPIs del piloto (T-A5-61): con línea base declarada o «sin dato», nunca un porcentaje inventado', () => {
  const kpi = (r: ReturnType<typeof calcularInsights>, id: string) => {
    const k = r.kpisPiloto.find((x) => x.id === id);
    if (!k) throw new Error(`falta el KPI ${id}`);
    return k;
  };
  const hv = (viajeId: string, tipo: 'llegada_carga' | 'salida_carga' | 'llegada_descarga', p: Partial<HitoParaInsights> = {}): HitoParaInsights => ({
    ...hito({ fuente: 'sistema' }), viajeId, tipo, ...p,
  });

  it('son exactamente seis, en orden: los cuatro de la ficha y los dos de referencia (16b)', () => {
    const r = calcularInsights(entrada());
    expect(r.kpisPiloto.map((k) => k.id)).toEqual([
      'hitos_sin_intervencion', 'minutos_gps_registro', 'viajes_completos', 'mensajes_supervisor_evitados',
      'salida_terminal_primer_cliente', 'reubicaciones_por_cliente',
    ]);
    for (const k of r.kpisPiloto) { expect(k.fuente.length).toBeGreaterThan(0); expect(k.calculo.length).toBeGreaterThan(0); }
  });

  it('sin ninguna línea base: sin comparación («sin dato»); los dos de referencia ni siquiera muestran valor', () => {
    const r = calcularInsights(entrada({ piloto: { minutosSalidaTerminalPrimerCliente: [30, 40], reubicaciones: { total: 4, clientes: 2 } } }));
    expect(kpi(r, 'hitos_sin_intervencion').valor).toBe(90);
    expect(kpi(r, 'hitos_sin_intervencion').contraBase).toBe(SIN_DATO);
    expect(kpi(r, 'minutos_gps_registro').valor).toBe(7.5);
    expect(kpi(r, 'minutos_gps_registro').contraBase).toBe(SIN_DATO);
    expect(kpi(r, 'mensajes_supervisor_evitados').valor).toBeNull();
    expect(kpi(r, 'mensajes_supervisor_evitados').contraBase).toBe(SIN_DATO);
    for (const id of ['salida_terminal_primer_cliente', 'reubicaciones_por_cliente']) {
      expect(kpi(r, id).valor).toBeNull();
      expect(kpi(r, id).contraBase).toBe(SIN_DATO);
    }
    expect(JSON.stringify(r.kpisPiloto)).not.toMatch(/NaN|Infinity/);
  });

  it('con línea base declarada compara: mejora en puntos/minutos y su % solo si la base es mayor que cero', () => {
    const r = calcularInsights(entrada({
      piloto: {
        lineaBase: { hitosSinIntervencionPct: 40, minutosGpsRegistro: 15, viajesCompletosPct: null, minutosSalidaTerminalPrimerCliente: 50, reubicacionesPorCliente: 0 },
        minutosSalidaTerminalPrimerCliente: [30, 40],
        reubicaciones: { total: 4, clientes: 2 },
      },
    }));
    expect(kpi(r, 'hitos_sin_intervencion').contraBase).toEqual({ lineaBase: 40, diferencia: 50, mejoraPct: null, mejor: true });
    expect(kpi(r, 'minutos_gps_registro').contraBase).toEqual({ lineaBase: 15, diferencia: -7.5, mejoraPct: 50, mejor: true });
    expect(kpi(r, 'salida_terminal_primer_cliente').valor).toBe(35);
    expect(kpi(r, 'salida_terminal_primer_cliente').contraBase).toEqual({ lineaBase: 50, diferencia: -15, mejoraPct: 30, mejor: true });
    // base 0 → no hay % posible (dividir entre cero sería inventar)
    expect(kpi(r, 'reubicaciones_por_cliente').valor).toBe(2);
    expect(kpi(r, 'reubicaciones_por_cliente').contraBase).toEqual({ lineaBase: 0, diferencia: 2, mejoraPct: null, mejor: false });
    expect(kpi(r, 'viajes_completos').contraBase).toBe(SIN_DATO);
  });

  it('una base negativa, no finita o 0 en un KPI donde no es posible, cuenta como no declarada', () => {
    const r = calcularInsights(entrada({ piloto: { lineaBase: { minutosGpsRegistro: -3, hitosSinIntervencionPct: Number.NaN, minutosSalidaTerminalPrimerCliente: 0 }, minutosSalidaTerminalPrimerCliente: [10] } }));
    expect(kpi(r, 'minutos_gps_registro').contraBase).toBe(SIN_DATO);
    expect(kpi(r, 'hitos_sin_intervencion').contraBase).toBe(SIN_DATO);
    expect(kpi(r, 'salida_terminal_primer_cliente').valor).toBeNull();
  });

  it('mensajes del supervisor evitados: es la estimación de llamadas evitadas, solo con su línea base', () => {
    const r = calcularInsights(entrada({ lineaBase: { llamadasPorViaje: 2, registradaEn: '2026-03-01' } }));
    const k = kpi(r, 'mensajes_supervisor_evitados');
    expect(k.valor).toBe(36);
    expect(k.rotulo).toBe('estimación');
    expect(k.contraBase).toEqual({ lineaBase: 2, diferencia: null, mejoraPct: null, mejor: null });
  });

  it('viajes completos: todos los hitos no omitidos del viaje registrados; un viaje con uno pendiente no cuenta', () => {
    const r = calcularInsights({
      hitos: [
        hv('v1', 'llegada_carga'), hv('v1', 'salida_carga'), hv('v1', 'llegada_descarga', { estado: 'omitido', fuente: null }),
        hv('v2', 'llegada_carga'), hv('v2', 'salida_carga', { estado: 'esperado', fuente: null }),
        hv('v3', 'llegada_carga', { estado: 'escalado', fuente: null }),
        hv('v4', 'llegada_carga', { estado: 'validado', fuente: 'oficina' }),
      ],
      cruces: [], episodios: [], viajesSinSitio: null, lineaBase: null,
      piloto: { lineaBase: { viajesCompletosPct: 25 } },
    });
    const k = kpi(r, 'viajes_completos');
    expect(k.valor).toBe(50);
    expect(k.contraBase).toEqual({ lineaBase: 25, diferencia: 25, mejoraPct: null, mejor: true });
  });

  it('viajes completos sin viajeId en los hitos o sin viajes: sin dato (null), no 0 %', () => {
    expect(kpi(calcularInsights(entrada()), 'viajes_completos').valor).toBeNull();
    expect(kpi(calcularInsights({ hitos: [], cruces: [], episodios: [], viajesSinSitio: null, lineaBase: null }), 'viajes_completos').valor).toBeNull();
    // un viaje cuyos hitos están todos omitidos no es «completo»: no hay nada que completar
    const r = calcularInsights({ hitos: [hv('v1', 'llegada_carga', { estado: 'omitido', fuente: null })], cruces: [], episodios: [], viajesSinSitio: null, lineaBase: null });
    expect(kpi(r, 'viajes_completos').valor).toBeNull();
  });

  it('los KPIs de referencia dependen de datos con medición: sin mediciones válidas, sin dato aunque haya base', () => {
    const r = calcularInsights(entrada({
      piloto: {
        lineaBase: { minutosSalidaTerminalPrimerCliente: 50, reubicacionesPorCliente: 1 },
        minutosSalidaTerminalPrimerCliente: [-5, Number.NaN],
        reubicaciones: { total: null, clientes: 0 },
      },
    }));
    expect(kpi(r, 'salida_terminal_primer_cliente').valor).toBeNull();
    expect(kpi(r, 'reubicaciones_por_cliente').valor).toBeNull();
    expect(kpi(r, 'salida_terminal_primer_cliente').contraBase).toBe(SIN_DATO);
  });
});
