/* eslint-disable security/detect-non-literal-fs-filename -- el arnés escribe en una ruta de salida propia */
// ARNÉS L11 (Inicio de una flota con perfil cinco_agentes): el componente REAL `InicioCincoV2` dentro del chrome v2 real, con los
// lectores sustituidos por datos 100 % sintéticos. Cuatro escenas: dueño con pesos, encargado sin pesos, flota nueva y fallo de lector.
// Uso: UI2_OUT=<dir> npx vitest run --config scripts/ui2-captura/vitest.config.mts l11
import { describe, it, vi } from 'vitest';
import { renderToReadableStream } from 'react-dom/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));
vi.mock('@/app/dashboard/sin-flota', () => ({ AvisoSinFlota: () => null }));

const esc = vi.hoisted(() => ({ rol: 'flota_admin', escena: 'dueno' as string }));
const CORRIDA = (estado: string, inicio: string, h: number | null = null, t: number | null = null) => ({ id: 'c', inicio, fin: null, estado, disparo: 'cron', tareasHechas: h, tareasTotal: t, resumen: null, error: null, duracionMs: null });
const PESOS = {
  importeDecena: {
    valor: 3306107, valorTexto: '$3.3 M', periodo: '1 al 10 de octubre de 2026', fuente: 'Reporte IAVE · cruces con fecha dentro de la decena (sin cobros tardíos)',
    sello: 'Medido', decenasFaltantes: ['11 al 20 de octubre de 2026'], decenasSinCruces: [], rotulo: 'Importe del reporte IAVE del 1 al 10 de octubre de 2026.', reintentar: false, motivo: null,
    cruces: 9177, anterior: { valor: 2988680, valorTexto: '$3 M', periodo: '1 al 10 de agosto de 2026', rotulo: 'Periodos distintos: 1 al 10 de octubre de 2026 (10 días) contra 1 al 10 de agosto de 2026 (10 días). No es el mismo periodo.' },
  },
  extemporaneos: {
    valor: 12511, valorTexto: '$12,511', periodo: 'decenas cargadas de octubre de 2026: 1 al 10', fuente: 'Reporte IAVE · cruces con fecha anterior al inicio del periodo de su archivo',
    sello: 'Estimado', decenasFaltantes: ['11 al 20 de octubre de 2026'], decenasSinCruces: [], rotulo: '26 candidatos a validar con el proveedor (decenas cargadas de octubre de 2026: 1 al 10). Definición provisional. Faltan por cargar: 11 al 20 de octubre de 2026. Estimado: la definición de extemporáneo es provisional; faltan decenas, la cifra es parcial.', reintentar: false, motivo: null, n: 26,
  },
};
const FALLO = (() => {
  const base = { valor: null, valorTexto: null, periodo: null, sello: 'Sin dato', decenasFaltantes: [], decenasSinCruces: [], rotulo: 'No se pudo leer. Reintenta en un momento.', reintentar: true, motivo: 'No se pudo leer el estado de cuenta.' };
  return { importeDecena: { ...base, fuente: 'Reporte IAVE', cruces: null, anterior: null }, extemporaneos: { ...base, fuente: 'Reporte IAVE', n: null } };
})();
const SIN_ARCHIVO = (() => {
  const base = { valor: null, valorTexto: null, periodo: null, sello: 'Sin dato', decenasFaltantes: [], decenasSinCruces: [], rotulo: 'No hay estado de cuenta IAVE cargado en los últimos dos meses.', reintentar: false, motivo: 'No hay estado de cuenta IAVE cargado en los últimos dos meses.' };
  return { importeDecena: { ...base, fuente: 'Reporte IAVE', cruces: null, anterior: null }, extemporaneos: { ...base, fuente: 'Reporte IAVE', n: null } };
})();
const DATOS = {
  rango: '30', hoy: '2026-10-31', veDinero: false, peajes: null, porTipo: null,
  kpis: { viajesLiquidados: 42, montoComprobado: 0, diferenciaDetectada: 0, conDiferencias: 5, porRevisar: 3, tasaCuadre: 88 },
  cartaPorte: { completas: 38, total: 41 },
  cierres: [3, 5, 6, 4, 7, 8, 6, 9].map((v, i) => ({ inicio: `2026-09-${String(7 + i * 7).padStart(2, '0')}`, etiqueta: `${7 + i * 7} sep`, valor: v, parcial: i === 7 })),
  hechos: [{ tipo: 'escalado', folio: 'V-3021', operador: null, cuando: '2026-10-31T12:20:00Z' }, { tipo: 'recordatorio', folio: 'V-3018', operador: 'Operador de ejemplo', cuando: '2026-10-31T09:05:00Z' }],
  escalados: 2,
};
vi.mock('@/app/dashboard/inicio-cinco-lectores', () => ({
  leerPesosInicio: async (_t: string, rol: string) => {
    if (rol !== 'flota_admin' && rol !== 'contador') return null;
    return { cifras: esc.escena === 'fallo' ? FALLO : esc.escena === 'nueva' ? SIN_ARCHIVO : PESOS, leidoEn: '2026-10-31T17:58:00Z' };
  },
  leerUltimasCorridas: async () => (esc.escena === 'nueva'
    ? { liquidacion: undefined, peajes: undefined, carta_porte: undefined, vigia: undefined, conductor: undefined }
    : { liquidacion: CORRIDA('ok', '2026-10-31T13:10:00Z'), peajes: CORRIDA('ok', '2026-10-31T12:30:00Z', 8, 8), carta_porte: CORRIDA('parcial', '2026-10-31T13:02:00Z'), vigia: undefined, conductor: CORRIDA('fallo', '2026-10-31T11:30:00Z') }),
  leerViajesEnCurso: async () => (esc.escena === 'nueva' ? 0 : 12),
}));
vi.mock('@/app/dashboard/resumen-datos', async () => ({
  ...(await import('@/app/dashboard/resumen-modelo')),
  leerDatosResumen: async () => (esc.escena === 'nueva'
    ? { ...DATOS, kpis: { ...DATOS.kpis, viajesLiquidados: 0, porRevisar: 0, conDiferencias: 0 }, cierres: DATOS.cierres.map((c) => ({ ...c, valor: 0 })), hechos: [], escalados: 0, cartaPorte: { completas: 0, total: 0 } }
    : esc.escena === 'fallo' ? { ...DATOS, kpis: null, escalados: null } : DATOS),
}));
vi.mock('@/lib/likida/asistente/senales', () => ({
  leerSenalesAsistente: async () => ({
    tms: { activa: true, probadaEn: '2026-10-29T12:00:00Z', ultimoError: null }, archivosRecibidos: 6, correoPlataforma: true,
    correoDesglose: { activa: true, usaCorreo: true, remitenteCapturado: true }, operadores: { activos: 40, conCorreo: 12 }, unidadesActivas: 60,
    patios: 2, coordinadores: 2, supervisores: 1, revisorCartaPorte: false,
  }),
}));
vi.mock('@/lib/saludo', async (o) => ({ ...(await o<Record<string, unknown>>()), ahoraMs: () => Date.parse('2026-10-31T18:00:00Z'), saludo: () => 'Buenas tardes' }));

const { default: Chrome } = await import('@/app/dashboard/shell/chrome-v2');
const { InicioCincoV2 } = await import('@/app/dashboard/inicio-cinco-v2');
import { exigirV2Html } from './exigir_v2';

const OUT = process.env.UI2_OUT ?? path.join(homedir(), 'likida-loop/cierre100/arnes-l11');
const ESCENAS: Array<{ id: string; escena: string; rol: string; veAsistente: boolean }> = [
  { id: 'l11-01-dueno-con-pesos', escena: 'dueno', rol: 'flota_admin', veAsistente: true },
  { id: 'l11-02-encargado-sin-pesos', escena: 'dueno', rol: 'encargado', veAsistente: true },
  { id: 'l11-03-flota-nueva', escena: 'nueva', rol: 'flota_admin', veAsistente: true },
  { id: 'l11-04-fallo-de-lector', escena: 'fallo', rol: 'flota_admin', veAsistente: true },
];

describe('L11', () => {
  it('renderiza las cuatro escenas del Inicio dentro del chrome v2', async () => {
    mkdirSync(path.join(OUT, 'vistas'), { recursive: true });
    for (const e of ESCENAS) {
      esc.rol = e.rol; esc.escena = e.escena;
      const inicio = await InicioCincoV2({ tenantId: 't-demo', userId: 'u-demo', tenantNombre: null, nombre: 'Ximena', tenantExiste: true, sufijo: '', soloLectura: false, veAsistente: e.veAsistente, rol: e.rol, rango: '30' });
      const flujo = await renderToReadableStream(<Chrome nombre="Ximena Salgado Robles" rol={e.rol} perfil="cinco_agentes" cerrarSesion={async () => {}}>{inicio}</Chrome>);
      await flujo.allReady;
      const html = await new Response(flujo).text();
      exigirV2Html(html, e.id);
      writeFileSync(path.join(OUT, 'vistas', `${e.id}.html`), html);
    }
  });
});
