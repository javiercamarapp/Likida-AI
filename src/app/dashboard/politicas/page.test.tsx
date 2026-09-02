import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · H35/H39 — /dashboard/politicas.
//
// H35: la lectura de `tenant.config` para saber si la política es PROPIA o
// HEREDADA no comprobaba `error` — una consulta caída se leía igual que
// "no tiene política propia" y la pantalla afirmaba «Heredada de la base»
// sobre una flota que quizás sí tiene la suya.
// H39: la tabla "Reglas por ruta" era la única de las tres sin
// `overflow-x-auto` — un nombre de ruta largo se cortaba en un teléfono sin
// forma de deslizar para leerlo completo.
// ═══════════════════════════════════════════════════════════════════════════

let rolPrueba = 'contador';
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => ({ tenantId: 't-1', rol: rolPrueba }) }));
vi.mock('@/lib/auth/guard', () => ({ requireSessionTenant: async () => ({ userId: 'u-1', tenantId: 't-1', rol: 'contador' }) }));

let politicaConfig: Array<{ concepto: string; topeMonto?: number; requiereCfdi: boolean; ruta?: string }> = [
  { concepto: 'diesel', topeMonto: 500, requiereCfdi: true },
];
vi.mock('@/lib/likida/config', () => ({
  getConfig: async () => ({
    politica: politicaConfig,
    estimulos: { viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, peajeFactor: 0.5 },
    tabulador: { umbralDesviacion: 0.2 },
  }),
}));

let tenantSelectResultado: { data: { config: unknown } | null; error: { message: string } | null } = { data: { config: { politica: [] } }, error: null };
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => tenantSelectResultado }) }) }),
  }),
}));

const { default: PoliticasPage } = await import('./page');

async function render() {
  const elemento = await PoliticasPage({ searchParams: Promise.resolve({}) });
  return renderToStaticMarkup(elemento as never);
}

async function renderComo(rol: string): Promise<string> {
  const antes = rolPrueba;
  rolPrueba = rol;
  try {
    return await render();
  } finally {
    rolPrueba = antes;
  }
}

describe('H35 — "propia vs heredada" falla cerrado', () => {
  it('lectura sana, `config` sin `politica` (array): dice "Heredada de la base"', async () => {
    // `Array.isArray` decide "propia" — un `config` sin la llave `politica`
    // (nunca ha guardado la suya) es el caso REAL de "heredada".
    tenantSelectResultado = { data: { config: {} }, error: null };
    const html = await render();
    expect(html).toContain('Heredada de la base');
    expect(html).not.toContain('No se pudo saber si es propia');
  });

  it('lectura sana, `config.politica` SÍ es un arreglo: NO dice "Heredada" — es propia', async () => {
    tenantSelectResultado = { data: { config: { politica: [] } }, error: null };
    const html = await render();
    expect(html).not.toContain('Heredada de la base');
    expect(html).not.toContain('No se pudo saber si es propia');
  });

  it('lectura caída: dice "No se pudo saber si es propia", NUNCA "Heredada de la base" (que sería afirmar algo que no se pudo comprobar)', async () => {
    tenantSelectResultado = { data: null, error: { message: 'timeout' } };
    const html = await render();
    expect(html).toContain('No se pudo saber si es propia');
    expect(html).not.toContain('Heredada de la base');
  });

  it('lectura caída, rol que SÍ puede editar: el párrafo bajo la tabla también lo dice, no solo el pill', async () => {
    tenantSelectResultado = { data: null, error: { message: 'timeout' } };
    const html = await renderComo('flota_admin');
    expect(html).toMatch(/No se pudo leer si esta flota ya tiene su propia política/);
  });
});

describe('H39 — la tabla "Reglas por ruta" desliza en pantallas angostas', () => {
  it('con reglas por ruta: la tabla va envuelta en overflow-x-auto, como las otras dos', async () => {
    tenantSelectResultado = { data: { config: { politica: [] } }, error: null };
    politicaConfig = [
      { concepto: 'diesel', topeMonto: 500, requiereCfdi: true },
      { concepto: 'diesel', topeMonto: 300, requiereCfdi: false, ruta: 'CDMX - Nuevo Laredo, Tamaulipas' },
    ];
    const html = await render();
    const idx = html.indexOf('Reglas por ruta');
    expect(idx, 'debe existir la sección de reglas por ruta').toBeGreaterThan(-1);
    const seccion = html.slice(idx, idx + 800);
    expect(seccion).toContain('overflow-x-auto');
    expect(seccion).toContain('CDMX - Nuevo Laredo, Tamaulipas');
  });
});
