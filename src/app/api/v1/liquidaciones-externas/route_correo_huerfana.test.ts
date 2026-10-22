import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// HALLAZGO MEDIO (oct-2026): una liquidación de un tenant `cinco_agentes`
// (un tenant cinco_agentes) que entra por el endpoint GENERAL (`POST /v1/liquidaciones-externas`,
// `recibirLiquidacionExterna`) en vez de `/v1/liquidaciones-externas/desgloses`
// queda HUÉRFANA para siempre — `canalDeEntregaPorOmision` fuerza el canal a
// `correo` (fail-safe correcto: nunca manda por WhatsApp), pero NINGÚN código de
// este endpoint inserta la fila en `liquidacion_entrega_correo` (esa tabla solo
// la llenan `desglose_recibir.ts`/`liberar_envio.ts`/`reenvio_correo.ts`, las
// tres del camino `/desgloses`).
//
// El fix: el endpoint general RECHAZA explícitamente (400, mensaje claro, sin
// guardar nada) una liquidación cuyo canal resuelto es `correo`, en vez de
// aceptarla con 201 y dejarla estancada en silencio. Esta prueba reproduce el
// escenario EXACTO con la resolución REAL del canal (perfil `cinco_agentes` vía
// `@/lib/auth/perfil_tenant`, no simulada), igual que `servicio_canal_cinco_agentes.test.ts`.
// ═══════════════════════════════════════════════════════════════════════════

type Resp = { data: unknown; error: { message: string; code?: string } | null };
const porTenantPerfil = new Map<string, Resp>();
const porTenantCanal = new Map<string, Resp>();

/** Un stub de query builder que es a la vez encadenable (cada método se
 *  devuelve a sí mismo) y «thenable» (se puede `await` directo, como hace
 *  `guardarRecuerdoDurable` sobre un `.upsert()` sin más encadenado). Sirve
 *  para cualquier tabla que esta prueba no necesita controlar (`api_idempotencia`,
 *  `liquidacion_externa` — `buscarPorClave` está mockeado aparte). */
function chainVacio(): unknown {
  const resultado: Resp = { data: null, error: null };
  const b: Record<string, unknown> = {
    select: () => b, eq: () => b, in: () => b, or: () => b, order: () => b, limit: () => b,
    insert: () => b, upsert: () => b, maybeSingle: async () => resultado,
    then: (resolve: (v: Resp) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(resultado).then(resolve, reject),
  };
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      if (tabla === 'tenant_perfil') {
        const b: Record<string, unknown> = {};
        let tenant: string | null = null;
        b.select = () => b;
        b.eq = (_c: string, v: string) => { tenant = v; return b; };
        b.maybeSingle = async () => porTenantPerfil.get(tenant ?? '') ?? { data: null, error: null };
        return b;
      }
      if (tabla === 'liquidacion_correo_config') {
        const b: Record<string, unknown> = {};
        let tenant: string | null = null;
        b.select = () => b;
        b.eq = (_c: string, v: string) => { tenant = v; return b; };
        b.maybeSingle = async () => porTenantCanal.get(tenant ?? '') ?? { data: null, error: null };
        return b;
      }
      return chainVacio();
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('NEXT_REDIRECT (no debería llamarse en esta prueba)'); } }));
let tenantActual = 't-cinco-agentes-x';
vi.mock('@/app/api/v1/_comun', async (orig) => ({
  ...(await orig<typeof import('@/app/api/v1/_comun')>()),
  abrir: async () => ({ ok: true, tenantId: tenantActual, rol: 'llave:administracion' }),
}));
vi.mock('@/lib/likida/liquidacion_externa/repo', async (orig) => ({
  ...(await orig<typeof import('@/lib/likida/liquidacion_externa/repo')>()),
  buscarPorClave: async () => null,
}));

/** Solo se usa en el caso SIN regresión (canal whatsapp/ambos): el guardia nuevo no debe tocar ese camino. */
const filaAceptada = () => ({
  id: '11111111-1111-4111-8111-111111111111', tenantId: tenantActual, claveExterna: 'CLIENTE-EXT-R1', huella: 'x'.repeat(64),
  sistemaOrigen: 'SAP', operadorId: 'o-1', operadorNombre: 'Operador Uno', operadorTelefono: '525512345678', // grep-limpio:ok
  foliosViaje: ['VJ-9'], viajeIds: [], periodoDesde: '2026-10-01', periodoHasta: '2026-10-07',
  conceptos: [{ clave: null, descripcion: 'Sueldo', tipo: 'percepcion', monto: 100 }], total: 100, moneda: 'MXN',
  pdfRuta: `${tenantActual}/externas/x.pdf`, pdfOrigen: 'generado' as const, estado: 'pendiente' as const, via: null, generacion: 1, intentos: 0,
  proximoIntentoEn: 'x', ultimoError: null, wamid: null, enviadaEn: null, acuseTipo: null, acuseEn: null, acuseConfirmadoEn: null,
  creadaEn: '2026-10-20T09:00:00.000Z',
});
const recibir = vi.fn(async () => ({ liquidacion: filaAceptada() }));
const intentar = vi.fn(async () => 'en_cola');
vi.mock('@/lib/likida/liquidacion_externa/servicio', async (orig) => ({
  // `dependenciasPorOmision` queda REAL: así `canalDeEntrega` resuelve el canal de verdad (perfil + config), no una
  // simulación — es justo lo que reproduce el escenario del hallazgo.
  ...(await orig<typeof import('@/lib/likida/liquidacion_externa/servicio')>()),
  recibirLiquidacionExterna: (...a: unknown[]) => recibir(...(a as [])),
  intentarEntrega: (...a: unknown[]) => intentar(...(a as [])),
}));

const { reiniciarCachePerfil } = await import('@/lib/auth/perfil_tenant');
const { POST } = await import('./route');
const { reiniciarIdempotencia } = await import('../_escritura');

const CINCO_AGENTES: Resp = { data: { perfil: 'cinco_agentes' }, error: null };

const CUERPO = () => ({
  claveExterna: 'CLIENTE-EXT-R1', sistemaOrigen: 'SAP', operador: { telefono: '5512345678' }, // grep-limpio:ok
  viajes: ['VJ-9'], periodo: { desde: '2026-10-01', hasta: '2026-10-07' },
  conceptos: [{ descripcion: 'Sueldo', tipo: 'percepcion', monto: 100 }], total: 100, moneda: 'MXN',
});
const postear = () => POST(new Request('https://app.likida.ai/api/v1/liquidaciones-externas', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(CUERPO()),
}));

beforeEach(() => {
  recibir.mockClear();
  intentar.mockClear();
  reiniciarIdempotencia();
  reiniciarCachePerfil();
  porTenantPerfil.clear();
  porTenantCanal.clear();
});

describe('POST /v1/liquidaciones-externas: una flota cinco_agentes (canal correo) por el endpoint general no queda huérfana', () => {
  // Tenants DISTINTOS por caso: `canalDeEntregaPorOmision` cachea el canal resuelto 30 s por tenant
  // (`canalRecordado`, en servicio.ts) y esa caché NO se limpia entre pruebas — solo la del perfil
  // (`reiniciarCachePerfil`). Reusar el mismo tenant en dos casos haría que el segundo leyera el canal
  // que quedó cacheado del primero, no el que esta prueba acaba de configurar.

  it('perfil cinco_agentes, SIN fila en liquidacion_correo_config (el caso real) ⇒ 400, nada se guarda, nada se intenta', async () => {
    tenantActual = 't-ca-sin-fila-route';
    porTenantPerfil.set(tenantActual, CINCO_AGENTES);
    // Sin fila de config: es justo el caso que el fail-safe de `canalDeEntregaPorOmision` cubre.
    const r = await postear();
    expect(r.status).toBe(400);
    const cuerpo = await r.json();
    expect(cuerpo.error.codigo).toBe('parametro_invalido');
    expect(cuerpo.error.mensaje).toMatch(/desgloses/);
    expect(recibir).not.toHaveBeenCalled();
    expect(intentar).not.toHaveBeenCalled();
  });

  it('perfil cinco_agentes con una fila vieja canal=whatsapp ⇒ igual 400 (el fail-safe manda sobre la config)', async () => {
    tenantActual = 't-ca-fila-whatsapp-route';
    porTenantPerfil.set(tenantActual, CINCO_AGENTES);
    porTenantCanal.set(tenantActual, { data: { canal: 'whatsapp', activa: true }, error: null });
    const r = await postear();
    expect(r.status).toBe(400);
    expect(recibir).not.toHaveBeenCalled();
  });

  it('una flota SIN perfil y SIN config (comportamiento de siempre) ⇒ sigue aceptando por WhatsApp, sin regresión', async () => {
    tenantActual = 't-sin-perfil-route';
    porTenantPerfil.set(tenantActual, { data: null, error: null });
    porTenantCanal.set(tenantActual, { data: null, error: null });
    const r = await postear();
    expect(r.status).toBe(201);
    expect(recibir).toHaveBeenCalledTimes(1);
  });

  it('una flota SIN perfil pero con su PROPIA config canal=correo ⇒ también se rechaza por el endpoint general (misma regla, su propia decisión)', async () => {
    tenantActual = 't-sin-perfil-correo-route';
    porTenantPerfil.set(tenantActual, { data: null, error: null });
    porTenantCanal.set(tenantActual, { data: { canal: 'correo', activa: true }, error: null });
    const r = await postear();
    expect(r.status).toBe(400);
    expect(recibir).not.toHaveBeenCalled();
  });
});
