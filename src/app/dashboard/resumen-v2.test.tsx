import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SenalesAsistente } from '@/lib/likida/asistente/pasos_cinco_agentes';
import type { DatosResumen } from './resumen-datos';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard', useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }), useSearchParams: () => new URLSearchParams(''),
}));

const senalesVacias: SenalesAsistente = {
  tms: 'sin_credencial', archivosRecibidos: 0, correoPlataforma: true,
  correoDesglose: { activa: false, usaCorreo: false, remitenteCapturado: false },
  operadores: { activos: 0, conCorreo: 0 }, unidadesActivas: 0, patios: 0, coordinadores: 0, supervisores: 0, revisorCartaPorte: false,
};
const lecturaSenales = vi.fn(async () => senalesVacias);
vi.mock('@/lib/likida/asistente/senales', () => ({ leerSenalesAsistente: lecturaSenales }));

const semanas = [3, 5, 4, 8, 6, 9, 7, 4].map((valor, i) => ({ inicio: `2026-09-${String(7 + i).padStart(2, '0')}`, etiqueta: `${7 + i} sep`, valor, parcial: i === 7 }));
const completos = (): DatosResumen => ({
  rango: '30', hoy: '2026-10-28', veDinero: true,
  kpis: { viajesLiquidados: 42, montoComprobado: 482310.5, diferenciaDetectada: 12400, conDiferencias: 5, porRevisar: 3, tasaCuadre: 88 },
  peajes: { total: 18250, semanas: 5 }, cartaPorte: { completas: 7, total: 9 }, cierres: semanas,
  porTipo: [{ tipo: 'sobre_politica', monto: 9000, n: 3 }, { tipo: 'duplicado', monto: 3400, n: 2 }],
  hechos: [{ tipo: 'recordatorio', folio: 'VJ-1042', operador: 'Rosa Medina', cuando: '2026-10-27T15:00:00Z' }, { tipo: 'escalado', folio: 'VJ-1038', operador: null, cuando: '2026-10-26T15:00:00Z' }],
  escalados: 2,
});
let datos: DatosResumen = completos();
vi.mock('./resumen-datos', async (orig) => ({ ...(await orig<typeof import('./resumen-datos')>()), leerDatosResumen: async () => datos }));

const { ResumenV2 } = await import('./resumen-v2');

const pintar = async (extra: Partial<Parameters<typeof ResumenV2>[0]> = {}) => renderToStaticMarkup(await ResumenV2({
  tenantId: 't', userId: 'u', tenantNombre: null, nombre: 'Ana', tenantExiste: true, sufijo: '', soloLectura: false, veAsistente: true, veDinero: true, rol: 'flota_admin', ...extra,
}));

describe('Resumen v2 del dueño', () => {
  it('trae las siete piezas del patrón: KPI, cierres, atención, diferencias, lo que hizo solo y siguiente acción', async () => {
    datos = completos();
    const h = await pintar();
    for (const t of ['Monto comprobado', 'Por revisar', 'Peajes del periodo', 'Carta Porte completas', 'Liquidaciones cerradas por semana', 'Requiere tu atención', 'Diferencias vs recuperado', 'Lo que hizo solo', 'Siguiente mejor acción']) expect(h).toContain(t);
    expect(h).toContain('Fuentes 7 de 7');
  });
  it('cada recuadro lleva su botón ⓘ', async () => {
    datos = completos();
    const h = await pintar();
    expect((h.match(/aria-label="Información: /g) ?? []).length).toBeGreaterThanOrEqual(9);
  });
  it('una sola barra de filtros y UN solo primario', async () => {
    datos = completos();
    const h = await pintar();
    expect((h.match(/role="toolbar"/g) ?? []).length).toBe(1);
    expect((h.match(/rv-btn--primary/g) ?? []).length).toBeLessThanOrEqual(1);
  });
  it('lectura caída: «—» y «No es cero», nunca un 0 inventado ni NaN', async () => {
    datos = { ...completos(), kpis: null, peajes: null, cartaPorte: null, cierres: null, porTipo: null, hechos: null, escalados: null };
    const h = await pintar();
    expect(h).toContain('No disponible ahora. No es cero');
    expect(h).toContain('Fuentes 0 de 7');
    expect(h).not.toContain('NaN');
    expect(h).not.toMatch(/rv-kpi__valor">0</);
  });
  it('sin acceso a dinero no se pinta ningún peso ni se leen cifras de dinero', async () => {
    datos = { ...completos(), veDinero: false, peajes: null, porTipo: null };
    const h = await pintar({ veDinero: false });
    expect(h).not.toContain('$');
    expect(h).not.toContain('Monto comprobado');
    expect(h).toContain('Liquidaciones cerradas');
  });
  it('sin acceso a Puesta en marcha no lee las señales ni enlaza al asistente', async () => {
    datos = completos();
    lecturaSenales.mockClear();
    const h = await pintar({ veAsistente: false });
    expect(lecturaSenales).not.toHaveBeenCalled();
    expect(h).not.toContain('puesta-en-marcha');
  });
  it('sin pendientes: las filas de atención dicen «Sin pendientes» (con lectura) y no inventan alertas', async () => {
    datos = { ...completos(), kpis: { ...completos().kpis!, porRevisar: 0 }, escalados: 0 };
    const h = await pintar({ veAsistente: false });
    expect(h).toContain('Sin pendientes · últimos 30 días.');
    expect(h).toContain('Sin pendientes · ahora.');
    expect(h).toContain('Nada urgente por hacer hoy');
  });
  it('periodo elegido: el chip activo es el de la URL', async () => {
    datos = { ...completos(), rango: '7' };
    const h = await pintar({ rango: '7' });
    expect(h).toMatch(/aria-pressed="true"[^>]*>7 días</);
  });

  it('flota normal (sin perfil): se presenta como «Tu flota» y no como «cinco agentes»', async () => {
    datos = completos();
    const h = await pintar({ perfil: null, veAsistente: false });
    expect(h).toContain('Tu flota, de un vistazo.');
    expect(h).not.toContain('cinco agentes');
    const hp = await pintar({ perfil: 'cinco_agentes' });
    expect(hp).toContain('Tus cinco agentes, de un vistazo.');
  });
  it('el encargado (sin dinero) no recibe enlaces a pantallas de dinero: liquidación y peajes no salen como enlaces', async () => {
    datos = { ...completos(), veDinero: false, peajes: null, porTipo: null };
    const h = await pintar({ rol: 'encargado', veDinero: false, veAsistente: false });
    expect(h).not.toContain('/dashboard/agentes/liquidacion');
    expect(h).not.toContain('/dashboard/agentes/peajes');
    expect(h).toContain('/dashboard/agentes/carta-porte');
    expect(h).not.toContain('Ver actividad');
    expect(h).not.toContain('$');
    expect(h).toContain('Diferencias en liquidaciones');
    expect(h).not.toContain('Recuperado');
  });
  it('los atajos son los que el rol abre', async () => {
    datos = { ...completos(), kpis: { ...completos().kpis!, porRevisar: 0 }, escalados: 0 };
    expect(await pintar({ veAsistente: false })).toContain('Nuevo viaje');
    expect(await pintar({ rol: 'contador', veAsistente: false })).not.toContain('Nuevo viaje');
  });
  it('un lector de insights caído se confiesa en «Requiere tu atención» (no es «sin pendientes»)', async () => {
    datos = { ...completos(), kpis: { ...completos().kpis!, porRevisar: 0 }, escalados: 0 };
    const h = await pintar({ veAsistente: false, fallidos: ['peajes'] });
    expect(h).toContain('Peajes: no se pudo leer');
    expect(h).toContain('No es «sin pendientes».');
  });
  it('perfil fiscal pospuesto: aviso con enlace a declararlo', async () => {
    datos = completos();
    const h = await pintar({ avisoFiscalPospuesto: true, veAsistente: false });
    expect(h).toContain('estímulo de peaje se muestra en $0');
    expect(h).toContain('/dashboard/onboarding');
    expect(await pintar({ veAsistente: false })).not.toContain('estímulo de peaje se muestra');
  });
  it('el dinero se pinta sin decimales', async () => {
    datos = completos();
    const h = await pintar();
    expect(h).toContain('$482,311');
    expect(h).not.toContain('.50');
  });
});
