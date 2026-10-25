import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

// La página de viajes en vivo: puerta por área (operación), filtros validados contra el catálogo de la flota y la
// acción de «atender» con DOS candados (ruta + permiso), siempre sobre el tenant de la SESIÓN.

type Elemento = ReactElement<Record<string, unknown>>;
let sesion: { tenantId: string; rol: string; userId: string } = { tenantId: 't-1', rol: 'encargado', userId: 'u-1' };
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => sesion }));
vi.mock('next/navigation', () => ({ redirect: (r: string) => { throw new Error(`REDIRECT:${r}`); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/saludo', () => ({ ahoraMs: () => Date.parse('2026-10-02T18:00:00.000Z') }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('sin base en pruebas'); } }));

const { ponerFuentes } = await import('@/lib/likida/orquestador/fuentes');
const { crearFuentesEnMemoria, datosVacios, hitosDe, viajeTablero } = await import('@/lib/likida/orquestador/fuentes.fixture');
const { VistaViajesEnVivo, TareasAbiertas } = await import('./vista');
const { default: Pagina } = await import('./page');

const T1 = '11111111-1111-4111-8111-111111111111';
const C1 = '22222222-2222-4222-8222-222222222222';

function buscar(nodo: ReactNode, componente: unknown, salida: Elemento[] = []): Elemento[] {
  if (Array.isArray(nodo)) { for (const h of nodo) buscar(h, componente, salida); return salida; }
  if (!isValidElement<Record<string, unknown>>(nodo)) return salida;
  if (nodo.type === componente) salida.push(nodo);
  buscar(nodo.props.children as ReactNode, componente, salida);
  return salida;
}

let m: ReturnType<typeof crearFuentesEnMemoria>;
beforeEach(() => {
  sesion = { tenantId: 't-1', rol: 'encargado', userId: 'u-1' };
  const a = viajeTablero('a1', { terminalId: T1, clienteId: C1 });
  const b = viajeTablero('a2', { terminalId: 'otra', clienteId: 'otro' });
  m = crearFuentesEnMemoria({
    't-1': { datos: { ...datosVacios(), viajes: [a, b], hitos: [...hitosDe('a1'), ...hitosDe('a2')] }, posiciones: {}, terminales: [{ id: T1, nombre: 'Guadalajara' }], clientes: [{ id: C1, nombre: 'Cliente A' }] },
    't-2': { datos: { ...datosVacios(), viajes: [viajeTablero('b1')], hitos: hitosDe('b1') }, posiciones: {} },
  });
  ponerFuentes(m.fuentes);
});

it('el contador (área dinero) es redirigido sin leer nada', async () => {
  sesion = { tenantId: 't-1', rol: 'contador', userId: 'u-2' };
  await expect(Pagina({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT:/dashboard');
  expect(m.llamadas).toEqual([]);
});

it('el encargado ve SOLO los viajes de su flota y los filtros válidos se aplican', async () => {
  const pagina = await Pagina({ searchParams: Promise.resolve({ terminal: T1, cliente: C1 }) });
  const vista = buscar(pagina, VistaViajesEnVivo)[0];
  const tablero = vista.props.tablero as { filas: Array<{ folio: string }> };
  expect(tablero.filas.map((f) => f.folio)).toEqual(['F-a1']);
  expect(m.llamadas.every((l) => l.tenantId === 't-1')).toBe(true);
});

it('un id de terminal que no está en el catálogo de la flota se ignora (nada de la URL llega a una consulta)', async () => {
  const ajeno = '33333333-3333-4333-8333-333333333333';
  const pagina = await Pagina({ searchParams: Promise.resolve({ terminal: ajeno, cliente: "x'; drop table viaje;--" }) });
  const vista = buscar(pagina, VistaViajesEnVivo)[0];
  expect((vista.props.filtros as { terminalId: string; clienteId: string })).toMatchObject({ terminalId: '', clienteId: '' });
  expect((vista.props.tablero as { filas: unknown[] }).filas).toHaveLength(2);
});

it('vista=excepciones deja solo los viajes con excepción', async () => {
  const pagina = await Pagina({ searchParams: Promise.resolve({ vista: 'excepciones' }) });
  const vista = buscar(pagina, VistaViajesEnVivo)[0];
  expect((vista.props.filtros as { soloExcepciones: boolean }).soloExcepciones).toBe(true);
});

// P6: el aviso saliente de una tarea nueva (apagado por defecto) se configura aquí, y solo lo configura el dueño.
it('la sección de Notificaciones del asistente aparece solo para quien puede administrar (el encargado no decide quién recibe los correos)', async () => {
  const paraEncargado = await Pagina({ searchParams: Promise.resolve({}) });
  expect(buscar(paraEncargado, VistaViajesEnVivo)[0].props.notificaciones).toBeNull();
  sesion = { tenantId: 't-1', rol: 'flota_admin', userId: 'u-3' };
  const paraDueno = await Pagina({ searchParams: Promise.resolve({}) });
  expect(buscar(paraDueno, VistaViajesEnVivo)[0].props.notificaciones).not.toBeNull();
});

// A37-S21-05: «Marcar atendida» aplica el rol a LA FILA y le dice a quien pulsó si la tarea ya estaba cerrada.
const TAREA_DINERO = '44444444-4444-4444-8444-444444444444';
const TAREA_OPERACION = '55555555-5555-4555-8555-555555555555';
function sembrarTareas() {
  const base = { creadaEn: '2026-10-02T18:00:00.000Z', viajeFolio: null, resumen: 'x', pedidaPorRol: 'encargado', dedupe: 'd', tenantId: 't-1', usuarioId: null };
  m.tareas.set('t-1', [
    { ...base, id: TAREA_DINERO, destino: 'liquidacion', motivo: 'diferencia_liquidacion', dedupe: 'd1' },
    { ...base, id: TAREA_OPERACION, destino: 'jefe_de_trafico', motivo: 'otro', dedupe: 'd2' },
  ] as never);
}
async function pulsar(id: string): Promise<string> {
  const pagina = await Pagina({ searchParams: Promise.resolve({}) });
  const tareasEl = buscar(pagina, VistaViajesEnVivo)[0].props.tareas as Elemento;
  expect(tareasEl.type).toBe(TareasAbiertas);
  const accion = tareasEl.props.accion as (fd: FormData) => Promise<void>;
  const fd = new FormData(); fd.set('id', id);
  try { await accion(fd); return 'ok'; } catch (e) { return (e as Error).message; }
}

it('A37-S21-05: un rol sin dinero no cierra una tarea de dinero aunque tenga su id', async () => {
  sembrarTareas();
  expect(await pulsar(TAREA_DINERO)).toContain('atencion=sin_permiso');
  expect(m.tareas.get('t-1')!.map((t) => t.id)).toContain(TAREA_DINERO);
});

it('A37-S21-05: la tarea operativa se cierra y la segunda persona que pulsa se entera de que ya estaba cerrada', async () => {
  sembrarTareas();
  expect(await pulsar(TAREA_OPERACION)).toBe('ok');
  expect(await pulsar(TAREA_OPERACION)).toContain('atencion=ya_atendida');
});
