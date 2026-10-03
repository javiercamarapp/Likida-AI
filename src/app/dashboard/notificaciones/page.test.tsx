import { beforeEach, expect, it, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// /dashboard/notificaciones — CERO cobertura de la PÁGINA (calcularAlertasFlota
// ya tiene prueba propia en calcular-alertas-flota.test.ts). Sólo lectura, sin
// server actions. Lo real que se vigila aquí: CADA señal se lee con
// `.catch(() => null)` por separado — un Promise.all sin eso tumbaría TODA la
// pantalla de alertas por una sola consulta rota, justo cuando hay algo que
// avisar.
// ═══════════════════════════════════════════════════════════════════════════

const dobles = vi.hoisted(() => ({
  getKpis: vi.fn(),
  detectarAnomalias: vi.fn(),
  contarEscalados: vi.fn(),
  contarHuerfanosPendientes: vi.fn(),
  getConexiones: vi.fn(),
  calcularAlertasFlota: vi.fn(),
  escalacionesAbiertas: vi.fn(),
  entradaTablero: vi.fn(),
  armarTableroViajes: vi.fn(),
}));

let sesion: { tenantId: string; rol: string } = { tenantId: 't-1', rol: 'flota_admin' };

vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => sesion }));
vi.mock('next/navigation', () => ({ redirect: (ruta: string) => { throw new Error(`REDIRECT:${ruta}`); } }));
vi.mock('@/lib/likida/analytics', () => ({ getKpis: dobles.getKpis, detectarAnomalias: dobles.detectarAnomalias, contarEscalados: dobles.contarEscalados }));
vi.mock('@/lib/likida/repo', () => ({ contarHuerfanosPendientes: dobles.contarHuerfanosPendientes }));
vi.mock('@/lib/likida/conexiones', () => ({ getConexiones: dobles.getConexiones }));
vi.mock('@/lib/likida/orquestador/fuentes', () => ({ fuentes: () => ({ escalacionesAbiertas: dobles.escalacionesAbiertas, entradaTablero: dobles.entradaTablero }) }));
vi.mock('@/lib/likida/orquestador/fuentes_reales', () => ({}));
vi.mock('@/lib/likida/orquestador/tablero_viajes', () => ({ armarTableroViajes: dobles.armarTableroViajes }));
vi.mock('@/lib/saludo', () => ({ ahoraMs: () => Date.parse('2026-10-02T18:00:00.000Z') }));
vi.mock('../calcular-alertas-flota', () => ({ calcularAlertasFlota: dobles.calcularAlertasFlota }));
vi.mock('./lista', () => ({ ListaAlertas: (props: { alertas: unknown }) => props }));

import PaginaNotificaciones from './page';

const SP = Promise.resolve({});

beforeEach(() => {
  vi.clearAllMocks();
  sesion = { tenantId: 't-1', rol: 'flota_admin' };
  dobles.getKpis.mockResolvedValue({ porRevisar: 3 });
  dobles.detectarAnomalias.mockResolvedValue([{ id: 'a-1' }]);
  dobles.contarEscalados.mockResolvedValue(1);
  dobles.contarHuerfanosPendientes.mockResolvedValue(0);
  dobles.getConexiones.mockResolvedValue([]);
  dobles.calcularAlertasFlota.mockReturnValue([]);
  dobles.escalacionesAbiertas.mockResolvedValue([
    { id: 'e1', destino: 'mesa_de_control', motivo: 'posible_emergencia' },
    { id: 'e2', destino: 'contador', motivo: 'duda_fiscal' },
  ]);
  dobles.entradaTablero.mockResolvedValue({});
  dobles.armarTableroViajes.mockReturnValue({ conteos: { conExcepcion: 4, sinSenal: 1 } });
});

// `/dashboard/notificaciones` vive en RUTAS_TODO_ROL a propósito (16-ago-2026):
// antes el contador —que sólo ve `dinero`— quedaba fuera de una pantalla que
// prometía "para todos los roles". Nadie se redirige aquí; el filtrado real
// pasa POR ALERTA, dentro de calcularAlertasFlota, vía el tercer argumento.
it.each(['encargado', 'contador', 'superadmin'])('%s SÍ puede ver la página — el filtrado es por alerta, no por ruta', async (rol) => {
  sesion = { tenantId: 't-1', rol };
  await expect(PaginaNotificaciones({ searchParams: SP })).resolves.toBeTruthy();
});

// `vendedor` no tiene área en AREAS_POR_ROL (su casa es /vendedor, no
// /dashboard) — ni siquiera RUTAS_TODO_ROL lo deja entrar: `puedeVerRuta`
// exige `areasDe(rol).length > 0`, y la de vendedor es vacía a propósito.
it('vendedor no tiene área asignada: tampoco entra a una ruta "para todos"', async () => {
  sesion = { tenantId: 't-1', rol: 'vendedor' };
  await expect(PaginaNotificaciones({ searchParams: SP })).rejects.toThrow('REDIRECT:/dashboard');
});

it('el callback de visibilidad por alerta refleja el rol real (contador no ve una ruta de operación)', async () => {
  sesion = { tenantId: 't-1', rol: 'contador' };
  await PaginaNotificaciones({ searchParams: SP });
  const puedeVer = dobles.calcularAlertasFlota.mock.calls[0][2] as (href: string) => boolean;
  expect(puedeVer('/dashboard/despacho')).toBe(false);
  expect(puedeVer('/dashboard/contador')).toBe(true);
});

it('lee las cinco señales del tenant de la SESIÓN y las pasa a calcularAlertasFlota', async () => {
  await PaginaNotificaciones({ searchParams: SP });
  expect(dobles.getKpis).toHaveBeenCalledWith('t-1');
  expect(dobles.detectarAnomalias).toHaveBeenCalledWith('t-1');
  expect(dobles.contarEscalados).toHaveBeenCalledWith('t-1');
  expect(dobles.contarHuerfanosPendientes).toHaveBeenCalledWith('t-1');
  expect(dobles.getConexiones).toHaveBeenCalledWith('t-1');
  expect(dobles.calcularAlertasFlota).toHaveBeenCalledWith(
    expect.objectContaining({ porRevisar: 3, duplicados: 1, escalados: 1, huerfanos: 0, conectores: [] }),
    expect.anything(), expect.any(Function),
  );
});

it('si UNA señal falla, las otras CUATRO se siguen leyendo — no cae la pantalla entera', async () => {
  dobles.getKpis.mockRejectedValueOnce(new Error('kpis caídos'));
  await PaginaNotificaciones({ searchParams: SP });
  expect(dobles.calcularAlertasFlota).toHaveBeenCalledWith(
    expect.objectContaining({ porRevisar: null, duplicados: 1, escalados: 1, huerfanos: 0, conectores: [] }),
    expect.anything(), expect.any(Function),
  );
});

it('cada señal caída se distingue como null, nunca como 0/vacío (0 sería una medición real)', async () => {
  dobles.detectarAnomalias.mockRejectedValueOnce(new Error('caída'));
  dobles.contarEscalados.mockRejectedValueOnce(new Error('caída'));
  await PaginaNotificaciones({ searchParams: SP });
  expect(dobles.calcularAlertasFlota).toHaveBeenCalledWith(
    expect.objectContaining({ duplicados: null, escalados: null }),
    expect.anything(), expect.any(Function),
  );
});

// P6: las tareas del asistente y las excepciones del Conductor entran a las notificaciones.
it('el dueño ve las tareas abiertas (todas) y las excepciones de viajes en vivo con los sin señal de vida', async () => {
  await PaginaNotificaciones({ searchParams: SP });
  expect(dobles.escalacionesAbiertas).toHaveBeenCalledWith('t-1', 60);
  expect(dobles.calcularAlertasFlota).toHaveBeenCalledWith(
    expect.objectContaining({ tareasAsistente: 2, excepcionesConductor: 4, sinSenalDeVida: 1 }),
    expect.anything(), expect.any(Function),
  );
});

it('el encargado solo cuenta las tareas que puede leer: la de dinero no entra a su campana', async () => {
  sesion = { tenantId: 't-1', rol: 'encargado' };
  await PaginaNotificaciones({ searchParams: SP });
  expect(dobles.calcularAlertasFlota).toHaveBeenCalledWith(
    expect.objectContaining({ tareasAsistente: 1 }), expect.anything(), expect.any(Function),
  );
});

it('el contador no ve viajes en vivo: ni se leen esas fuentes ni existen esas señales (undefined, no null)', async () => {
  sesion = { tenantId: 't-1', rol: 'contador' };
  await PaginaNotificaciones({ searchParams: SP });
  expect(dobles.escalacionesAbiertas).not.toHaveBeenCalled();
  expect(dobles.entradaTablero).not.toHaveBeenCalled();
  const senales = dobles.calcularAlertasFlota.mock.calls[0][0] as Record<string, unknown>;
  expect(senales.tareasAsistente).toBeUndefined();
  expect(senales.excepcionesConductor).toBeUndefined();
});

it('si el tablero o las tareas no se pueden leer se confiesa (null), no se pinta como cero', async () => {
  dobles.escalacionesAbiertas.mockRejectedValueOnce(new Error('caída'));
  dobles.entradaTablero.mockRejectedValueOnce(new Error('caída'));
  await PaginaNotificaciones({ searchParams: SP });
  expect(dobles.calcularAlertasFlota).toHaveBeenCalledWith(
    expect.objectContaining({ tareasAsistente: null, excepcionesConductor: null }), expect.anything(), expect.any(Function),
  );
});
