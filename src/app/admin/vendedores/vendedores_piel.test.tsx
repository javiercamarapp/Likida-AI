/* eslint-disable security/detect-non-literal-fs-filename -- rutas fijas del propio módulo */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { renderToReadableStream } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { emojis } from '../guardas/medir';

vi.mock('@/lib/likida/vendedores', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/likida/vendedores')>();
  return { ...real, listarProspectos: async () => [], listarVendedores: async () => [] };
});
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => ({}) }) }));
vi.mock('@/lib/likida/pg', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/likida/pg')>()),
  conteo: () => ({}),
  traerTodoEnParalelo: async () => [],
  traerPorIds: async () => [],
}));
vi.mock('@/lib/likida/agentes/corridas', () => ({ ultimasCorridasNegocio: async () => [], duracionLegible: () => '' }));
vi.mock('./acciones', () => ({
  accionMover: async () => ({ ok: true }), accionAsignar: async () => ({ ok: true }), accionNota: async () => ({ ok: true }),
  accionRedactar: async () => ({ ok: true }), accionCrearProspecto: async () => ({ ok: true }), accionInvitar: async () => ({ ok: true }),
  accionRepartir: async () => ({ ok: true }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { ConsolaVendedores } = await import('./consola-vendedores');
async function render(el: ReactElement): Promise<string> {
  const flujo = await renderToReadableStream(el);
  await flujo.allReady;
  return new Response(flujo).text();
}
const leer = (f: string) => readFileSync(join(__dirname, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Vendedores: contrato visual del tablero compartido', () => {
  it.each(['tablero.tsx', 'formas.tsx', 'consola-vendedores.tsx', 'tablero.css'])('%s: sin emojis, glifos de icono, hex, style= ni .card', (f) => {
    const t = leer(f);
    expect(emojis(t)).toBe(0);
    expect(t).not.toMatch(/[✓✕⌂⤢⛔✉]/);
    expect(t.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    if (f.endsWith('.tsx')) {
      expect(t).not.toMatch(/style=\{/);
      expect(t).not.toMatch(/className="card/);
      expect(t).not.toMatch(/<table/);
      expect(t).not.toMatch(/BarraPagina|StatCard|StatusPill|TituloSeccion/);
    }
  });
});

describe('Vendedores: comisiones solo con base real', () => {
  it('declara que FALTA la base y no pinta ninguna cifra de comisión', async () => {
    const html = await render(ConsolaVendedores({ sp: {} }));
    expect(html).toContain('Comisiones de vendedores');
    expect(html).toContain('Falta: aún no hay base para calcularlas');
    expect(html).not.toMatch(/\$\s?0/);
    expect(html).not.toContain('cobros reales. Likida hoy no le cobra');
  });
  it('un solo h1 con el nombre de la entrada del menú', async () => {
    const html = await render(ConsolaVendedores({ sp: {} }));
    expect((html.match(/<h1/g) ?? []).length).toBe(1);
    expect(html).toMatch(/<h1[^>]*>Ventas<\/h1>/);
  });
  it('pipeline vacío: dice que no hay prospectos todavía y cómo se llena', async () => {
    const html = await render(ConsolaVendedores({ sp: {} }));
    expect(html).toContain('Sin prospectos todavía');
  });
});
