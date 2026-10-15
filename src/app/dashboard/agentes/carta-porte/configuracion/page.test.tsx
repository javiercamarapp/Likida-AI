import { beforeEach, describe, expect, it, vi } from 'vitest';

// La página: gatea con SU ruta, lee solo lo de la flota de la sesión, y distingue «sin fila» (arranque) de «ya guardada».
let sesion: { tenantId: string; rol: string; userId: string } = { tenantId: 't-1', rol: 'flota_admin', userId: 'u-1' };
const puerto = vi.hoisted(() => ({ rutas: [] as string[], salida: null as unknown }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async (ruta: string) => { puerto.rutas.push(ruta); return sesion; } }));
vi.mock('next/navigation', () => ({ redirect: (r: string) => { throw new Error(`REDIRECT:${r}`); } }));
vi.mock('./actions', () => ({ guardarConfiguracionSalida: vi.fn(), probarConexionSalida: vi.fn() }));
vi.mock('@/lib/likida/carta_porte_docs/repo', async () => (await import('@/lib/likida/carta_porte_docs/repo_falso.fixture')).api);
vi.mock('@/lib/likida/carta_porte_docs/worker_envios_deps', () => ({ salidaDeFlota: async () => puerto.salida }));

import { estado, reset } from '@/lib/likida/carta_porte_docs/repo_falso.fixture';
import { CONFIG_SALIDA_ARRANQUE } from '@/lib/likida/carta_porte_docs/salida_config';
import { SIN_TMS } from '@/lib/likida/carta_porte_docs/tms_puerto';
import Pagina from './page';

type Props = { config: { reintentosMax: number }; esArranque: boolean; personas: Array<{ id: string }>; conector: { hay: boolean; puedeProbar: boolean } };
const montar = async () => (await Pagina({ searchParams: Promise.resolve({}) })) as unknown as { props: Props };

beforeEach(() => {
  reset(); puerto.rutas.length = 0; puerto.salida = SIN_TMS;
  sesion = { tenantId: 't-1', rol: 'flota_admin', userId: 'u-1' };
});

describe('PaginaConfiguracionSalida', () => {
  it('sin fila guardada entrega los valores de arranque marcados como tales y sin conector', async () => {
    const { props } = await montar();
    expect(puerto.rutas).toEqual(['/dashboard/agentes/carta-porte/configuracion']);
    expect(props.esArranque).toBe(true);
    expect(props.config).toMatchObject({ reintentosMax: CONFIG_SALIDA_ARRANQUE.reintentosMax });
    expect(props.conector).toEqual({ hay: false, puedeProbar: false });
  });

  it('con fila de ESTA flota la muestra; la fila de otra flota no se cuela; las personas son solo las de la flota', async () => {
    estado.salidaConfigs.set('t-1', { ...CONFIG_SALIDA_ARRANQUE, reintentosMax: 2 });
    estado.salidaConfigs.set('t-otra', { ...CONFIG_SALIDA_ARRANQUE, reintentosMax: 9 });
    estado.usuarios.push({ tenantId: 't-1', id: 'a', nombre: 'Ana', email: 'a@ejemplo.test', rol: 'encargado', telefono: null, activo: true });
    estado.usuarios.push({ tenantId: 't-otra', id: 'b', nombre: 'Beto', email: 'b@ejemplo.test', rol: 'encargado', telefono: null, activo: true });
    const { props } = await montar();
    expect(props.esArranque).toBe(false);
    expect(props.config.reintentosMax).toBe(2);
    expect(props.personas.map((p) => p.id)).toEqual(['a']);
  });

  it('con conector que sabe probar habilita el botón; con conector sin probar() no', async () => {
    puerto.salida = { async cargarPlantilla() { return { ok: true, referencia: null, duplicado: false }; } };
    expect((await montar()).props.conector).toEqual({ hay: true, puedeProbar: false });
    puerto.salida = { async cargarPlantilla() { return { ok: true, referencia: null, duplicado: false }; }, async probar() { return { ok: true, mensaje: '' }; } };
    expect((await montar()).props.conector).toEqual({ hay: true, puedeProbar: true });
  });

  it('un rol que no ve la ruta rebota al panel; una lectura caída lanza en vez de fingir arranque', async () => {
    const visibilidad = await import('@/lib/auth/visibilidad');
    sesion = { ...sesion, rol: 'contador' };
    expect(visibilidad.puedeVerRuta('contador', '/dashboard/agentes/carta-porte/configuracion')).toBe(false);
    await expect(montar()).rejects.toThrow('REDIRECT:/dashboard');
    sesion = { ...sesion, rol: 'flota_admin' };
    estado.fallar.set('leerSalidaConfig', new Error('caída'));
    await expect(montar()).rejects.toThrow('caída');
  });
});
