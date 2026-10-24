import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { inicioDiaEnZona, TZ_MX } = await import('@/lib/formato');
const { rangoDeDias } = await import('./estadias_lectura');
const { horaExactaMx, csvEstadias } = await import('./estadias_anden');
const { evidenciaJornadaDeHitos } = await import('./jornada_hitos');
const { evidenciaJornadaDeViaje } = await import('./servicios');
const { CONFIG_CONDUCTOR_DEFAULT } = await import('./config');
const { hitoVacio } = await import('./memoria.fixture');
type Deps = import('./servicios').DepsServicios;
type TipoHito = import('./tipos').TipoHito;

// A37-S35-09 / A37-S36-10: periodos, hora de CSV y «día» de jornada en la zona de LA FLOTA (config.zonaHoraria),
// no en -06:00 fijo. Con la zona de México todo se conserva igual.
const TIJUANA = 'America/Tijuana'; // con horario de verano de EE. UU.

describe('inicioDiaEnZona', () => {
  it('México (sin horario de verano): -06:00 todo el año, igual que antes', () => {
    expect(inicioDiaEnZona('2026-07-01', TZ_MX).toISOString()).toBe('2026-07-01T06:00:00.000Z');
    expect(inicioDiaEnZona('2026-12-31', TZ_MX).toISOString()).toBe('2026-12-31T06:00:00.000Z');
  });
  it('Tijuana: -07:00 en verano y -08:00 en invierno; el día del cambio de hora no se corre', () => {
    expect(inicioDiaEnZona('2026-07-01', TIJUANA).toISOString()).toBe('2026-07-01T07:00:00.000Z');
    expect(inicioDiaEnZona('2026-12-31', TIJUANA).toISOString()).toBe('2026-12-31T08:00:00.000Z');
    // 1-nov-2026 termina el horario de verano de EE. UU. (02:00): la medianoche de ese día es todavía -07:00.
    expect(inicioDiaEnZona('2026-11-01', TIJUANA).toISOString()).toBe('2026-11-01T07:00:00.000Z');
    expect(inicioDiaEnZona('2026-11-02', TIJUANA).toISOString()).toBe('2026-11-02T08:00:00.000Z');
  });
  it('un día que no existe o mal escrito es fecha inválida, no un día vecino', () => {
    expect(Number.isNaN(inicioDiaEnZona('2026-02-31', TZ_MX).getTime())).toBe(true);
    expect(Number.isNaN(inicioDiaEnZona('ayer', TZ_MX).getTime())).toBe(true);
  });
});

describe('rangoDeDias en la zona de la flota', () => {
  it('sin zona: hora de México, como siempre', () => {
    expect(rangoDeDias('2026-10-01', '2026-10-02')).toEqual({ desde: new Date('2026-10-01T06:00:00.000Z'), hasta: new Date('2026-10-03T06:00:00.000Z') });
  });
  it('Tijuana en verano: los bordes del periodo son SUS medianoches (-07:00), no las de CDMX', () => {
    expect(rangoDeDias('2026-07-01', '2026-07-31', 93, TIJUANA)).toEqual({
      desde: new Date('2026-07-01T07:00:00.000Z'), hasta: new Date('2026-08-01T07:00:00.000Z'),
    });
  });
  it('un periodo que cruza el fin del horario de verano termina en la medianoche local del día siguiente', () => {
    expect(rangoDeDias('2026-10-26', '2026-11-01', 93, TIJUANA)).toEqual({
      desde: new Date('2026-10-26T07:00:00.000Z'), hasta: new Date('2026-11-02T08:00:00.000Z'),
    });
  });
});

describe('horaExactaMx con zona', () => {
  it('México por omisión; con la zona de la flota, su hora local', () => {
    const iso = '2026-07-01T06:30:15.000Z';
    expect(horaExactaMx(iso)).toBe('2026-07-01 00:30:15');
    expect(horaExactaMx(iso, TIJUANA)).toBe('2026-06-30 23:30:15');
  });
});

describe('csvEstadias rotula la zona', () => {
  it('con México conserva las columnas `*_hora_mx`; con otra zona, el rótulo dice cuál es', () => {
    expect(csvEstadias([]).split('\r\n')[0]).toContain('llegada_hora_mx');
    const cab = csvEstadias([], TIJUANA).split('\r\n')[0];
    expect(cab).not.toContain('_hora_mx');
    expect(cab).toContain('llegada_hora_America/Tijuana');
    expect(cab).toContain('salida_hora_America/Tijuana');
  });
});

describe('jornada: el «día» es el de la zona de la flota', () => {
  const hs = (momento: string) => (['llegada_carga'] as TipoHito[]).map((tipo) =>
    hitoVacio({ id: `h-${tipo}`, tipo, viajeId: 'v1', tenantId: 't1', estado: 'recibido', fuente: 'texto', mensajeEn: momento, recibidoEn: momento }));
  it('un hito a las 23:30 locales de Tijuana en verano (06:30Z del día siguiente) cuenta para el día LOCAL', () => {
    const h = hs('2026-07-02T06:30:00.000Z');
    expect(evidenciaJornadaDeHitos(h, '2026-07-01', TIJUANA).hitos).toBe(1);
    // CDMX (default) lo manda al día siguiente: 00:30 del 2.
    expect(evidenciaJornadaDeHitos(h, '2026-07-02').hitos).toBe(1);
    expect(evidenciaJornadaDeHitos(h, '2026-07-01').hitos).toBe(0);
  });
  it('el servicio pide la ventana a partir de la medianoche LOCAL de la flota', async () => {
    const espia = vi.fn(async () => []);
    const d: Deps = {
      config: async () => ({ ...CONFIG_CONDUCTOR_DEFAULT, zonaHoraria: TIJUANA }),
      viajeConHitos: async () => null,
      datosEstadias: async () => ({ viajes: [], hitos: [], veredictos: [], evidencias: [], sitios: new Map(), truncada: false }),
      politicas: async () => ({ flota: null, porCliente: new Map() }),
      hitosDeOperador: espia,
    };
    await evidenciaJornadaDeViaje('t1', 'o1', '2026-07-01', d);
    const [, , desde] = espia.mock.calls[0] as unknown as [string, string, Date, Date];
    // Medianoche de Tijuana (07:00Z) menos 1 h de holgura.
    expect(desde.toISOString()).toBe('2026-07-01T06:00:00.000Z');
  });
});
