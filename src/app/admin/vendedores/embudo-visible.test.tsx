import type { ReactElement } from 'react';
import { renderToReadableStream } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const ESTADOS_PERSISTIDOS = [
  'nuevo', 'contactado', 'appointment', 'rescheduled', 'cancelled', 'no-show',
  'demo', 'proposal', 'pilot', 'won', 'lost',
  'negociacion', 'cerrado', 'perdido',
] as const;

const prospectos = ESTADOS_PERSISTIDOS.map((estado, i) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  empresa: `Empresa ${estado}`,
  contactoNombre: null,
  telefono: null,
  correo: null,
  ciudad: null,
  vacante: null,
  fuente: 'prueba',
  estado,
  vendedorId: 'v-1',
  tenantId: null,
  notas: null,
  cerradoEn: estado === 'won' || estado === 'cerrado' ? '2026-09-03T00:00:00.000Z' : null,
  createdAt: '2026-09-03T00:00:00.000Z',
}));

vi.mock('@/lib/likida/vendedores', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/likida/vendedores')>();
  return {
    ...real,
    listarProspectos: async () => prospectos,
    listarVendedores: async () => [],
  };
});
// w15/perf: la consola de administración lee el ÍNDICE LIGERO (id, empresa, estado…) y pide `notas` solo de las tarjetas visibles; se
// ejercita la función REAL de punta a punta con la capa de lectura sustituida por estas mismas filas.
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => ({}) }) }));
vi.mock('@/lib/likida/pg', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/likida/pg')>()),
  conteo: () => ({}),
  traerTodoEnParalelo: async (_c: unknown, consulta: string) => (consulta.includes('marcas de duplicado') ? [] : prospectos.map((p) => ({
    id: p.id, empresa: p.empresa, vacante: p.vacante, ciudad: p.ciudad, estado: p.estado, fuente: p.fuente, vendedor_id: p.vendedorId,
    created_at: p.createdAt, telefono: p.telefono, contacto_nombre: p.contactoNombre,
  }))),
  traerPorIds: async (ids: string[]) => ids.map((id) => ({ id, notas: null })),
}));
vi.mock('@/lib/likida/agentes/corridas', () => ({
  ultimasCorridasNegocio: async () => [],
  duracionLegible: () => '',
}));
vi.mock('./acciones', () => ({
  accionMover: async () => ({ ok: true }),
  accionAsignar: async () => ({ ok: true }),
  accionNota: async () => ({ ok: true }),
  accionRedactar: async () => ({ ok: true }),
  accionCrearProspecto: async () => ({ ok: true }),
  accionInvitar: async () => ({ ok: true }),
  accionRepartir: async () => ({ ok: true }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

/** R9c: la consola streamea por bloque (<Suspense>); se espera a que TODOS los bloques resuelvan antes de leer el HTML. */
async function renderCompleto(el: ReactElement): Promise<string> {
  const flujo = await renderToReadableStream(el);
  await flujo.allReady;
  return new Response(flujo).text();
}

const { ConsolaVendedores } = await import('./consola-vendedores');
const { PanelVendedor } = await import('../../vendedor/panel-vendedor');

describe('FUNC-P1-01: ningún estado válido desaparece del embudo', () => {
  it.each([
    ['administrador', async () => ConsolaVendedores({ nombre: 'Admin', sp: {} })],
    ['vendedor', async () => PanelVendedor({ userId: 'v-1', nombre: 'Vendedor', rol: 'vendedor' })],
  ] as const)('%s ve los 11 estados canónicos y las filas históricas', async (_vista, construir) => {
    const html = await renderCompleto(await construir());

    for (const estado of ESTADOS_PERSISTIDOS) {
      expect(html, `${estado} debe conservar su tarjeta visible`).toContain(`Empresa ${estado}`);
    }
    for (const rotulo of [
      'Nuevo', 'Contactado', 'Cita agendada', 'Cita reprogramada',
      'Cita cancelada', 'No se presentó', 'Demo', 'Propuesta', 'Piloto',
      'Ganado', 'Perdido',
    ]) {
      expect(html, `debe existir la columna ${rotulo}`).toContain(rotulo);
    }
  });

  it('el administrador ve el embudo de ventas con las cifras de la ruta y dice cuántos quedaron fuera', async () => {
    const html = await renderCompleto(await ConsolaVendedores({ nombre: 'Admin', sp: {} }));
    expect(html).toContain('Embudo de ventas');
    expect(html).toContain('rv-embudo');
    // 14 filas: 1 por estado persistido (11 canónicos + 3 alias); en ruta (sin cancelada, no-show, perdido ni su alias) = 14 - 4.
    expect(html).toContain('10 en la ruta');
    expect(html).toContain('Fuera de la ruta hay 4');
  });
});
