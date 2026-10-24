import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// QUÉ PANTALLA ELIGE LA PUERTA SEGÚN EL CANAL DEL DESGLOSE (T-A1-28).
//
// Lo que se fija:
//   · sin configuración guardada (o ilegible) la pantalla es la de siempre: KPIs, cola y «Liquidaciones externas»;
//   · con el canal en correo se muestra la lista de desgloses y NO se leen ni se pintan los KPIs, la cola ni la estrategia del flujo
//     de fotos (se ocultan, no se borran).
// Se inspecciona el elemento que devuelve la página; no hay base ni render de la pantalla.
// ═══════════════════════════════════════════════════════════════════════════

const m = vi.hoisted(() => {
  const vacio = () => vi.fn(async () => null);
  return {
    leerConfigCorreo: vi.fn(),
    getKpis: vi.fn(async () => ({ porRevisar: 0 })),
    colaRevision: vi.fn(async () => ({ filas: [] })),
    otras: vacio,
    admin: vi.fn((_rol?: string) => true),
    reintentar: vi.fn(async () => 'reintentada'),
    copia: vi.fn(async () => ({ estado: 'enviada' })),
    reavisar: vi.fn(async () => 'reavisada'),
  };
});

vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => ({ tenantId: 't-1', rol: 'flota_admin', userId: 'u-1' }) }));
vi.mock('@/lib/auth/visibilidad', () => ({ puedeVerRuta: () => true, puedeVerArea: () => true }));
vi.mock('@/lib/auth/permisos', () => ({ puedeAdministrar: (r: string) => m.admin(r) }));
vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('redirect'); } }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/likida/analytics', () => ({
  getKpis: m.getKpis, getLiquidaciones: m.otras(), contarViajes: m.otras(), getLiquidacionesPorDia: m.otras(), getHechosSolos: m.otras(),
  getDineroObservadoPorTipo: m.otras(), getStatsPorOperador: m.otras(), getValorAhorro: m.otras(),
}));
vi.mock('@/lib/likida/config', () => ({ getConfig: m.otras() }));
vi.mock('@/lib/likida/costos', () => ({ traerResumenCostoIaTenant: m.otras() }));
vi.mock('@/lib/likida/agentes/corridas', () => ({ ultimasCorridas: m.otras() }));
vi.mock('@/lib/likida/agentes/estrategia', () => ({ validarUmbralConfianza: () => 0, guardarEstrategiaAgente: async () => {} }));
vi.mock('@/lib/likida/errores', () => ({ mensajeParaPantalla: () => '' }));
vi.mock('@/lib/likida/revision', () => ({
  colaRevision: m.colaRevision, leerFiltrosCola: () => ({}), decodificarCursorCola: () => null, listarTerminales: m.otras(),
}));
vi.mock('@/lib/likida/repo', () => ({ buscarCatalogo: async () => [] }));
vi.mock('@/lib/likida/liquidacion_externa/repo', () => ({
  contarPorEstado: m.otras(), contarNoCoincide: m.otras(), avisosDiscrepanciaDe: async () => null,
  listarLiquidacionesExternas: async () => ({ filas: [], hayMas: false, total: 0 }),
  leerFormatoFlota: m.otras(), leerTelefonosFlota: m.otras(), leerPorId: m.otras(),
}));
vi.mock('@/lib/likida/liquidacion_externa/servicio', () => ({
  reintentarLiquidacionExterna: (...a: unknown[]) => (m.reintentar as (...x: unknown[]) => unknown)(...a), reenviarCopiaAJefe: (...a: unknown[]) => (m.copia as (...x: unknown[]) => unknown)(...a), reavisarDiscrepancia: (...a: unknown[]) => (m.reavisar as (...x: unknown[]) => unknown)(...a),
}));
vi.mock('@/lib/likida/liquidacion_externa/reenvio_correo', () => ({ reenviarDesglose: async () => ({ estado: 'reenviado' }) }));
vi.mock('@/lib/likida/liquidacion_externa/importar_archivo', () => ({ importarLiquidacionesDeArchivo: async () => ({}) }));
vi.mock('@/lib/likida/liquidacion_externa/repo_correo', () => ({
  leerConfigCorreo: m.leerConfigCorreo,
  listarDesgloses: async () => ({ ok: true, valor: { items: [], siguiente: null } }),
  entregasDe: async () => ({ ok: true, valor: [] }),
  contarParaInsights: async () => ({ ok: true, valor: { desgloses: 0, entregasPorEstado: {}, excepcionesAbiertas: 0 } }),
  listarExcepciones: async () => ({ ok: true, valor: [] }),
}));
vi.mock('@/app/api/v1/_comun', () => ({ decodificarCursor: () => null, codificarCursor: () => 'x' }));
vi.mock('../seccion-notificaciones', () => ({ SeccionNotificaciones: () => null }));
vi.mock('../ficha-corridas', () => ({ FichaCorridas: () => null }));
vi.mock('../estrategia-forma', () => ({ FormaEstrategiaLiquidacion: () => null }));

import PaginaAgenteLiquidacion from './page';
import { VistaAgenteLiquidacion } from './vista';
import { VistaDesgloses, SeccionDesgloses } from './desgloses';
import { SeccionExternas } from './externas';
import type { ReactElement } from 'react';

const pedir = async () => (await PaginaAgenteLiquidacion({ searchParams: Promise.resolve({}) })) as ReactElement<Record<string, unknown>>;
const config = (canal: 'whatsapp' | 'correo' | 'ambos') => ({ ok: true, valor: { canal } });

beforeEach(() => { m.getKpis.mockClear(); m.colaRevision.mockClear(); m.leerConfigCorreo.mockReset(); });

describe('la puerta elige la pantalla por el canal', () => {
  it('sin fila de configuración (canal por defecto) sigue la pantalla de siempre, con Liquidaciones externas', async () => {
    m.leerConfigCorreo.mockResolvedValue(config('whatsapp'));
    const el = await pedir();
    expect(el.type).toBe(VistaAgenteLiquidacion);
    expect(m.getKpis).toHaveBeenCalled();
    const bloque = el.props.externas as ReactElement<{ children: ReactElement }>;
    expect(bloque.props.children.type).toBe(SeccionExternas);
  });

  it('si la configuración no se puede leer, no cambia la pantalla de la flota', async () => {
    m.leerConfigCorreo.mockResolvedValue({ ok: false, motivo: 'no_disponible' });
    expect((await pedir()).type).toBe(VistaAgenteLiquidacion);
    m.leerConfigCorreo.mockRejectedValue(new Error('base caída'));
    expect((await pedir()).type).toBe(VistaAgenteLiquidacion);
  });

  it.each(['correo', 'ambos'] as const)('con el canal «%s» muestra los desgloses y no lee ni pinta KPIs, cola ni estrategia', async (canal) => {
    m.leerConfigCorreo.mockResolvedValue(config(canal));
    const el = await pedir();
    expect(el.type).toBe(VistaDesgloses);
    expect(m.getKpis).not.toHaveBeenCalled();
    expect(m.colaRevision).not.toHaveBeenCalled();
    const bloque = el.props.desgloses as ReactElement<{ children: ReactElement }>;
    expect(bloque.props.children.type).toBe(SeccionDesgloses);
    expect(el.props).not.toHaveProperty('externas');
    expect(el.props).not.toHaveProperty('kpis');
  });

  it('los filtros de la URL de los desgloses se validan antes de llegar a la sección', async () => {
    m.leerConfigCorreo.mockResolvedValue(config('correo'));
    const el = (await PaginaAgenteLiquidacion({
      searchParams: Promise.resolve({ des_estado: 'drop table', des_desde: '2026-13-45', des_hasta: '2026-10-05' }),
    })) as ReactElement<{ desgloses: ReactElement<{ children: ReactElement<{ filtro: unknown; desde: unknown; hasta: unknown }> }> }>;
    const seccion = el.props.desgloses.props.children.props;
    expect(seccion.filtro).toBeNull();
    expect(seccion.desde).toBeNull();
    expect(seccion.hasta).toBe('2026-10-05');
  });
});

describe('A37-A1-liquidaciones-20: las acciones de WhatsApp de la pantalla exigen administrar, no solo ver la ruta', () => {
  const ID = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001';
  const fd = () => { const f = new FormData(); f.set('id', ID); return f; };
  type Acciones = { reintentar: (f: FormData) => Promise<void>; reenviarCopia: (f: FormData) => Promise<void>; reavisar: (f: FormData) => Promise<void> };
  const acciones = async () => {
    m.leerConfigCorreo.mockResolvedValue(config('whatsapp'));
    const el = await pedir();
    const bloque = el.props.externas as ReactElement<{ children: ReactElement<Acciones> }>;
    return bloque.props.children.props;
  };

  it('un rol que ve dinero pero no administra (contador) NO dispara reintento, copia ni reaviso', async () => {
    const a = await acciones();
    m.admin.mockImplementation(() => false);
    m.reintentar.mockClear(); m.copia.mockClear(); m.reavisar.mockClear();
    await expect(a.reintentar(fd())).rejects.toThrow(/administra/);
    await expect(a.reenviarCopia(fd())).rejects.toThrow(/administra/);
    await expect(a.reavisar(fd())).rejects.toThrow(/administra/);
    expect(m.reintentar).not.toHaveBeenCalled();
    expect(m.copia).not.toHaveBeenCalled();
    expect(m.reavisar).not.toHaveBeenCalled();
    m.admin.mockImplementation(() => true);
  });

  it('quien administra sí llega al servicio', async () => {
    const a = await acciones();
    m.reintentar.mockClear();
    await expect(a.reintentar(fd())).rejects.toThrow('redirect'); // la acción termina con redirect()
    expect(m.reintentar).toHaveBeenCalledTimes(1);
  });
});
