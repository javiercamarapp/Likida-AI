import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// /admin/soporte — CERO cobertura de la PÁGINA (getTicketsCruzados/soporte.ts
// ya tienen prueba propia: admin/soporte.test.ts y likida/soporte.test.ts).
// Tres server actions (responder, tomar, cambiar estado), cada una re-exige
// `requireSuperadmin()` adentro — el patrón del repo: una server action es un
// endpoint POST alcanzable sin pasar por el render de la página.
// ═══════════════════════════════════════════════════════════════════════════

type Elemento = ReactElement<Record<string, unknown>>;

const dobles = vi.hoisted(() => ({
  requireSuperadmin: vi.fn(),
  getTicketsCruzados: vi.fn(),
  contarTickets: vi.fn(),
  resolverTicketCruzado: vi.fn(),
  getTicketDelTenant: vi.fn(),
  getHilo: vi.fn(),
  responderTicket: vi.fn(),
  tomarTicket: vi.fn(),
  cambiarEstadoTicket: vi.fn(),
  revalidatePath: vi.fn(),
  avisosDeSlaPorTicket: vi.fn(),
}));

vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('next/cache', () => ({ revalidatePath: dobles.revalidatePath }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => '/admin/soporte', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/admin/soporte-escalado', () => ({ avisosDeSlaPorTicket: dobles.avisosDeSlaPorTicket }));
vi.mock('@/lib/admin/soporte', async (importar) => ({
  ...(await importar<typeof import('@/lib/admin/soporte')>()),
  getTicketsCruzados: dobles.getTicketsCruzados,
  contarTickets: dobles.contarTickets,
  resolverTicketCruzado: dobles.resolverTicketCruzado,
}));
vi.mock('@/lib/likida/soporte', async (importar) => ({
  ...(await importar<typeof import('@/lib/likida/soporte')>()),
  getTicketDelTenant: dobles.getTicketDelTenant,
  getHilo: dobles.getHilo,
  responderTicket: dobles.responderTicket,
  tomarTicket: dobles.tomarTicket,
  cambiarEstadoTicket: dobles.cambiarEstadoTicket,
}));

import { FormaConAviso } from '../ui/forma';
import SoportePage from './page';

function formasConAviso(nodo: ReactNode, salida: Elemento[] = []): Elemento[] {
  if (Array.isArray(nodo)) { for (const hijo of nodo) formasConAviso(hijo, salida); return salida; }
  if (!isValidElement<Record<string, unknown>>(nodo)) return salida;
  if (nodo.type === FormaConAviso) salida.push(nodo);
  formasConAviso(nodo.props.children as ReactNode, salida);
  return salida;
}
function accionDelBoton(pagina: ReactNode, patron: RegExp) {
  const forma = formasConAviso(pagina).find((f) => patron.test(String(f.props.boton)));
  if (!forma) throw new Error(`No se encontró un FormaConAviso con botón que matchee ${patron}`);
  return forma.props.accion as (previo: unknown, fd: FormData) => Promise<{ ok?: string; error?: string }>;
}

const fd = (campos: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(campos)) f.set(k, v); return f; };
const DETALLE = { id: 't-1', asunto: 'No puedo timbrar', categoria: 'fiscal', prioridad: 'alta', estado: 'abierto', abiertoEn: '2026-01-01T00:00:00Z', venceEn: null, asignadoA: null, asignadoNombre: null, descripcion: null };

async function paginaConTicketAbierto() {
  dobles.resolverTicketCruzado.mockResolvedValue({ id: 't-1', tenantId: 'tn-1', tenantNombre: 'Transportes ACME' });
  dobles.getTicketDelTenant.mockResolvedValue(DETALLE);
  dobles.getHilo.mockResolvedValue([]);
  return SoportePage({ searchParams: Promise.resolve({ ticket: 't-1' }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  dobles.requireSuperadmin.mockResolvedValue({ userId: 'u-1', tenantId: null, rol: 'superadmin' });
  dobles.getTicketsCruzados.mockResolvedValue([]);
  dobles.contarTickets.mockResolvedValue({ abiertos: 0, vencidos: 0, sinSla: 0, cerrados: 0 });
  dobles.avisosDeSlaPorTicket.mockResolvedValue(new Map());
});

it('no-superadmin: requireSuperadmin ya redirige (lo prueba guard.test.ts) — aquí sólo confirmamos que la página lo invoca antes de leer la cola', async () => {
  dobles.requireSuperadmin.mockRejectedValueOnce(new Error('REDIRECT:/dashboard'));
  await expect(SoportePage({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT:/dashboard');
  expect(dobles.getTicketsCruzados).not.toHaveBeenCalled();
});

it('una cola caída se dice — nunca se confunde con "nadie necesita nada"', async () => {
  dobles.getTicketsCruzados.mockRejectedValueOnce(new Error('caída'));
  const pagina = await SoportePage({ searchParams: Promise.resolve({}) });
  expect(formasConAviso(pagina)).toHaveLength(0);
});

it('responder: manda el userId de la SESIÓN, resuelve la flota del ticket por el form (no confía en un tenant suelto)', async () => {
  dobles.responderTicket.mockResolvedValue({ movioAEnProceso: true });
  const pagina = await paginaConTicketAbierto();
  const accion = accionDelBoton(pagina, /^Enviar$/);
  const r = await accion(null, fd({ ticket: 't-1', cuerpo: 'Ya lo revisamos', tenantId: 'OTRO' }));
  expect(dobles.resolverTicketCruzado).toHaveBeenCalledWith('t-1');
  expect(dobles.responderTicket).toHaveBeenCalledWith('t-1', 'tn-1', { tipo: 'likida', userId: 'u-1' }, { cuerpo: 'Ya lo revisamos', interna: false });
  expect(r).toEqual(expect.objectContaining({ ok: expect.stringContaining('en proceso') }));
});

it('responder con nota interna: NO cuenta como respuesta pública — el rótulo lo dice', async () => {
  dobles.responderTicket.mockResolvedValue({ movioAEnProceso: false });
  const pagina = await paginaConTicketAbierto();
  const accion = accionDelBoton(pagina, /^Enviar$/);
  const r = await accion(null, fd({ ticket: 't-1', cuerpo: 'nota', interna: '1' }));
  expect(dobles.responderTicket).toHaveBeenCalledWith('t-1', 'tn-1', expect.anything(), expect.objectContaining({ interna: true }));
  expect(r).toEqual(expect.objectContaining({ ok: expect.stringContaining('NO la ve') }));
});

it('un ticket que ya no existe: NO escribe a ciegas en el hilo de otro (falla cerrado, mensaje genérico porque flotaDelTicket lanza Error simple, no DatoInvalido)', async () => {
  const pagina = await paginaConTicketAbierto();
  const accion = accionDelBoton(pagina, /^Enviar$/);
  dobles.resolverTicketCruzado.mockResolvedValueOnce(null); // el POST llega DESPUÉS de que el ticket se borró
  const r = await accion(null, fd({ ticket: 't-borrado', cuerpo: 'x' }));
  expect(r).toEqual(expect.objectContaining({ error: expect.any(String) }));
  expect((r as { error: string }).error).not.toBe('');
  expect(dobles.responderTicket).not.toHaveBeenCalled();
});

it('tomar: manda el userId de la SESIÓN, id por el form', async () => {
  dobles.tomarTicket.mockResolvedValue({ estado: 'en_proceso' });
  const pagina = await paginaConTicketAbierto();
  const accion = accionDelBoton(pagina, /Tomar el ticket/);
  const r = await accion(null, fd({ ticket: 't-1' }));
  expect(dobles.tomarTicket).toHaveBeenCalledWith('t-1', 'tn-1', { tipo: 'likida', userId: 'u-1' });
  expect(r).toEqual(expect.objectContaining({ ok: expect.stringContaining('en_proceso') }));
});

it('cambiar estado: manda el userId de la SESIÓN; si la bitácora falló, lo DICE en vez de afirmar que sí quedó', async () => {
  dobles.cambiarEstadoTicket.mockResolvedValue({ estadoPrevio: 'abierto', estado: 'resuelto', anotado: false });
  const pagina = await paginaConTicketAbierto();
  const accion = accionDelBoton(pagina, /Cambiar estado/);
  const r = await accion(null, fd({ ticket: 't-1', estado: 'resuelto' }));
  expect(dobles.cambiarEstadoTicket).toHaveBeenCalledWith('t-1', 'tn-1', { tipo: 'likida', userId: 'u-1' }, 'resuelto');
  expect(r).toEqual(expect.objectContaining({ ok: expect.stringContaining('no se pudo escribir fue la entrada de bitácora') }));
});

// ── F7: SLA con consecuencia visible, reabrir y nota interna ────────────────

const FILA = (extra: Record<string, unknown> = {}) => ({
  id: 't-1', asunto: 'No puedo timbrar', categoria: 'fiscal', prioridad: 'alta', estado: 'abierto', abiertoEn: '2026-11-01T10:00:00Z', resueltoEn: null,
  venceEn: '2026-11-02T10:00:00Z', horasRestantes: -30, tenantId: 'tn-1', tenantNombre: 'Transportes ACME', asignadoA: null, asignadoNombre: null, ...extra,
});
async function html(sp: { ticket?: string } = {}) {
  const { renderToStaticMarkup } = await import('react-dom/server');
  return renderToStaticMarkup(await SoportePage({ searchParams: Promise.resolve(sp) }));
}

it('SLA vencido CON aviso registrado: la fila dice que se avisó al operador y cuándo', async () => {
  dobles.getTicketsCruzados.mockResolvedValue([FILA()]);
  dobles.avisosDeSlaPorTicket.mockResolvedValue(new Map([['t-1', '2026-11-03T16:00:00Z']]));
  const salida = await html();
  expect(salida).toContain('Vencido hace 30 h');
  expect(salida).toContain('Se avisó al operador');
  expect(dobles.avisosDeSlaPorTicket).toHaveBeenCalledWith(['t-1']);
});

it('SLA vencido SIN aviso registrado: lo dice, no afirma un aviso que no consta', async () => {
  dobles.getTicketsCruzados.mockResolvedValue([FILA()]);
  const salida = await html();
  expect(salida).toContain('Aún sin aviso al operador');
  expect(salida).not.toContain('Se avisó al operador');
});

it('si no se pudo leer el registro de avisos, dice «sin dato», no «sin aviso»', async () => {
  dobles.getTicketsCruzados.mockResolvedValue([FILA()]);
  dobles.avisosDeSlaPorTicket.mockResolvedValue(null);
  const salida = await html();
  expect(salida).toContain('Aviso al operador: sin dato');
  expect(salida).not.toContain('Aún sin aviso');
});

it('un ticket sin SLA pactado dice «sin SLA», nunca «vencido»; uno cerrado no pide aviso', async () => {
  dobles.getTicketsCruzados.mockResolvedValue([FILA({ id: 't-2', venceEn: null, horasRestantes: null }), FILA({ id: 't-3', estado: 'cerrado' })]);
  const salida = await html();
  expect(salida).toContain('Sin SLA pactado');
  expect(dobles.avisosDeSlaPorTicket).toHaveBeenCalledWith([]);
  expect(salida).not.toContain('Aún sin aviso');
});

it('un ticket cerrado ofrece REABRIR (y no responder): vuelve a «abierto» con la firma de la sesión y queda en bitácora', async () => {
  dobles.resolverTicketCruzado.mockResolvedValue({ id: 't-1', tenantId: 'tn-1', tenantNombre: 'Transportes ACME' });
  dobles.getTicketDelTenant.mockResolvedValue({ ...DETALLE, estado: 'cerrado' });
  dobles.getHilo.mockResolvedValue([]);
  const pagina = await SoportePage({ searchParams: Promise.resolve({ ticket: 't-1' }) });
  expect(formasConAviso(pagina).some((f) => /^Enviar$/.test(String(f.props.boton)))).toBe(false);
  const accion = accionDelBoton(pagina, /Reabrir el ticket/);
  dobles.cambiarEstadoTicket.mockResolvedValue({ estadoPrevio: 'cerrado', estado: 'abierto', anotado: true });
  const r = await accion(null, fd({ ticket: 't-1', estado: 'abierto' }));
  expect(dobles.cambiarEstadoTicket).toHaveBeenCalledWith('t-1', 'tn-1', { tipo: 'likida', userId: 'u-1' }, 'abierto');
  expect(r).toEqual(expect.objectContaining({ ok: expect.stringContaining('Quedó en la bitácora') }));
});

it('un ticket abierto NO ofrece reabrir; ofrece responder con nota interna que el cliente no ve', async () => {
  const pagina = await paginaConTicketAbierto();
  expect(formasConAviso(pagina).some((f) => /Reabrir/.test(String(f.props.boton)))).toBe(false);
  const salida = await html({ ticket: 't-1' });
  expect(salida).toContain('Nota interna: el cliente NO la ve');
});

it('el hilo pinta la nota interna distinta y con su rótulo', async () => {
  dobles.resolverTicketCruzado.mockResolvedValue({ id: 't-1', tenantId: 'tn-1', tenantNombre: 'Transportes ACME' });
  dobles.getTicketDelTenant.mockResolvedValue(DETALLE);
  dobles.getHilo.mockResolvedValue([
    { id: 'm1', cuerpo: 'Hola, ya lo vemos', interna: false, deLikida: true, autorNombre: 'Ana', creadoEn: '2026-11-02T10:00:00Z' },
    { id: 'm2', cuerpo: 'Revisar con fiscal', interna: true, deLikida: true, autorNombre: 'Ana', creadoEn: '2026-11-02T11:00:00Z' },
  ]);
  const salida = await html({ ticket: 't-1' });
  expect(salida).toContain('Revisar con fiscal');
  expect(salida).toContain('Nota interna: el cliente no la ve');
});

it('la pantalla no imprime claves internas (tablas ni columnas)', async () => {
  dobles.getTicketsCruzados.mockResolvedValue([FILA()]);
  const salida = await html();
  expect(salida).not.toMatch(/vence_en|ticket_mensaje|ticket_soporte|bitacora_auditoria/);
});

it('D11/D12 (auditoría 11-nov): una cola sin un solo ticket NO pinta cuatro ceros: un solo estado vacío dentro de una tarjeta', async () => {
  dobles.getTicketsCruzados.mockResolvedValue([]);
  const h = await html();
  expect(h).not.toContain('Con SLA vencido');
  expect(h).toMatch(/rv-tarjeta[\s\S]*La cola está vacía/);
});
