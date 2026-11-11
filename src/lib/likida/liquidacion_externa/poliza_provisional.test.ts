import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import type { DependenciasDesglose } from './desglose_recibir';
import { BITACORA_MUESTRA, PADRON_MUESTRA } from './desglose_muestra_tms.fixture';

// Póliza provisional (decisión del dueño, 10-nov-2026): sin la perilla todo sigue reteniéndose; con ella el desglose se guarda marcado,
// SIEMPRE retenido, y solo una persona que administra lo libera. Dobles en memoria; la base no se toca.
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('la base no debe tocarse en estas pruebas'); } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { prepararMuestraTms, SISTEMA_ORIGEN_MUESTRA_TMS } = await import('./desglose_muestra_recepcion');
const { recibirDesglose } = await import('./desglose_recibir');
const { liberarEnvio } = await import('./liberar_envio');
const { armarCorreoDesglose } = await import('./entrega_correo');
const { CONFIG_CORREO_POR_DEFECTO } = await import('./repo_correo');
const { POLIZA_PROVISIONAL } = await import('./poliza_provisional');

const TENANT = 't-1';
const CONFIG = { ...CONFIG_CORREO_POR_DEFECTO, canal: 'correo' as const, activa: true, noEnviarAntes: '2020-01-01', rhCorreos: ['rh@ejemplo.test'], revisores: [{ departamento: 'nomina', correo: 'rev@ejemplo.test' }], primerMesHasta: '2099-12-31' };

function desgloseSinPoliza() {
  const p = prepararMuestraTms({ formato: 'muestra-tms', version: 1, bitacoras: [BITACORA_MUESTRA] }, PADRON_MUESTRA);
  if (!p.ok) throw new Error(p.mensaje);
  return p.desgloses[0];
}

function dobles(provisional: boolean | undefined) {
  const excepciones: Array<{ tipo: string; detalle: Record<string, unknown> }> = [];
  const resueltas: string[] = [];
  const subidas: Uint8Array[] = [];
  const metas: Array<Record<string, unknown>> = [];
  const entregas: Array<{ rol: string; correo: string }> = [];
  const deps = {
    ahora: () => new Date('2026-11-06T12:00:00Z'),
    leerConfig: async () => CONFIG,
    buscarPorClave: async () => null,
    abrirExcepcion: async (_t: string, _c: string, tipo: string, detalle: Record<string, unknown>) => { excepciones.push({ tipo, detalle }); return { id: excepciones.length, nueva: true }; },
    resolverOperador: async () => ({ id: 'op-1', nombre: 'Operador Ficticio Uno', telefono: '28999', activo: true }),
    resolverViajeIds: async () => [],
    leerContacto: async () => ({ operadorId: 'op-1', correo: 'op@ejemplo.test', correoRebotadoEn: null, coordinadorId: null }),
    leerCoordinador: async () => null,
    subirXlsx: async (_t: string, _c: string, _h: string, b: Uint8Array) => { subidas.push(b); return 'ruta/x.xlsx'; },
    insertarLiquidacion: async (n: { datos: { claveExterna: string } }) => ({ id: 'liq-1', claveExterna: n.datos.claveExterna }),
    insertarDesglose: async (_t: string, m: Record<string, unknown>) => { metas.push(m); return true; },
    insertarEntregas: async (_t: string, f: Array<{ rol: string; correo: string }>) => { entregas.push(...f); return f.length; },
    registrarEvento: async () => undefined,
    resolverExcepciones: async (_t: string, _c: string, tipo: string) => { resueltas.push(tipo); return 1; },
    omitirPendientes: async () => 0,
    ...(provisional === undefined ? {} : { leerPolizaProvisional: async () => provisional }),
  } as unknown as DependenciasDesglose;
  return { deps, excepciones, resueltas, subidas, metas, entregas };
}

describe('póliza provisional: la perilla de la flota', () => {
  it.each([undefined, false])('apagada (%s): sigue reteniendo como antes (sin_poliza, nada se guarda)', async (valor) => {
    const b = dobles(valor);
    const r = await recibirDesglose(TENANT, desgloseSinPoliza(), b.deps, { sistemaOrigen: SISTEMA_ORIGEN_MUESTRA_TMS });
    expect(r.estado).toBe('sin_poliza');
    expect(b.metas).toHaveLength(0);
    expect(b.subidas).toHaveLength(0);
    expect(b.entregas).toHaveLength(0);
    expect(b.excepciones.map((e) => e.tipo)).toEqual(['sin_poliza']);
  });

  it('encendida: se guarda marcada y RETENIDA; solo el revisor recibe copia; nada al operador, coordinador ni RH', async () => {
    const b = dobles(true);
    const r = await recibirDesglose(TENANT, desgloseSinPoliza(), b.deps, { sistemaOrigen: SISTEMA_ORIGEN_MUESTRA_TMS });
    expect(r.estado).toBe('creada');
    if (r.estado !== 'creada') return;
    expect(r.retenida).toBe(true);
    expect(r.motivos).toContain('sin_poliza');
    expect(b.metas[0]).toMatchObject({ poliza: POLIZA_PROVISIONAL });
    expect(String(b.metas[0].retenidaMotivo)).toMatch(/^Póliza provisional/);
    expect(b.entregas.map((e) => e.rol)).toEqual(['revisor']);
    // la excepción que pide la revisión sigue abierta (no se cierra sola como cuando llega la póliza real)
    expect(b.excepciones.find((e) => e.tipo === 'sin_poliza')?.detalle).toMatchObject({ provisional: true });
    expect(b.resueltas).not.toContain('sin_poliza');
  });

  it('encendida y SIN revisores: sigue retenida y no sale ningún correo', async () => {
    const b = dobles(true);
    b.deps.leerConfig = async () => ({ ...CONFIG, revisores: [], primerMesHasta: null });
    const r = await recibirDesglose(TENANT, desgloseSinPoliza(), b.deps, { sistemaOrigen: SISTEMA_ORIGEN_MUESTRA_TMS });
    expect(r.estado === 'creada' && r.retenida && r.entregas === 0).toBe(true);
    expect(b.entregas).toHaveLength(0);
  });

  it('el Excel lleva la marca «PÓLIZA PROVISIONAL» y el correo la dice en asunto y cuerpo', async () => {
    const b = dobles(true);
    await recibirDesglose(TENANT, desgloseSinPoliza(), b.deps, { sistemaOrigen: SISTEMA_ORIGEN_MUESTRA_TMS });
    const libro = XLSX.read(b.subidas[0], { type: 'array' });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    expect(Object.values(hoja).some((c) => typeof c === 'object' && c && 'v' in c && /PÓLIZA PROVISIONAL/.test(String((c as { v: unknown }).v)))).toBe(true);
    const { correo } = armarCorreoDesglose({ claveExterna: 'BIT-1', periodoDesde: '2026-10-01', periodoHasta: '2026-10-07', polizaProvisional: true });
    expect(correo.asunto).toContain('PÓLIZA PROVISIONAL');
    expect(correo.parrafos.join(' ')).toContain('PÓLIZA PROVISIONAL');
    const normal = armarCorreoDesglose({ claveExterna: 'BIT-1', periodoDesde: '2026-10-01', periodoHasta: '2026-10-07' });
    expect(normal.correo.asunto).not.toContain('PROVISIONAL');
  });

  it('nunca sale sin revisión: el envío al operador solo lo crea liberarEnvio, con una persona que administra', async () => {
    const insertadas: Array<{ rol: string; disparo?: string; pedidoPor?: string | null }> = [];
    const base = (poliza: string | null, rol: string) => ({
      leerLiquidacion: async () => ({ id: 'liq-1', claveExterna: 'BIT-1', periodoHasta: '2026-10-07', operadorId: 'op-1', huella: 'h' }),
      leerDesglose: async () => ({ desglose: { retenidaMotivo: 'Póliza provisional: pendiente de revisión humana antes de enviar.', poliza } }),
      leerConfig: async () => ({ ...CONFIG, rhCorreos: [] as string[], archivoCorreo: null }),
      leerContacto: async () => ({ operadorId: 'op-1', correo: 'op@ejemplo.test', correoRebotadoEn: null, coordinadorId: null }),
      leerCoordinador: async () => null,
      entregas: async () => [{ rol: 'revisor' }],
      excepcionesAbiertas: async () => [{ id: 7, tipo: 'sin_poliza', detalle: {}, claveExterna: 'BIT-1' }],
      insertarEntregas: async (_t: string, f: typeof insertadas) => { insertadas.push(...f); return f.length; },
      liberarRetencion: async () => true,
      resolverExcepcion: async () => true,
      existeCorreccionSiguiente: async () => false,
      registrarEvento: async () => undefined,
      ahora: () => new Date('2026-11-06T12:00:00Z'),
      _rol: rol,
    });
    const sinPermiso = await liberarEnvio(TENANT, 'liq-1', { userId: 'u', rol: 'encargado' }, base(POLIZA_PROVISIONAL, 'x') as never);
    expect(sinPermiso).toMatchObject({ estado: 'rechazado', motivo: 'sin_permiso' });
    expect(insertadas).toHaveLength(0);
    // una falta de póliza que NO es provisional no se libera desde aquí
    const real = await liberarEnvio(TENANT, 'liq-1', { userId: 'u', rol: 'flota_admin' }, base(null, 'x') as never);
    expect(real).toMatchObject({ estado: 'rechazado', motivo: 'no_liberable' });
    expect(insertadas).toHaveLength(0);
    const ok = await liberarEnvio(TENANT, 'liq-1', { userId: 'u', rol: 'flota_admin' }, base(POLIZA_PROVISIONAL, 'x') as never);
    expect(ok).toMatchObject({ estado: 'liberado' });
    expect(insertadas.map((e) => e.rol)).toEqual(['operador']);
    expect(insertadas[0]).toMatchObject({ disparo: 'manual', pedidoPor: 'u' });
  });
});
