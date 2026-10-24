import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// /admin/aprobaciones — AUDITORÍA ADVERSARIAL, HALLAZGO MEDIO sobre
// `FormaEnvio` ("Enviar por correo"): mandaba un correo REAL a un prospecto
// externo vía Resend con un solo clic, sin diálogo. `forma-pieza.test.tsx`
// prueba ESE componente aislado (botón type="button", diálogo con el correo
// exacto, confirmar type="submit"). Esta prueba es la INTEGRACIÓN: que la
// server action cerrada por CLOSURE (`accionEnviar`, definida dentro de
// `PaginaAprobaciones`) sea la que de verdad manda el correo cuando se
// confirma — mismo patrón que `mcp-clientes/page.test.tsx` (PR #583) usa para
// `FormaRechazarCliente`.
//
// No se re-prueba aquí el resto de la página (las cinco lecturas en paralelo,
// "Aprobar"/"Rechazar" de `FormaPieza`): esa cobertura no cambió con este
// arreglo y no tiene prueba previa que mantener en sincronía.
// ═══════════════════════════════════════════════════════════════════════════

type Elemento = ReactElement<Record<string, unknown>>;
type AccionEnviar = (previo: unknown, fd: FormData) => Promise<{ ok?: string; error?: string }>;

const dobles = vi.hoisted(() => ({
  requireSuperadmin: vi.fn(),
  bandejaPendiente: vi.fn(),
  aprobadasSinEnviar: vi.fn(),
  ultimasResueltas: vi.fn(),
  rebotesRecientes: vi.fn(),
  correosSuprimidos: vi.fn(),
  aprobarPieza: vi.fn(),
  rechazarPieza: vi.fn(),
  enviarPiezaPorCorreo: vi.fn(),
  liberarEnvioAmbiguo: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('next/cache', () => ({ revalidatePath: dobles.revalidatePath }));
vi.mock('@/lib/likida/agentes/cola', async (importar) => ({
  ...(await importar<typeof import('@/lib/likida/agentes/cola')>()),
  bandejaPendiente: dobles.bandejaPendiente,
  aprobadasSinEnviar: dobles.aprobadasSinEnviar,
  ultimasResueltas: dobles.ultimasResueltas,
  rebotesRecientes: dobles.rebotesRecientes,
  correosSuprimidos: dobles.correosSuprimidos,
  aprobarPieza: dobles.aprobarPieza,
  rechazarPieza: dobles.rechazarPieza,
  enviarPiezaPorCorreo: dobles.enviarPiezaPorCorreo,
  liberarEnvioAmbiguo: dobles.liberarEnvioAmbiguo,
}));

import { FormaEnvio, FormaLiberarAmbiguo, FormaPieza } from './forma-pieza';
import PaginaAprobaciones from './page';

/** Recorre el árbol ya renderizado (sin montar DOM) y junta cada elemento
 *  cuyo `type` sea `componente` — mismo patrón que `mcp-clientes/page.test.tsx`. */
function buscarElementos(nodo: ReactNode, componente: unknown, salida: Elemento[] = []): Elemento[] {
  if (Array.isArray(nodo)) { for (const hijo of nodo) buscarElementos(hijo, componente, salida); return salida; }
  if (!isValidElement<Record<string, unknown>>(nodo)) return salida;
  if (nodo.type === componente) salida.push(nodo);
  buscarElementos(nodo.props.children as ReactNode, componente, salida);
  return salida;
}

const PIEZA_POR_ENVIAR = {
  id: 'pz-1', tipo: 'correo_frio', prioridad: 'normal', agente: 'redactor',
  tenantId: null, prospectoId: 'pr-1', prospectoEmpresa: 'Transportes X', prospectoCorreo: 'contacto@x.mx',
  titulo: 'Correo día 0', cuerpo: 'x', fuentes: null, estado: 'aprobado',
  cuerpoFinal: null, motivoRechazo: null, enviadoEn: null,
  providerMessageId: null, envioError: null,
  entregaEstado: null, entregaEventoEn: null,
  resueltoPorEmail: null, creadoEn: '2026-08-19T00:00:00Z',
};

const fd = (campos: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(campos)) f.set(k, v); return f; };

beforeEach(() => {
  vi.clearAllMocks();
  dobles.requireSuperadmin.mockResolvedValue({ userId: 'admin-1', tenantId: null, rol: 'superadmin' });
  dobles.bandejaPendiente.mockResolvedValue([]);
  dobles.aprobadasSinEnviar.mockResolvedValue([PIEZA_POR_ENVIAR]);
  dobles.ultimasResueltas.mockResolvedValue([]);
  dobles.rebotesRecientes.mockResolvedValue([]);
  dobles.correosSuprimidos.mockResolvedValue([]);
});

it('INTEGRACIÓN — "Enviar por correo" de la página real pasa por FormaEnvio, y confirmar (el type="submit" real) SÍ manda el correo', async () => {
  dobles.enviarPiezaPorCorreo.mockResolvedValue({ ok: true, destinatario: 'contacto@x.mx', providerId: 'resend-1' });
  const pagina = await PaginaAprobaciones();
  const [forma] = buscarElementos(pagina, FormaEnvio);
  expect(forma).toBeDefined();
  expect((forma.props.pieza as { id: string }).id).toBe('pz-1');

  const accion = forma.props.accion as AccionEnviar;
  // El botón "Sí, enviar" (dentro del <dialog>) es type="submit": confirmarlo
  // envía EXACTAMENTE este formulario a esta action. Invocarla aquí simula
  // ESE envío real, no un clic cualquiera sobre el disparador.
  const r = await accion(null, fd({ pieza: 'pz-1' }));
  expect(dobles.enviarPiezaPorCorreo).toHaveBeenCalledWith('pz-1', 'admin-1');
  expect(r.ok).toContain('contacto@x.mx');
  expect(dobles.revalidatePath).toHaveBeenCalledWith('/admin/aprobaciones');
});

it('INTEGRACIÓN — re-exige requireSuperadmin aunque la action se invoque directo (segunda puerta)', async () => {
  const pagina = await PaginaAprobaciones();
  const [forma] = buscarElementos(pagina, FormaEnvio);
  const accion = forma.props.accion as AccionEnviar;
  dobles.requireSuperadmin.mockRejectedValueOnce(new Error('REDIRECT:/dashboard'));
  await expect(accion(null, fd({ pieza: 'pz-1' }))).rejects.toThrow('REDIRECT:/dashboard');
  expect(dobles.enviarPiezaPorCorreo).not.toHaveBeenCalled();
});

it('INTEGRACIÓN — si enviarPiezaPorCorreo falla, el detalle llega verbatim y NO se revalida', async () => {
  dobles.enviarPiezaPorCorreo.mockRejectedValue(new Error('Solo una pieza APROBADA y aún no enviada se puede enviar'));
  const pagina = await PaginaAprobaciones();
  const [forma] = buscarElementos(pagina, FormaEnvio);
  const accion = forma.props.accion as AccionEnviar;
  const r = await accion(null, fd({ pieza: 'pz-1' }));
  expect(r.error).toBeTruthy();
  expect(dobles.revalidatePath).not.toHaveBeenCalled();
});

// A36-R11-01: envío ambiguo (timeout) — la pantalla muestra el motivo y ofrece la salida.
const AMBIGUA = {
  ...PIEZA_POR_ENVIAR, id: 'pz-9', enviadoEn: '2026-10-20T10:00:00Z', providerMessageId: null,
  envioError: 'AMBIGUO: el proveedor no contestó a tiempo (timeout) — el correo PUDO haber salido. Verificar en Resend antes de cualquier reenvío.',
};

it('A36-R11-01 — una pieza ambigua en «Últimas resueltas» muestra su motivo y el botón de liberar; la acción la libera con el actor', async () => {
  dobles.aprobadasSinEnviar.mockResolvedValue([]);
  dobles.ultimasResueltas.mockResolvedValue([AMBIGUA]);
  dobles.liberarEnvioAmbiguo.mockResolvedValue({ reservaLiberada: true });
  const pagina = await PaginaAprobaciones();
  const [forma] = buscarElementos(pagina, FormaLiberarAmbiguo);
  expect(forma).toBeDefined();
  expect(JSON.stringify(pagina)).toContain('Verificar en Resend');
  const r = await (forma.props.accion as AccionEnviar)(null, fd({ pieza: 'pz-9' }));
  expect(dobles.liberarEnvioAmbiguo).toHaveBeenCalledWith('pz-9', 'admin-1');
  expect(r.ok).toBeTruthy();
  expect(dobles.revalidatePath).toHaveBeenCalledWith('/admin/aprobaciones');
});

it('A36-R11-01 — la reserva de cadencia no borrada se DICE en la respuesta', async () => {
  dobles.aprobadasSinEnviar.mockResolvedValue([]);
  dobles.ultimasResueltas.mockResolvedValue([AMBIGUA]);
  dobles.liberarEnvioAmbiguo.mockResolvedValue({ reservaLiberada: false });
  const pagina = await PaginaAprobaciones();
  const [forma] = buscarElementos(pagina, FormaLiberarAmbiguo);
  const r = await (forma.props.accion as AccionEnviar)(null, fd({ pieza: 'pz-9' }));
  expect(r.ok).toMatch(/48 h/);
});

it('A36-R11-01 — una pieza enviada con prueba del proveedor NO ofrece liberar', async () => {
  dobles.aprobadasSinEnviar.mockResolvedValue([]);
  dobles.ultimasResueltas.mockResolvedValue([{ ...AMBIGUA, providerMessageId: 're_1' }]);
  const pagina = await PaginaAprobaciones();
  expect(buscarElementos(pagina, FormaLiberarAmbiguo)).toHaveLength(0);
});

// A37-S05-08
it('A37-S05-08 — «Aprobar con mi edición» con el cuerpo vaciado NO aprueba el borrador original', async () => {
  dobles.bandejaPendiente.mockResolvedValue([{ ...PIEZA_POR_ENVIAR, estado: 'pendiente' }]);
  const pagina = await PaginaAprobaciones();
  const [forma] = buscarElementos(pagina, FormaPieza);
  const accion = forma.props.accion as AccionEnviar;
  const r = await accion(null, fd({ pieza: 'pz-1', operacion: 'aprobar', cuerpoEditado: '   ' }));
  expect(r.error).toMatch(/vacío/);
  expect(dobles.aprobarPieza).not.toHaveBeenCalled();
  // sin modo edición el campo no viaja: «Aprobar tal cual» sigue funcionando
  dobles.aprobarPieza.mockResolvedValue(undefined);
  const ok = await accion(null, fd({ pieza: 'pz-1', operacion: 'aprobar' }));
  expect(ok.ok).toMatch(/tal cual/);
  expect(dobles.aprobarPieza).toHaveBeenCalledWith('pz-1', 'admin-1', undefined);
});
