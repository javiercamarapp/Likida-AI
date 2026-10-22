import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// /admin/costos-facturacion — CERO cobertura de la PÁGINA (getResumenNegocio,
// transferencia.ts y suscripcion.ts ya tienen prueba propia). Tres server
// actions con dinero real: fijar el price de un plan, emitir una mensualidad
// y conciliar/timbrar un pago. La única lógica que vive AQUÍ (no en una lib)
// es el cálculo del periodo del mes en curso — el bug DAT-23 real (usaba
// getUTCMonth() y el 31-dic 18:01 hora MX ya era 1-ene en UTC).
// ═══════════════════════════════════════════════════════════════════════════

type Elemento = ReactElement<Record<string, unknown>>;

const dobles = vi.hoisted(() => ({
  requireSuperadmin: vi.fn(),
  getResumenNegocio: vi.fn(),
  getPlanes: vi.fn(),
  guardarPriceDePlan: vi.fn(),
  stripeConfigurado: vi.fn(),
  modoStripe: vi.fn(),
  webhookConfigurado: vi.fn(),
  datosBancarios: vi.fn(),
  emitirMensualidad: vi.fn(),
  conciliar: vi.fn(),
  timbrarFactura: vi.fn(),
  getPorCobrar: vi.fn(),
  facturapiConfigurado: vi.fn(),
  modoFacturapi: vi.fn(),
  revalidatePath: vi.fn(),
  hoyMx: vi.fn(),
}));

vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('next/cache', () => ({ revalidatePath: dobles.revalidatePath }));
vi.mock('@/lib/admin/negocio', () => ({ getResumenNegocio: dobles.getResumenNegocio }));
vi.mock('@/lib/saas/suscripcion', async (importar) => ({
  ...(await importar<typeof import('@/lib/saas/suscripcion')>()),
  getPlanes: dobles.getPlanes,
  guardarPriceDePlan: dobles.guardarPriceDePlan,
}));
vi.mock('@/lib/saas/stripe', () => ({
  stripeConfigurado: dobles.stripeConfigurado, modoStripe: dobles.modoStripe, webhookConfigurado: dobles.webhookConfigurado,
}));
vi.mock('@/lib/saas/transferencia', async (importar) => ({
  ...(await importar<typeof import('@/lib/saas/transferencia')>()),
  datosBancarios: dobles.datosBancarios,
  emitirMensualidad: dobles.emitirMensualidad,
  conciliar: dobles.conciliar,
  timbrarFactura: dobles.timbrarFactura,
  getPorCobrar: dobles.getPorCobrar,
}));
vi.mock('@/lib/saas/facturapi', () => ({ facturapiConfigurado: dobles.facturapiConfigurado, modoFacturapi: dobles.modoFacturapi }));
vi.mock('@/lib/formato', async (importar) => ({
  ...(await importar<typeof import('@/lib/formato')>()),
  hoyMx: dobles.hoyMx,
}));

import { FormaConAviso, type AccionDeForma } from '../ui/forma';
import { FormaEmitirMensualidad } from './forma-emitir';
import CostosFacturacionPage from './page';

type AccionEmitir = (previo: unknown, fd: FormData) => Promise<{ ok?: string; error?: string }>;

/** Recorre el árbol ya renderizado (sin montar DOM) y junta cada elemento
 *  cuyo `type` sea `componente` — así se extraen, de la página REAL, tanto
 *  las server actions cerradas por CLOSURE como las props que la página le
 *  pasó a cada formulario (mismo patrón que `mcp-clientes/page.test.tsx`). */
function buscarElementos(nodo: ReactNode, componente: unknown, salida: Elemento[] = []): Elemento[] {
  if (Array.isArray(nodo)) { for (const hijo of nodo) buscarElementos(hijo, componente, salida); return salida; }
  if (!isValidElement<Record<string, unknown>>(nodo)) return salida;
  if (nodo.type === componente) salida.push(nodo);
  buscarElementos(nodo.props.children as ReactNode, componente, salida);
  return salida;
}
function accionDelBoton(pagina: ReactNode, patron: RegExp) {
  const forma = buscarElementos(pagina, FormaConAviso).find((f) => patron.test(String(f.props.boton)));
  if (!forma) throw new Error(`No se encontró un FormaConAviso con botón que matchee ${patron}`);
  return forma.props.accion as (previo: unknown, fd: FormData) => Promise<{ ok?: string; error?: string }>;
}
/** "Emitir" dejó de ser un `FormaConAviso` de un clic (HALLAZGO MEDIO,
 *  auditoría adversarial) — ahora es `FormaEmitirMensualidad`, que SÍ exige
 *  confirmar en un diálogo antes de invocar la server action real. */
function accionEmitirDeLaPagina(pagina: ReactNode) {
  const [forma] = buscarElementos(pagina, FormaEmitirMensualidad);
  if (!forma) throw new Error('No se encontró FormaEmitirMensualidad en la página');
  return forma;
}

const fd = (campos: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(campos)) f.set(k, v); return f; };
const RESUMEN = { costoIaUsd: 100, viajesProcesados: 10, porDia: [], porFase: [], porModelo: [], flotas: [{ id: 'tn-1', nombre: 'ACME' }] };

beforeEach(() => {
  vi.clearAllMocks();
  dobles.requireSuperadmin.mockResolvedValue({ userId: 'u-1', tenantId: null, rol: 'superadmin' });
  dobles.getResumenNegocio.mockResolvedValue(RESUMEN);
  dobles.stripeConfigurado.mockReturnValue(true);
  dobles.modoStripe.mockReturnValue('produccion');
  dobles.webhookConfigurado.mockReturnValue(true);
  dobles.facturapiConfigurado.mockReturnValue(true);
  dobles.modoFacturapi.mockReturnValue('produccion');
  dobles.getPlanes.mockResolvedValue([]);
  dobles.datosBancarios.mockReturnValue(null);
  dobles.getPorCobrar.mockResolvedValue([]);
  dobles.hoyMx.mockReturnValue('2026-03-15');
});

it('accionPrecio: no-superadmin — requireSuperadmin ya redirige (guard.test.ts la prueba); confirmamos que se invoca antes de tocar Stripe', async () => {
  dobles.getPlanes.mockResolvedValue([{ clave: 'pro', nombre: 'Pro', precioMensual: null, precioIvaIncluido: null, stripePriceId: null }]);
  dobles.requireSuperadmin.mockRejectedValueOnce(new Error('REDIRECT:/dashboard'));
  const pagina = await CostosFacturacionPage();
  const accion = accionDelBoton(pagina, /Guardar price/);
  await expect(accion(null, fd({ plan: 'pro', price: 'price_1' }))).rejects.toThrow('REDIRECT:/dashboard');
  expect(dobles.guardarPriceDePlan).not.toHaveBeenCalled();
});

it('accionPrecio: lee el monto/IVA de Stripe (no se teclea) y avisa si tax_behavior es unspecified', async () => {
  dobles.getPlanes.mockResolvedValue([{ clave: 'pro', nombre: 'Pro', precioMensual: null, precioIvaIncluido: null, stripePriceId: null }]);
  dobles.guardarPriceDePlan.mockResolvedValue({ montoMensual: 2400, moneda: 'MXN', ivaIncluido: null });
  const pagina = await CostosFacturacionPage();
  const accion = accionDelBoton(pagina, /Guardar price/);
  const r = await accion(null, fd({ plan: 'pro', price: 'price_1abc' }));
  expect(dobles.guardarPriceDePlan).toHaveBeenCalledWith('pro', 'price_1abc');
  expect(r).toEqual(expect.objectContaining({ ok: expect.stringContaining('TODAVÍA NO SE PUEDE EMITIR') }));
});

it('accionPrecio: con IVA declarado, dice que ya se puede contratar', async () => {
  dobles.getPlanes.mockResolvedValue([{ clave: 'pro', nombre: 'Pro', precioMensual: null, precioIvaIncluido: null, stripePriceId: null }]);
  dobles.guardarPriceDePlan.mockResolvedValue({ montoMensual: 2400, moneda: 'MXN', ivaIncluido: true });
  const pagina = await CostosFacturacionPage();
  const accion = accionDelBoton(pagina, /Guardar price/);
  const r = await accion(null, fd({ plan: 'pro', price: 'price_1abc' }));
  expect(r).toEqual(expect.objectContaining({ ok: expect.stringContaining('Ya se puede contratar') }));
});

it('accionEmitir: sin flota elegida, error explícito y NO llama emitirMensualidad', async () => {
  const pagina = await CostosFacturacionPage();
  const accion = accionEmitirDeLaPagina(pagina).props.accion as AccionEmitir;
  const r = await accion(null, fd({ tenantId: '' }));
  expect(r).toEqual({ error: 'Elige una flota.' });
  expect(dobles.emitirMensualidad).not.toHaveBeenCalled();
});

it('accionEmitir: el periodo es el MES EN CURSO en hora de México, no UTC (regresión DAT-23: 31-dic 18:01 MX ya era 1-ene en UTC)', async () => {
  dobles.hoyMx.mockReturnValue('2026-12-31'); // 31 de diciembre en México
  dobles.emitirMensualidad.mockResolvedValue({ monto: 2784, subtotal: 2400, iva: 384, referencia: 'REF-1' });
  const pagina = await CostosFacturacionPage();
  const accion = accionEmitirDeLaPagina(pagina).props.accion as AccionEmitir;
  await accion(null, fd({ tenantId: 'tn-1' }));
  // Debe emitir DICIEMBRE (2026-12-01 al 2026-12-31), nunca enero.
  expect(dobles.emitirMensualidad).toHaveBeenCalledWith('tn-1', '2026-12-01', '2026-12-31');
});

it('accionEmitir: dice las TRES cifras (total, base, IVA) y la referencia — verlas juntas es lo que deja cachar un IVA mal puesto', async () => {
  dobles.emitirMensualidad.mockResolvedValue({ monto: 2784, subtotal: 2400, iva: 384, referencia: 'REF-1' });
  const pagina = await CostosFacturacionPage();
  const accion = accionEmitirDeLaPagina(pagina).props.accion as AccionEmitir;
  const r = await accion(null, fd({ tenantId: 'tn-1' }));
  expect(r.ok).toContain('REF-1');
  expect(dobles.revalidatePath).toHaveBeenCalledWith('/admin/costos-facturacion');
  expect(dobles.revalidatePath).toHaveBeenCalledWith('/dashboard/suscripcion');
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA ADVERSARIAL, HALLAZGO MEDIO: "Emitir" era un `FormaConAviso` de un
// solo clic — sin diálogo — que disparaba `emitirMensualidad` (acción fiscal
// real, constraint de unicidad por periodo en la base) de inmediato. Ahora es
// `FormaEmitirMensualidad` (BotonConfirmar/DialogoConfirmar, tono="peligro",
// mismo molde que `FormaRechazarCliente` del PR #583). Estas tres pruebas son
// la INTEGRACIÓN: que la página de verdad use ESE componente (no el de un
// clic), que le pase el periodo REAL calculado por `periodoMesActualMx`, y
// que la server action cerrada por CLOSURE sea la que de verdad emite cuando
// se confirma.
// ═══════════════════════════════════════════════════════════════════════════

it('INTEGRACIÓN — "Emitir" de la página real es FormaEmitirMensualidad (confirmación), NUNCA FormaConAviso (un solo clic)', async () => {
  const pagina = await CostosFacturacionPage();
  expect(buscarElementos(pagina, FormaEmitirMensualidad)).toHaveLength(1);
  // Si alguien revirtiera el arreglo reintroduciendo el de un clic, ningún
  // FormaConAviso con botón "Emitir" debe volver a existir.
  expect(buscarElementos(pagina, FormaConAviso).some((f) => f.props.boton === 'Emitir')).toBe(false);
});

it('INTEGRACIÓN — el botón "Emitir" abre el diálogo de confirmación en vez de ejecutar directo, con el periodo REAL y las flotas reales', async () => {
  dobles.hoyMx.mockReturnValue('2026-10-15');
  const pagina = await CostosFacturacionPage();
  const forma = accionEmitirDeLaPagina(pagina);
  expect(forma.props.periodoIni).toBe('2026-10-01');
  expect(forma.props.periodoFin).toBe('2026-10-31');
  expect(forma.props.flotas).toEqual([{ id: 'tn-1', nombre: 'ACME' }]);

  // Se vuelve a renderizar EL MISMO componente con las props REALES que la
  // página le pasó, para comprobar su marcado: el disparador visible es
  // type="button" (no envía nada por sí solo) y lo que SÍ envía vive DENTRO
  // del <dialog>, cerrado por omisión.
  const html = renderToStaticMarkup(
    <FormaEmitirMensualidad
      accion={forma.props.accion as AccionDeForma}
      flotas={forma.props.flotas as Array<{ id: string; nombre: string }>}
      periodoIni={forma.props.periodoIni as string}
      periodoFin={forma.props.periodoFin as string}
    />,
  );
  expect(html).toMatch(/<button type="button"[^>]*>Emitir<\/button>/);
  expect(html).toContain('<dialog');
  expect(html).not.toMatch(/<dialog[^>]*\sopen/);
});

it('INTEGRACIÓN — confirmar en el diálogo (el type="submit" real) SÍ emite la mensualidad', async () => {
  dobles.emitirMensualidad.mockResolvedValue({ monto: 2784, subtotal: 2400, iva: 384, referencia: 'REF-1' });
  const pagina = await CostosFacturacionPage();
  const forma = accionEmitirDeLaPagina(pagina);
  const accion = forma.props.accion as AccionEmitir;

  // El botón "Sí, emitir mensualidad" es type="submit": confirmarlo envía
  // EXACTAMENTE este formulario a esta action. Invocarla aquí simula ESE
  // envío, no un clic cualquiera sobre el disparador.
  const r = await accion(null, fd({ tenantId: 'tn-1' }));
  expect(dobles.emitirMensualidad).toHaveBeenCalledWith('tn-1', expect.any(String), expect.any(String));
  expect(r.ok).toContain('REF-1');
});

it('INTEGRACIÓN — cancelar NO ejecuta: el botón Cancelar es type="button" y no hay otra vía al formulario que emite', () => {
  const html = renderToStaticMarkup(
    <FormaEmitirMensualidad accion={async () => null} flotas={[{ id: 'tn-1', nombre: 'ACME' }]} periodoIni="2026-10-01" periodoFin="2026-10-31" />,
  );
  // Cancelar es type="button": no hay <form> que envíe al cancelar, así que
  // no hay manera de que ese clic llegue a invocar `emitirMensualidad`.
  expect(html).toMatch(/<button type="button"[^>]*>Cancelar<\/button>/);
  expect(dobles.emitirMensualidad).not.toHaveBeenCalled();
});

it('accionConciliar: manda el userId de la SESIÓN al conciliar, y timbra DESPUÉS con su propio try', async () => {
  dobles.getPorCobrar.mockResolvedValue([{ id: 'f-1', tenantNombre: 'ACME', periodoInicio: '2026-01-01', periodoFin: '2026-01-31', referencia: 'R', monto: 2784, subtotal: 2400, iva: 384 }]);
  dobles.conciliar.mockResolvedValue(undefined);
  dobles.timbrarFactura.mockResolvedValue({ uuid: 'uuid-real-12345678' });
  const pagina = await CostosFacturacionPage();
  const accion = accionDelBoton(pagina, /Marcar pagada/);
  const r = await accion(null, fd({ facturaId: 'f-1', referenciaBanco: 'MOV-999' }));
  expect(dobles.conciliar).toHaveBeenCalledWith('f-1', 'MOV-999', 'u-1');
  expect(r.ok).toContain('CFDI timbrado: uuid-rea…');
});

it('accionConciliar: un PAC caído NO deshace el pago ya registrado — se dice por separado', async () => {
  dobles.getPorCobrar.mockResolvedValue([{ id: 'f-1', tenantNombre: 'ACME', periodoInicio: '2026-01-01', periodoFin: '2026-01-31', referencia: 'R', monto: 2784, subtotal: 2400, iva: 384 }]);
  dobles.conciliar.mockResolvedValue(undefined);
  dobles.timbrarFactura.mockRejectedValue(new Error('PAC caído'));
  const pagina = await CostosFacturacionPage();
  const accion = accionDelBoton(pagina, /Marcar pagada/);
  const r = await accion(null, fd({ facturaId: 'f-1', referenciaBanco: 'MOV-999' }));
  expect(r.ok).toContain('Factura marcada como pagada');
  expect(r.ok).toContain('NO se timbró');
});

it('un "por cobrar" caído se DICE — nunca se confunde con "nada pendiente"', async () => {
  dobles.getPorCobrar.mockRejectedValueOnce(new Error('caída'));
  const html = renderToStaticMarkup(await CostosFacturacionPage());
  expect(html).toContain('No se pudo leer lo que está por cobrarse');
  expect(html).not.toContain('Nada pendiente de cobro');
});
