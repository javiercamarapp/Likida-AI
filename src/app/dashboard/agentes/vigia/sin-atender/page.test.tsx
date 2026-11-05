import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

let sesion = { tenantId: 't-sesion', rol: 'flota_admin', userId: 'u-sesion' };
const resolverEfectivo = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: resolverEfectivo }));
vi.mock('@/lib/auth/tenant-atado', () => ({ firmarFlotaPintada: vi.fn(() => 'firma') }));
const puedeVerRuta = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/visibilidad', () => ({ puedeVerRuta }));
vi.mock('next/navigation', () => ({ redirect: vi.fn((u: string) => { throw new Error(`REDIRECT ${u}`); }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/errores', () => ({ mensajeParaPantalla: (_e: unknown, que: string) => `No se pudo ${que}` }));
const revisar = vi.hoisted(() => vi.fn());
vi.mock('@/lib/likida/vigia/sin_atender_aviso/acciones', () => ({ revisarSinAtender: revisar, VISTA_PREVIA_PANTALLA: 160 }));
vi.mock('@/lib/likida/vigia/sin_atender_aviso/interruptor', () => ({ resumenHabilitado: vi.fn(async () => ({ ok: false, motivo: 'bandera_apagada' })) }));
vi.mock('./acciones', () => ({ revisarSinAtenderAccion: vi.fn(), enviarResumenAccion: vi.fn() }));

const Pagina = (await import('./page')).default;
const { crudos, resultado, alerta } = await import('@/lib/likida/vigia/sin_atender_aviso/fixtures');

type Props = { error: string | null; resultado: unknown; puedeEnviar: boolean; correoEncendido: boolean; gruposRevisados: number; sufijo: string };
async function props(sp: Record<string, string> = {}): Promise<Props> {
  return ((await Pagina({ searchParams: Promise.resolve(sp) })) as ReactElement<Props>).props;
}

beforeEach(() => {
  vi.clearAllMocks();
  sesion = { tenantId: 't-sesion', rol: 'flota_admin', userId: 'u-sesion' };
  resolverEfectivo.mockImplementation(async () => sesion);
  puedeVerRuta.mockReturnValue(true);
  revisar.mockResolvedValue({ ok: true, revision: { resultado: resultado([alerta()]), gruposRevisados: 2, gruposOmitidos: 0, clienteDeChat: new Map(), crudos: crudos() } });
});

describe('la página «sin atender»', () => {
  it('rol sin ruta: redirige y no lee chats', async () => {
    puedeVerRuta.mockReturnValue(false);
    await expect(props()).rejects.toThrow('REDIRECT /dashboard');
    expect(revisar).not.toHaveBeenCalled();
  });
  it('el tenant sale de resolverTenantEfectivo (no del parámetro) y la lectura no lleva ajustes', async () => {
    const p = await props({ tenant: 'otro' });
    expect(resolverEfectivo).toHaveBeenCalledWith('/dashboard/agentes/vigia/sin-atender', { tenant: 'otro' });
    expect(revisar).toHaveBeenCalledWith('t-sesion', {}, 160);
    expect(p.gruposRevisados).toBe(2);
    expect(p.error).toBeNull();
  });
  it('solo quien administra puede enviar; el correo apagado se refleja', async () => {
    expect((await props()).puedeEnviar).toBe(true);
    sesion = { ...sesion, rol: 'encargado' };
    const p = await props();
    expect(p.puedeEnviar).toBe(false);
    expect(p.correoEncendido).toBe(false);
  });
  it('si la lectura falla: lo dice en llano y no lanza', async () => {
    revisar.mockRejectedValue(new Error('boom'));
    const p = await props();
    expect(p.error).toBe('No se pudo revisar las conversaciones');
    expect(p.resultado).toBeNull();
  });
});
