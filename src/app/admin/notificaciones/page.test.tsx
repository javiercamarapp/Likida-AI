import { beforeEach, expect, it, vi } from 'vitest';
// A37-S05-01/S06-01: la página ahora llama su propia puerta; aquí la sesión es de superadmin.
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: vi.fn(async () => ({ rol: 'superadmin', tenantId: null, nombre: 'Prueba' })) }));

// ═══════════════════════════════════════════════════════════════════════════
// /admin/notificaciones — CERO cobertura de la página. calcularAlertas y las
// fuentes (negocio.ts, escalaciones.ts) ya tienen prueba propia. La puerta
// (requireSuperadmin) vive en admin/layout.tsx, no aquí — esta página no
// tiene server actions ni chequeo propio. Lo que sí es suyo: que las CUATRO
// fuentes se lean y se pasen a calcularAlertas con la forma correcta, y que
// use el TOTAL real de conversaciones (FE-9), no el tamaño de una página de 20.
// ═══════════════════════════════════════════════════════════════════════════

const dobles = vi.hoisted(() => ({
  getResumenNegocio: vi.fn(),
  getConversacionesActivas: vi.fn(),
  contarConversacionesActivas: vi.fn(),
  getBandejaEscalaciones: vi.fn(),
  calcularAlertas: vi.fn(),
}));

vi.mock('@/lib/admin/negocio', () => ({
  getResumenNegocio: dobles.getResumenNegocio,
  getConversacionesActivas: dobles.getConversacionesActivas,
  contarConversacionesActivas: dobles.contarConversacionesActivas,
}));
vi.mock('@/lib/admin/escalaciones', () => ({ getBandejaEscalaciones: dobles.getBandejaEscalaciones }));
vi.mock('../calcular-alertas', () => ({ calcularAlertas: dobles.calcularAlertas }));
vi.mock('./lista', () => ({ default: (props: { alertas: unknown }) => props }));

import NotificacionesPage from './page';

beforeEach(() => {
  vi.clearAllMocks();
  dobles.getResumenNegocio.mockResolvedValue({ costoHoyUsd: 1 });
  dobles.getConversacionesActivas.mockResolvedValue([{ id: 'c-1' }]);
  dobles.contarConversacionesActivas.mockResolvedValue(37);
  dobles.getBandejaEscalaciones.mockResolvedValue({ conteos: { alto: 2 } });
  dobles.calcularAlertas.mockReturnValue([]);
});

it('lee las cuatro fuentes y las pasa a calcularAlertas con la forma correcta', async () => {
  await NotificacionesPage();
  expect(dobles.getResumenNegocio).toHaveBeenCalled();
  expect(dobles.getConversacionesActivas).toHaveBeenCalled();
  expect(dobles.getBandejaEscalaciones).toHaveBeenCalledWith(expect.any(Number));
  expect(dobles.contarConversacionesActivas).toHaveBeenCalled();
  expect(dobles.calcularAlertas).toHaveBeenCalledWith(
    { costoHoyUsd: 1 }, [{ id: 'c-1' }], { alto: 2 }, 37,
  );
});

it('usa el TOTAL real de conversaciones (FE-9), no la longitud de la página de 20', async () => {
  dobles.getConversacionesActivas.mockResolvedValue(Array.from({ length: 20 }, (_, i) => ({ id: `c-${i}` })));
  dobles.contarConversacionesActivas.mockResolvedValue(153);
  await NotificacionesPage();
  expect(dobles.calcularAlertas).toHaveBeenCalledWith(expect.anything(), expect.any(Array), expect.anything(), 153);
});

// A37-S07-07 — una fuente caída tumbaba la página entera (Promise.all sin
// catch). Ahora cada fuente degrada por separado y se AVISA que está ciega.
it('A37-S07-07: si getResumenNegocio falla, la página no cae: calcula con null y avisa la fuente ciega', async () => {
  dobles.getResumenNegocio.mockRejectedValue(new Error('resumen_negocio: timeout'));
  const tree = (await NotificacionesPage()) as unknown as { props: { children: unknown } };
  expect(tree).toBeTruthy();
  expect(dobles.calcularAlertas).toHaveBeenCalledWith(null, [{ id: 'c-1' }], { alto: 2 }, 37);
  const props = JSON.stringify(tree, (_k, v) => (typeof v === 'function' ? undefined : v));
  expect(props).toMatch(/No se pudo leer/);
  expect(props).toMatch(/resumen del negocio/);
});

it('A37-S07-07: si la lista de conversaciones falla, sigue con [] y lo dice', async () => {
  dobles.getConversacionesActivas.mockRejectedValue(new Error('boom'));
  dobles.contarConversacionesActivas.mockResolvedValue(null);
  const tree = await NotificacionesPage();
  expect(dobles.calcularAlertas).toHaveBeenCalledWith({ costoHoyUsd: 1 }, [], { alto: 2 }, null);
  expect(JSON.stringify(tree)).toMatch(/conversaciones/);
});
