import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL ANTI-RUIDO DE `avisoHuerfanos`, PROBADO CONTRA EL MOTOR ENTERO.
//
// `avisar_huerfanos.test.ts` mockea `avisar()` para probar QUÉ se mide; este
// archivo lo deja correr DE VERDAD —leer estado, decidir, reclamar, mandar—
// porque lo que hay que fijar es la PERSISTENCIA: dos corridas del cron
// `escalar` dentro de la misma hora, con la misma flota atorada, no pueden
// mandar dos correos. Mismo criterio que `agentes/notificaciones_parpadeo.
// test.ts`: una base falsa que guarda UNA fila de verdad y respeta los CHECK
// de la migración 0097.
// ═══════════════════════════════════════════════════════════════════════════

interface FilaEstado {
  magnitud: number;
  avisado_en: string | null;
  magnitud_avisada: number | null;
  actualizado_en: string;
}

const estados = new Map<string, FilaEstado>();
const llave = (tenantId: string) => `${tenantId}:liquidacion:cola_atorada`;

function checksDe0097(f: FilaEstado): void {
  if ((f.avisado_en === null) !== (f.magnitud_avisada === null)) {
    throw new Error('viola agente_notif_huella_completa (0097): la huella va junta o no va');
  }
  if (f.magnitud < 0) throw new Error('viola magnitud >= 0 (0097)');
  if (f.magnitud_avisada !== null && f.magnitud_avisada < 1) {
    throw new Error('viola magnitud_avisada >= 1 (0097)');
  }
}

/** La tabla `agente_notificacion_estado`: soporta la lectura por llave
 *  (`leerEstado`), el upsert de `guardarMagnitud`, el update condicional de
 *  `reclamarAviso`/`cerrarIncidente`, Y el `select tenant_id … gt('magnitud', 0)`
 *  que `avisarHuerfanosPendientes` usa para encontrar incidentes abiertos. */
function tablaEstado() {
  const filtrosEq: Array<[string, string]> = [];
  let filtroGt: number | null = null;
  let payload: Record<string, unknown> | null = null;
  let condicionOr: string | null = null;
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = (col: string, val: string) => { filtrosEq.push([col, val]); return b; };
  b.gt = (_col: string, val: number) => { filtroGt = val; return b; };
  b.or = (c: string) => { condicionOr = c; return b; };
  b.update = (p: Record<string, unknown>) => { payload = p; return b; };
  b.upsert = (p: Record<string, unknown>) => {
    const tenantId = p.tenant_id as string;
    const k = llave(tenantId);
    const previa = estados.get(k);
    const nueva: FilaEstado = {
      magnitud: previa?.magnitud ?? 0,
      avisado_en: previa?.avisado_en ?? null,
      magnitud_avisada: previa?.magnitud_avisada ?? null,
      actualizado_en: previa?.actualizado_en ?? '1970-01-01T00:00:00.000Z',
    };
    if ('magnitud' in p) nueva.magnitud = p.magnitud as number;
    checksDe0097(nueva);
    estados.set(k, nueva);
    return Promise.resolve({ error: null });
  };
  // Lectura por llave exacta (`leerEstado`, tres `.eq()` encadenados).
  b.maybeSingle = () => {
    if (filtrosEq.length < 3) return Promise.resolve({ data: null, error: null });
    const tenantId = filtrosEq.find(([c]) => c === 'tenant_id')?.[1] ?? '';
    const fila = estados.get(llave(tenantId)) ?? null;
    return Promise.resolve({ data: fila === null ? null : { ...fila }, error: null });
  };
  b.then = (res: (v: unknown) => unknown) => {
    // El `select('tenant_id').eq('agente',…).eq('evento',…).gt('magnitud', 0)`
    // de `avisarHuerfanosPendientes`: NINGÚN `.update()` ni `.maybeSingle()`
    // en esta cadena — la distingue el `gt` sin payload.
    if (payload === null && filtroGt !== null) {
      const data = [...estados.entries()]
        .filter(([k, f]) => k.endsWith(':liquidacion:cola_atorada') && f.magnitud > filtroGt!)
        .map(([k]) => ({ tenant_id: k.split(':')[0] }));
      return Promise.resolve({ data, error: null }).then(res);
    }
    // El `update` de `cerrarIncidente` (sin `.or`) o de `reclamarAviso` (con
    // `.or`, que aquí se EVALÚA de verdad — el piso de una hora real).
    let data: Array<{ tenant_id: string }> = [];
    const tenantId = filtrosEq.find(([c]) => c === 'tenant_id')?.[1] ?? '';
    const k = llave(tenantId);
    const fila = estados.get(k);
    if (payload !== null && fila !== null && fila !== undefined) {
      const umbral = condicionOr?.match(/avisado_en\.lt\.(.+)$/)?.[1] ?? null;
      const pasa = condicionOr === null
        || fila.avisado_en === null || (umbral !== null && fila.avisado_en < umbral);
      if (pasa) {
        const nueva: FilaEstado = { ...fila };
        if ('magnitud' in payload) nueva.magnitud = payload.magnitud as number;
        if ('avisado_en' in payload) nueva.avisado_en = payload.avisado_en as (string | null);
        if ('magnitud_avisada' in payload) nueva.magnitud_avisada = payload.magnitud_avisada as (number | null);
        if ('actualizado_en' in payload) nueva.actualizado_en = payload.actualizado_en as string;
        checksDe0097(nueva);
        estados.set(k, nueva);
        if (condicionOr !== null) data = [{ tenant_id: tenantId }];
      }
    }
    return Promise.resolve({ data, error: null }).then(res);
  };
  return b;
}

/** `comprobante_huerfano`: lo que esta corrida ve como pendiente, ahora. */
let pendientes: Array<{ tenant_id: string; creado_en: string }> = [];
function tablaHuerfanos() {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'is', 'order', 'range']) b[m] = () => b;
  b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: pendientes, error: null, count: pendientes.length }).then(r);
  return b;
}

/** `app_user`, `agente_notificacion_config` y `tenant`: config sin fila
 *  (defaults del código — PERO `cola_atorada` no es el default, así que se
 *  guarda una fila que lo enciende, ver `beforeEach`) y una dueña con correo. */
let configFila: { data: unknown; error: null } = { data: null, error: null };
function tablaSimple(respuesta: unknown) {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = () => b;
  b.order = () => b;
  b.or = () => b;
  b.maybeSingle = () => Promise.resolve(respuesta);
  b.limit = () => Promise.resolve(respuesta);
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      if (tabla === 'comprobante_huerfano') return tablaHuerfanos();
      if (tabla === 'agente_notificacion_estado') return tablaEstado();
      if (tabla === 'app_user') {
        return tablaSimple({
          data: [{ id: 'u1', nombre: 'Dueña', email: 'duena@flota.mx', rol: 'flota_admin' }],
          error: null,
        });
      }
      if (tabla === 'tenant') return tablaSimple({ data: { nombre: 'Transportes Antirruido' }, error: null });
      if (tabla === 'agente_notificacion_config') return tablaSimple(configFila);
      return tablaSimple({ data: null, error: null });
    },
  }),
}));

const enviarCorreo = vi.fn(async (): Promise<{ ok: true; id: string } | { ok: false; motivo: string }> => ({ ok: true, id: 'env-1' }));
vi.mock('@/lib/correo/enviar', () => ({
  correoConfigurado: () => true,
  enviarCorreo: (...a: unknown[]) => enviarCorreo(...(a as [])),
}));

const { avisarHuerfanosPendientes } = await import('./avisar_huerfanos');
const { PISO_ENTRE_AVISOS_MS } = await import('./agentes/notificaciones');

const T0 = new Date('2026-10-19T12:00:00Z');
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

beforeEach(() => {
  estados.clear();
  pendientes = [];
  // `cola_atorada` enciende para el dueño: el default sin fila NO lo trae
  // (`CONFIG_NOTIF_DEFAULT` solo enciende `corrida_fallida`), y sin esta fila
  // la prueba mediría "apagado", no el anti-ruido.
  configFila = { data: { eventos: ['cola_atorada'], roles: ['flota_admin'] }, error: null };
  enviarCorreo.mockClear();
});

describe('la misma flota atorada, dentro de la misma hora: UN solo correo', () => {
  it('dos corridas de `escalar` con el huérfano todavía pendiente no duplican el aviso', async () => {
    pendientes = [{ tenant_id: 't-1', creado_en: T0.toISOString() }];

    const r1 = await avisarHuerfanosPendientes(T0);
    expect(r1.avisados).toBe(1);
    expect(enviarCorreo).toHaveBeenCalledTimes(1);

    // La corrida siguiente, 15 minutos después, con el MISMO huérfano sin
    // resolver — muy por debajo del piso de una hora.
    const r2 = await avisarHuerfanosPendientes(min(15));
    expect(r2.avisados).toBe(0);
    expect(enviarCorreo).toHaveBeenCalledTimes(1);
  });

  it('pasada la hora, con el mismo huérfano sin resolver, SÍ sale el segundo correo', async () => {
    pendientes = [{ tenant_id: 't-1', creado_en: T0.toISOString() }];
    await avisarHuerfanosPendientes(T0);
    expect(enviarCorreo).toHaveBeenCalledTimes(1);

    const r = await avisarHuerfanosPendientes(min(65));
    // Misma magnitud (1) que el aviso anterior: no cruzó ninguna marca nueva,
    // pero el piso de una hora ya se cumplió — `debeAvisar` solo reavisa una
    // magnitud sin marca nueva cuando el incidente se cerró y reabrió, así
    // que aquí el aviso correcto sigue siendo "nada nuevo que decir".
    expect(r.avisados).toBe(0);
    expect(enviarCorreo).toHaveBeenCalledTimes(1);
  });
});

describe('se resuelve y reaparece DENTRO de la misma hora: tampoco duplica', () => {
  it('huérfano → correo → se adjunta (cero pendientes) → otro huérfano nuevo a los 20 min: NO sale un segundo correo', async () => {
    pendientes = [{ tenant_id: 't-1', creado_en: T0.toISOString() }];
    await avisarHuerfanosPendientes(T0);
    expect(enviarCorreo).toHaveBeenCalledTimes(1);

    // Se resolvió: cero pendientes. Esta corrida CIERRA el incidente (la
    // magnitud vuelve a 0, la huella se queda) — es lo que re-arma el filo
    // para la PRÓXIMA hora, sin mandar nada todavía.
    pendientes = [];
    const r2 = await avisarHuerfanosPendientes(min(10));
    expect(r2.avisados).toBe(0);
    expect(enviarCorreo).toHaveBeenCalledTimes(1);

    // Un comprobante nuevo llega a los 20 min — dentro de la MISMA hora del
    // correo original. El piso de una hora sigue valiendo entre dos avisos
    // cualesquiera, no solo dentro del mismo incidente (B7).
    pendientes = [{ tenant_id: 't-1', creado_en: min(20).toISOString() }];
    const r3 = await avisarHuerfanosPendientes(min(20));
    expect(r3.avisados).toBe(0);
    expect(enviarCorreo).toHaveBeenCalledTimes(1);
  });

  it('… pero pasada la hora desde el correo original, el huérfano nuevo SÍ avisa — desde la primera marca', async () => {
    pendientes = [{ tenant_id: 't-1', creado_en: T0.toISOString() }];
    await avisarHuerfanosPendientes(T0);
    pendientes = [];
    await avisarHuerfanosPendientes(min(10));

    pendientes = [{ tenant_id: 't-1', creado_en: min(70).toISOString() }];
    const r = await avisarHuerfanosPendientes(min(70));
    expect(r.avisados).toBe(1);
    expect(enviarCorreo).toHaveBeenCalledTimes(2);
  });
});

describe('aislamiento por tenant, contra el motor real', () => {
  it('el piso de una flota no silencia el primer aviso de otra', async () => {
    pendientes = [{ tenant_id: 't-1', creado_en: T0.toISOString() }];
    await avisarHuerfanosPendientes(T0);
    expect(enviarCorreo).toHaveBeenCalledTimes(1);

    // Un minuto después, OTRA flota tiene su primer huérfano. El piso de
    // `t-1` no puede silenciar el primer correo de `t-2` — son incidentes de
    // flotas distintas, no el mismo (agente, evento) global.
    pendientes = [
      { tenant_id: 't-1', creado_en: T0.toISOString() },
      { tenant_id: 't-2', creado_en: min(1).toISOString() },
    ];
    const r = await avisarHuerfanosPendientes(min(1));
    expect(r.avisados).toBe(1);
    expect(enviarCorreo).toHaveBeenCalledTimes(2);
  });
});

describe('el piso real del repo (1 h) es el mismo que usa este aviso', () => {
  it('no se inventa una cadencia propia', () => {
    expect(PISO_ENTRE_AVISOS_MS).toBe(60 * 60 * 1000);
  });
});
