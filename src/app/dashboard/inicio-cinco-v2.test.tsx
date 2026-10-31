import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToPipeableStream, renderToReadableStream } from 'react-dom/server';
import { PassThrough } from 'node:stream';
import type { CifrasPesosCincoAgentes } from './cinco-agentes-cifras-modelo';
import { cifrasSinDato } from './cinco-agentes-cifras-modelo';
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
const hrefs = (h: string) => [...h.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

beforeEach(() => {
  dobles.pesos.mockReset().mockImplementation(async (_t: string, rol: string) => (rol === 'flota_admin' || rol === 'contador' ? { cifras: PESOS, leidoEn: '2026-10-31T17:58:00Z' } : null));
  dobles.corridas.mockReset().mockResolvedValue(CORRIDAS);
  dobles.enCurso.mockReset().mockResolvedValue(4);
  dobles.datos.mockReset().mockResolvedValue(DATOS);
  dobles.senales.mockReset().mockResolvedValue(SENALES);
});

describe('Inicio v2 cinco_agentes: pesos por rol', () => {
  it('el dueño ve los pesos COMPLETOS con periodo, fuente, sello y la decena anterior rotulada', async () => {
    const t = texto(await html('flota_admin'));
    expect(t).toContain('$3,306,107');
    expect(t).not.toContain('$3.3 M');
    expect(t).toContain('1 al 10 de octubre de 2026');
    expect(t).toContain('9,177 cruces');
    expect(t).toContain('Medido');
    expect(t).toContain('Decena anterior: $2,988,680');
    expect(t).toContain('Periodos distintos');
    expect(t).toContain('Falta cargar: 11 al 20 de octubre de 2026');
    expect(t).toContain('Fuente: Reporte IAVE');
    expect(t).toContain('$12,511');
    expect(t).toContain('Estimado');
    expect(t).toContain('26 candidatos a validar');
    // Una sola vez: ni el conteo ni las decenas faltantes se repiten dentro de la tarjeta de extemporáneos
    expect((t.match(/26 candidatos a validar/g) ?? []).length).toBe(1);
  });

  // OJO (C3): HOY este camino es INALCANZABLE en producción. `AREA_POR_RUTA['/dashboard']` es 'operacion' y el contador (solo dinero) es
  // redirigido por `resolverTenantEfectivo` a /dashboard/agentes/liquidacion, así que solo el dueño (flota_admin) y el superadmin ven la
  // franja. Esta prueba cubre el COMPONENTE (si algún día se abre /dashboard a 'dinero' bajo cinco_agentes), no lo que hoy ve un contador.
  it('el componente muestra los pesos a un rol de finanzas, aunque hoy el contador no llega a este Inicio', async () => {
    const { puedeVerRuta } = await import('@/lib/auth/visibilidad');
    expect(puedeVerRuta('contador', '/dashboard', 'cinco_agentes')).toBe(false); // por eso hoy no llega
    const t = texto(await html('contador'));
    expect(t).toContain('$3,306,107');
    expect(t).toContain('$12,511');
  });

  it('el encargado NO ve pesos ni su franja, y el lector ni siquiera devuelve datos', async () => {
    const h = await html('encargado');
    const t = texto(h);
    expect(t).not.toMatch(/\$\s?\d/);
    expect(t).not.toContain('Importe IAVE');
    expect(t).not.toContain('Cobros extemporáneos');
    expect(t).not.toContain('IAVE');
  });

  it('nómina no ve pesos (y su rol no abre este inicio: la ruta lo rebota antes)', async () => {
    const t = texto(await html('nomina'));
    expect(t).not.toMatch(/\$\s?\d/);
    const { puedeVerRuta } = await import('@/lib/auth/visibilidad');
    expect(puedeVerRuta('nomina', '/dashboard', 'cinco_agentes')).toBe(false);
  });
});

describe('Inicio v2: fallos honestos', () => {
  it('fallo de lectura = Sin dato con Reintentar, jamás $0', async () => {
    dobles.pesos.mockResolvedValue({ cifras: cifrasSinDato('No se pudo leer el estado de cuenta.', true), leidoEn: '2026-10-31T18:00:00Z' });
    const h = await html('flota_admin');
    const t = texto(h);
    expect(t).toContain('No disponible ahora');
    expect(t).toContain('Reintentar');
    expect((h.match(/>Reintentar</g) ?? []).length).toBe(1); // un solo Reintentar por bloque de pesos en fallo total
    expect(t).not.toContain('Cobros extemporáneos');
    expect(t).not.toMatch(/\$\s?0(?![\d,])/);
    expect(t).not.toContain('$3,306,107');
  });

  it('sin estado de cuenta cargado = Sin dato con su motivo (no es $0 ni error)', async () => {
    dobles.pesos.mockResolvedValue({ cifras: cifrasSinDato('No hay estado de cuenta IAVE cargado en los últimos dos meses.', false), leidoEn: '2026-10-31T18:00:00Z' });
    const t = texto(await html('flota_admin'));
    expect(t).toContain('Sin dato');
    expect(t).toContain('No hay estado de cuenta IAVE cargado');
    expect(t).not.toMatch(/\$\s?0(?![\d,])/);
  });

  it('lectura rápida caída: las cifras de agente dicen sin dato, no 0', async () => {
    dobles.datos.mockResolvedValue({ ...DATOS, kpis: null, escalados: null, cartaPorte: null });
    const t = texto(await html('encargado'));
    expect(t).toContain('No se pudo leer. No es cero.');
    expect(t).not.toMatch(/\b0 por revisar/);
  });
});

describe('Inicio v2: estructura', () => {
  it('cinco tarjetas de agente, cada una con estado en texto, cifra real y ⓘ', async () => {
    const h = await html('flota_admin');
    expect((h.match(/data-agente-resumen="/g) ?? []).length).toBe(5);
    const t = texto(h);
    expect(t).toContain('Corrió hoy 07:10');
    expect(t).toContain('Falló hoy 05:30');
    expect(t).toContain('38 / 41');
    expect(t).toContain('26');
    expect(t).toContain('Sin corridas: abre su tablero');
    expect((h.match(/aria-label="Qué es [^"]*"|Más información|class="[^"]*rv-info/g) ?? []).length).toBeGreaterThan(0);
  });

  it('Suspense: mientras los pesos tardan, el resto ya pinta y cada tarjeta lleva su esqueleto', async () => {
    dobles.pesos.mockReturnValue(new Promise(() => {}));
    const el = await InicioCincoV2({ tenantId: 't-1', userId: 'u-1', tenantNombre: null, nombre: 'Ana', tenantExiste: true, sufijo: '', soloLectura: false, veAsistente: true, rol: 'flota_admin' } as never);
    // Solo el CASCARÓN (lo que ya llegó al navegador antes de que respondan los pesos): se aborta al estar listo.
    const h = await new Promise<string>((listo) => {
      const trozos: string[] = [];
      const { pipe, abort } = renderToPipeableStream(el, {
        onShellReady() {
          const s = new PassThrough();
          s.on('data', (c) => trozos.push(String(c)));
          pipe(s);
          setTimeout(() => { abort(); listo(trozos.join('')); }, 30);
        },
        onError() {},
      });
    });
    expect((h.match(/aria-label="Cargando"/g) ?? []).length).toBeGreaterThanOrEqual(3); // Peajes + importe + extemporáneos
    expect(texto(h)).toContain('Liquidaciones');
    expect(texto(h)).not.toContain('$3,306,107');
  });

  it('los enlaces se filtran por puedeVerRuta: el encargado no recibe Peajes', async () => {
    const e = hrefs(await html('encargado'));
    expect(e).toContain('/dashboard/agentes/carta-porte');
    expect(e).toContain('/dashboard/viajes');
    expect(e.some((x) => x.includes('/agentes/peajes'))).toBe(false);
    const d = hrefs(await html('flota_admin'));
    expect(d).toContain('/dashboard/agentes/peajes');
  });

  it('sin permiso de Puesta en marcha no hay tarjeta de Puesta en marcha', async () => {
    const t = texto(await html('encargado', { veAsistente: false }));
    expect(t).not.toContain('Puesta en marcha');
    expect(texto(await html('flota_admin'))).toContain('Puesta en marcha');
  });

  it('lo que hizo solo dice solo las últimas 24 h', async () => {
    dobles.datos.mockResolvedValue({ ...DATOS, hechos: [{ tipo: 'escalado', folio: 'V-OLD', operador: null, cuando: '2026-10-20T12:00:00Z' }] });
    const t = texto(await html('flota_admin'));
    expect(t).not.toContain('V-OLD');
    expect(t).toContain('Nada en las últimas 24 h');
  });

  it('flota nueva: primeros pasos en lugar de «Nada urgente»', async () => {
    dobles.corridas.mockResolvedValue({ liquidacion: undefined, peajes: undefined, carta_porte: undefined, vigia: undefined, conductor: undefined });
    dobles.enCurso.mockResolvedValue(0);
    dobles.datos.mockResolvedValue({ ...DATOS, kpis: { ...DATOS.kpis!, viajesLiquidados: 0, porRevisar: 0, conDiferencias: 0 }, cierres: [{ inicio: 'x', etiqueta: 'x', valor: 0, parcial: false }], hechos: [], escalados: 0, cartaPorte: { completas: 0, total: 0 } });
    const h = await html('flota_admin');
    const t = texto(h);
    expect(t).toContain('Tu flota todavía no tiene actividad');
    expect(h).toContain('aria-label="Primeros pasos"');
    expect(t).not.toContain('Nada urgente');
  });

  it('la tarjeta de Hoy no se queda en «Nada urgente»: con viajes en curso los lista', async () => {
    const t = texto(await html('flota_admin'));
    expect(t).toContain('4 viajes en curso');
    expect(t).toContain('3 liquidaciones por revisar');
    expect(t).toContain('2 viajes escalados');
  });
});
