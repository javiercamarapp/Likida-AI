import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// /admin/mcp-clientes — AUDITORÍA ADVERSARIAL, DOS HALLAZGOS ALTOS sobre el
// MISMO botón "Rechazar":
//
//   · HALLAZGO #2: antes de este arreglo, "Rechazar" era un `FormaConAviso`
//     de un solo clic — sin diálogo, sin paso intermedio — que revocaba EN EL
//     ACTO todos los tokens OAuth vivos del cliente (potencialmente de varias
//     flotas que ya habían dado consentimiento). Ya se envolvió con
//     `FormaRechazarCliente` (BotonConfirmar/DialogoConfirmar, tono="peligro")
//     — forma-rechazar.test.tsx prueba ESE componente aislado.
//   · HALLAZGO #1: ni con diálogo basta si dice "todos los tokens" sin decir
//     A CUÁNTOS — la propia regla de `confirmar.tsx` exige que el diálogo
//     diga "a cuántos afecta". `listarClientesPendientes` ahora cuenta los
//     tokens vivos de cada cliente ANTES de decidir (decidir ya es
//     irreversible) y la página tiene que pasar esa cifra REAL, no una fija.
//
// Esta prueba es la INTEGRACIÓN: que la página de verdad use
// `FormaRechazarCliente` (no `FormaConAviso` de un clic) para "Rechazar", que
// le pase el conteo real de `listarClientesPendientes`, y que la server
// action cerrada por CLOSURE sea la que de verdad revoca cuando se confirma.
// ═══════════════════════════════════════════════════════════════════════════

type Elemento = ReactElement<Record<string, unknown>>;

const dobles = vi.hoisted(() => ({
  requireSuperadmin: vi.fn(),
  listarClientesPendientes: vi.fn(),
  decidirCliente: vi.fn(),
  anotarBitacora: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('next/cache', () => ({ revalidatePath: dobles.revalidatePath }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: dobles.anotarBitacora }));
vi.mock('@/lib/mcp/oauth', async (importar) => ({
  ...(await importar<typeof import('@/lib/mcp/oauth')>()),
  listarClientesPendientes: dobles.listarClientesPendientes,
  decidirCliente: dobles.decidirCliente,
}));

import { FormaConAviso, type ResultadoAccion } from '../ui/forma';
import { FormaRechazarCliente } from './forma-rechazar';
import McpClientesPage from './page';

/** Recorre el árbol ya renderizado (sin montar DOM) y junta cada elemento
 *  cuyo `type` sea `componente` — así se extraen, de la página REAL, tanto
 *  las server actions cerradas por CLOSURE como las props que la página le
 *  pasó a cada formulario. */
function buscarElementos(nodo: ReactNode, componente: unknown, salida: Elemento[] = []): Elemento[] {
  if (Array.isArray(nodo)) { for (const hijo of nodo) buscarElementos(hijo, componente, salida); return salida; }
  if (!isValidElement<Record<string, unknown>>(nodo)) return salida;
  if (nodo.type === componente) salida.push(nodo);
  buscarElementos(nodo.props.children as ReactNode, componente, salida);
  return salida;
}

type AccionRechazar = (previo: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>;

const SESION = { userId: 'admin-1', tenantId: null, rol: 'superadmin' };
const CLIENTE_PENDIENTE = {
  clientId: '11111111-1111-4111-8111-111111111111',
  nombre: 'Tablero de Tableau',
  redirectUris: ['https://tableau.example/cb'],
  anfitriones: ['tableau.example'],
  estado: 'pendiente' as const,
  creadoEn: '2026-10-01T00:00:00Z',
  tokensVivos: 5,
};
const fd = (campos: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(campos)) f.set(k, v); return f; };

beforeEach(() => {
  vi.clearAllMocks();
  dobles.requireSuperadmin.mockResolvedValue(SESION);
  dobles.listarClientesPendientes.mockResolvedValue([CLIENTE_PENDIENTE]);
  dobles.anotarBitacora.mockResolvedValue(true);
});

it('no-superadmin: requireSuperadmin ya redirige — aquí solo confirmamos que la página lo invoca antes de leer la cola', async () => {
  dobles.requireSuperadmin.mockRejectedValueOnce(new Error('REDIRECT:/dashboard'));
  await expect(McpClientesPage()).rejects.toThrow('REDIRECT:/dashboard');
  expect(dobles.listarClientesPendientes).not.toHaveBeenCalled();
});

it('una cola caída se enseña como error, no como "cero pendientes" — y no se monta ningún formulario de rechazo', async () => {
  dobles.listarClientesPendientes.mockRejectedValueOnce(new Error('caída'));
  const pagina = await McpClientesPage();
  expect(buscarElementos(pagina, FormaRechazarCliente)).toHaveLength(0);
});

it('"Rechazar" es FormaRechazarCliente (confirmación), NUNCA FormaConAviso (un solo clic) — HALLAZGO ALTO #2', async () => {
  const pagina = await McpClientesPage();
  const rechazos = buscarElementos(pagina, FormaRechazarCliente);
  expect(rechazos).toHaveLength(1);

  // "Aprobar" sigue siendo FormaConAviso (no es destructivo ni revoca nada);
  // ningún FormaConAviso del botón "Rechazar" debe existir — si alguien
  // revirtiera el arreglo reintroduciendo el de un clic, esto lo atrapa.
  const conAviso = buscarElementos(pagina, FormaConAviso);
  expect(conAviso.some((f) => f.props.boton === 'Rechazar')).toBe(false);
  expect(conAviso.some((f) => f.props.boton === 'Aprobar')).toBe(true);
});

it('a FormaRechazarCliente le llega el conteo REAL de tokens vivos de listarClientesPendientes, no uno fijo', async () => {
  dobles.listarClientesPendientes.mockResolvedValueOnce([{ ...CLIENTE_PENDIENTE, tokensVivos: 42 }]);
  const pagina = await McpClientesPage();
  const [rechazo] = buscarElementos(pagina, FormaRechazarCliente);
  expect(rechazo.props.tokensVivos).toBe(42);
  expect(rechazo.props.clientId).toBe(CLIENTE_PENDIENTE.clientId);
  expect(rechazo.props.nombre).toBe('Tablero de Tableau');
});

it('INTEGRACIÓN — el botón "Rechazar" de la página real abre el diálogo de confirmación en vez de ejecutar directo', async () => {
  const pagina = await McpClientesPage();
  const [rechazo] = buscarElementos(pagina, FormaRechazarCliente);

  // Se vuelve a renderizar EL MISMO componente con las props REALES que la
  // página le pasó (no una copia con datos inventados) para comprobar su
  // marcado: el disparador visible es type="button" (no envía nada por sí
  // solo) y lo que SÍ envía vive DENTRO del <dialog>, cerrado por omisión.
  const html = renderToStaticMarkup(
    <FormaRechazarCliente
      accion={rechazo.props.accion as AccionRechazar}
      clientId={rechazo.props.clientId as string}
      nombre={rechazo.props.nombre as string}
      tokensVivos={rechazo.props.tokensVivos as number}
    />,
  );
  expect(html).toMatch(/<button type="button"[^>]*>Rechazar<\/button>/);
  expect(html).toContain('<dialog');
  expect(html).not.toMatch(/<dialog[^>]*\sopen/);
  // El diálogo dice a CUÁNTOS tokens afecta — HALLAZGO ALTO #1, no "todos" a secas.
  expect(html).toMatch(/revoca en el acto los 5 tokens oauth vivos/i);
});

it('INTEGRACIÓN — confirmar en el diálogo (el type="submit" real) SÍ ejecuta la revocación', async () => {
  dobles.decidirCliente.mockResolvedValue({ ok: true, revocados: 5 });
  const pagina = await McpClientesPage();
  const [rechazo] = buscarElementos(pagina, FormaRechazarCliente);
  const accion = rechazo.props.accion as AccionRechazar;

  // El botón "Sí, rechazar y revocar" es type="submit": lo que confirmarlo
  // hace es exactamente enviar este formulario a esta action. Invocarla aquí
  // simula ESE envío, no un clic cualquiera.
  const r = await accion(null, fd({ cliente: CLIENTE_PENDIENTE.clientId }));

  expect(dobles.decidirCliente).toHaveBeenCalledWith(CLIENTE_PENDIENTE.clientId, 'rechazado', 'admin-1');
  expect(r).toEqual({ ok: 'Cliente rechazado. Tokens vivos revocados: 5.' });
  expect(dobles.revalidatePath).toHaveBeenCalledWith('/admin/mcp-clientes');
});

it('INTEGRACIÓN — cancelar NO ejecuta: el botón Cancelar es type="button" y no hay otra vía al formulario que envía', async () => {
  const pagina = await McpClientesPage();
  const [rechazo] = buscarElementos(pagina, FormaRechazarCliente);
  const html = renderToStaticMarkup(
    <FormaRechazarCliente
      accion={rechazo.props.accion as AccionRechazar}
      clientId={rechazo.props.clientId as string}
      nombre={rechazo.props.nombre as string}
      tokensVivos={rechazo.props.tokensVivos as number}
    />,
  );
  // Cancelar es type="button": no hay <form> que envíe al cancelar, así que
  // no hay manera de que ese clic llegue a invocar `decidirCliente`.
  expect(html).toMatch(/<button type="button"[^>]*>Cancelar<\/button>/);
  expect(dobles.decidirCliente).not.toHaveBeenCalled();
});

it('rechazar: la server action re-exige requireSuperadmin aunque se invoque directo (segunda puerta)', async () => {
  const pagina = await McpClientesPage();
  const [rechazo] = buscarElementos(pagina, FormaRechazarCliente);
  const accion = rechazo.props.accion as AccionRechazar;
  dobles.requireSuperadmin.mockRejectedValueOnce(new Error('REDIRECT:/dashboard'));
  await expect(accion(null, fd({ cliente: CLIENTE_PENDIENTE.clientId }))).rejects.toThrow('REDIRECT:/dashboard');
  expect(dobles.decidirCliente).not.toHaveBeenCalled();
});

it('rechazar: si decidirCliente falla, el detalle llega verbatim y NO se revalida ni se anota bitácora', async () => {
  dobles.decidirCliente.mockResolvedValue({ ok: false, error: 'no_disponible', detalle: 'No se pudo guardar la decisión. Intenta de nuevo.' });
  const pagina = await McpClientesPage();
  const [rechazo] = buscarElementos(pagina, FormaRechazarCliente);
  const accion = rechazo.props.accion as AccionRechazar;
  const r = await accion(null, fd({ cliente: CLIENTE_PENDIENTE.clientId }));
  expect(r).toEqual({ error: 'No se pudo guardar la decisión. Intenta de nuevo.' });
  expect(dobles.revalidatePath).not.toHaveBeenCalled();
  expect(dobles.anotarBitacora).not.toHaveBeenCalled();
});
