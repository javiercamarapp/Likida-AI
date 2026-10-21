import { beforeEach, expect, it, vi } from 'vitest';
import type { PropsDetalle } from './detalle';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA A8 ESCALACIÓN (ALTO, hallazgo 1) — "Reasignar chofer" SÍ avisa.
//
// El botón de esta pantalla (/dashboard/[id]) llamaba a `reasignarOperador`
// (que resetea `avisado_en` a NULL en cada cambio REAL de chofer) pero nunca
// llamaba a `avisarAlChofer` después — a diferencia de `/dashboard/despacho`
// (`asignarYAvisar`) y del flujo por WhatsApp (`asignar_wa.ts`), que sí lo
// hacen. Sin el aviso, `avisado_en` se queda en NULL para siempre y el viaje
// reasignado por aquí queda invisible para `viajesSinAceptar()`/A8: el chofer
// nuevo nunca recibe el WhatsApp de asignación.
//
// Esta prueba es a nivel SERVER ACTION, no del componente cliente
// (`reasignar_forma.test.tsx` ya cubre el combo): monta la página real
// (`Page(...)`), captura el `accion` que le pasa a `DetalleLiquidacion` vía
// `reasignar.accion` — el mismo patrón que
// `dashboard/carta-porte/documentos/[id]/page.test.tsx` usa para probar
// `revisar` — y la invoca directo, como lo haría el `<form action>`.
// ═══════════════════════════════════════════════════════════════════════════

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  reasignarOperador: vi.fn(),
  avisarAlChofer: vi.fn(),
  instrucciones: vi.fn(),
  revalidatePath: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/lib/auth/guard', () => ({ requireSessionTenant: mocks.session }));
vi.mock('@/lib/likida/analytics', () => ({
  getLiquidacionDetalle: async () => ({
    id: 'liq-1', folio: 'F-1', viajeId: 'viaje-1', pdfPath: null, estatus: 'cuadrada',
    operadorId: 'op-viejo', operadorNombre: 'Chofer Viejo',
    viaje: { operadorTelefono: null },
    gastos: [],
  }),
}));
vi.mock('@/lib/likida/repo', () => ({
  reasignarOperador: mocks.reasignarOperador,
  buscarCatalogo: async () => [],
  // >0 para que `reasignar` SÍ viaje en las props (page.tsx apaga el control
  // si `totalOperadores === 0`).
  contarCatalogo: async () => 5,
}));
vi.mock('@/lib/likida/operacion', () => ({ avisarAlChofer: mocks.avisarAlChofer }));
vi.mock('@/lib/likida/convenios/envio', () => ({ instruccionesAlCambiarOperador: mocks.instrucciones }));
vi.mock('@/lib/likida/revision', async (original) => ({
  ...await original<typeof import('@/lib/likida/revision')>(),
  leerRevision: async () => null,
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('DB no esperada'); } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: mocks.error } }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (r: string) => { throw new Error(`REDIRECT:${r}`); },
  notFound: () => { throw new Error('404'); },
}));
vi.mock('./detalle', () => ({ DetalleLiquidacion: () => null }));

const { default: Page } = await import('./page');

function sesion() {
  return { rol: 'flota_admin', tenantId: 'flota-1', userId: 'u-1' };
}

async function props(): Promise<PropsDetalle> {
  const el = await Page({ params: Promise.resolve({ id: 'liq-1' }), searchParams: Promise.resolve({}) });
  return (el as unknown as { props: PropsDetalle }).props;
}

const fd = (operadorId: string) => {
  const f = new FormData();
  f.set('operadorId', operadorId);
  return f;
};

beforeEach(() => {
  mocks.session.mockReset().mockResolvedValue(sesion());
  mocks.reasignarOperador.mockReset().mockResolvedValue({ cambio: true, operadorAnteriorId: 'op-viejo' });
  mocks.avisarAlChofer.mockReset().mockResolvedValue(undefined);
  mocks.instrucciones.mockReset().mockResolvedValue({ estado: 'sin_convenio' });
  mocks.revalidatePath.mockReset();
});

it('reasignar llama a avisarAlChofer con el tenant, el operador nuevo y el viaje — el chofer nuevo SÍ se entera', async () => {
  const p = await props();
  expect(p.reasignar).not.toBeNull();

  const r = await p.reasignar!.accion(null, fd('op-nuevo'));

  expect(mocks.reasignarOperador).toHaveBeenCalledWith('flota-1', 'viaje-1', 'op-nuevo');
  // ESTO es lo que faltaba: sin esta llamada, `avisado_en` se queda en NULL y
  // `viajesSinAceptar()` nunca ve el viaje reasignado.
  expect(mocks.avisarAlChofer).toHaveBeenCalledWith('flota-1', 'op-nuevo', 'viaje-1');
  expect(mocks.instrucciones).toHaveBeenCalledWith('flota-1', 'viaje-1', { cambio: true, operadorAnteriorId: 'op-viejo' });
  expect(r).toEqual({ ok: 'Listo: el viaje quedó a nombre del chofer que elegiste.' });
});

it('si el aviso de WhatsApp falla, la reasignación QUEDA igual (best-effort) y se dice para reintentar', async () => {
  mocks.avisarAlChofer.mockRejectedValue(new Error('Meta: timeout'));
  const p = await props();

  const r = await p.reasignar!.accion(null, fd('op-nuevo'));

  // La reasignación en sí ya quedó aplicada — no se deshace por un fallo de WhatsApp.
  expect(mocks.reasignarOperador).toHaveBeenCalledWith('flota-1', 'viaje-1', 'op-nuevo');
  expect(mocks.instrucciones).toHaveBeenCalled();
  expect(r).toEqual({
    error: 'El viaje quedó a nombre del chofer que elegiste, pero el aviso de WhatsApp no salió — vuelve a intentarlo desde aquí.',
  });
});

it('sin operadorId no se llama a nada — ni reasignar ni avisar', async () => {
  const p = await props();
  const r = await p.reasignar!.accion(null, new FormData());
  expect(mocks.reasignarOperador).not.toHaveBeenCalled();
  expect(mocks.avisarAlChofer).not.toHaveBeenCalled();
  expect(r).toMatchObject({ error: expect.stringMatching(/Elige un chofer/i) });
});

it('un rol que no puede asignar es rechazado antes de tocar la base', async () => {
  const p = await props();
  mocks.session.mockResolvedValue({ rol: 'contador', tenantId: 'flota-1', userId: 'u-1' });
  const r = await p.reasignar!.accion(null, fd('op-nuevo'));
  expect(r).toEqual({ error: 'Tu rol no puede reasignar choferes.' });
  expect(mocks.reasignarOperador).not.toHaveBeenCalled();
  expect(mocks.avisarAlChofer).not.toHaveBeenCalled();
});

it('si reasignarOperador falla, nunca se llega a avisar (no hay a quién avisar de un cambio que no se aplicó)', async () => {
  mocks.reasignarOperador.mockRejectedValue(new Error('reasignarOperador: el operador está dado de baja en esta flota'));
  const p = await props();
  const r = await p.reasignar!.accion(null, fd('op-nuevo'));
  expect(mocks.avisarAlChofer).not.toHaveBeenCalled();
  expect(mocks.instrucciones).not.toHaveBeenCalled();
  expect(r).toMatchObject({ error: expect.any(String) });
});
