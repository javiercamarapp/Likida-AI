import { describe, expect, it } from 'vitest';
import { calcularInsights, MENSAJE_SIN_LINEA_BASE, type CruceParaInsights, type EntradaInsights, type HitoParaInsights } from './insights';

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
