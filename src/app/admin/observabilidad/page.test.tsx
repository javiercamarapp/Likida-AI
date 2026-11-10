import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

// /admin/observabilidad — donde viven los interruptores (el kill switch). Esta prueba fija su FUNCIÓN antes de tocar la pantalla:
// la acción re-exige superadmin ADENTRO (un POST directo no pasa por el render), apagar exige motivo (lo valida `apagar`), una
// operación desconocida se rechaza, y una fuente caída se DICE en vez de pintar «todo encendido».

type Elemento = ReactElement<Record<string, unknown>>;
const dobles = vi.hoisted(() => ({
  requireSuperadmin: vi.fn(),
  listarInterruptores: vi.fn(),
  apagar: vi.fn(),
  encender: vi.fn(),
  corridasRecientes: vi.fn(),
  getLatencias: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('next/cache', () => ({ revalidatePath: dobles.revalidatePath }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => '/admin/observabilidad', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/likida/interruptores', () => ({ listarInterruptores: dobles.listarInterruptores, apagar: dobles.apagar, encender: dobles.encender }));
vi.mock('@/lib/admin/corridas-cruzadas', async (importar) => ({ ...(await importar<typeof import('@/lib/admin/corridas-cruzadas')>()), corridasRecientes: dobles.corridasRecientes }));
vi.mock('@/lib/admin/slo', async (importar) => ({ ...(await importar<typeof import('@/lib/admin/slo')>()), getLatencias: dobles.getLatencias }));

import { SeccionInterruptores } from './interruptores-ui';
import ObservabilidadPage from './page';

function buscar(nodo: ReactNode, tipo: unknown, salida: Elemento[] = []): Elemento[] {
  if (Array.isArray(nodo)) { for (const h of nodo) buscar(h, tipo, salida); return salida; }
  if (!isValidElement<Record<string, unknown>>(nodo)) return salida;
  if (nodo.type === tipo) salida.push(nodo);
  buscar(nodo.props.children as ReactNode, tipo, salida);
  return salida;
}
type Accion = (previo: unknown, fd: FormData) => Promise<{ ok?: string; error?: string } | null>;
const fd = (c: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(c)) f.set(k, v); return f; };
const INTERRUPTOR = { id: 'agente:cobranza', apagado: false, motivo: null, cambiadoPorNombre: null, cambiadoEn: null };

async function accionDeLaPagina(): Promise<Accion> {
  const pagina = await ObservabilidadPage();
  const seccion = buscar(pagina, SeccionInterruptores)[0];
  if (!seccion) throw new Error('la página no pintó SeccionInterruptores');
  return seccion.props.accion as Accion;
}
const pintar = async () => renderToStaticMarkup(await ObservabilidadPage());

beforeEach(() => {
  vi.clearAllMocks();
  dobles.requireSuperadmin.mockResolvedValue({ userId: 'u-1' });
  dobles.listarInterruptores.mockResolvedValue([INTERRUPTOR]);
  dobles.corridasRecientes.mockResolvedValue([]);
  dobles.getLatencias.mockResolvedValue({ ventanaDias: 7, rutas: [], crons: [], ia: [] });
  dobles.apagar.mockResolvedValue(undefined);
  dobles.encender.mockResolvedValue(undefined);
});

it('la acción re-exige superadmin DENTRO: un POST directo sin sesión no apaga nada', async () => {
  const accion = await accionDeLaPagina();
  dobles.requireSuperadmin.mockRejectedValueOnce(new Error('no autorizado'));
  await expect(accion(null, fd({ id: 'agente:cobranza', operacion: 'apagar', motivo: 'x' }))).rejects.toThrow('no autorizado');
  expect(dobles.apagar).not.toHaveBeenCalled();
});

it('apagar manda el id, el motivo y el userId de la SESIÓN, y revalida la pantalla', async () => {
  const accion = await accionDeLaPagina();
  const r = await accion(null, fd({ id: 'agente:cobranza', operacion: 'apagar', motivo: 'incidente de prueba' }));
  expect(dobles.apagar).toHaveBeenCalledWith('agente:cobranza', 'incidente de prueba', 'u-1');
  expect(dobles.revalidatePath).toHaveBeenCalledWith('/admin/observabilidad');
  expect(r).toEqual({ ok: expect.stringContaining('APAGADO') });
});

it('apagar sin motivo: el error de `apagar` llega a la pantalla y no se revalida', async () => {
  dobles.apagar.mockRejectedValueOnce(new Error('Apagar exige un motivo.'));
  const accion = await accionDeLaPagina();
  const r = await accion(null, fd({ id: 'agente:cobranza', operacion: 'apagar', motivo: '' }));
  expect(r).toEqual({ error: expect.any(String) });
  expect(dobles.revalidatePath).not.toHaveBeenCalled();
});

it('encender no pide motivo y firma con la sesión; una operación desconocida se rechaza sin tocar nada', async () => {
  const accion = await accionDeLaPagina();
  expect(await accion(null, fd({ id: 'agente:cobranza', operacion: 'encender' }))).toEqual({ ok: expect.stringContaining('encendido') });
  expect(dobles.encender).toHaveBeenCalledWith('agente:cobranza', 'u-1');
  expect(await accion(null, fd({ id: 'agente:cobranza', operacion: 'borrar' }))).toEqual({ error: 'Operación desconocida.' });
  expect(dobles.apagar).not.toHaveBeenCalled();
});

it('una fuente de interruptores caída se DICE: no es «todos encendidos» y los reloj fallan cerrado', async () => {
  dobles.listarInterruptores.mockRejectedValue(new Error('caída'));
  const html = await pintar();
  expect(html).toContain('No se pudieron leer los interruptores');
  expect(html).toContain('NO corren');
});

it('cada fuente cae por su lado: sin corridas ni latencias, los interruptores siguen en pie', async () => {
  dobles.corridasRecientes.mockRejectedValue(new Error('caída'));
  dobles.getLatencias.mockRejectedValue(new Error('caída'));
  const html = await pintar();
  expect(html).toContain('Agente de Cobranza');
  expect(html).toContain('No se pudo leer el historial de corridas');
  expect(html).toContain('No se pudo leer la latencia');
});

it('sin muestras de latencia lo dice (la tabla existe y está vacía de verdad)', async () => {
  const html = await pintar();
  expect(html).toContain('Sin muestras todavía');
});
