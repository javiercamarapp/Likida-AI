import { describe, it, expect } from 'vitest';
import { aSenalExtra, crearDobleSenales, senalesApagadas, leerSenalExtra, CAPACIDADES_PROVEEDOR, VIGENCIA_SENAL_MIN, type LecturaConduccion, type SenalesConduccion } from './senales_conduccion';
import { puedeEscribirAlChofer, VELOCIDAD_MARCHA_KMH } from './compuerta_movimiento';
import type { MuestraGps, SitiosViaje } from './ciclo_gps';

// Todo sintético: coordenadas inventadas, ningún dato real.
const LAT = 20.7;
const LNG = -103.4;
const grados = (m: number): number => m / 111_195;
const AHORA = new Date('2026-10-02T14:30:00.000Z');
const hace = (seg: number): Date => new Date(AHORA.getTime() - seg * 1000);
const M = (seg: number, desplazaM = 0): MuestraGps => ({ lat: LAT + grados(desplazaM), lng: LNG, medidaEn: hace(seg) });
const QUIETA = [M(240), M(120), M(5)];
const ENCENDIDA = { compuertaMovimientoActiva: true } as const;
const SIN_SITIOS: SitiosViaje = { origen: null, destino: null };
const EN_PATIO: SitiosViaje = { origen: { id: 'p', nombre: 'p', lat: LAT, lng: LNG, radioM: 500 }, destino: null };
const lectura = (extra: Partial<LecturaConduccion> = {}): LecturaConduccion => ({ ignicion: null, velocidadKmh: null, telefonoEnMano: null, medidaEn: hace(30), ...extra });

describe('aSenalExtra — traducción de la lectura del proveedor', () => {
  it('sin lectura, sin hora, con hora ilegible, vieja o futura: null (rige solo-GPS)', () => {
    expect(aSenalExtra(null, AHORA)).toBeNull();
    expect(aSenalExtra(undefined, AHORA)).toBeNull();
    expect(aSenalExtra(lectura({ medidaEn: null }), AHORA)).toBeNull();
    expect(aSenalExtra(lectura({ medidaEn: new Date('x') }), AHORA)).toBeNull();
    expect(aSenalExtra(lectura({ medidaEn: hace((VIGENCIA_SENAL_MIN + 1) * 60) }), AHORA)).toBeNull();
    expect(aSenalExtra(lectura({ medidaEn: new Date(AHORA.getTime() + 10 * 60_000) }), AHORA)).toBeNull();
  });

  it('entrega ignición y velocidad tal cual; lo que no reporta queda null, no falso', () => {
    expect(aSenalExtra(lectura({ ignicion: true, velocidadKmh: 40 }), AHORA)).toEqual({ ignicion: true, velocidadKmh: 40 });
    expect(aSenalExtra(lectura({ ignicion: false }), AHORA)).toEqual({ ignicion: false, velocidadKmh: null });
    expect(aSenalExtra(lectura(), AHORA)).toEqual({ ignicion: null, velocidadKmh: null });
    expect(aSenalExtra(lectura({ velocidadKmh: -3 }), AHORA)?.velocidadKmh).toBeNull();
    expect(aSenalExtra(lectura({ velocidadKmh: Number.NaN }), AHORA)?.velocidadKmh).toBeNull();
  });

  it('«teléfono en la mano» se expresa como marcha (más que el umbral) aunque la velocidad sea baja o falte', () => {
    const solo = aSenalExtra(lectura({ telefonoEnMano: true }), AHORA);
    expect(solo?.velocidadKmh).toBeGreaterThan(VELOCIDAD_MARCHA_KMH);
    const lenta = aSenalExtra(lectura({ telefonoEnMano: true, velocidadKmh: 1 }), AHORA);
    expect(lenta?.velocidadKmh).toBeGreaterThan(VELOCIDAD_MARCHA_KMH);
    const rapida = aSenalExtra(lectura({ telefonoEnMano: true, velocidadKmh: 80 }), AHORA);
    expect(rapida?.velocidadKmh).toBe(80);
    expect(aSenalExtra(lectura({ telefonoEnMano: false, velocidadKmh: 0 }), AHORA)?.velocidadKmh).toBe(0);
  });
});

describe('puertos: apagado y doble', () => {
  it('el puerto apagado nunca entrega señal; el doble entrega por unidad y devuelve null a la desconocida', async () => {
    expect(await senalesApagadas.leer('u1', AHORA)).toBeNull();
    const doble = crearDobleSenales({ u1: lectura({ ignicion: true, velocidadKmh: 60 }) });
    expect((await doble.leer('u1', AHORA))?.velocidadKmh).toBe(60);
    expect(await doble.leer('otra', AHORA)).toBeNull();
  });

  it('leerSenalExtra traga el fallo del proveedor: error o plazo → null (solo-GPS), nunca lanza', async () => {
    const roto: SenalesConduccion = { leer: async () => { throw new Error('proveedor caído'); } };
    await expect(leerSenalExtra(roto, 'u1', AHORA)).resolves.toBeNull();
    const doble = crearDobleSenales({ u1: lectura({ ignicion: true }) });
    await expect(leerSenalExtra(doble, 'u1', AHORA)).resolves.toEqual({ ignicion: true, velocidadKmh: null });
    await expect(leerSenalExtra(null, 'u1', AHORA)).resolves.toBeNull();
  });
});

describe('contrato con la compuerta puedeEscribirAlChofer (T-A5-36)', () => {
  const decide = (senalExtra: ReturnType<typeof aSenalExtra>, sitios = SIN_SITIOS, posiciones = QUIETA) =>
    puedeEscribirAlChofer({ posiciones, sitioDelViaje: sitios, config: ENCENDIDA, ahora: AHORA, senalExtra });

  it('ausencia de señal → regla solo-GPS: tres muestras quietas permiten, pocas no', () => {
    expect(decide(null)).toEqual({ permitido: true, razon: 'detenida' });
    expect(decide(null, SIN_SITIOS, [M(5)])).toEqual({ permitido: false, razon: 'pocas_muestras' });
  });

  it('atasco: ≥3 muestras quietas pero ignición encendida → NO escribe', () => {
    const r = decide(aSenalExtra(lectura({ ignicion: true, velocidadKmh: 0 }), AHORA));
    expect(r).toEqual({ permitido: false, razon: 'ignicion_encendida' });
  });

  it('ignición apagada o no reportada con la unidad quieta → permite', () => {
    expect(decide(aSenalExtra(lectura({ ignicion: false }), AHORA)).permitido).toBe(true);
    expect(decide(aSenalExtra(lectura({ ignicion: null }), AHORA)).permitido).toBe(true);
  });

  it('velocidad de marcha → NO, también dentro de un patio', () => {
    expect(decide(aSenalExtra(lectura({ velocidadKmh: 30 }), AHORA))).toEqual({ permitido: false, razon: 'conduciendo' });
    expect(decide(aSenalExtra(lectura({ velocidadKmh: 30 }), AHORA), EN_PATIO)).toEqual({ permitido: false, razon: 'conduciendo' });
  });

  it('teléfono en la mano → NO, aunque la velocidad sea 0 y esté dentro del patio', () => {
    const s = aSenalExtra(lectura({ telefonoEnMano: true, velocidadKmh: 0 }), AHORA);
    expect(decide(s)).toEqual({ permitido: false, razon: 'conduciendo' });
    expect(decide(s, EN_PATIO).permitido).toBe(false);
  });

  it('lectura vieja de «en marcha» no frena a quien el GPS ya muestra quieto (no se actúa por señal rancia)', () => {
    const vieja = aSenalExtra(lectura({ velocidadKmh: 90, medidaEn: hace(3600) }), AHORA);
    expect(decide(vieja)).toEqual({ permitido: true, razon: 'detenida' });
  });
});

describe('CAPACIDADES_PROVEEDOR', () => {
  it('nada está verificado en vivo (bloqueo externo) y ningún lector trae «teléfono en la mano»', () => {
    for (const c of Object.values(CAPACIDADES_PROVEEDOR)) {
      expect(c.ignicion.verificadoEnVivo).toBe(false);
      expect(c.velocidad.verificadoEnVivo).toBe(false);
      expect(c.telefonoEnMano.verificadoEnVivo).toBe(false);
      expect(c.telefonoEnMano.enRepo).toBe(false);
    }
    expect(CAPACIDADES_PROVEEDOR.navixy.ignicion.enRepo).toBe(true);
    expect(CAPACIDADES_PROVEEDOR.wialon.ignicion.enRepo).toBe(false);
  });
});
