import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA PÁGINA DEL AGENTE DE LIQUIDACIONES PARA EL ROL `nomina` (0949).
//
// Con espías en TODA la capa de datos de la pantalla del dueño (KPIs, liquidaciones, cola, desgloses, excepciones, configuración,
// formato, corridas, costos...): para `nomina` la página devuelve la vista de conteos y NO toca ninguno. Para el dueño sigue
// devolviendo la pantalla de siempre (la prueba de arriba no pasa por no leer nada).
// ═══════════════════════════════════════════════════════════════════════════

const m = vi.hoisted(() => {
  const espia = () => vi.fn(async () => null);
  return {
    rol: 'nomina',
    resolver: vi.fn(),
    getKpis: vi.fn(async () => ({ porRevisar: 0 })),
    getLiquidaciones: espia(), contarViajes: espia(), getLiquidacionesPorDia: espia(), getHechosSolos: espia(),
    getDineroObservadoPorTipo: espia(), getStatsPorOperador: espia(), getValorAhorro: espia(), getConfig: espia(),
    traerResumenCostoIaTenant: espia(), ultimasCorridas: espia(), colaRevision: vi.fn(async () => ({ filas: [] })),
    listarTerminales: espia(), buscarCatalogo: vi.fn(async () => []),
    contarPorEstado: espia(), contarNoCoincide: espia(), listarLiquidacionesExternas: vi.fn(async () => ({ filas: [], hayMas: false, total: 0 })),
    leerFormatoFlota: espia(), leerTelefonosFlota: espia(), leerPorId: espia(), avisosDiscrepanciaDe: espia(),
    leerConfigCorreo: vi.fn(async () => ({ ok: true, valor: { canal: 'correo' } })),
    listarDesgloses: vi.fn(async () => ({ ok: true, valor: { items: [], siguiente: null } })),
    entregasDe: vi.fn(async () => ({ ok: true, valor: [] })),
    contarParaInsights: vi.fn(async () => ({ ok: true, valor: { desgloses: 0, entregasPorEstado: {}, excepcionesAbiertas: 0 } })),
    listarExcepciones: vi.fn(async () => ({ ok: true, valor: [] })),
    contarParaNomina: vi.fn(async () => ({ recibidosHoy: 1, enviados: 2, entregados: 3, rebotados: 4, retenidos: 5, sinPoliza: 6 })),
    leerFlash: vi.fn(async () => ({})),
    canal: vi.fn(async () => 'correo'),
    efectos: {
      reintentar: vi.fn(async () => 'x'), copia: vi.fn(async () => ({})), reavisar: vi.fn(async () => 'x'), reenviar: vi.fn(async () => ({ estado: 'reenviado' })),
      liberar: vi.fn(async () => ({ estado: 'liberado' })), importar: vi.fn(async () => ({})), guardarEstrategia: vi.fn(async () => {}),
    },
  };
});

vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => m.resolver() }));
vi.mock('@/lib/auth/perfil_tenant', () => ({ perfilDeTenant: async () => 'cinco_agentes' }));
vi.mock('@/lib/likida/mensaje_flash', () => ({ dejarFlash: async () => {}, leerFlash: m.leerFlash }));
vi.mock('next/navigation', () => ({ redirect: (a: string) => { throw new Error(`redirect:${a}`); } }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/likida/analytics', () => ({
  getKpis: m.getKpis, getLiquidaciones: m.getLiquidaciones, contarViajes: m.contarViajes, getLiquidacionesPorDia: m.getLiquidacionesPorDia,
  getHechosSolos: m.getHechosSolos, getDineroObservadoPorTipo: m.getDineroObservadoPorTipo, getStatsPorOperador: m.getStatsPorOperador, getValorAhorro: m.getValorAhorro,
}));
vi.mock('@/lib/likida/config', () => ({ getConfig: m.getConfig }));
vi.mock('@/lib/likida/costos', () => ({ traerResumenCostoIaTenant: m.traerResumenCostoIaTenant }));
vi.mock('@/lib/likida/agentes/corridas', () => ({ ultimasCorridas: m.ultimasCorridas }));
vi.mock('@/lib/likida/agentes/estrategia', () => ({ validarUmbralConfianza: () => 0, guardarEstrategiaAgente: m.efectos.guardarEstrategia }));
vi.mock('@/lib/likida/liquidacion_externa/liberar_envio', () => ({ liberarEnvio: m.efectos.liberar }));
vi.mock('@/lib/likida/errores', () => ({ mensajeParaPantalla: () => '' }));
vi.mock('@/lib/likida/revision', () => ({
  colaRevision: m.colaRevision, leerFiltrosCola: () => ({}), decodificarCursorCola: () => null, listarTerminales: m.listarTerminales,
}));
vi.mock('@/lib/likida/repo', () => ({ buscarCatalogo: m.buscarCatalogo }));
vi.mock('@/lib/likida/liquidacion_externa/repo', () => ({
  contarPorEstado: m.contarPorEstado, contarNoCoincide: m.contarNoCoincide, avisosDiscrepanciaDe: m.avisosDiscrepanciaDe,
  listarLiquidacionesExternas: m.listarLiquidacionesExternas, leerFormatoFlota: m.leerFormatoFlota, leerTelefonosFlota: m.leerTelefonosFlota, leerPorId: m.leerPorId,
  contarParaNomina: m.contarParaNomina,
}));
vi.mock('@/lib/likida/liquidacion_externa/servicio', () => ({
  reintentarLiquidacionExterna: m.efectos.reintentar, reenviarCopiaAJefe: m.efectos.copia, reavisarDiscrepancia: m.efectos.reavisar,
  canalDeEntregaPorOmision: m.canal,
}));
vi.mock('@/lib/likida/liquidacion_externa/reenvio_correo', () => ({ reenviarDesglose: m.efectos.reenviar }));
vi.mock('@/lib/likida/liquidacion_externa/importar_archivo', () => ({ importarLiquidacionesDeArchivo: m.efectos.importar }));
vi.mock('@/lib/likida/liquidacion_externa/repo_correo', () => ({
  leerConfigCorreo: m.leerConfigCorreo, listarDesgloses: m.listarDesgloses, entregasDe: m.entregasDe,
  contarParaInsights: m.contarParaInsights, listarExcepciones: m.listarExcepciones,
}));
vi.mock('@/app/api/v1/_comun', () => ({ decodificarCursor: () => null, codificarCursor: () => 'x' }));
vi.mock('../seccion-notificaciones', () => ({ SeccionNotificaciones: () => null }));
vi.mock('../ficha-corridas', () => ({ FichaCorridas: () => null }));
vi.mock('../estrategia-forma', () => ({ FormaEstrategiaLiquidacion: () => null }));

import PaginaAgenteLiquidacion from './page';
import { PaginaConteosNomina } from './conteos-nomina';
import { VistaDesgloses } from './desgloses';
import type { ReactElement } from 'react';

const pedir = async (sp: Record<string, string> = {}) =>
  (await PaginaAgenteLiquidacion({ searchParams: Promise.resolve(sp) })) as ReactElement<Record<string, unknown>>;

const LECTORES = [
  'getKpis', 'getLiquidaciones', 'contarViajes', 'getLiquidacionesPorDia', 'getHechosSolos', 'getDineroObservadoPorTipo', 'getStatsPorOperador',
  'getValorAhorro', 'getConfig', 'traerResumenCostoIaTenant', 'ultimasCorridas', 'colaRevision', 'listarTerminales', 'buscarCatalogo',
  'contarPorEstado', 'contarNoCoincide', 'listarLiquidacionesExternas', 'leerFormatoFlota', 'leerTelefonosFlota', 'leerPorId',
  'avisosDiscrepanciaDe', 'leerConfigCorreo', 'listarDesgloses', 'entregasDe', 'contarParaInsights', 'listarExcepciones', 'leerFlash', 'canal',
] as const;

beforeEach(() => {
  for (const k of LECTORES) (m[k] as ReturnType<typeof vi.fn>).mockClear();
  m.contarParaNomina.mockClear();
  m.resolver.mockReset();
});

describe('para nomina', () => {
  beforeEach(() => m.resolver.mockResolvedValue({ tenantId: 't-1', rol: 'nomina', userId: 'u-n' }));

  it('devuelve la vista de conteos', async () => {
    const el = await pedir();
    expect(el.type).toBe(PaginaConteosNomina);
    expect(el.props.tenantId).toBe('t-1');
  });

  it('NO lee ni una de las lecturas de la pantalla del dueño (KPIs, cola, desgloses, excepciones, formato, costos, flash...)', async () => {
    await pedir();
    for (const k of LECTORES) expect(m[k] as ReturnType<typeof vi.fn>, k).not.toHaveBeenCalled();
  });

  it('los parámetros de la URL no abren nada más: ni el detalle de un desglose, ni los filtros, ni la cola', async () => {
    const el = await pedir({
      des_det: '0b6f2c1e-7d3a-4c8e-9f10-123456789abc', des_estado: 'retenido', des_cursor: 'x', rev: 'todas', estado: 'por_revisar',
      ext_estado: 'error', vista: 'demo', tenant: 't-ajeno', rol: 'flota_admin',
    });
    expect(el.type).toBe(PaginaConteosNomina);
    for (const k of LECTORES) expect(m[k] as ReturnType<typeof vi.fn>, k).not.toHaveBeenCalled();
  });

  it('el tenant de la vista es SOLO el de la sesión (un ?tenant= no lo cambia)', async () => {
    const el = await pedir({ tenant: 't-ajeno' });
    expect(el.props.tenantId).toBe('t-1');
  });
});

describe('para el dueño nada cambia', () => {
  it('con el canal en correo sigue devolviendo la lista de desgloses y SÍ lee sus datos', async () => {
    m.resolver.mockResolvedValue({ tenantId: 't-1', rol: 'flota_admin', userId: 'u-1' });
    const el = await pedir();
    expect(el.type).toBe(VistaDesgloses);
    expect(m.canal).toHaveBeenCalled();
    expect(m.contarParaInsights).toHaveBeenCalled();
    expect(m.contarParaNomina).not.toHaveBeenCalled();
  });
});

describe('un rol que no ve la ruta rebota como siempre', () => {
  it('un encargado (operación, sin dinero) no abre Liquidaciones', async () => {
    m.resolver.mockResolvedValue({ tenantId: 't-1', rol: 'encargado', userId: 'u-e' });
    await expect(pedir()).rejects.toThrow('redirect:/dashboard');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LAS DIEZ ACCIONES DE SERVIDOR: alcanzables por POST directo, así que se sacan de la pantalla del dueño (la que las trae como
// props), se cambia la sesión a `nomina` y se invocan. Todas deben rechazar y NINGÚN efecto debe ejecutarse.
// ═══════════════════════════════════════════════════════════════════════════
const ACCIONES = [
  'reenviarDesgloseExterno', 'liberarEnvioExterno', 'subirDesglosesExportados', 'subirContactosOperadores', 'buscarFiltro',
  'reintentarExterna', 'subirLiquidacionesExternas', 'reenviarCopiaExterna', 'reavisarExterna', 'guardarEstrategia',
];

function funciones(nodo: unknown, vistos = new Set<unknown>(), fuera: Array<(...a: unknown[]) => unknown> = []) {
  if (!nodo || typeof nodo !== 'object' || vistos.has(nodo) || typeof (nodo as { then?: unknown }).then === 'function') return fuera;
  vistos.add(nodo);
  const valores = Array.isArray(nodo) ? nodo : Object.values(nodo as object);
  for (const v of valores) {
    if (typeof v === 'function') { if (!fuera.includes(v as never)) fuera.push(v as never); } else funciones(v, vistos, fuera);
  }
  return fuera;
}

describe('las acciones de servidor rechazan a nomina', () => {
  it('las diez existen, y ninguna opera ni lee cuando la sesión es nomina', async () => {
    m.resolver.mockResolvedValue({ tenantId: 't-1', rol: 'flota_admin', userId: 'u-1' });
    const todas: Array<(...a: unknown[]) => unknown> = [];
    for (const canal of ['whatsapp', 'correo'] as const) {
      m.canal.mockResolvedValue(canal);
      // `des_det` abre el detalle de un desglose, que es donde la pantalla del dueño trae reenviar y liberar.
      funciones(await pedir({ des_det: '0b6f2c1e-7d3a-4c8e-9f10-123456789abc' }), new Set(), todas);
    }
    const acciones = todas.filter((f) => ACCIONES.includes(f.name));
    expect(new Set(acciones.map((f) => f.name))).toEqual(new Set(ACCIONES));

    m.resolver.mockResolvedValue({ tenantId: 't-1', rol: 'nomina', userId: 'u-n' });
    for (const k of LECTORES) (m[k] as ReturnType<typeof vi.fn>).mockClear();
    for (const f of Object.values(m.efectos)) f.mockClear();
    const fd = new FormData();
    fd.set('id', '0b6f2c1e-7d3a-4c8e-9f10-123456789abc'); fd.set('a', 'todos'); fd.set('motivo', 'manual');
    for (const accion of acciones) {
      let rechazo = false;
      try {
        const r = await (accion.length >= 2 ? accion({ ok: true }, fd) : accion.name === 'buscarFiltro' ? accion('operador', 'x') : accion(fd));
        rechazo = !!r && typeof r === 'object' && 'ok' in r && (r as { ok: boolean }).ok === false;
      } catch {
        rechazo = true;
      }
      expect(rechazo, `${accion.name} no rechazó a nomina`).toBe(true);
    }
    for (const [k, f] of Object.entries(m.efectos)) expect(f, k).not.toHaveBeenCalled();
    expect(m.buscarCatalogo).not.toHaveBeenCalled();
  });
});
