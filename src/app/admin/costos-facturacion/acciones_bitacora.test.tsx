import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// Las tres acciones que más dinero mueven de /admin (guardar el price de un plan, emitir la mensualidad, conciliar un pago) dejaban
// como única huella `conciliada_por` en la fila: la bitácora de auditoría no tenía ni una entrada `plan.price_guardado`,
// `mensualidad.emitida` ni `pago.conciliado` (FUNC-DINERO). Estas pruebas fijan: (1) el asiento con el actor y la flota correctos,
// (2) que sin segundo factor NO se ejecuta nada y NO se asienta nada, (3) que si la bitácora no pudo escribir se DICE, sin deshacer
// ni esconder el acto. El comportamiento de negocio (montos, periodo, timbrado) lo siguen probando `page.test.tsx` y compañía.
// ═══════════════════════════════════════════════════════════════════════════

type Elemento = ReactElement<Record<string, unknown>>;
type Accion = (previo: unknown, fd: FormData) => Promise<{ ok?: string; error?: string }>;

const dobles = vi.hoisted(() => ({
  requireSuperadmin: vi.fn(),
  pasoExtra: vi.fn(),
  anotar: vi.fn(),
  getResumenNegocio: vi.fn(),
  getPlanes: vi.fn(),
  guardarPriceDePlan: vi.fn(),
  emitirMensualidad: vi.fn(),
  conciliar: vi.fn(),
  timbrarFactura: vi.fn(),
  tenantDeFactura: vi.fn(),
  getPorCobrarTodas: vi.fn(),
}));

vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/admin/negocio', () => ({ getResumenNegocio: dobles.getResumenNegocio }));
vi.mock('@/lib/admin/acciones_riesgo', async (importar) => ({
  ...(await importar<typeof import('@/lib/admin/acciones_riesgo')>()),
  pasoExtraSuperadmin: dobles.pasoExtra,
  anotarAccionAdmin: dobles.anotar,
}));
vi.mock('@/lib/saas/suscripcion', async (importar) => ({
  ...(await importar<typeof import('@/lib/saas/suscripcion')>()),
  getPlanes: dobles.getPlanes,
  guardarPriceDePlan: dobles.guardarPriceDePlan,
  listarSuscripcionesVivas: async () => [],
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('@/lib/saas/stripe', () => ({ stripeConfigurado: () => true, modoStripe: () => 'produccion', webhookConfigurado: () => true }));
vi.mock('@/lib/saas/transferencia', async (importar) => ({
  ...(await importar<typeof import('@/lib/saas/transferencia')>()),
  datosBancarios: () => null,
  emitirMensualidad: dobles.emitirMensualidad,
  conciliar: dobles.conciliar,
  timbrarFactura: dobles.timbrarFactura,
  tenantDeFacturaSaas: dobles.tenantDeFactura,
  getPorCobrarTodas: dobles.getPorCobrarTodas,
}));
vi.mock('@/lib/saas/facturapi', () => ({ facturapiConfigurado: () => true, modoFacturapi: () => 'produccion' }));
vi.mock('@/lib/formato', async (importar) => ({
  ...(await importar<typeof import('@/lib/formato')>()),
  hoyMx: () => '2026-03-15',
}));

import { FormaConAviso } from '../ui/forma';
import { FormaEmitirMensualidad } from './forma-emitir';
import CostosFacturacionPage from './page';

function buscar(nodo: ReactNode, componente: unknown, salida: Elemento[] = []): Elemento[] {
  if (Array.isArray(nodo)) { for (const h of nodo) buscar(h, componente, salida); return salida; }
  if (!isValidElement<Record<string, unknown>>(nodo)) return salida;
  if (nodo.type === componente) salida.push(nodo);
  buscar(nodo.props.children as ReactNode, componente, salida);
  return salida;
}
const fd = (c: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(c)) f.set(k, v); return f; };

let pagina: ReactNode;
const accionDe = (patron: RegExp): Accion => {
  const f = buscar(pagina, FormaConAviso).find((x) => patron.test(String(x.props.boton)));
  if (!f) throw new Error(`sin forma ${patron}`);
  return f.props.accion as Accion;
};
const accionEmitir = (): Accion => (buscar(pagina, FormaEmitirMensualidad)[0].props.accion as Accion);

beforeEach(async () => {
  vi.clearAllMocks();
  dobles.requireSuperadmin.mockResolvedValue({ userId: 'u-1', tenantId: null, rol: 'superadmin' });
  dobles.pasoExtra.mockResolvedValue(null);
  dobles.anotar.mockResolvedValue(true);
  dobles.getResumenNegocio.mockResolvedValue({ costoIaUsd: 1, viajesProcesados: 1, porDia: [], porFase: [], porModelo: [], flotas: [{ id: 'tn-1', nombre: 'ACME' }] });
  dobles.getPlanes.mockResolvedValue([{ clave: 'pro', nombre: 'Pro', precioMensual: 1000, moneda: 'MXN', precioIvaIncluido: false, stripePriceId: 'price_1', limiteViajesMes: null, limiteOperadores: null, orden: 1 }]);
  dobles.getPorCobrarTodas.mockResolvedValue({
    facturas: [{ id: 'f-1', tenantId: 'tn-1', tenantNombre: 'ACME', periodoInicio: '2026-03-01', periodoFin: '2026-03-31', monto: 1160, subtotal: 1000, iva: 160, moneda: 'MXN', estado: 'pendiente', referencia: 'REF', cfdiUuid: null }],
    total: 1160,
  });
  dobles.guardarPriceDePlan.mockResolvedValue({ montoMensual: 1000, moneda: 'MXN', ivaIncluido: false });
  dobles.emitirMensualidad.mockResolvedValue({ id: 'fs-9', referencia: 'REF-9', monto: 1160, subtotal: 1000, iva: 160 });
  dobles.conciliar.mockResolvedValue(undefined);
  dobles.timbrarFactura.mockResolvedValue({ uuid: 'abcdef12-0000' });
  dobles.tenantDeFactura.mockResolvedValue('tn-1');
  pagina = await CostosFacturacionPage();
});

it('guardar price: asienta plan.price_guardado (sin flota; plan como entidad) con lo LEÍDO de Stripe', async () => {
  const r = await accionDe(/Guardar price/)(null, fd({ plan: 'pro', price: ' price_1abc ' }));
  expect(r.ok).toMatch(/Plan pro/);
  expect(dobles.anotar).toHaveBeenCalledWith({
    actor: expect.objectContaining({ userId: 'u-1' }), tenantId: null, accion: 'plan.price_guardado', entidad: 'plan', entidadId: 'pro',
    detalle: { price_id: 'price_1abc', monto_mensual: 1000, moneda: 'MXN', iva_incluido: false },
  });
  expect(dobles.pasoExtra).toHaveBeenCalledWith('dinero_saas', expect.objectContaining({ userId: 'u-1' }));
});

it('guardar price: si Stripe/la validación rechaza, NO se asienta nada', async () => {
  dobles.guardarPriceDePlan.mockRejectedValue(new Error('x'));
  const r = await accionDe(/Guardar price/)(null, fd({ plan: 'pro', price: 'price_1' }));
  expect(r.error).toBeTruthy();
  expect(dobles.anotar).not.toHaveBeenCalled();
});

it('emitir: asienta mensualidad.emitida con la flota, la factura y las TRES cifras', async () => {
  const r = await accionEmitir()(null, fd({ tenantId: 'tn-1' }));
  expect(r.ok).toMatch(/Mensualidad emitida/);
  expect(dobles.anotar).toHaveBeenCalledWith({
    actor: expect.objectContaining({ userId: 'u-1' }), tenantId: 'tn-1', accion: 'mensualidad.emitida', entidad: 'factura_saas', entidadId: 'fs-9',
    detalle: { periodo_inicio: '2026-03-01', periodo_fin: '2026-03-31', monto: 1160, subtotal: 1000, iva: 160, referencia: 'REF-9' },
  });
});

it('emitir: si emitirMensualidad lanza (sin suscripción, doble cobro), no hay asiento', async () => {
  dobles.emitirMensualidad.mockRejectedValue(new Error('Esa flota no tiene una suscripción activa'));
  await accionEmitir()(null, fd({ tenantId: 'tn-1' }));
  expect(dobles.anotar).not.toHaveBeenCalled();
});

it('conciliar: asienta pago.conciliado atribuido a la flota de la factura, sin copiar la referencia del banco', async () => {
  const r = await accionDe(/Marcar pagada/)(null, fd({ facturaId: 'f-1', referenciaBanco: 'SPEI-123456' }));
  expect(r.ok).toMatch(/marcada como pagada/);
  expect(dobles.anotar).toHaveBeenCalledWith({
    actor: expect.objectContaining({ userId: 'u-1' }), tenantId: 'tn-1', accion: 'pago.conciliado', entidad: 'factura_saas', entidadId: 'f-1',
    detalle: { con_referencia_banco: true },
  });
});

it('conciliar: si no se pudo leer la flota de la factura, el asiento sale SIN flota (no se pierde)', async () => {
  dobles.tenantDeFactura.mockRejectedValue(new Error('base caída'));
  await accionDe(/Marcar pagada/)(null, fd({ facturaId: 'f-1', referenciaBanco: 'SPEI-123456' }));
  expect(dobles.anotar).toHaveBeenCalledWith(expect.objectContaining({ tenantId: null, entidadId: 'f-1' }));
});

it('conciliar: si conciliar() rechaza (ya pagada), no se asienta pago alguno ni se timbra', async () => {
  dobles.conciliar.mockRejectedValue(new Error('Esa factura ya estaba marcada como pagada.'));
  await accionDe(/Marcar pagada/)(null, fd({ facturaId: 'f-1', referenciaBanco: 'SPEI-123456' }));
  expect(dobles.anotar).not.toHaveBeenCalled();
  expect(dobles.timbrarFactura).not.toHaveBeenCalled();
});

it('sin segundo factor reciente: NO se ejecuta ni se asienta nada, y se dice por qué (las tres acciones)', async () => {
  dobles.pasoExtra.mockResolvedValue('Cambiar precios exige tu segundo factor.');
  const a = await accionDe(/Guardar price/)(null, fd({ plan: 'pro', price: 'price_1' }));
  const b = await accionEmitir()(null, fd({ tenantId: 'tn-1' }));
  const c = await accionDe(/Marcar pagada/)(null, fd({ facturaId: 'f-1', referenciaBanco: 'SPEI-123456' }));
  for (const r of [a, b, c]) expect(r.error).toMatch(/segundo factor/);
  expect(dobles.guardarPriceDePlan).not.toHaveBeenCalled();
  expect(dobles.emitirMensualidad).not.toHaveBeenCalled();
  expect(dobles.conciliar).not.toHaveBeenCalled();
  expect(dobles.anotar).not.toHaveBeenCalled();
});

it('si la bitácora no pudo escribir, el acto SE DICE hecho y se avisa que falta el asiento', async () => {
  dobles.anotar.mockResolvedValue(false);
  const a = await accionDe(/Guardar price/)(null, fd({ plan: 'pro', price: 'price_1' }));
  const b = await accionEmitir()(null, fd({ tenantId: 'tn-1' }));
  const c = await accionDe(/Marcar pagada/)(null, fd({ facturaId: 'f-1', referenciaBanco: 'SPEI-123456' }));
  for (const r of [a, b, c]) { expect(r.ok).toMatch(/NO se pudo escribir en la bitácora/); expect(r.error).toBeUndefined(); }
});
