import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
// A37-S05-01/S06-01: la página ahora llama su propia puerta; aquí la sesión es de superadmin.
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: vi.fn(async () => ({ rol: 'superadmin', tenantId: null, nombre: 'Prueba' })) }));

// ═══════════════════════════════════════════════════════════════════════════
// /admin/escalaciones — CERO cobertura. Puerta en el layout de /admin, no
// aquí. getBandejaEscalaciones ya tiene prueba propia (escalaciones.test.ts).
// Lo que se vigila aquí es el patrón "items === null ⟺ error !== null" (una
// fuente caída se DICE, nunca se colapsa a cero) y el fix ADM-4 (auditoría
// 24): las tarjetas de conteo usan el total REAL de cada fuente, no el
// tamaño de una lista topada.
// ═══════════════════════════════════════════════════════════════════════════

const dobles = vi.hoisted(() => ({ getBandejaEscalaciones: vi.fn(), getAgentesParados: vi.fn(), leerResumenBandeja: vi.fn() }));
vi.mock('@/lib/admin/agentes-parados', async (importar) => ({
  ...(await importar<typeof import('@/lib/admin/agentes-parados')>()),
  getAgentesParados: dobles.getAgentesParados,
}));
vi.mock('@/lib/admin/cola-aprobacion', async (importar) => ({
  ...(await importar<typeof import('@/lib/admin/cola-aprobacion')>()),
  leerResumenBandeja: dobles.leerResumenBandeja,
}));
vi.mock('@/lib/admin/escalaciones', async (importar) => ({
  ...(await importar<typeof import('@/lib/admin/escalaciones')>()),
  getBandejaEscalaciones: dobles.getBandejaEscalaciones,
}));

import type { BandejaEscalaciones, FuenteEscalacion } from '@/lib/admin/escalaciones';
import EscalacionesPage from './page';
async function renderizar() { return renderToStaticMarkup(await EscalacionesPage()); }

const FUENTES: FuenteEscalacion[] = ['arco', 'corridas', 'talachas', 'facturas_proveedor', 'tickets', 'liquidaciones'];
function bandejaVacia(): BandejaEscalaciones {
  const fuentes = {} as BandejaEscalaciones['fuentes'];
  for (const f of FUENTES) fuentes[f] = { items: [], error: null };
  return {
    fuentes, cola: [],
    conteos: { arco: 0, corridasFallo: 0, talachas: 0, facturasProveedor: 0, ticketsAbiertos: 0, ticketsVencidos: 0, liquidacionesRevisar: 0 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dobles.getAgentesParados.mockResolvedValue({ parados: [], habilitados: 3, umbralHoras: 72, latidoDelRunner: null });
  dobles.leerResumenBandeja.mockResolvedValue(null);
});

it('las seis fuentes leídas y sin nada pendiente: dice "la cola está vacía de verdad"', async () => {
  dobles.getBandejaEscalaciones.mockResolvedValue(bandejaVacia());
  const html = await renderizar();
  expect(html).toContain('La cola está vacía de verdad');
});

it('una fuente caída se DICE y NO se cuenta como 0 en su tarjeta — no se pinta como si no hubiera pendientes ahí', async () => {
  const b = bandejaVacia();
  b.fuentes.arco = { items: null, error: 'timeout leyendo solicitud_arco' };
  dobles.getBandejaEscalaciones.mockResolvedValue(b);
  const html = await renderizar();
  expect(html).toContain('Solicitudes ARCO: no se pudo leer.');
  expect(html).toContain('timeout leyendo solicitud_arco');
  expect(html).not.toContain('la cola está vacía de verdad');
});

it('con una fuente ilegible y las demás vacías: NO afirma "vacía de verdad" — deja la duda explícita', async () => {
  const b = bandejaVacia();
  b.fuentes.tickets = { items: null, error: 'caída' };
  dobles.getBandejaEscalaciones.mockResolvedValue(b);
  const html = await renderizar();
  expect(html).toContain('una fuente quedó');
  expect(html).toContain('sin leer (arriba)');
  expect(html).toContain('NO afirma que no haya pendientes en total');
});

it('el conteo de la tarjeta es el TOTAL real (ADM-4), no el tamaño de una lista de items topada', async () => {
  const b = bandejaVacia();
  // 300 corridas en fallo reales, pero la lista de items sólo trae 20 (topada).
  b.conteos.corridasFallo = 300;
  b.fuentes.corridas = { items: Array.from({ length: 20 }, (_, i) => ({
    fuente: 'corridas' as const, titulo: `Corrida ${i}`, detalle: null, tenantNombre: 'x', desde: '2026-01-01T00:00:00Z', vence: null, href: null,
  })), error: null };
  b.cola = b.fuentes.corridas.items!;
  dobles.getBandejaEscalaciones.mockResolvedValue(b);
  const html = await renderizar();
  expect(html).toContain('300');
});

it('la cola se recorta a 50 y lo declara contra el total real — sin ocultar cuántas hay de más', async () => {
  const b = bandejaVacia();
  b.cola = Array.from({ length: 75 }, (_, i) => ({
    fuente: 'liquidaciones' as const, titulo: `Liquidación ${i}`, detalle: null, tenantNombre: 'x',
    desde: new Date(Date.now() - i * 3_600_000).toISOString(), vence: null, href: `/dashboard/viajes?tenant=x&id=${i}`,
  }));
  dobles.getBandejaEscalaciones.mockResolvedValue(b);
  const html = await renderizar();
  expect(html).toContain('Se listan las 50 más urgentes de 75');
  expect(html).toContain('Los conteos de arriba SÍ son de toda la cola');
});

it('un item sin pantalla a la que llevar dice "sin ficha" — nunca un link que rebote', async () => {
  const b = bandejaVacia();
  b.cola = [{ fuente: 'talachas', titulo: 'Talacha X', detalle: null, tenantNombre: 'Flota Y', desde: '2026-01-01T00:00:00Z', vence: null, href: null }];
  dobles.getBandejaEscalaciones.mockResolvedValue(b);
  const html = await renderizar();
  expect(html).toContain('sin ficha');
});

it('un solo h1 y sin tarjeta dentro de tarjeta: la tabla es TablaBase directa en el marco', async () => {
  const b = bandejaVacia();
  b.cola = [{ fuente: 'talachas', titulo: 'Talacha X', detalle: null, tenantNombre: 'Flota Y', desde: '2026-01-01T00:00:00Z', vence: null, href: '/admin/conversaciones' }];
  dobles.getBandejaEscalaciones.mockResolvedValue(b);
  const html = await renderizar();
  expect((html.match(/<h1/g) ?? []).length).toBe(1);
  expect(html).toContain('rv-tb');
  expect(html).not.toContain('style=');
});

it('«Agentes que no corrieron y por qué»: cuenta, causa y motivo del runner; la bandeja que frena se dice y NO se toca el tope', async () => {
  dobles.getBandejaEscalaciones.mockResolvedValue(bandejaVacia());
  dobles.getAgentesParados.mockResolvedValue({
    parados: [
      { agente: 'a1', nombre: 'Agente Uno', ultimaCorrida: '2026-09-02T00:00:00Z', horasSinCorrer: 1800, causa: 'contrapresion_bandeja', motivo: 'bandeja sin atender' },
      { agente: 'a2', nombre: null, ultimaCorrida: null, horasSinCorrer: null, causa: null, motivo: null },
    ],
    habilitados: 49, umbralHoras: 72, latidoDelRunner: '2026-11-10T10:00:00Z',
  });
  dobles.leerResumenBandeja.mockResolvedValue({ pendientes: 100, urgentes: 0, masViejaCreadaEn: '2026-08-20T00:00:00Z', diasMasVieja: 82, frenaAlRunner: true, motivoFreno: 'x', topeBandeja: 40, diasVencimiento: 7 });
  const html = await renderizar();
  expect(html).toContain('Agentes que no corrieron y por qué');
  expect(html).toContain('2 de 49 agentes habilitados llevan más de 72 h sin correr');
  expect(html).toContain('Frenado por la bandeja de aprobación');
  expect(html).toContain('Nunca ha corrido');
  expect(html).toContain('Sin dato: no figura entre los saltados');
  expect(html).toContain('La bandeja de aprobación está frenando a los agentes.');
  expect(html).toContain('/admin/aprobaciones');
});

it('lectura de agentes caída: lo DICE, no afirma que ninguno esté parado', async () => {
  dobles.getBandejaEscalaciones.mockResolvedValue(bandejaVacia());
  dobles.getAgentesParados.mockResolvedValue(null);
  const html = await renderizar();
  expect(html).toContain('No es que no haya agentes parados');
  expect(html).not.toContain('Ningún agente parado');
});

it('sin agentes parados: lo dice con el universo evaluado', async () => {
  dobles.getBandejaEscalaciones.mockResolvedValue(bandejaVacia());
  const html = await renderizar();
  expect(html).toContain('Ningún agente parado');
  expect(html).toContain('Los 3 agentes habilitados corrieron en las últimas 72 h');
});
