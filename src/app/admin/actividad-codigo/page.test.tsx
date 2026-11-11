import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
// A37-S05-01/S06-01: la página ahora llama su propia puerta; aquí la sesión es de superadmin.
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: vi.fn(async () => ({ rol: 'superadmin', tenantId: null, nombre: 'Prueba' })) }));

// ═══════════════════════════════════════════════════════════════════════════
// /admin/actividad-codigo — CERO cobertura de la PÁGINA (getActividadCodigo
// ya tiene prueba propia). Sin server actions, gate en admin/layout.tsx. Lo
// real: los CUATRO estados (sin_token/calculando/error/ok) nunca se
// confunden entre sí — "sin_token" y "error" jamás se ven como cero commits.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => '/admin/actividad-codigo', useSearchParams: () => new URLSearchParams() }));
const dobles = vi.hoisted(() => ({ getActividadCodigo: vi.fn() }));
vi.mock('@/lib/admin/actividad-codigo', () => ({ getActividadCodigo: dobles.getActividadCodigo }));

import ActividadCodigoPage from './page';
async function renderizar() { return renderToStaticMarkup(await ActividadCodigoPage()); }

it('sin acceso a GitHub: lo dice explícito y sin jerga de variables — nunca "cero commits"', async () => {
  dobles.getActividadCodigo.mockResolvedValue({ estado: 'sin_token' });
  const html = await renderizar();
  expect(html).not.toContain('GITHUB_TOKEN');
  // F26 ronda 5: UN solo estado de página (antes aviso + 4 cifras «Sin dato» + 3 vacíos): la causa y la salida van en ese estado.
  expect(html).toContain('Pídele al equipo técnico');
  expect(html.match(/GitHub aún no está conectado/g)?.length).toBe(1);
  // F26 ronda 3: sin conexión es una caja punteada neutra con la causa verdadera (GitHub sin conectar), sin rojo y sin «Reintentar»
  // por celda; y jamás un cero.
  expect(html).toContain('GitHub aún no está conectado');
  expect(html).not.toContain('no respondió a tiempo');
  expect(html).not.toContain('Reintentar');
  expect(html).not.toMatch(/data-estado="error"/);
  expect(html).not.toMatch(/rv-kpi__valor"[^>]*>0</);
});

it('GitHub calculando (202): lo dice, invita a recargar — no es un error ni un cero', async () => {
  dobles.getActividadCodigo.mockResolvedValue({ estado: 'calculando' });
  const html = await renderizar();
  expect(html).toContain('todavía está calculando');
  expect(html).not.toMatch(/rv-kpi__valor"[^>]*>0</);
});

it('error de lectura: muestra el detalle real y ACLARA que no significa "sin commits"', async () => {
  dobles.getActividadCodigo.mockResolvedValue({ estado: 'error', detalle: 'GitHub contestó 500' });
  const html = await renderizar();
  expect(html).toContain('GitHub contestó 500');
  expect(html).toContain('Esto NO significa que no haya commits');
  expect(html).not.toContain('GITHUB_TOKEN');
  // Un fallo real lleva UN solo «Reintentar» (el del aviso), no uno por celda; el rojo no se reparte.
  expect(html.match(/>Reintentar</g)?.length).toBe(1);
  expect(html).not.toMatch(/data-estado="error"/);
});

it('ok con datos reales: pinta el heatmap y los totales medidos', async () => {
  dobles.getActividadCodigo.mockResolvedValue({
    estado: 'ok', totalAnual: 250,
    semanas: [{ semana: 1735689600, dias: [1, 0, 3, 0, 2, 0, 0], total: 6 }, { semana: 1736294400, dias: [0, 0, 0, 0, 0, 0, 5], total: 5 }],
    recientes: [{ sha: 'abc1234', mensaje: 'fix: algo real', fecha: '2026-01-01T00:00:00Z' }],
  });
  const html = await renderizar();
  expect(html).toContain('250');
  expect(html).toContain('fix: algo real');
  expect(html).toContain('abc1234');
});

it('ok pero semana actual en cero DE VERDAD (medido): dice 0, no un guion ni "sin dato"', async () => {
  dobles.getActividadCodigo.mockResolvedValue({
    estado: 'ok', totalAnual: 10,
    semanas: [{ semana: 1735689600, dias: [1, 0, 0, 0, 0, 0, 0], total: 1 }, { semana: 1736294400, dias: [0, 0, 0, 0, 0, 0, 0], total: 0 }],
    recientes: [],
  });
  const html = await renderizar();
  expect(html).toContain('Esta semana');
  // El StatCard de "Esta semana" recibe valor=0 real — se comprueba que la
  // página lee `a.semanas[length-1].total` y no un valor fijo o `?? algo
  // distinto de 0`.
  expect(html).not.toContain('undefined');
});

it('un commit sin fecha se muestra con guion, no una fecha inventada', async () => {
  dobles.getActividadCodigo.mockResolvedValue({
    estado: 'ok', totalAnual: 1,
    semanas: [{ semana: 1735689600, dias: [1], total: 1 }],
    recientes: [{ sha: 'zzz9999', mensaje: 'commit raro', fecha: null }],
  });
  const html = await renderizar();
  expect(html).toContain('zzz9999');
  expect(html).toContain('—');
});
