// ═══════════════════════════════════════════════════════════════════════════
// ARNÉS «admin-sa»: ve el superadmin (/admin) renderizado, sin sesión ni base.
// Monta las páginas REALES de src/app/admin dentro del AdminChrome REAL (chrome.tsx + sidebar) con
// fixtures PROPIAS (sintéticas; ningún dato ni cliente real), mockeando solo las lecturas (supabase/lib).
// Escribe un .html por pantalla en $SA_TRABAJO/vistas. Luego: admin-sa-compilar-css.mjs y admin-sa-capturar.mjs.
// Uso: scripts/ui2-captura/admin-sa-correr.sh
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, vi } from 'vitest';
import { prerender } from 'react-dom/static';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ReactNode } from 'react';

const TRABAJO = process.env.SA_TRABAJO ?? path.join(homedir(), 'likida-loop/frontend-plan/.arnes-admin-sa');
const SOLO = process.env.SA_SOLO ? process.env.SA_SOLO.split(',') : null;

// ── Estado mutable que leen los mocks ──────────────────────────────────────
const E = vi.hoisted(() => ({
  ruta: '/admin',
  idioma: 'es' as 'es' | 'en',
  datos: 'vacio' as 'vacio' | 'con',
}));

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

// Idioma: el mismo contrato que servidor.ts pero con el idioma del arnés (sin cookies ni GoTrue).
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
    datosParaProveedor: async (ns: string[]) => ({
      idioma: E.idioma,
      diccionarios: E.idioma === 'es' ? {} : await cargarDiccionarios(E.idioma, ns as never),
    }),
  };
});

// ── Fixtures ───────────────────────────────────────────────────────────────
const dia = (i: number) => `2026-10-${String(1 + i).padStart(2, '0')}`;
const FLOTAS_CON = [
  { id: 'tn-1', nombre: 'Transportes del Norte (sim.)', plan: 'pro', viajes: 412, costoIaUsd: 38.42, politicaPropia: true },
  { id: 'tn-2', nombre: 'Fletes Peninsulares (sim.)', plan: 'starter', viajes: 96, costoIaUsd: 7.1, politicaPropia: false },
  { id: '11111111-1111-1111-1111-111111111111', nombre: 'Flota Demo', plan: 'demo', viajes: 0, costoIaUsd: 0, politicaPropia: false },
];
const NEGOCIO_CON = {
  tenants: 3, flotas: FLOTAS_CON, viajesProcesados: 508, costoIaUsd: 45.52, tokensIn: 1_800_000, tokensOut: 420_000,
  porFase: [], porModelo: [],
  porDia: Array.from({ length: 30 }, (_, i) => ({ dia: dia(i % 30).replace('2026-10-', i < 30 ? '2026-10-' : '2026-11-'), costoUsd: 0.4 + ((i * 7) % 9) / 5, tokens: 1000 * i })),
  facturasPorDia: Array.from({ length: 30 }, (_, i) => ({ dia: dia(i), n: (i * 5) % 17 })),
  facturasTotal: 2315, tendenciaCosto: 12, tendenciaTokens: 8,
};
const NEGOCIO_VACIO = {
  tenants: 1, flotas: [{ id: '11111111-1111-1111-1111-111111111111', nombre: 'Flota Demo', plan: 'demo', viajes: 0, costoIaUsd: 0, politicaPropia: false }],
  viajesProcesados: 0, costoIaUsd: 0, tokensIn: 0, tokensOut: 0, porFase: [], porModelo: [],
  porDia: Array.from({ length: 30 }, (_, i) => ({ dia: dia(i), costoUsd: 0, tokens: 0 })),
  facturasPorDia: Array.from({ length: 30 }, (_, i) => ({ dia: dia(i), n: 0 })),
  facturasTotal: 0, tendenciaCosto: null, tendenciaTokens: null,
};
const con = () => E.datos === 'con';
const ITEMS_CON = [
  { severidad: 'S2', regla: 'r1', fuente: 'escalacion', titulo: 'Conciliación bancaria sin respuesta de 3 días', flota: 'Transportes del Norte (sim.)', desde: '2026-10-25T10:00:00Z', vence: '2026-10-26T10:00:00Z', href: '/admin/escalaciones' },
  { severidad: 'S3', regla: 'r2', fuente: 'escalacion', titulo: 'Operador sin comprobante de caseta', flota: 'Fletes Peninsulares (sim.)', desde: '2026-10-28T10:00:00Z', vence: null, href: '/admin/escalaciones' },
];
const AGENTES_CAL = ['liquidacion', 'peajes', 'cobranza', 'soporte_whatsapp'].map((agente, i) => ({
  agente, revision: { tasaRevisionHumana: [0.12, 0.4, null, 0.05][i] }, corridas: i === 2 ? null : { total: [210, 96, 0, 44][i], p95Ms: [8200, 1900, null, 640][i] },
}));

vi.mock('@/app/admin/resumen-lecturas', () => {
  const ok = <T,>(v: T) => async () => v;
  return {
    VENTANA_FACTURAS_DIAS: 30,
    resumenNegocio: async () => (con() ? NEGOCIO_CON : NEGOCIO_VACIO),
    conteosPlataforma: async () => ({ liquidaciones: con() ? 322 : 0 }),
    mrr: async () => (con() ? { totalMxn: 61_500 } : { totalMxn: 0 }),
    costoIaMes: async () => ({ mesUsd: con() ? 31.84 : 0, llamadas: con() ? 9120 : 0, etiquetaMes: 'noviembre' }),
    panorama: async () => ({ bandeja: { conteos: { liquidacionesRevisar: con() ? 41 : 0 } }, requiereAccion: { pendientes: 0, hayUrgente: false } }),
    slos: ok([
      { clave: 'disponibilidad', nombre: 'Disponibilidad de la app', objetivo: '99,5 %', medido: con() ? '99,8 %' : 'sin muestra', ventana: '30 d', cumple: con() ? true : null },
      { clave: 'latencia', nombre: 'Latencia de lectura', objetivo: 'p95 < 2 s', medido: con() ? '1,4 s' : 'sin muestra', ventana: '7 d', cumple: con() ? true : null },
    ]),
    parados: async () => ({ parados: con() ? [{ agente: 'cobranza', nombre: 'Cobranza', ultimaCorrida: null, horasSinCorrer: null, motivo: null, causa: null }] : [], habilitados: 4, umbralHoras: 72, latidoDelRunner: null }),
    calidadAgentes: async () => ({ ventanaDias: 30, desde: '', agentes: con() ? AGENTES_CAL : [], fuentes: {}, errores: [] }),
    quema: async () => [{ clave: 'disponibilidad', nombre: 'Disponibilidad de la app', objetivo: 0.995, presupuesto: con() ? { restantePct: 82, agotado: false } : null, razon: con() ? null : 'sin muestra', nivel: con() ? 'ninguna' : 'sin_medir' }],
    despliegues: async () => (con()
      ? { estado: 'ok', anotaciones: [{ sha: 'a1b2c3d4e5f6', shaCorto: 'a1b2c3d', entorno: 'production', rama: 'master', instante: '2026-11-14T16:00:00Z', vistas: 3, etiqueta: 'a1b2c3d · production' }], nota: 'Hora = primera vez que el servidor vio ese SHA.' }
      : { estado: 'no_medido', anotaciones: [], nota: 'Sin despliegues vistos todavía.' }),
    entradaSemaforo: async () => ({ guardia: { juicio: 'ok', haceMin: 4, baseCaidaDesde: null, appCaidaDesde: null }, bandeja: { s2: 0, fuentesCiegas: 0 }, extras: [], slos: [], frenadosPorBandeja: 0 }),
    entradaTuTurno: async () => ({ items: con() ? ITEMS_CON : [], envios: { urgentes: con() ? 2 : 0, normales: con() ? 5 : 0 }, frenados: 0 }),
  };
});

// Lecturas del layout (campana, pestañas): vacías.
vi.mock('@/app/admin/requiere-accion', async (orig) => ({
  ...(await orig<typeof import('@/app/admin/requiere-accion')>()),
  obtenerPanoramaAccion: async () => ({ bandeja: null, cola: null }),
}));

// ── Otras pantallas: lecturas mockeadas ─────────────────────────────────────
// Un supabaseAdmin falso (encadenable) para lo que las páginas piden sin pasar por una lib mockeada.
vi.mock('@/lib/supabase/admin', () => {
  const filas: Record<string, unknown[]> = {
    agente_corrida: [{ inicio: '2026-11-15T14:00:00Z', estado: 'ok' }],
  };
  const rpcs: Record<string, unknown[]> = {
    consumo_agentes: [{ agente: 'liquidacion', n: 210, fallos: 6 }, { agente: 'peajes', n: 96, fallos: 1 }, { agente: 'soporte_whatsapp', n: 44, fallos: 0 }],
  };
  const cadena = (datos: unknown[]): unknown => new Proxy({}, {
    get: (_t, k) => {
      if (k === 'then') return (res: (v: unknown) => void) => res({ data: datos, error: null, count: datos.length });
      if (k === 'single' || k === 'maybeSingle') return () => Promise.resolve({ data: datos[0] ?? null, error: null });
      return () => cadena(datos);
    },
  });
  return { supabaseAdmin: () => ({ from: (t: string) => cadena(filas[t] ?? []), rpc: (n: string) => cadena(rpcs[n] ?? []) }) };
});

// agentes
const DEPTOS = ['finanzas', 'operacion', 'exito', 'ventas'];
const AGENTES_DEF = [
  ['liquidacion', 'Liquidación de viajes', 'finanzas', 'vivo'], ['peajes', 'Conciliación de peajes', 'finanzas', 'vivo'],
  ['cobranza', 'Cobranza (dunning)', 'finanzas', 'vivo'], ['soporte_whatsapp', 'Soporte por WhatsApp', 'exito', 'vivo'],
  ['carta_porte', 'Revisor de carta porte', 'operacion', 'vivo'], ['prospeccion', 'Prospección en frío', 'ventas', 'pausado'],
  ['onboarding', 'Puesta en marcha', 'exito', 'disenado'], ['mantenimiento', 'Mantenimiento preventivo', 'operacion', 'disenado'],
].map(([id, nombre, departamento, estado], i) => ({
  id, nombre, departamento, descripcion: `Agente de ${nombre.toLowerCase()}.`, disparador: i % 2 ? 'programado' : 'evento', estado, presupuestoDiaUsd: 2 + i,
  promptRef: null, modeloRol: 'estandar', experimental: i > 5, runnerHabilitado: i < 5, creadoEn: '2026-08-01T00:00:00Z',
}));
void DEPTOS;
vi.mock('@/lib/likida/agentes/definiciones', async (orig) => ({ ...(await orig<typeof import('@/lib/likida/agentes/definiciones')>()), listarAgentes: async () => AGENTES_DEF }));
vi.mock('@/lib/likida/interruptores', async (orig) => ({ ...(await orig<typeof import('@/lib/likida/interruptores')>()), listarInterruptores: async () => [{ id: 'agente:peajes', apagado: true, motivo: 'Revisión', cambiadoPor: null, cambiadoPorNombre: 'Javier', cambiadoEn: '2026-11-10T00:00:00Z' }] }));
vi.mock('@/lib/likida/agentes/insumos', async (orig) => ({ ...(await orig<typeof import('@/lib/likida/agentes/insumos')>()), contarPendientesPorAgente: async () => new Map([['liquidacion', 3]]) }));
vi.mock('@/lib/admin/agentes-parados', async (orig) => ({ ...(await orig<typeof import('@/lib/admin/agentes-parados')>()), getAgentesParados: async () => ({ parados: [{ agente: 'cobranza', nombre: 'Cobranza (dunning)', ultimaCorrida: null, horasSinCorrer: null, motivo: 'sin_palanca', causa: null }], habilitados: 5, umbralHoras: 72, latidoDelRunner: null }) }));
vi.mock('@/lib/admin/consumo', async (orig) => ({ ...(await orig<typeof import('@/lib/admin/consumo')>()), getConsumoPorAgente: async () => ({ agentes: AGENTES_DEF.slice(0, 4).map((a, i) => ({ agente: a.id, nombre: a.nombre, estado: a.estado, runnerHabilitado: true, presupuestoDiaUsd: a.presupuestoDiaUsd, gastadoHoyUsd: 0.3 * i, gastado30dUsd: [12.4, 5.1, 0, 3.2][i], llamadas30d: 100 * i, tokens30d: 1000 * i, ultimaCorrida: null, corridas: [], hoyUsd: 0 })), insights: [] }) }));

// flotas
vi.mock('@/lib/admin/negocio', async (orig) => ({ ...(await orig<typeof import('@/lib/admin/negocio')>()), getResumenNegocio: async () => NEGOCIO_CON }));
vi.mock('@/lib/admin/onboarding', () => ({ getOnboardingFlotas: async () => new Map([
  ['tn-1', { credenciales: { total: 2, probadas: 2 }, avisosConfigurados: 3, avisoPrivacidad: { razonSocial: true, domicilio: true } }],
  ['tn-2', { credenciales: { total: 1, probadas: 0 }, avisosConfigurados: 0, avisoPrivacidad: { razonSocial: true, domicilio: false } }],
]) }));
vi.mock('@/lib/likida/contactos', () => ({ telefonosJefe: async () => ({ 'tn-1': '5512345678' }) }));
vi.mock('@/lib/saas/suscripcion', async (orig) => ({ ...(await orig<typeof import('@/lib/saas/suscripcion')>()), getPlanes: async () => [{ clave: 'pro', nombre: 'Pro' }, { clave: 'starter', nombre: 'Starter' }, { clave: 'demo', nombre: 'Demo' }] }));
vi.mock('@/lib/admin/techo_ia', async (orig) => ({ ...(await orig<typeof import('@/lib/admin/techo_ia')>()), getTechosIa: async () => ({ filas: [
  { tenantId: 'tn-1', nombre: 'Transportes del Norte (sim.)', topeUsd: 5, origen: 'plan', declaradoUsd: null, usadoHoyUsd: 1.5, pctUsado: 30 },
  { tenantId: 'tn-2', nombre: 'Fletes Peninsulares (sim.)', topeUsd: 2, origen: 'plan', declaradoUsd: null, usadoHoyUsd: 0.3, pctUsado: 15 },
], pisoUsd: 1, truncado: false, gastoIlegible: false }) }));
vi.mock('@/app/admin/flotas/acciones', () => ({ accionCrearFlota: async () => ({}), accionFacilidad: async () => ({}) }));

// cobranza
vi.mock('@/lib/saas/transferencia', async (orig) => ({ ...(await orig<typeof import('@/lib/saas/transferencia')>()), getPorCobrarTodas: async () => ({ total: 3, facturas: [
  { id: 'f1', tenantId: 'tn-1', tenantNombre: 'Transportes del Norte (sim.)', periodoInicio: '2026-10-01', periodoFin: '2026-10-31', monto: 11600, subtotal: 10000, iva: 1600, moneda: 'MXN', estado: 'pendiente', referencia: 'LK202610', cfdiUuid: null },
  { id: 'f2', tenantId: 'tn-2', tenantNombre: 'Fletes Peninsulares (sim.)', periodoInicio: '2026-09-01', periodoFin: '2026-09-30', monto: 5800, subtotal: 5000, iva: 800, moneda: 'MXN', estado: 'vencida', referencia: 'LK202609', cfdiUuid: null },
  { id: 'f3', tenantId: 'tn-1', tenantNombre: 'Transportes del Norte (sim.)', periodoInicio: '2026-09-01', periodoFin: '2026-09-30', monto: 11600, subtotal: 10000, iva: 1600, moneda: 'MXN', estado: 'pagada', referencia: 'LK202609B', cfdiUuid: 'a1b2' },
] }) }));
vi.mock('@/lib/likida/repo', async (orig) => ({ ...(await orig<typeof import('@/lib/likida/repo')>()), getPiezasDunningPlataforma: async () => [], getUltimaCorridaDunningPlataforma: async () => null }));

// trust-safety
vi.mock('@/lib/seguridad/eventos', async (orig) => ({ ...(await orig<typeof import('@/lib/seguridad/eventos')>()),
  getEventosSeguridad: async () => [
    { id: 'e1', origen: 'wa_webhook', tipo: 'firma_invalida', severidad: 'alta', tenantId: null, actor: '5215550000001', detalle: null, creadoEn: '2026-11-15T12:00:00Z', repeticiones: 3 },
    { id: 'e2', origen: 'auth', tipo: 'login_fallido', severidad: 'media', tenantId: 'tn-1', actor: 'usuario@ejemplo.mx', detalle: { intentos: 4 }, creadoEn: '2026-11-14T09:30:00Z', repeticiones: 1 },
    { id: 'e3', origen: 'export', tipo: 'exporte_dinero', severidad: 'info', tenantId: 'tn-2', actor: 'u-sa', detalle: null, creadoEn: '2026-11-13T18:00:00Z', repeticiones: 1 },
  ],
  resumenEventosSeguridad: async () => ({ total: 57, d30: { alta: 3, media: 14, info: 40 } }) }));
vi.mock('@/lib/seguridad/cobertura', async (orig) => { const o = await orig<typeof import('@/lib/seguridad/cobertura')>(); return { ...o, coberturaEventosSeguridad: async () => o.FUENTES_SEGURIDAD.map((f, i) => ({ ...f, filas30d: f.emite ? (i * 7) % 11 : 0 })) }; });

// crons
vi.mock('@/lib/admin/salud', async (orig) => {
  const o = await orig<typeof import('@/lib/admin/salud')>();
  return { ...o, detalleLatidos: async () => Object.fromEntries(o.CRONS.map((c, i) => [c, {
    estado: i === 3 ? 'vencido' : 'ok', haceMin: i === 3 ? 95 : 1 + i * 3, ultimoEstado: i === 5 ? 'fallo' : 'ok',
    ultimoLatido: '2026-11-16T05:00:00.000Z', cadenciaMs: i === 3 ? 3_600_000 : 60_000 * (i + 1), detalle: {}, motivoSalto: null,
  }])) };
});

// dev
vi.mock('@/lib/admin/github', () => ({
  getActividadGitHub: async () => ({ estado: 'sin_token' }), getMapaCommits: async () => ({ estado: 'sin_token' }), getAutoresCommits: async () => ({ estado: 'sin_token' }),
}));
vi.mock('@/lib/admin/slo', async (orig) => ({ ...(await orig<typeof import('@/lib/admin/slo')>()), getSLOs: async () => [
  { clave: 'disponibilidad', nombre: 'Disponibilidad de la app', objetivo: '99,5 %', medido: '99,8 %', ventana: '30 d', cumple: true },
] }));

// mapa-prospectos
vi.mock('@/lib/admin/prospectos-mapa', () => ({ getResumenProspectos: async () => ({
  generadoEn: '2026-11-16T05:00:00Z', total: 33_148, porEtapa: { nuevo: 31_900, contactado: 900, interesado: 210, demo: 90, cliente: 48 },
  conTelefono: 24_300, conDecisor: 5_100, sinPlaza: 412,
  porEntidad: { 'Nuevo León': { n: 4_200, conTelefono: 3_100, conDecisor: 800, porEtapa: { nuevo: 4_000, contactado: 200 } }, 'Ciudad de México': { n: 6_100, conTelefono: 4_500, conDecisor: 900, porEtapa: { nuevo: 5_900, contactado: 200 } } },
}) }));

// ── Pantallas ──────────────────────────────────────────────────────────────
const { default: AdminChrome } = await import('@/app/admin/chrome');
const { ProveedorRequiereAccion } = await import('@/app/admin/cabecera-admin');
const { ProveedorConteosPestanas } = await import('@/app/admin/conteos-pestanas-contexto');
const { IdiomaProvider } = await import('@/lib/i18n/proveedor');
const { cargarDiccionarios } = await import('@/lib/i18n/catalogo');
const { ConsolaAdmin } = await import('@/app/admin/consola');
const { default: PaginaAgentes } = await import('@/app/admin/agentes/page');
const { default: PaginaFlotas } = await import('@/app/admin/flotas/page');
const { default: PaginaCobranza } = await import('@/app/admin/cobranza/page');
const { default: PaginaTrust } = await import('@/app/admin/trust-safety/page');
const { default: PaginaCrons } = await import('@/app/admin/crons/page');
const { default: PaginaDev } = await import('@/app/admin/dev/page');
const { default: PaginaCerebro } = await import('@/app/admin/mapa-prospectos/page');

interface Pantalla { id: string; ruta: string; idioma?: 'es' | 'en'; datos?: 'vacio' | 'con'; cuerpo: () => Promise<ReactNode> | ReactNode }
const PANTALLAS: Pantalla[] = [
  { id: '01-resumen-vacio', ruta: '/admin', datos: 'vacio', cuerpo: () => <ConsolaAdmin nombre="Javier" /> },
  { id: '01b-resumen-con-datos', ruta: '/admin', datos: 'con', cuerpo: () => <ConsolaAdmin nombre="Javier" /> },
  { id: '02-cerebro-de-ventas', ruta: '/admin/mapa-prospectos', datos: 'con', cuerpo: () => PaginaCerebro() },
  { id: '03-agentes', ruta: '/admin/agentes', datos: 'con', cuerpo: () => PaginaAgentes({ searchParams: Promise.resolve({}) } as never) },
  { id: '04-flotas', ruta: '/admin/flotas', datos: 'con', cuerpo: () => PaginaFlotas({ searchParams: Promise.resolve({}) } as never) },
  { id: '05-cobranza', ruta: '/admin/cobranza', datos: 'con', cuerpo: () => PaginaCobranza({} as never) },
  { id: '06-trust-safety', ruta: '/admin/trust-safety', datos: 'con', cuerpo: () => PaginaTrust({ searchParams: Promise.resolve({}) } as never) },
  { id: '07-crons', ruta: '/admin/crons', datos: 'con', cuerpo: () => PaginaCrons() },
  { id: '08-dev', ruta: '/admin/dev', datos: 'con', cuerpo: () => PaginaDev() },
  { id: '01c-resumen-en', ruta: '/admin', datos: 'con', idioma: 'en', cuerpo: () => <ConsolaAdmin nombre="Javier" /> },
];

const FLOTAS_SEL = [{ id: 'tn-1', nombre: 'Transportes del Norte (sim.)' }, { id: 'tn-2', nombre: 'Fletes Peninsulares (sim.)' }];

const ERRORES_PREVIOS: string[] = [];
async function aHtml(el: ReactNode): Promise<string> {
  const errores: string[] = [];
  const { prelude } = await prerender(el as never, { onError: (e: unknown) => { errores.push(String((e as Error)?.stack ?? e).split('\n').slice(0, 4).join(' | ')); } });
  if (errores.length) { ERRORES_PREVIOS.push(...errores); }
  const r = prelude.getReader(); const dec = new TextDecoder(); let s = '';
  for (;;) { const { done, value } = await r.read(); if (done) break; s += dec.decode(value, { stream: true }); }
  return s;
}

describe('arnés admin-sa', () => {
  it('renderiza las pantallas de /admin con el marco real', async () => {
    mkdirSync(path.join(TRABAJO, 'vistas'), { recursive: true });
    for (const p of PANTALLAS) {
      if (SOLO && !SOLO.some((s) => p.id.startsWith(s))) continue;
      E.ruta = p.ruta; E.idioma = p.idioma ?? 'es'; E.datos = p.datos ?? 'vacio';
      const dic = E.idioma === 'es' ? {} : await cargarDiccionarios(E.idioma, ['shell', 'avisos', 'admin_inicio', 'admin_agentes', 'admin_sistema'] as never);
      try {
        const html = await aHtml(
          <IdiomaProvider idioma={E.idioma} diccionarios={dic as never}>
            <ProveedorRequiereAccion valor={{ pendientes: 0, hayUrgente: false }}>
              <ProveedorConteosPestanas valor={{} as never}>
                <AdminChrome nombre="Javier" avatarUrl={null} flotas={FLOTAS_SEL} flotaActual={null}>{await p.cuerpo()}</AdminChrome>
              </ProveedorConteosPestanas>
            </ProveedorRequiereAccion>
          </IdiomaProvider>,
        );
        writeFileSync(path.join(TRABAJO, 'vistas', `${p.id}.html`), html);
        if (ERRORES_PREVIOS.length) { writeFileSync(path.join(TRABAJO, 'vistas', `${p.id}.errores-render.txt`), [...new Set(ERRORES_PREVIOS)].join('\n\n')); ERRORES_PREVIOS.length = 0; }
        console.log('OK', p.id, (html.length / 1024).toFixed(0), 'KB');
      } catch (e) {
        console.log('FALLO', p.id, String(e).slice(0, 400));
        writeFileSync(path.join(TRABAJO, 'vistas', `${p.id}.error.txt`), String((e as Error).stack ?? e));
      }
    }
  }, 600_000);
});
