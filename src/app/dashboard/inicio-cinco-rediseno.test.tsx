import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToReadableStream } from 'react-dom/server';
import type { CifrasPesosCincoAgentes } from './cinco-agentes-cifras-modelo';
import type { DatosResumen } from './resumen-modelo';

// Datos 100 % sintéticos: «flota con perfil cinco_agentes», cifras inventadas para la prueba.
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard', useSearchParams: () => new URLSearchParams(''), useRouter: () => ({ refresh() {}, replace() {}, push() {} }) }));
vi.mock('./sin-flota', () => ({ AvisoSinFlota: () => null }));

const dobles = vi.hoisted(() => ({
  pesos: vi.fn(), corridas: vi.fn(), enCurso: vi.fn(), datos: vi.fn(), senales: vi.fn(),
}));
vi.mock('./inicio-cinco-lectores', () => ({
  leerPesosInicio: (...a: unknown[]) => dobles.pesos(...a),
  leerUltimasCorridas: (...a: unknown[]) => dobles.corridas(...a),
  leerViajesEnCurso: (...a: unknown[]) => dobles.enCurso(...a),
}));
vi.mock('./resumen-datos', async () => ({ ...(await import('./resumen-modelo')), leerDatosResumen: (...a: unknown[]) => dobles.datos(...a) }));
vi.mock('@/lib/likida/asistente/senales', () => ({ leerSenalesAsistente: (...a: unknown[]) => dobles.senales(...a) }));
vi.mock('@/lib/saludo', async (o) => ({ ...(await o<Record<string, unknown>>()), ahoraMs: () => Date.parse('2026-10-31T18:00:00Z') }));

const { InicioCincoV2 } = await import('./inicio-cinco-v2');

const SENALES = {
  tms: null, archivosRecibidos: null, correoPlataforma: null, correoDesglose: null, operadores: null, unidadesActivas: null,
  patios: null, coordinadores: null, supervisores: null, revisorCartaPorte: null,
};
const DATOS: DatosResumen = {
  rango: '30', hoy: '2026-10-31', veDinero: false, peajes: null, porTipo: null,
  kpis: { viajesLiquidados: 42, montoComprobado: 0, diferenciaDetectada: 0, conDiferencias: 5, porRevisar: 3, tasaCuadre: 88 },
  cartaPorte: { completas: 38, total: 41 },
  cierres: [{ inicio: '2026-10-26', etiqueta: '26 oct', valor: 9, parcial: false }],
  hechos: [{ tipo: 'escalado', folio: 'V-100', operador: null, cuando: '2026-10-31T12:00:00Z' }],
  escalados: 2,
};
const PESOS: CifrasPesosCincoAgentes = {
  importeDecena: {
    valor: 3306107, valorTexto: '$3.3 M', periodo: '1 al 10 de octubre de 2026', fuente: 'Reporte IAVE · cruces con fecha dentro de la decena (sin cobros tardíos)',
    sello: 'Medido', decenasFaltantes: ['11 al 20 de octubre de 2026'], decenasSinCruces: [], rotulo: 'Importe del reporte IAVE.', reintentar: false, motivo: null,
    cruces: 9177, anterior: { valor: 2988680, valorTexto: '$3 M', periodo: '1 al 10 de agosto', rotulo: 'Periodos distintos: A contra B. No es el mismo periodo.' },
  },
  extemporaneos: {
    valor: 12511, valorTexto: '$12,511', periodo: 'decenas cargadas de octubre de 2026: 1 al 10', fuente: 'Reporte IAVE · fecha anterior al inicio del periodo',
    sello: 'Estimado', decenasFaltantes: [], decenasSinCruces: [], rotulo: '26 candidatos a validar. Definición provisional.', reintentar: false, motivo: null, n: 26,
  },
};
const CORRIDAS = { liquidacion: { id: 'c', inicio: '2026-10-31T13:10:00Z', fin: null, estado: 'ok', disparo: 'cron', tareasHechas: 3, tareasTotal: 3, resumen: null, error: null, duracionMs: null }, peajes: undefined, carta_porte: undefined, vigia: undefined, conductor: { id: 'd', inicio: '2026-10-31T11:30:00Z', fin: null, estado: 'fallo', disparo: 'cron', tareasHechas: null, tareasTotal: null, resumen: null, error: 'x', duracionMs: null } };

async function html(rol: string, extra: Record<string, unknown> = {}): Promise<string> {
  const el = await InicioCincoV2({ tenantId: 't-1', userId: 'u-1', tenantNombre: null, nombre: 'Ana', tenantExiste: true, sufijo: '', soloLectura: false, veAsistente: true, rol, ...extra } as never);
  const flujo = await renderToReadableStream(el);
  await flujo.allReady;
  return new Response(flujo).text();
}
const texto = (h: string) => h.replace(/<script[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ ([.,:)])/g, '$1');

beforeEach(() => {
  dobles.pesos.mockReset().mockImplementation(async (_t: string, rol: string) => (rol === 'flota_admin' || rol === 'contador' ? { cifras: PESOS, leidoEn: '2026-10-31T17:58:00Z' } : null));
  dobles.corridas.mockReset().mockResolvedValue(CORRIDAS);
  dobles.enCurso.mockReset().mockResolvedValue(4);
  dobles.datos.mockReset().mockResolvedValue(DATOS);
  dobles.senales.mockReset().mockResolvedValue(SENALES);
});


const AHORA = Date.parse('2026-10-31T18:00:00Z');
const VACIAS = { liquidacion: undefined, peajes: undefined, carta_porte: undefined, vigia: undefined, conductor: undefined };
const DATOS_VACIOS = { ...DATOS, kpis: { ...DATOS.kpis!, viajesLiquidados: 0, porRevisar: 0, conDiferencias: 0 }, cierres: [{ inicio: 'x', etiqueta: 'x', valor: 0, parcial: false }], hechos: [], escalados: 0, cartaPorte: { completas: 0, total: 0 } };

describe('Inicio rediseñado: jerarquía, iconos animados y estados honestos', () => {
  it('un solo h1; los cinco agentes van en el lugar de la fila 1 de la portada (Rovaq), luego «Hoy» y al final las cifras de pesos', async () => {
    const h = await html('flota_admin');
    expect((h.match(/<h1[\s>]/g) ?? []).length).toBe(1);
    const iHoy = h.indexOf('Requiere tu atención');
    const iAgentes = h.indexOf('data-agente-resumen="liquidacion"');
    const iPesos = h.indexOf('Importe IAVE por decena');
    expect(iHoy).toBeGreaterThan(-1);
    expect(iAgentes).toBeLessThan(iHoy);
    expect(iHoy).toBeLessThan(iPesos);
  });

  it('la barra de procedencia dice hasta cuándo son las cifras y no repite el chip de fuentes', async () => {
    const h = await html('flota_admin');
    expect(h).toContain('class="rv-esq__procedencia"');
    expect(texto(h)).toContain('Cifras al');
  });

  it('cada tarjeta lleva su icono SVG animado (decorativo) y el texto del estado al lado', async () => {
    const h = await html('flota_admin');
    for (const a of ['liquidacion', 'peajes', 'carta_porte', 'vigia', 'conductor']) expect(h).toContain(`class="rv-ia" data-agente="${a}"`);
    expect((h.match(/<svg[^>]*class="rv-ia"[^>]*aria-hidden="true"/g) ?? []).length).toBe(5);
  });

  it('solo se mueve (data-vivo) el agente con una corrida sin cerrar hace minutos; los demás quedan quietos', async () => {
    dobles.corridas.mockResolvedValue({ ...VACIAS, liquidacion: { id: 'c', inicio: new Date(AHORA - 120_000).toISOString(), fin: null, estado: 'ok', disparo: 'cron', tareasHechas: null, tareasTotal: null, resumen: null, error: null, duracionMs: null } });
    const h = await html('flota_admin');
    expect((h.match(/data-vivo="true"/g) ?? []).length).toBe(1);
    expect(texto(h)).toContain('Corriendo ahora');
    const trozo = h.slice(h.indexOf('data-agente-resumen="liquidacion"'), h.indexOf('data-agente-resumen="peajes"'));
    expect(trozo).toContain('data-vivo="true"');
  });

  it('flota recién conectada (todo vacío): se ve completa y honesta, sin cifras inventadas ni gráfica de ceros', async () => {
    dobles.corridas.mockResolvedValue(VACIAS);
    dobles.enCurso.mockResolvedValue(0);
    dobles.datos.mockResolvedValue(DATOS_VACIOS);
    const h = await html('flota_admin');
    const t = texto(h);
    expect((h.match(/data-agente-resumen="/g) ?? []).length).toBe(5);
    expect(t).toContain('Ninguno ha corrido todavía');
    expect((t.match(/Para que arranque/g) ?? []).length).toBe(5);
    expect(t).toContain('Tu flota todavía no tiene actividad');
    expect(h).not.toContain('data-vivo');
    expect(h).not.toContain('Liquidaciones cerradas por semana'); // sin serie real no hay gráfica
    expect(t).not.toMatch(/\$\s?0(?![\d,])/);
    expect(t).not.toMatch(/\b0 (por revisar|cerradas)/);
    expect(t).toContain('Sin viajes liquidados todavía');
  });

  it('con una semana de cierres reales aparece la gráfica de cierres con su fuente; con datos nulos no', async () => {
    const con = texto(await html('flota_admin'));
    expect(con).toContain('Liquidaciones cerradas por semana');
    expect(con).toContain('viajes liquidados de tu flota');
    dobles.datos.mockResolvedValue({ ...DATOS, cierres: null });
    expect(texto(await html('flota_admin'))).not.toContain('Liquidaciones cerradas por semana');
  });

  it('«en espera de conexión» solo se afirma con la señal medida: 0 estados de cuenta → Peajes espera; señal ilegible (null) no', async () => {
    dobles.corridas.mockResolvedValue(VACIAS);
    dobles.senales.mockResolvedValue({ ...SENALES, archivosRecibidos: 0 });
    expect(texto(await html('flota_admin'))).toContain('En espera del estado de cuenta');
    dobles.senales.mockResolvedValue(SENALES);
    expect(texto(await html('flota_admin'))).not.toContain('En espera del estado de cuenta');
  });

  it('cada tarjeta enlaza a su panel con el nombre accesible del agente', async () => {
    const t = texto(await html('flota_admin'));
    expect(t).toContain('Abrir panel Peajes');
    expect(t).toContain('Abrir panel Carta Porte');
  });
});
