import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';

// T-A4-32 · las server actions también niegan bajo el perfil cinco_agentes (no basta con ocultar el botón:
// una acción es un endpoint). Sin perfil, todo sigue como siempre.

const sesion = { tenantId: 't-sesion', rol: 'flota_admin', userId: 'u-sesion' };
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: vi.fn(async () => sesion) }));
vi.mock('@/lib/auth/visibilidad', () => ({ puedeVerRuta: () => true }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/saludo', () => ({ ahoraMs: () => 1_000 }));
vi.mock('../../bloque', () => ({ vigilar: <T,>(p: T) => p }));
vi.mock('../../../sufijo', () => ({ sufijoTenant: () => '' }));
vi.mock('@/lib/likida/errores', () => ({ mensajeParaPantalla: (_e: unknown, que: string) => `No se pudo ${que}` }));
vi.mock('@/lib/likida/conductor/trabajo', () => ({ emailDeUsuario: vi.fn(async () => null) }));

const perfilDeTenant = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/perfil_tenant', () => ({ perfilDeTenant }));

const guardarConfigVigia = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => {}));
vi.mock('@/lib/likida/vigia/repo', async () => {
  const real = await vi.importActual<typeof import('@/lib/likida/vigia/repo')>('@/lib/likida/vigia/repo');
  return { ...real, cargarTablero: vi.fn(async () => ({ config: {} })), guardarConfigVigia, crearRepoVigia: () => ({ config: async () => null }) };
});
vi.mock('@/lib/likida/vigia/deps', () => ({ crearDepsVigia: () => ({ repo: {} }) }));
vi.mock('@/lib/likida/vigia/aviso/bandeja', () => ({ crearRepoBandeja: () => ({ contarPendientes: async () => 0 }) }));

const leerRespuestasRapidas = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => []));
vi.mock('@/lib/likida/vigia/historial/repo', () => ({
  leerGrupos: vi.fn(async () => []), leerClientesParaGrupo: vi.fn(async () => []), leerMensajesHistorial: vi.fn(async () => ({ mensajes: [], truncado: false })),
  leerRespuestasRapidas,
}));
const aprobarRespuestaRapidaPanel = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ ok: true as const, mensaje: 'hecho' })));
const retirarRespuestaRapidaPanel = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ ok: true as const, mensaje: 'hecho' })));
vi.mock('@/lib/likida/vigia/historial/acciones', () => ({
  altaGrupoPanel: vi.fn(), borrarGrupoPanel: vi.fn(), criticoGrupoPanel: vi.fn(), importarHistorialPanel: vi.fn(),
  aprobarRespuestaRapidaPanel, retirarRespuestaRapidaPanel,
}));

const Tablero = (await import('./page')).default;
const Historial = (await import('./historial/page')).default;

type Acc = Record<string, (p: null, f: FormData) => Promise<{ ok: boolean; error?: string } | null>>;
const fd = (c: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(c)) f.append(k, v); return f; };
const propsTablero = async () => (await Tablero({ searchParams: Promise.resolve({}) })) as ReactElement<{ acciones: Acc; standby: boolean }>;
const propsHistorial = async () => (await Historial({ searchParams: Promise.resolve({}) })) as ReactElement<{ acciones: Acc; standby: boolean; rapidas: unknown }>;
const cfg = (modo: string) => fd({ habilitado: 'on', modoAprobacion: modo, autoenviarMinAprobaciones: '5', slaRespuestaMin: '30', escalarNivel2Min: '60', retencionDias: '180' });

beforeEach(() => { vi.clearAllMocks(); });

describe('tablero del Vigía bajo perfil', () => {
  it('con perfil: standby activo y la acción de configuración niega el autoenvío sin guardar', async () => {
    perfilDeTenant.mockResolvedValue('cinco_agentes');
    const el = await propsTablero();
    expect(el.props.standby).toBe(true);
    const r = await el.props.acciones.config(null, cfg('autoenviar_bajo_riesgo'));
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('no está disponible en tu plan') });
    expect(guardarConfigVigia).not.toHaveBeenCalled();
  });
  it('con perfil: «siempre aprobar» sí se guarda', async () => {
    perfilDeTenant.mockResolvedValue('cinco_agentes');
    const el = await propsTablero();
    expect(await el.props.acciones.config(null, cfg('siempre'))).toMatchObject({ ok: true });
    expect(guardarConfigVigia).toHaveBeenCalledTimes(1);
  });
  it('sin perfil: standby apagado y el autoenvío se guarda como hoy', async () => {
    perfilDeTenant.mockResolvedValue(null);
    const el = await propsTablero();
    expect(el.props.standby).toBe(false);
    expect(await el.props.acciones.config(null, cfg('autoenviar_bajo_riesgo'))).toMatchObject({ ok: true });
    expect(guardarConfigVigia).toHaveBeenCalledTimes(1);
  });
});

describe('histórico del Vigía bajo perfil', () => {
  it('con perfil: no se leen las respuestas rápidas y aprobar/retirar devuelven «no disponible en tu plan» sin tocar nada', async () => {
    perfilDeTenant.mockResolvedValue('cinco_agentes');
    const el = await propsHistorial();
    expect(el.props.standby).toBe(true);
    expect(el.props.rapidas).toBeNull();
    expect(leerRespuestasRapidas).not.toHaveBeenCalled();
    expect(await el.props.acciones.aprobarRapida(null, fd({ pregunta: 'x' }))).toMatchObject({ ok: false, error: 'Esto no está disponible en tu plan.' });
    expect(await el.props.acciones.retirarRapida(null, fd({ respuestaId: 'x' }))).toMatchObject({ ok: false, error: 'Esto no está disponible en tu plan.' });
    expect(aprobarRespuestaRapidaPanel).not.toHaveBeenCalled();
    expect(retirarRespuestaRapidaPanel).not.toHaveBeenCalled();
  });
  it('sin perfil: se leen y las acciones llegan al panel como siempre', async () => {
    perfilDeTenant.mockResolvedValue(null);
    const el = await propsHistorial();
    expect(el.props.standby).toBe(false);
    expect(leerRespuestasRapidas).toHaveBeenCalledTimes(1);
    expect(await el.props.acciones.aprobarRapida(null, fd({ pregunta: 'x' }))).toMatchObject({ ok: true });
    expect(await el.props.acciones.retirarRapida(null, fd({ respuestaId: 'x' }))).toMatchObject({ ok: true });
  });
});
