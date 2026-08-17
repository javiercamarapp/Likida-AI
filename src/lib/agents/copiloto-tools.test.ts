import { describe, it, expect, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LAS 14 TOOLS DEL COPILOTO — la auditoría externa del 16-ago encontró que
// era el módulo con 0 de 14 funciones cubiertas. Lo que se fija aquí:
//  1. Cada tool devuelve `pantalla` (la fuente clicable, guardarraíl §5.2) y
//     esa ruta EXISTE como page.tsx real — el chip a un 404 ya pasó una vez
//     (traza_corrida → /admin/corridas sin índice) y bitacora/cobranza_saas
//     apuntaban a pantallas equivocadas hasta hoy.
//  2. Los envoltorios NO transforman a escondidas: fuentes ciegas se dicen,
//     el MRR $0 se declara como verdad medida, los uuid se validan ANTES de
//     tocar la base.
//  3. Ninguna tool lanza cuando su lib responde — el copiloto degrada, no
//     revienta.
// Los mocks devuelven formas mínimas realistas; el sujeto es el ENVOLTORIO.
// ═══════════════════════════════════════════════════════════════════════════

// Un query builder camaleónico: acepta CUALQUIER cadena de métodos y al
// await resuelve { data, error: null }. `ilike` es el único con semántica
// (la búsqueda de flota de ficha_cliente); el resto devuelve vacío honesto.
function builderFalso(datos: unknown[] = []) {
  let resultado = datos;
  const b: Record<string, unknown> = {};
  const encadena = (nombre: string) => {
    b[nombre] = (...args: unknown[]) => {
      if (nombre === 'ilike') {
        const patron = String(args[1] ?? '');
        resultado = patron.includes('DEMO') ? [{ id: 't1', nombre: 'FLOTA DEMO' }] : [];
      }
      return b;
    };
  };
  for (const m of ['select', 'eq', 'neq', 'is', 'in', 'gte', 'lte', 'ilike', 'order', 'range', 'limit', 'maybeSingle', 'single', 'head']) encadena(m);
  (b as { then: unknown }).then = (res: (v: unknown) => unknown) => res({ data: resultado, error: null, count: resultado.length });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => builderFalso() }),
}));
vi.mock('@/lib/admin/negocio', () => ({
  getResumenNegocio: async () => ({
    tenants: 3, viajesProcesados: 42, costoIaUsd: 1.2345, tendenciaCosto: -5,
    facturasTotal: 7, flotas: [{ nombre: 'FLOTA DEMO', plan: 'demo', viajes: 42, costoIaUsd: 1.2345 }],
  }),
  getConteosPlataforma: async () => ({ operadores: 5, liquidaciones: 4, conversaciones: 6, usuariosPorRol: { superadmin: 1 } }),
  getCostoPorFaseModelo: async () => ([{ fase: 'ocr', modelo: 'gemini', costoUsd: 0.5 }]),
}));
vi.mock('@/lib/admin/escalaciones', () => ({
  getBandejaEscalaciones: async () => ({
    conteos: { total: 2, vencidos: 1 },
    fuentes: { arco: { items: 1, error: null }, tickets: { items: null, error: 'fetch failed' } },
    cola: [{ fuente: 'arco', titulo: 'Solicitud ARCO', tenantNombre: 'FLOTA DEMO', desde: '2026-08-16', vence: null, href: '/admin/compliance' }],
  }),
}));
vi.mock('@/lib/admin/guardia', () => ({
  clasificacionDeGuardia: async () => ({
    fuentesCiegas: [], items: [], porSeveridad: { S1: 0, S2: 0, S3: 0, no_incidente: 0 }, limites: ['no ve X'],
  }),
}));
vi.mock('@/lib/admin/bitacora', () => ({
  ultimasEntradasBitacora: async () => ([{ accion: 'apagar', actor: 'u1', creadoEn: '2026-08-16' }]),
}));
vi.mock('@/lib/admin/corridas-cruzadas', () => ({
  corridasRecientes: async () => ([{ id: 'c1', agente: 'redactor', estado: 'ok' }]),
  trazaDeCorrida: async (id: string) => (id === '11111111-1111-4111-8111-111111111111'
    ? { id, agente: 'redactor', estado: 'ok', tareasHechas: 1, tareasTotal: 1 }
    : null),
}));
vi.mock('@/lib/likida/interruptores', () => ({
  listarInterruptores: async () => ([{ id: 'global', apagado: false }]),
}));
vi.mock('@/lib/likida/vendedores', () => ({
  listarProspectos: async () => ([{ id: 'p1', empresa: 'ACME', estado: 'nuevo', vendedorId: null }]),
  listarVendedores: async () => ([{ id: 'v1', nombre: 'Rodrigo' }]),
  conteosVacios: () => ({ nuevo: 0, contactado: 0, demo: 0, negociacion: 0, cerrado: 0, perdido: 0 }),
}));
vi.mock('@/lib/saas/transferencia', () => ({ getPorCobrar: async () => ([]) }));
vi.mock('@/lib/admin/ficha-cliente', () => ({
  getFichaCliente: async (id: string) => ({ id, nombre: 'FLOTA DEMO', viajes: 42 }),
}));
vi.mock('@/lib/admin/adquisicion', () => ({
  getAdquisicion: async () => ({ fuentes: [], alertas: [], totalProspectos: 829, sinFuenteDeDatos: ['ads'] }),
}));
vi.mock('@/lib/likida/agentes/runner', () => ({ gastoDelDiaUsd: async () => 0.12 }));
vi.mock('@/lib/likida/agentes/corridas', () => ({
  ultimasCorridasNegocio: async () => ([{ id: 'c1', agente: 'redactor', estado: 'ok' }]),
}));
vi.mock('@/lib/likida/agentes/definiciones', () => ({
  listarAgentes: async () => ([{ id: 'redactor', estado: 'vivo', runnerHabilitado: true, presupuestoDiaUsd: 1 }]),
}));
vi.mock('@/lib/likida/agentes/cola', () => ({
  piezasPendientes: async () => ([]),
  contarPendientes: async () => 0,
}));

const { TOOLS_COPILOTO_LECTURA, PANTALLA_POR_TOOL } = await import('./copiloto-tools');
const { executeTool } = await import('@/lib/llm/tool-executor');

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

describe('el contrato de las 14 tools del copiloto', () => {
  it('toda pantalla citada EXISTE como page.tsx — el chip jamás apunta a un 404', () => {
    const raiz = join(process.cwd(), 'src/app');
    for (const [tool, { ruta }] of Object.entries(PANTALLA_POR_TOOL)) {
      const dir = join(raiz, ruta.replace(/^\//, ''));
      const page = join(dir, 'page.tsx');
      expect(existsSync(page), `${tool} cita ${ruta} y ahí no hay page.tsx`).toBe(true);
    }
  });

  it('los mapeos corregidos el 16-ago quedaron corregidos DE VERDAD', () => {
    expect(PANTALLA_POR_TOOL.bitacora.ruta).toBe('/admin/observabilidad');
    expect(PANTALLA_POR_TOOL.cobranza_saas.ruta).toBe('/admin/costos-facturacion');
    expect(PANTALLA_POR_TOOL.traza_corrida.ruta).toBe('/admin/corridas');
  });

  it('las 14 se ejecutan sin lanzar y todas devuelven su `pantalla`', async () => {
    const conArgs: Record<string, Record<string, unknown>> = {
      traza_corrida: { id: '11111111-1111-4111-8111-111111111111' },
      ficha_cliente: { nombre: 'DEMO' },
      bitacora: {},
    };
    for (const nombre of TOOLS_COPILOTO_LECTURA) {
      const r = await executeTool(nombre, conArgs[nombre] ?? {}, { tenantId: 'likida' });
      expect(r.success, `${nombre} falló: ${String(r.error)}`).toBe(true);
      const cuerpo = r.result as { pantalla?: string; error?: string };
      expect(typeof cuerpo.pantalla, `${nombre} sin pantalla`).toBe('string');
    }
  });

  it('metrica_negocio declara el MRR $0 como verdad medida, no como hueco', async () => {
    const r = await executeTool('metrica_negocio', {}, { tenantId: 'likida' });
    const c = r.result as { mrrUsd: number; nota_mrr: string; costoIaUsd: number };
    expect(c.mrrUsd).toBe(0);
    expect(c.nota_mrr).toMatch(/[Cc]ero clientes/);
    expect(c.costoIaUsd).toBe(1.23); // redondeado a centavos, no el crudo
  });

  it('bandeja DICE sus fuentes ciegas por nombre — null ≠ 0', async () => {
    const r = await executeTool('bandeja', {}, { tenantId: 'likida' });
    const c = r.result as { fuentesCiegas: Array<{ fuente: string; error: string | null }> };
    expect(c.fuentesCiegas).toEqual([{ fuente: 'tickets', error: 'fetch failed' }]);
  });

  it('traza_corrida valida el uuid ANTES de tocar la base', async () => {
    const basura = await executeTool('traza_corrida', { id: "'; drop table viaje;--" }, { tenantId: 'likida' });
    expect(basura.success).toBe(true);
    expect((basura.result as { error?: string }).error).toMatch(/forma de corrida/);
    const noExiste = await executeTool('traza_corrida', { id: '22222222-2222-4222-8222-222222222222' }, { tenantId: 'likida' });
    expect((noExiste.result as { error?: string }).error).toMatch(/No existe/);
  });

  it('ficha_cliente sin coincidencias lo dice, no inventa una flota', async () => {
    const r = await executeTool('ficha_cliente', { nombre: 'INEXISTENTE' }, { tenantId: 'likida' });
    const c = r.result as Record<string, unknown>;
    expect(JSON.stringify(c)).not.toMatch(/FLOTA DEMO/);
  });
});
