// ═══════════════════════════════════════════════════════════════════════════
// ARNÉS «admin-sa-bo»: las 8 pantallas del Back-office (/admin/back-office/*) dentro del marco real de /admin, sin sesión ni base.
// Cada pantalla en variante «con datos» (fixtures SINTÉTICAS) y «ausente» (lectura no_disponible: «No disponible. No es cero.»);
// tablero y cierre también en inglés. Mismos mocks que las page.test.tsx de cada pantalla (lecturas), sin tocar las páginas.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, vi } from 'vitest';
import { prerender } from 'react-dom/static';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ReactNode } from 'react';

const TRABAJO = process.env.SA_TRABAJO ?? path.join(homedir(), 'likida-loop/frontend-plan/.arnes-admin-sa');
const SOLO = process.env.SA_SOLO ? process.env.SA_SOLO.split(',') : null;
const E = vi.hoisted(() => ({ ruta: '/admin/back-office', idioma: 'es' as 'es' | 'en', modo: 'con' as 'con' | 'ausente', tablas: {} as Record<string, unknown[]> }));
// ── Lo mismo que el arnés base ─────────────────────────────────────────────
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(), usePathname: () => E.ruta,
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} }),
  redirect: (r: string) => { throw new Error(`REDIRECT:${r}`); }, notFound: () => { throw new Error('NOTFOUND'); },
}));
vi.mock('next/cache', () => ({ revalidatePath() {}, revalidateTag() {}, unstable_cache: (f: unknown) => f }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }), headers: async () => new Headers() }));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: async () => ({ userId: 'u-sa', rol: 'superadmin', nombre: 'Javier', avatarUrl: null }) }));
vi.mock('@/lib/logger', () => ({ logger: { info() {}, warn() {}, error() {}, debug() {} } }));
vi.mock('@/lib/admin/acciones_riesgo', () => ({ pasoExtraSuperadmin: async () => null, anotarAccionAdmin: async () => null, AVISO_SIN_BITACORA: ' (sin bitácora)' }));
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
vi.mock('@/lib/formato', async (importar) => ({ ...(await importar<typeof import('@/lib/formato')>()), hoyMx: () => '2026-11-16' }));
vi.mock('./acciones', () => ({}));

// Base: tablas `bo_*`. «ausente» => 42P01 en todas; «con» => filas de E.tablas (o vacío).
vi.mock('@/lib/supabase/admin', () => {
  const cadena = (tabla: string): unknown => new Proxy(() => undefined, {
    get: (_t, prop) => {
      if (prop === 'then') {
        return (res: (v: unknown) => unknown) => {
          if (E.modo === 'ausente') return res({ data: null, error: { code: '42P01', message: `relation "${tabla}" does not exist` } });
          const f = E.tablas[tabla] ?? [];
          return res({ data: f, error: null, count: f.length });
        };
      }
      if (prop === 'maybeSingle' || prop === 'single') return () => Promise.resolve(E.modo === 'ausente' ? { data: null, error: { code: '42P01', message: 'x' } } : { data: (E.tablas[tabla] ?? [])[0] ?? null, error: null });
      return () => cadena(tabla);
    },
    apply: () => cadena(tabla),
  });
  return { supabaseAdmin: () => ({ from: (t: string) => cadena(t), rpc: () => cadena('rpc') }) };
});
vi.mock('@/lib/saas/transferencia', () => ({ listarFacturasSaas: vi.fn(), TECHO_FACTURAS_SAAS: 2000 }));
vi.mock('@/lib/admin/negocio', () => ({ costoIaVentana: vi.fn() }));

// ── Fixtures y mocks de lecturas por pantalla ──────────────────────────────
const { NO_DISPONIBLE, OK } = await import('@/lib/backoffice/lectura');
const { armarTablero } = await import('@/lib/backoffice/tablero');
const { armarCierre, comprobaciones } = await import('@/lib/backoffice/cierre');
const { CUENTAS_PROPUESTAS } = await import('@/lib/backoffice/cuentas');
const { candadoDeEntidad } = await import('@/lib/backoffice/fiscal');
const { armarLibro, cobro, gastoNube } = await import('@/lib/backoffice/libro_fixtures');
const { comprobacionesLibro, delPeriodo } = await import('@/lib/backoffice/libro');
const { armarPaquete } = await import('@/lib/backoffice/paquete-contable');
type FacturaInsumo = import('@/lib/backoffice/cierre').FacturaInsumo;

const con = () => E.modo === 'con';
const P = '2026-10-01'; // mes terminado (cierre) ; el tablero usa el mes en curso 2026-11
const PN = '2026-11-01';
const fac = (id: string, nombre: string, total: number, o: Partial<FacturaInsumo> = {}): FacturaInsumo => ({
  id, tenantId: id, tenantNombre: nombre, estado: 'pagada', periodoInicio: PN, totalCent: total, subtotalCent: Math.round(total / 1.16), ivaCent: total - Math.round(total / 1.16),
  creadaEn: '2026-11-01T12:00:00Z', pagadaEn: '2026-11-10T16:00:00Z', conciliadaEn: '2026-11-10T16:00:00Z', referenciaBanco: 'SPEI 1', ...o,
});
const ENTIDAD_CON = { razonSocial: 'Likida SAPI de CV (sim.)', rfc: null as string | null, regimenFiscal: null, domicilioFiscalCp: '97000', constituidaEl: '2026-10-01', actualizadaPor: 'u1', actualizadaEn: '2026-11-02T18:00:00Z' };
const gasto = (id: string, prov: string, total: number, o: Record<string, unknown> = {}) => ({
  id, proveedorId: id, proveedor: prov, fecha: '2026-11-03', periodo: PN, concepto: 'Plan mensual', moneda: 'MXN' as const, totalCent: total, subtotalCent: null, ivaAcreditableCent: null,
  cfdiUuid: null, comprobante: 'sin_comprobante' as const, cuentaContable: null, conciliado: false, ...o,
});

function datosTablero() {
  if (!con()) {
    return { periodo: PN, hoy: '2026-11-16', entidad: NO_DISPONIBLE, facturas: NO_DISPONIBLE, gastos: NO_DISPONIBLE, comisiones: NO_DISPONIBLE, contratos: NO_DISPONIBLE, obligaciones: NO_DISPONIBLE, cierres: NO_DISPONIBLE };
  }
  const meses = ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', PN];
  const filas = [
    ...meses.flatMap((m, i) => [fac(`a${i}`, 'Transportes del Norte (sim.)', 580000 + i * 40000, { periodoInicio: m, pagadaEn: `${m.slice(0, 8)}10T16:00:00Z`, conciliadaEn: `${m.slice(0, 8)}10T16:00:00Z` })]),
    fac('b1', 'Fletes Peninsulares (sim.)', 290000, { periodoInicio: PN }),
    fac('p1', 'Logística del Bajío (sim.)', 290000, { estado: 'pendiente', pagadaEn: null, conciliadaEn: null, referenciaBanco: null, creadaEn: '2026-11-01T12:00:00Z' }),
    fac('f1', 'Rutas del Golfo (sim.)', 116000, { estado: 'fallida', pagadaEn: null, conciliadaEn: null, referenciaBanco: null }),
  ];
  return {
    periodo: PN, hoy: '2026-11-16', entidad: OK({ ...ENTIDAD_CON, rfc: null }),
    facturas: OK({ filas, truncada: false }),
    gastos: OK([gasto('g1', 'Vercel (sim.)', 41000, { conciliado: true }), gasto('g2', 'Supabase (sim.)', 52500), gasto('g3', 'Dominio (sim.)', 28000, { conciliado: true })]),
    comisiones: OK({ periodo: PN, devengadoCent: 145000, clawbackCent: -20000, pagadoCent: 90000 }),
    contratos: OK([{ vence_el: '2026-11-25', estado: 'vigente' }, { vence_el: '2026-10-30', estado: 'vigente' }, { vence_el: null, estado: 'vigente' }, { vence_el: '2027-03-01', estado: 'vigente' }]),
    obligaciones: OK([{ clave: 'iva_mensual', estado_catalogo: 'pendiente_de_contador' }, { clave: 'isr_provisional', estado_catalogo: 'pendiente_de_contador' }, { clave: 'diot', estado_catalogo: 'vigente' }]),
    cierres: OK([{ periodo: P, estado: 'abierto', netoCent: 100000, tipoCambio: 17, snapshot: null, cerradoPor: null, cerradoEn: null, actualizadoEn: '2026-11-02T12:00:00Z' }]),
  };
}
vi.mock('@/lib/backoffice/tablero', async (importar) => {
  const o = await importar<typeof import('@/lib/backoffice/tablero')>();
  return { ...o, leerTablero: async () => o.armarTablero(datosTablero() as never) };
});
void armarTablero;

// Cierre
const facCierre = (id: string, nombre: string, total: number) => fac(id, nombre, total, { periodoInicio: P, pagadaEn: '2026-10-12T16:00:00Z', conciliadaEn: '2026-10-12T16:00:00Z' });
function vistaCierre() {
  const insumos = {
    periodo: P, facturas: OK([facCierre('t1', 'Transportes del Norte (sim.)', 696000), facCierre('t2', 'Fletes Peninsulares (sim.)', 290000)]), facturasTruncadas: false,
    cobradoSql: OK(986000), costoIa: OK({ totalUsd: 45.5, porTenantUsd: [{ tenantId: 't1', usd: 38.4 }, { tenantId: 't2', usd: 7.1 }] }), tipoCambio: 17,
    gastos: OK([gasto('g1', 'Vercel (sim.)', 41000, { periodo: P }), gasto('g2', 'Supabase (sim.)', 52500, { periodo: P })]),
    comisiones: OK({ periodo: P, devengadoCent: 145000, clawbackCent: 0, pagadoCent: 0 }), movimientos: NO_DISPONIBLE,
  };
  const cierre = armarCierre(insumos as never, P);
  const guardado = { periodo: P, estado: 'abierto', netoCent: 100000, tipoCambio: 17, snapshot: null, cerradoPor: null, cerradoEn: null, actualizadoEn: '2026-11-02T12:00:00Z' };
  return { periodo: P, guardado: con() ? OK(guardado) : NO_DISPONIBLE, origen: 'en_vivo', cierre, comprobaciones: comprobaciones(cierre, insumos as never, { netoCent: 100000 }) };
}
vi.mock('@/lib/backoffice/cierre', async (importar) => ({
  ...(await importar<typeof import('@/lib/backoffice/cierre')>()), leerVistaCierre: async () => vistaCierre(), cobradoDelMesAnterior: async () => 880000,
}));
vi.mock('@/lib/backoffice/entidad', async (importar) => ({
  ...(await importar<typeof import('@/lib/backoffice/entidad')>()), leerEntidad: async () => (con() ? OK(ENTIDAD_CON) : NO_DISPONIBLE),
}));
vi.mock('@/lib/backoffice/reporte', async (importar) => ({
  ...(await importar<typeof import('@/lib/backoffice/reporte')>()), leerUpdateInversionistas: async () => OK(null),
}));

// Contabilidad
const CUENTAS = CUENTAS_PROPUESTAS.map((c) => ({ ...c }));
function paqueteContable() {
  const entidad = OK({ rfc: null, razonSocial: null, constituidaEl: '2026-10-01' });
  const candado = candadoDeEntidad(entidad as never);
  if (!con()) return { entidad, candado, cuentas: NO_DISPONIBLE, libro: NO_DISPONIBLE, comprobaciones: null, delMes: null, gastos: NO_DISPONIBLE, cierre: NO_DISPONIBLE, paquete: null };
  const asientos = armarLibro([
    { fecha: '2026-11-03', lineas: cobro(580000), soporte: 'cfdi', descripcion: 'Mensualidad Transportes del Norte (sim.)' },
    { fecha: '2026-11-05', lineas: cobro(290000), soporte: 'cfdi', descripcion: 'Mensualidad Fletes Peninsulares (sim.)' },
    { fecha: '2026-11-09', lineas: gastoNube(41000), soporte: 'ninguno', descripcion: 'Gasto de nube sin factura' },
    { fecha: '2026-11-11', lineas: gastoNube(52500), soporte: 'cfdi', descripcion: 'Base de datos' },
  ]);
  const delMes = delPeriodo(asientos, PN);
  const comp = comprobacionesLibro(asientos, CUENTAS);
  const paquete = armarPaquete({ periodo: PN, candado, asientos: delMes, cuentas: CUENTAS, comprobaciones: comp, gastos: null, rfcPorProveedor: {}, cierre: null, ivaTrasladadoCent: null } as never);
  return { entidad, candado, cuentas: OK(CUENTAS), libro: OK({ asientos, truncado: false }), comprobaciones: comp, delMes, gastos: NO_DISPONIBLE, cierre: NO_DISPONIBLE, paquete };
}
const OBLIGACIONES = [
  { clave: 'iva_mensual', nombre: 'IVA: declaración mensual', periodicidad: 'mensual', diaLimite: 17, mesLimite: null, mesesDesfase: 1, requiereEntidad: true, estadoCatalogo: 'pendiente_de_contador', nota: null },
  { clave: 'conservacion_5_anios', nombre: 'Conservación de la contabilidad', periodicidad: 'evento', diaLimite: null, mesLimite: null, mesesDesfase: 0, requiereEntidad: false, estadoCatalogo: 'pendiente_de_contador', nota: null },
];
vi.mock('@/lib/backoffice/contabilidad', () => {
  class ErrorLibro extends Error { constructor(public readonly codigo: string, public readonly detalle: string) { super(detalle); } }
  const otro = async () => { throw new Error('no usado'); };
  return {
    ErrorLibro, leerPaqueteDelMes: async () => paqueteContable(), leerObligaciones: async () => (con() ? OK(OBLIGACIONES) : NO_DISPONIBLE), leerCumplimientos: async () => OK([]),
    leerEntidad: otro, leerCuentas: otro, marcarPresentada: otro, marcarPaqueteListo: otro, registrarAsiento: otro, reversarAsiento: otro,
  };
});

// Contratos y contratistas
const contrato = (p: Record<string, unknown>) => ({
  id: 'c', tipo: 'suscripcion', contraparte: 'Vercel (sim.)', tenantId: null, descripcion: null, firmadoEl: '2026-01-10', venceEl: '2026-11-25', renovacionAuto: false, diasAviso: [30],
  responsable: 'Javier', costoMensualCent: 200000, documentoUrl: null, estado: 'vigente', motivoTerminacion: null, creadoEn: '2026-01-10', ...p,
});
const CONTRATOS = [
  contrato({ id: 'c1' }), contrato({ id: 'c2', tipo: 'proveedor', contraparte: 'Supabase (sim.)', venceEl: '2027-03-01', renovacionAuto: true, costoMensualCent: 52500 }),
  contrato({ id: 'c3', tipo: 'cliente', contraparte: 'Transportes del Norte (sim.)', venceEl: '2026-10-30', estado: 'vencido', costoMensualCent: null }),
  contrato({ id: 'c4', tipo: 'dominio', contraparte: 'Dominio likida (sim.)', venceEl: null, costoMensualCent: 28000 }),
  contrato({ id: 'c5', tipo: 'legal_pendiente', contraparte: 'Aviso de privacidad (sim.)', venceEl: null, estado: 'borrador', costoMensualCent: null }),
];
vi.mock('@/lib/backoffice/contratos', async (importar) => ({
  ...(await importar<typeof import('@/lib/backoffice/contratos')>()),
  listarContratos: async () => (con() ? OK(CONTRATOS) : NO_DISPONIBLE), leerRfcEntidad: async () => OK(null),
}));
const persona = (p: Record<string, unknown>) => ({ id: 'p', nombre: 'Ana (sim.)', rol: 'Ventas', esquema: 'comision', rfc: null, cfdiHonorariosVigente: null, constanciaSituacionFiscalEn: null, contratoId: null, vendedorId: null, activo: true, nota: null, ...p });
vi.mock('@/lib/backoffice/contratistas', async (importar) => ({
  ...(await importar<typeof import('@/lib/backoffice/contratistas')>()),
  listarContratistas: async () => (con() ? OK([
    persona({ id: 'p1' }), persona({ id: 'p2', nombre: 'Luis (sim.)', rol: 'Diseño', esquema: 'honorarios', rfc: 'XAXX010101000', cfdiHonorariosVigente: true, constanciaSituacionFiscalEn: '2026-06-01' }),
    persona({ id: 'p3', nombre: 'Marta (sim.)', rol: 'Soporte', esquema: 'honorarios', rfc: 'XAXX010101000', cfdiHonorariosVigente: false }), persona({ id: 'p4', nombre: 'Equipo nómina (sim.)', rol: null, esquema: 'proveedor_nomina' }),
  ]) : NO_DISPONIBLE),
}));

// Tablas para gastos y comisiones (supabase)
const TABLAS_CON: Record<string, unknown[]> = {
  bo_gasto: [
    { id: 'g1', proveedor_id: 'p1', fecha: '2026-11-03', periodo: PN, concepto: 'Plan Pro', moneda: 'USD', monto_original: '20.00', tipo_cambio: '20.5000', subtotal_mxn: null, iva_acreditable_mxn: null, total_mxn: '410.00', cfdi_uuid: null, comprobante_estado: 'sin_comprobante', deducible_en_forma: 'no_evaluable', cuenta_contable: null, conciliado_en: null, referencia_banco: null, bo_proveedor: { nombre: 'Vercel (sim.)' } },
    { id: 'g2', proveedor_id: 'p2', fecha: '2026-11-05', periodo: PN, concepto: 'Base de datos', moneda: 'MXN', monto_original: '525.00', tipo_cambio: null, subtotal_mxn: '452.59', iva_acreditable_mxn: '72.41', total_mxn: '525.00', cfdi_uuid: '8f2a1c3e-0000-4000-8000-000000000001', comprobante_estado: 'cfdi', deducible_en_forma: 'no_evaluable', cuenta_contable: '5100', conciliado_en: '2026-11-06T12:00:00Z', referencia_banco: 'SPEI 77', bo_proveedor: { nombre: 'Supabase (sim.)' } },
    { id: 'g3', proveedor_id: 'p3', fecha: '2026-10-12', periodo: '2026-10-01', concepto: 'Dominio', moneda: 'MXN', monto_original: '280.00', tipo_cambio: null, subtotal_mxn: null, iva_acreditable_mxn: null, total_mxn: '280.00', cfdi_uuid: null, comprobante_estado: 'sin_comprobante', deducible_en_forma: 'no_evaluable', cuenta_contable: null, conciliado_en: null, referencia_banco: null, bo_proveedor: { nombre: 'Registrador (sim.)' } },
  ],
  bo_proveedor: [
    { id: 'p1', nombre: 'Vercel (sim.)', rfc: null, categoria: 'nube', cuenta_contable: '5100', cadencia: 'mensual', activo: true, creado_en: '2026-01-01' },
    { id: 'p2', nombre: 'Supabase (sim.)', rfc: null, categoria: 'nube', cuenta_contable: '5100', cadencia: 'mensual', activo: true, creado_en: '2026-01-01' },
  ],
  app_user: [{ id: 'v1', nombre: 'Ana Vendedora (sim.)', email: 'ana@ejemplo.test' }, { id: 'v2', nombre: 'Luis Vendedor (sim.)', email: 'luis@ejemplo.test' }],
  bo_comision_mov: [
    { id: 'm1', vendedor_id: 'v1', prospecto_id: 'pr1', tenant_id: 'tn-1', factura_saas_id: 'f1', periodo: PN, tipo: 'devengo', concepto: 'primer_mes', base_cobrada: '5000.00', pct_aplicado: '0.5', monto: '2500.00', referencia_origen: null },
    { id: 'm2', vendedor_id: 'v1', prospecto_id: 'pr1', tenant_id: 'tn-1', factura_saas_id: 'f0', periodo: '2026-10-01', tipo: 'devengo', concepto: 'recurrente', base_cobrada: '5000.00', pct_aplicado: '0.2', monto: '1000.00', referencia_origen: null },
    { id: 'm3', vendedor_id: 'v2', prospecto_id: 'pr2', tenant_id: 'tn-2', factura_saas_id: 'f2', periodo: PN, tipo: 'clawback', concepto: 'ajuste', base_cobrada: '2500.00', pct_aplicado: null, monto: '-200.00', referencia_origen: 'nota de crédito' },
  ],
  bo_pago_vendedor: [{ id: 'pv1', vendedor_id: 'v1', periodo: '2026-10-01', monto_autorizado: '1000.00', cfdi_honorarios_uuid: null, cfdi_honorarios_recibido_en: null, estado: 'autorizado', autorizado_en: '2026-11-02T12:00:00Z', pagado_en: null, referencia_banco: null }],
  prospecto: [{ id: 'pr1', empresa: 'Transportes del Norte (sim.)', vendedor_id: 'v1', tenant_id: 'tn-1', estado: 'won', cerrado_en: '2026-09-20T00:00:00Z' }],
  bo_comision_regla: [{ vigencia_meses: 12 }],
};

// ── Pantallas ──────────────────────────────────────────────────────────────
const { default: AdminChrome } = await import('@/app/admin/chrome');
const { ProveedorRequiereAccion } = await import('@/app/admin/cabecera-admin');
const { ProveedorConteosPestanas } = await import('@/app/admin/conteos-pestanas-contexto');
const { IdiomaProvider } = await import('@/lib/i18n/proveedor');
const { cargarDiccionarios } = await import('@/lib/i18n/catalogo');
const cargadores = import.meta.glob('/src/app/admin/back-office/**/page.tsx');

interface Pantalla { id: string; sub: string; idioma?: 'es' | 'en'; modo: 'con' | 'ausente'; props?: Record<string, unknown> }
const BASE: Array<[string, string, boolean, Record<string, unknown>?]> = [
  ['60-back-office-tablero', '', true], ['61-back-office-cierre', 'cierre', true, { mes: P }], ['62-back-office-contabilidad', 'contabilidad', false],
  ['63-back-office-gastos', 'gastos', false], ['64-back-office-comisiones', 'comisiones', false], ['65-back-office-contratos', 'contratos', false],
  ['66-back-office-contratistas', 'contratistas', false], ['67-back-office-entidad', 'entidad', false],
];
const PANTALLAS: Pantalla[] = BASE.flatMap(([id, sub, enIngles, sp]) => [
  { id, sub, modo: 'con' as const, props: sp }, { id: `${id}-ausente`, sub, modo: 'ausente' as const, props: sp },
  ...(enIngles ? [{ id: `${id}-en`, sub, modo: 'con' as const, idioma: 'en' as const, props: sp }] : []),
]);

const FLOTAS_SEL = [{ id: 'tn-1', nombre: 'Transportes del Norte (sim.)' }];
const ERRORES_PREVIOS: string[] = [];
async function aHtml(el: ReactNode): Promise<string> {
  const errores: string[] = [];
  const { prelude } = await prerender(el as never, { onError: (e: unknown) => { errores.push(String((e as Error)?.stack ?? e).split('\n').slice(0, 4).join(' | ')); } });
  if (errores.length) ERRORES_PREVIOS.push(...errores);
  const r = prelude.getReader(); const dec = new TextDecoder(); let s = '';
  for (;;) { const { done, value } = await r.read(); if (done) break; s += dec.decode(value, { stream: true }); }
  return s;
}

describe('arnés admin-sa-bo', () => {
  it('renderiza el Back-office con el marco real', async () => {
    mkdirSync(path.join(TRABAJO, 'vistas'), { recursive: true });
    for (const p of PANTALLAS) {
      if (SOLO && !SOLO.some((s) => p.id.startsWith(s))) continue;
      E.ruta = `/admin/back-office${p.sub ? `/${p.sub}` : ''}`; E.idioma = p.idioma ?? 'es'; E.modo = p.modo; E.tablas = p.modo === 'con' ? TABLAS_CON : {};
      try {
        const modulo = (await cargadores[`/src/app/admin/back-office${p.sub ? `/${p.sub}` : ''}/page.tsx`]()) as { default: (a?: unknown) => Promise<ReactNode> };
        const cuerpo = await modulo.default({ searchParams: Promise.resolve(p.props ?? {}), params: Promise.resolve({}) });
        const dic = E.idioma === 'es' ? {} : await cargarDiccionarios(E.idioma, ['shell', 'avisos', 'admin_backoffice', 'admin_inicio', 'admin_sistema'] as never);
        const html = await aHtml(
          <IdiomaProvider idioma={E.idioma} diccionarios={dic as never}>
            <ProveedorRequiereAccion valor={{ pendientes: 0, hayUrgente: false }}>
              <ProveedorConteosPestanas valor={{} as never}>
                <AdminChrome nombre="Javier" avatarUrl={null} flotas={FLOTAS_SEL} flotaActual={null}>{cuerpo}</AdminChrome>
              </ProveedorConteosPestanas>
            </ProveedorRequiereAccion>
          </IdiomaProvider>,
        );
        writeFileSync(path.join(TRABAJO, 'vistas', `${p.id}.html`), html);
        if (ERRORES_PREVIOS.length) { writeFileSync(path.join(TRABAJO, 'vistas', `${p.id}.errores-render.txt`), [...new Set(ERRORES_PREVIOS)].join('\n\n')); ERRORES_PREVIOS.length = 0; }
        console.log('OK', p.id, (html.length / 1024).toFixed(0), 'KB');
      } catch (e) {
        console.log('FALLO', p.id, String(e).slice(0, 300).replace(/\n/g, ' '));
        writeFileSync(path.join(TRABAJO, 'vistas', `${p.id}.error.txt`), String((e as Error).stack ?? e));
      }
    }
  }, 900_000);
});
