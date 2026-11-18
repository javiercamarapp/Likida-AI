// ═══════════════════════════════════════════════════════════════════════════
// ARNÉS «admin-sa-resto»: el resto de páginas estáticas de /admin (todas menos [id], los stubs 308 y el back-office, que vive en
// admin-sa-bo.harness.tsx). Mismo marco real (AdminChrome) y mismas reglas: HTML estático, sin sesión ni base.
// Base simulada: un supabaseAdmin encadenable que devuelve filas SINTÉTICAS por tabla (FILAS) o vacío. Lo que una pantalla lee por una
// lib propia y no se pudo montar con esto queda documentado en el informe (.error.txt junto al html).
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, vi } from 'vitest';
import { prerender } from 'react-dom/static';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ReactNode } from 'react';

const TRABAJO = process.env.SA_TRABAJO ?? path.join(homedir(), 'likida-loop/frontend-plan/.arnes-admin-sa');
const SOLO = process.env.SA_SOLO ? process.env.SA_SOLO.split(',') : null;
const E = vi.hoisted(() => ({ ruta: '/admin', idioma: 'es' as 'es' | 'en' }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => E.ruta,
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} }),
  redirect: (r: string) => { throw new Error(`REDIRECT:${r}`); },
  notFound: () => { throw new Error('NOTFOUND'); },
}));
vi.mock('next/cache', () => ({ revalidatePath() {}, revalidateTag() {}, unstable_cache: (f: unknown) => f }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }), headers: async () => new Headers() }));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: async () => ({ userId: 'u-sa', rol: 'superadmin', nombre: 'Javier', avatarUrl: null }) }));
vi.mock('@/lib/logger', () => ({ logger: { info() {}, warn() {}, error() {}, debug() {} } }));
vi.mock('@/lib/i18n/servidor', async () => {
  const { cargarDiccionarios } = await import('@/lib/i18n/catalogo');
  const { crearTraductor } = await import('@/lib/i18n/traducir');
  return {
    idiomaActual: async () => E.idioma,
    getT: async (ns: string) => {
      const dic = (await cargarDiccionarios(E.idioma, [ns as never]))[ns as never];
      const base = E.idioma === 'es' ? dic : (await cargarDiccionarios('es', [ns as never]))[ns as never];
      return crearTraductor(E.idioma, dic as never, base as never);
    },
    datosParaProveedor: async (ns: string[]) => ({ idioma: E.idioma, diccionarios: E.idioma === 'es' ? {} : await cargarDiccionarios(E.idioma, ns as never) }),
  };
});
vi.mock('@/app/admin/requiere-accion', async (orig) => ({
  ...(await orig<typeof import('@/app/admin/requiere-accion')>()),
  obtenerPanoramaAccion: async () => ({ resumen: { pendientes: 0, hayUrgente: false, motivo: null, desconocido: false }, bandeja: null, cola: null, extras: [] }),
}));

// ── Base simulada ──────────────────────────────────────────────────────────
const FILAS = vi.hoisted(() => {
  const T = '11111111-1111-1111-1111-111111111111';
  const F: Record<string, unknown[]> = {
    tenant: [
      { id: 'tn-1', nombre: 'Transportes del Norte (sim.)', plan: 'pro', activo: true, creado_en: '2026-08-01T00:00:00Z', estado: 'activo' },
      { id: 'tn-2', nombre: 'Fletes Peninsulares (sim.)', plan: 'starter', activo: true, creado_en: '2026-09-01T00:00:00Z', estado: 'activo' },
    ],
    agente_corrida: [{ id: 'c1', agente: 'liquidacion', inicio: '2026-11-15T14:00:00Z', fin: '2026-11-15T14:00:08Z', estado: 'ok', tenant_id: 'tn-1' }],
  };
  void T;
  return F;
});
const COSTO_IA = vi.hoisted(() => ({
  totales: { n: 9120, costoUsd: 45.52, tokensIn: 1_800_000, tokensOut: 420_000 },
  porFase: [{ fase: 'extraccion', n: 5000, costoUsd: 22.1 }, { fase: 'validacion', n: 4120, costoUsd: 23.42 }],
  porModelo: [{ modelo: 'modelo-a (sim.)', n: 6000, costoUsd: 30.2 }, { modelo: 'modelo-b (sim.)', n: 3120, costoUsd: 15.32 }],
  porFaseModelo: [{ fase: 'extraccion', modelo: 'modelo-a (sim.)', n: 5000, costoUsd: 22.1 }],
  porDia: Array.from({ length: 30 }, (_, i) => ({ dia: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`, costoUsd: 0.4 + ((i * 7) % 9) / 5, tokens: 1000 * i })),
  porTenant: [{ tenantId: 'tn-1', costoUsd: 38.42 }, { tenantId: 'tn-2', costoUsd: 7.1 }],
}));
vi.mock('@/lib/supabase/admin', () => {
  const cadena = (datos: unknown[]): unknown => new Proxy({}, {
    get: (_t, k) => {
      if (k === 'then') return (res: (v: unknown) => void) => res({ data: datos, error: null, count: datos.length });
      if (k === 'single' || k === 'maybeSingle') return () => Promise.resolve({ data: datos[0] ?? null, error: null });
      return () => cadena(datos);
    },
  });
  return { supabaseAdmin: () => ({ from: (t: string) => cadena(FILAS[t] ?? []), rpc: (n: string) => (n === 'resumen_costo_ia' ? Promise.resolve({ data: COSTO_IA, error: null }) : cadena([])) }) };
});
vi.mock('@/lib/supabase/server', () => {
  const cadena = (datos: unknown[]): unknown => new Proxy({}, {
    get: (_t, k) => {
      if (k === 'then') return (res: (v: unknown) => void) => res({ data: datos, error: null, count: datos.length });
      if (k === 'single' || k === 'maybeSingle') return () => Promise.resolve({ data: datos[0] ?? null, error: null });
      return () => cadena(datos);
    },
  });
  return { supabaseServer: async () => ({ from: () => cadena([]), rpc: () => cadena([]), auth: { getUser: async () => ({ data: { user: null } }) } }) };
});


// Resumen de negocio (lo leen varias pantallas de agentes/capacidad): fixture propia.
const dia = (i: number) => `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`;
const NEGOCIO_CON = {
  tenants: 3, flotas: [
    { id: 'tn-1', nombre: 'Transportes del Norte (sim.)', plan: 'pro', viajes: 412, costoIaUsd: 38.42, politicaPropia: true },
    { id: 'tn-2', nombre: 'Fletes Peninsulares (sim.)', plan: 'starter', viajes: 96, costoIaUsd: 7.1, politicaPropia: false },
  ], viajesProcesados: 508, costoIaUsd: 45.52, tokensIn: 1_800_000, tokensOut: 420_000,
  porFase: [], porModelo: [],
  porDia: Array.from({ length: 30 }, (_, i) => ({ dia: dia(i), costoUsd: 0.4 + ((i * 7) % 9) / 5, tokens: 1000 * i })),
  facturasPorDia: Array.from({ length: 30 }, (_, i) => ({ dia: dia(i), n: (i * 5) % 17 })),
  facturasTotal: 2315, tendenciaCosto: 12, tendenciaTokens: 8,
};
vi.mock('@/lib/admin/negocio', async (orig) => ({ ...(await orig<typeof import('@/lib/admin/negocio')>()), getResumenNegocio: async () => NEGOCIO_CON }));

const { default: AdminChrome } = await import('@/app/admin/chrome');
const { ProveedorRequiereAccion } = await import('@/app/admin/cabecera-admin');
const { ProveedorConteosPestanas } = await import('@/app/admin/conteos-pestanas-contexto');
const { IdiomaProvider } = await import('@/lib/i18n/proveedor');

// Cada entrada: id de captura (NN-ruta), módulo de la página (ruta bajo src/app/admin) y propiedades.
const RUTAS = [
  'actividad-codigo', 'agente-cuadre', 'agente-ocr', 'agente-whatsapp', 'aprobaciones', 'bitacora', 'calidad-evals', 'capacidad-forecast',
  'compliance', 'consumo', 'conversaciones', 'copiloto', 'corridas', 'costos-facturacion', 'crecimiento', 'elegir-flota', 'equipo', 'escalaciones',
  'evals', 'facturas', 'integraciones', 'marketing', 'mcp-clientes', 'mi-perfil', 'model-ops', 'notificaciones', 'observabilidad', 'qa',
  'salud-sistema', 'soporte', 'techo-ia', 'tu-turno', 'vendedores', 'whatsapp-infra',
];
const cargadores = import.meta.glob('/src/app/admin/*/page.tsx');

const FLOTAS_SEL = [{ id: 'tn-1', nombre: 'Transportes del Norte (sim.)' }, { id: 'tn-2', nombre: 'Fletes Peninsulares (sim.)' }];
const ERRORES_PREVIOS: string[] = [];
async function aHtml(el: ReactNode): Promise<string> {
  const errores: string[] = [];
  const { prelude } = await prerender(el as never, { onError: (e: unknown) => { errores.push(String((e as Error)?.stack ?? e).split('\n').slice(0, 4).join(' | ')); } });
  if (errores.length) ERRORES_PREVIOS.push(...errores);
  const r = prelude.getReader(); const dec = new TextDecoder(); let s = '';
  for (;;) { const { done, value } = await r.read(); if (done) break; s += dec.decode(value, { stream: true }); }
  return s;
}

describe('arnés admin-sa-resto', () => {
  it('renderiza el resto de pantallas de /admin con el marco real', async () => {
    mkdirSync(path.join(TRABAJO, 'vistas'), { recursive: true });
    for (const [i, ruta] of RUTAS.entries()) {
      const id = `${String(20 + i)}-${ruta}`;
      if (SOLO && !SOLO.some((s) => id.startsWith(s))) continue;
      E.ruta = `/admin/${ruta}`; E.idioma = 'es';
      try {
        const modulo = (await cargadores[`/src/app/admin/${ruta}/page.tsx`]()) as { default: (p: unknown) => Promise<ReactNode> };
        const cuerpo = await modulo.default({ searchParams: Promise.resolve({}), params: Promise.resolve({}) });
        const html = await aHtml(
          <IdiomaProvider idioma="es" diccionarios={{} as never}>
            <ProveedorRequiereAccion valor={{ pendientes: 0, hayUrgente: false }}>
              <ProveedorConteosPestanas valor={{} as never}>
                <AdminChrome nombre="Javier" avatarUrl={null} flotas={FLOTAS_SEL} flotaActual={null}>{cuerpo}</AdminChrome>
              </ProveedorConteosPestanas>
            </ProveedorRequiereAccion>
          </IdiomaProvider>,
        );
        writeFileSync(path.join(TRABAJO, 'vistas', `${id}.html`), html);
        if (ERRORES_PREVIOS.length) { writeFileSync(path.join(TRABAJO, 'vistas', `${id}.errores-render.txt`), [...new Set(ERRORES_PREVIOS)].join('\n\n')); ERRORES_PREVIOS.length = 0; }
        console.log('OK', id, (html.length / 1024).toFixed(0), 'KB');
      } catch (e) {
        console.log('FALLO', id, String(e).slice(0, 300).replace(/\n/g, ' '));
        writeFileSync(path.join(TRABAJO, 'vistas', `${id}.error.txt`), String((e as Error).stack ?? e));
      }
    }
  }, 900_000);
});
