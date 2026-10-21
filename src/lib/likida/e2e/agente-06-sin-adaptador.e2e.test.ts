import { describe, it, expect, vi, beforeEach } from 'vitest';
import { facturarAlVuelo } from '../facturacion/al_vuelo';
import { avisarALasPersonas } from '@/app/api/cron/facturar/lote';

// ═══════════════════════════════════════════════════════════════════════════
// EL CAMINO «SIN ADAPTADOR» (migración 0844), DE PUNTA A PUNTA.
//
// El agujero que esto cierra: `agente-06-autofactura.e2e.test.ts` fija
// `adaptadorDe.mockReturnValue(...)` SIEMPRE no-nulo en su `beforeEach`, así que
// la rama `sin_adaptador`/`sin_robot` es estructuralmente INALCANZABLE ahí — y
// como ese E2E solo ejercita `facturarLoteAlVuelo` (el lote), ni siquiera llega
// a `facturarAlVuelo` (el camino de UN gasto), que es el único que escribe
// `autofactura_aviso_sin_robot_en` y devuelve `avisoSinRobot`.
// `route.test.ts` dobla `facturarLoteAlVuelo` entero (nunca pasa por
// `anotarBloqueo`/`avisarALasPersonas`), y `avisar.test.ts` prueba `armarAviso`
// con tickets armados a mano, nunca con un gasto que de verdad pasó por la
// decisión de `facturarAlVuelo`.
//
// Aquí corre la cadena REAL: un gasto de un comercio que el catálogo reconoce
// (`megasur` — portal, campos y dominios verdaderos del catálogo) pero que
// NADIE tiene registrado en `TABLA` (`adaptadores/registro.ts`) ni como
// adaptador escrito ni como piloto — exactamente «el portal se reconoce y
// nadie sabe operarlo». `facturarAlVuelo` decide `sin_adaptador`, marca el
// candado 0844 y devuelve `avisoSinRobot`; el mismo bloque que `lote.ts:358-366`
// usa para decidir `anotarBloqueo`; y la función REAL que ese cron llama al
// cerrar la corrida (`avisarALasPersonas`, exportada de `lote.ts` para esto)
// dispara el aviso REAL — que vuelve a leer el gasto (`getPorFacturar`), lo
// vuelve a enrutar (`enrutar`/`armarAviso`) y arma el mensaje de WhatsApp real
// (`mensajeParaEncargado`) con la liga y los datos del ticket.
//
// LO ÚNICO DOBLE: la base de `gasto` (en memoria), el teléfono del encargado
// (`telefonoJefeDe`) y el envío de WhatsApp (`sendText`/`sendTemplate`). Todo
// lo demás — `decidirAutofactura`, `enrutar`, `armarAviso`, `getPorFacturar`,
// `mensajeParaEncargado`, `avisarPorFacturar`, `avisarALasPersonas` — es el
// código de producción, sin sustituir.
// ═══════════════════════════════════════════════════════════════════════════

type Fila = Record<string, unknown>;

// ── La base de `gasto`, en memoria. Mismo contrato que usan `facturarAlVuelo`
// (lectura por id, claim condicional, el candado 0844) y `getPorFacturar`
// (lectura por ventana de fecha, sin CFDI, paginada en UNA sola página).
const gastos: Fila[] = [];

function evaluarOr(f: Fila, expr: string): boolean {
  return expr.split(/,(?=\w+\.(?:is|lt)\.)/).some((p) => {
    const m = /^(\w+)\.(is|lt)\.(.*)$/.exec(p);
    if (!m) return false;
    const [, col, op, val] = m;
    const v = f[col] ?? null;
    if (op === 'is') return val === 'null' && v === null;
    return v !== null && Date.parse(String(v)) < Date.parse(val);
  });
}

function consultaGasto() {
  const filtros: Array<(f: Fila) => boolean> = [];
  let op: 'select' | 'update' = 'select';
  let patch: Fila = {};
  let devolver = false;
  let conConteo = false;
  const ejecutar = () => {
    const filas = gastos.filter((f) => filtros.every((p) => p(f)));
    if (op === 'select') return { data: filas.map((f) => ({ ...f })), error: null, ...(conConteo ? { count: filas.length } : {}) };
    for (const f of filas) Object.assign(f, patch);
    return { data: devolver ? filas.map((f) => ({ id: f.id })) : null, error: null };
  };
  const q: Record<string, unknown> = {
    select(_cols?: string, opciones?: { count?: string }) {
      if (op === 'update') devolver = true;
      if (opciones?.count === 'exact') conConteo = true;
      return q;
    },
    update(p: Fila) { op = 'update'; patch = p; return q; },
    eq(c: string, v: unknown) { filtros.push((f) => f[c] === v); return q; },
    in(c: string, vs: unknown[]) { filtros.push((f) => vs.includes(f[c])); return q; },
    is(c: string, v: unknown) { filtros.push((f) => (f[c] ?? null) === v); return q; },
    gte(c: string, v: unknown) { filtros.push((f) => f[c] !== null && f[c] !== undefined && String(f[c]) >= String(v)); return q; },
    neq(c: string, v: unknown) { filtros.push((f) => f[c] !== v); return q; },
    or(expr: string) { filtros.push((f) => evaluarOr(f, expr)); return q; },
    order() { return q; },
    limit() { return q; },
    // `facturarAlVuelo` lee el gasto con `.maybeSingle()`: una fila o `null`,
    // nunca el arreglo que usa el resto de la cadena.
    maybeSingle() {
      return Promise.resolve(ejecutar()).then((r) => {
        const filas = (r as { data: Fila[] | null }).data ?? [];
        return { data: filas[0] ?? null, error: (r as { error: unknown }).error };
      });
    },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(ejecutar()).then(res, rej); },
  };
  return q;
}

const insertBitacora = vi.fn(async () => ({ error: null }));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => (t === 'gasto' ? consultaGasto() : { insert: insertBitacora }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const sendText = vi.fn();
const sendTemplate = vi.fn();
vi.mock('@/lib/meta/client', () => ({
  sendText: (...a: unknown[]) => sendText(...a),
  sendTemplate: (...a: unknown[]) => sendTemplate(...a),
  motivoDeFalloWhatsApp: () => 'la plantilla no está aprobada (prueba)',
}));

const telefonoJefeDe = vi.fn(async (_t: string) => '5219990000002');
vi.mock('@/lib/likida/contactos', () => ({ telefonoJefeDe: (t: string) => telefonoJefeDe(t) }));

// ── Datos: un comercio REAL del catálogo (`megasur`), reconocido, sin cuenta,
// con sus campos completos — y que NO está en `TABLA` (`adaptadores/registro.ts`):
// ni adaptador escrito ni piloto. Exactamente «se reconoce y nadie lo opera».
const TENANT = 'tenant-sin-robot';
const GASTO_ID = 'g-megasur-1';
const HOY = '2026-10-02';

function gastoMegasur(o: Fila = {}): Fila {
  return {
    id: GASTO_ID, tenant_id: TENANT, concepto: 'diesel', monto: 420.5, fecha: HOY, folio: 'F-7788',
    rfc_emisor: null, cfdi_uuid: null, ocr_confianza: 0.95,
    ocr_extra: { urlFacturacion: 'http://megasur.com.mx:8029/', webId: 'WID-900', estacion: 'E9' },
    autofactura_intentada_en: null, autofactura_bloqueada_en: null, autofactura_bloqueo: null,
    autofactura_aviso_sin_robot_en: null,
    ...o,
  };
}
const fila = () => gastos.find((g) => g.id === GASTO_ID)!;

beforeEach(() => {
  gastos.length = 0;
  insertBitacora.mockClear();
  sendText.mockReset();
  sendTemplate.mockReset();
  telefonoJefeDe.mockReset(); telefonoJefeDe.mockResolvedValue('5219990000002');
});

describe('Agente 6 · SIN ADAPTADOR (0844): facturarAlVuelo → anotarBloqueo (lote.ts) → avisarALasPersonas → WhatsApp real', () => {
  it('un comercio reconocido sin robot escrito se rinde, marca el candado UNA vez, y el WhatsApp real al encargado lleva la liga y los datos', async () => {
    gastos.push(gastoMegasur());

    const r = await facturarAlVuelo({ gastoId: GASTO_ID, tenantId: TENANT, modo: 'emitir', hoy: HOY });

    // 1. `facturarAlVuelo` se rinde con el motivo correcto y marca el candado.
    expect(r).toMatchObject({ intentado: false, facturado: false, motivo: 'sin_adaptador' });
    expect(r.avisoSinRobot).toMatch(/sin adaptador escrito para megasur/i);
    expect(fila().autofactura_aviso_sin_robot_en).toBeTruthy();
    // No es un bloqueo: `enrutar()` tiene que seguir leyendo 'sin_robot', no
    // 'bloqueado' — por eso NO toca estas dos columnas.
    expect(fila().autofactura_bloqueada_en).toBeNull();
    expect(fila().autofactura_bloqueo).toBeNull();
    expect(fila().cfdi_uuid).toBeNull();

    // 2. Lo que `lote.ts:358-366` hace con ese resultado: lo trata como un
    // bloqueo para decidir a quién avisar esta corrida.
    const bloqueadosPorFlota = new Map<string, Array<{ gastoId: string; motivo: string }>>();
    if (r.avisoSinRobot) bloqueadosPorFlota.set(TENANT, [{ gastoId: GASTO_ID, motivo: r.avisoSinRobot }]);
    expect(bloqueadosPorFlota.has(TENANT)).toBe(true);

    // 3. La función REAL que el cron llama al cerrar la corrida. Nada de esto
    // está doblado salvo el teléfono y el envío de WhatsApp: `avisarPorFacturar`
    // vuelve a leer el gasto con `getPorFacturar`, lo vuelve a enrutar con
    // `enrutar`/`armarAviso` y arma el texto con `mensajeParaEncargado`.
    sendText.mockResolvedValue('wamid-sin-robot');
    const avisos = await avisarALasPersonas(bloqueadosPorFlota, HOY);

    expect(telefonoJefeDe).toHaveBeenCalledWith(TENANT);
    expect(avisos).toEqual([{ tenantId: TENANT, enviado: true, tickets: 1, motivo: undefined }]);
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledOnce();

    // 4. EL MENSAJE QUE DE VERDAD RECIBE EL ENCARGADO: la liga del portal, el
    // WebID que ya se leyó del ticket, y que el hueco es NUESTRO (no "pide
    // cuenta", no "se intentó y no se pudo" — esas son las otras dos ramas de
    // `enrutar`).
    const [telefono, texto] = sendText.mock.calls[0] as [string, string];
    expect(telefono).toBe('5219990000002');
    expect(texto).toContain('megasur.com.mx:8029');
    expect(texto).toContain('WID-900');
    expect(texto).toMatch(/todavía no lo sé llenar solo/i);
    expect(texto).not.toMatch(/pide cuenta/i);
    expect(texto).not.toMatch(/se intentó solo y no se pudo/i);
  });

  it('el candado es independiente del bloqueo: la corrida siguiente NO vuelve a avisar, aunque el ticket siga en la cola', async () => {
    gastos.push(gastoMegasur());
    const ahora1 = new Date(Date.parse(`${HOY}T12:00:00.000Z`)).toISOString();
    const r1 = await facturarAlVuelo({ gastoId: GASTO_ID, tenantId: TENANT, modo: 'emitir', hoy: HOY, ahora: ahora1 });
    expect(r1.avisoSinRobot).toBeTruthy();
    const marcaTrasPrimera = fila().autofactura_aviso_sin_robot_en;
    expect(marcaTrasPrimera).toBe(ahora1);

    // El claim de la primera corrida vence a los 10 min; esta ya pasó 20.
    const ahora2 = new Date(Date.parse(`${HOY}T12:20:00.000Z`)).toISOString();
    const r2 = await facturarAlVuelo({ gastoId: GASTO_ID, tenantId: TENANT, modo: 'emitir', hoy: HOY, ahora: ahora2 });

    // El ticket SIGUE reportándose 'sin_adaptador' —una persona todavía lo
    // puede facturar, el ticket no se esconde— pero el candado de 0844 ya está
    // puesto, así que no hay un SEGUNDO `avisoSinRobot` que dispare otro
    // WhatsApp sobre lo mismo.
    expect(r2.motivo).toBe('sin_adaptador');
    expect(r2.avisoSinRobot).toBeUndefined();
    // Solo UNA marca del candado, de la primera corrida: la segunda NO la pisó.
    expect(fila().autofactura_aviso_sin_robot_en).toBe(marcaTrasPrimera);
  });
});
