import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL CRON DE FACTURACIÓN — el cable, que es donde estaba el agujero.
//
// Las piezas existían todas —el adaptador de CAPUFE, el registro por flota, el
// navegador de verdad— y ninguna estaba conectada: la ruta llamaba a
// `facturarAlVuelo` sin haber registrado un solo adaptador, así que cada ticket
// salía "sin_adaptador" y el cron respondía 200. Verde en el panel de Vercel,
// cero facturas. Un cron en verde que no hace nada es peor que uno en rojo.
//
// Lo que estas pruebas fijan es el CABLE, no la lógica de facturar (esa vive en
// `al_vuelo.test.ts` y `capufe.test.ts`):
//
//   1. Se abre UN navegador POR FLOTA, no uno por ticket. Es la decisión de
//      costo del producto.
//   2. Nunca se comparte navegador ENTRE flotas: el contexto lleva las cookies y
//      CAPUFE podría recordar el RFC de la anterior.
//   3. Si Chromium no arranca —que es HOY, en Vercel— la respuesta es 503 con el
//      motivo, y los tickets NO se tocan: `facturarAlVuelo` es quien pone el
//      sello de intentado, así que no llamarlo es lo que los deja para la
//      corrida siguiente.
//   4. La cola se pide en el orden de la 0063, o los mismos ocho tickets que no
//      proceden se llevan todas las corridas.
// ═══════════════════════════════════════════════════════════════════════════

const SECRETO = 'cron-secreto-de-prueba';
process.env.CRON_SECRET = SECRETO;
delete process.env.FACTURACION_MODO;

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

/** Lo que devuelve la consulta de la cola. */
let cola: { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
const consulta: Array<[string, unknown[]]> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const nodo: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'not', 'order', 'limit']) {
        nodo[m] = (...a: unknown[]) => { consulta.push([`${tabla}.${m}`, a]); return nodo; };
      }
      nodo.then = (r: (v: unknown) => unknown) => Promise.resolve(cola).then(r);
      return nodo;
    },
  }),
}));

const facturarAlVuelo = vi.fn(async (a: { gastoId: string }) => ({
  intentado: true, facturado: false, detalle: `ensayo de ${a.gastoId}`,
}));
vi.mock('@/lib/cuadra/facturacion/al_vuelo', () => ({ facturarAlVuelo }));

/** Qué datos fiscales tiene cada flota. */
let fiscalPorFlota: Record<string, { flota: unknown; falta: string[] }>;
const getFiscalDeFlota = vi.fn(async (t: string) =>
  fiscalPorFlota[t] ?? { flota: null, falta: ['sin ficha'] });
vi.mock('@/lib/cuadra/facturacion/flota_fiscal', () => ({ getFiscalDeFlota }));

/** `null` = Chromium arranca. Un string = no arranca, con ese mensaje. */
let navegadorRoto: string | null = null;
const navegadoresAbiertos: number[] = [];
const conNavegador = vi.fn(async (fn: (abrir: unknown) => Promise<unknown>) => {
  // `conNavegador` arranca Chromium ANTES de correr el cuerpo. Si lanza aquí, el
  // cuerpo no se ejecuta — que es justo lo que la ruta usa para distinguir "no
  // hay navegador" de "el lote falló".
  if (navegadorRoto) throw new Error(navegadorRoto);
  navegadoresAbiertos.push(Date.now());
  return fn(async () => ({}));
});
vi.mock('@/lib/cuadra/facturacion/adaptadores/pagina_playwright', () => ({ conNavegador }));

const conPortales = vi.fn(async (_op: unknown, fn: (r: unknown) => Promise<unknown>) =>
  fn({ registrados: ['capufe'], problemas: [] }));
vi.mock('@/lib/cuadra/facturacion/adaptadores/registro', () => ({
  conPortales,
  PORTALES_CONOCIDOS: ['capufe'] as readonly string[],
}));

const { GET } = await import('./route');

/** Una fila de la cola. Por default, un ticket de CAPUFE. */
const CAPUFE = { urlFacturacion: 'https://facturacioncapufe.com.mx/Capufe/', codigo: 'X' };
/** OXXO Gas exige cuenta: no lo opera ningún adaptador. */
const OTRO = { urlFacturacion: 'https://facturacion.oxxogas.com/' };

const fila = (o: Record<string, unknown> = {}) => ({
  id: 'g-1', tenant_id: 't-1', concepto: 'caseta', monto: 180, fecha: '2026-08-03',
  folio: 'CAPUFE000000000001', rfc_emisor: null, cfdi_uuid: null, ocr_extra: CAPUFE,
  ...o,
});

const FISCAL = {
  tenantId: 't-1', rfc: 'GMX0902279I1', nombre: 'TRANSPORTES DEL BAJIO SA DE CV',
  codigoPostal: '37000', regimenFiscal: '601', usoCfdi: 'G03', correo: 'f@x.mx',
};

const pedir = (auth = `Bearer ${SECRETO}`) =>
  GET(new Request('https://app.likida.ai/api/cron/facturar', { headers: { authorization: auth } }));

beforeEach(() => {
  cola = { data: [fila()], error: null };
  consulta.length = 0;
  navegadorRoto = null;
  navegadoresAbiertos.length = 0;
  fiscalPorFlota = { 't-1': { flota: FISCAL, falta: [] }, 't-2': { flota: { ...FISCAL, tenantId: 't-2' }, falta: [] } };
  facturarAlVuelo.mockClear();
  getFiscalDeFlota.mockClear();
  conNavegador.mockClear();
  conPortales.mockClear();
  for (const f of Object.values(logger)) f.mockReset();
});

describe('la puerta', () => {
  it('sin CRON_SECRET la ruta devuelve 500 y NO corre', async () => {
    const antes = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    const res = await pedir();
    process.env.CRON_SECRET = antes;

    expect(res.status).toBe(500);
    expect(facturarAlVuelo).not.toHaveBeenCalled();
  });

  it('con el bearer equivocado, 401', async () => {
    expect((await pedir('Bearer otro')).status).toBe(401);
    expect(facturarAlVuelo).not.toHaveBeenCalled();
  });
});

describe('la cola', () => {
  it('se pide en el orden de la 0063: los nunca intentados primero', async () => {
    // Sin este orden, los ocho tickets más viejos que NO proceden salen elegidos
    // en cada corrida y los nuevos no entran nunca. La columna existía desde la
    // 0063 y la consulta la ignoraba.
    await pedir();

    const ordenes = consulta.filter(([m]) => m === 'gasto.order').map(([, a]) => a);
    expect(ordenes[0]).toEqual(['autofactura_intentada_en', { ascending: true, nullsFirst: true }]);
    expect(ordenes[1]).toEqual(['created_at', { ascending: true }]);
  });

  it('anuncia lo que NO cupo en el lote', async () => {
    // Un tope que no se anuncia se lee como "ya se facturó todo".
    cola = { data: Array.from({ length: 9 }, (_, i) => fila({ id: `g-${i}` })), error: null };
    const cuerpo = await (await pedir()).json();

    expect(cuerpo.intentados).toBe(8);
    expect(cuerpo.quedaron).toBe(1);
  });
});

describe('un navegador por flota, no uno por ticket', () => {
  it('tres tickets de la misma flota comparten UN navegador', async () => {
    cola = { data: [fila({ id: 'g-1' }), fila({ id: 'g-2' }), fila({ id: 'g-3' })], error: null };

    const cuerpo = await (await pedir()).json();

    expect(conNavegador).toHaveBeenCalledTimes(1);
    expect(conPortales).toHaveBeenCalledTimes(1);
    expect(facturarAlVuelo).toHaveBeenCalledTimes(3);
    expect(cuerpo.corrio).toBe(true);
    expect(cuerpo.intentados).toBe(3);
  });

  it('dos flotas NO comparten navegador: el contexto lleva las cookies del portal', async () => {
    // `SesionNavegador` usa un solo BrowserContext para todas sus pestañas. Que
    // CAPUFE reconozca la sesión entre códigos es lo que se quiere DENTRO de una
    // flota y exactamente lo que no se quiere entre dos: podría recordar el RFC
    // de la anterior.
    cola = { data: [fila({ id: 'g-1', tenant_id: 't-1' }), fila({ id: 'g-2', tenant_id: 't-2' })], error: null };

    await pedir();

    expect(conNavegador).toHaveBeenCalledTimes(2);
    expect(conPortales).toHaveBeenCalledTimes(2);
    // Y cada lote se registró con los datos fiscales de SU flota.
    const flotas = conPortales.mock.calls.map((c) => (c[0] as { flota: { tenantId: string } }).flota.tenantId);
    expect(flotas.sort()).toEqual(['t-1', 't-2']);
  });

  it('los tickets van agrupados por portal dentro de la flota', async () => {
    // Con un solo portal escrito esto se ve poco, pero el orden es el del
    // agrupamiento y no el de la consulta: es lo que permite que una sesión de
    // CAPUFE reciba varios códigos seguidos en vez de intercalados con otro
    // portal.
    cola = {
      data: [
        fila({ id: 'capufe-1' }),
        fila({ id: 'sin-portal', ocr_extra: OTRO }),
        fila({ id: 'capufe-2' }),
      ],
      error: null,
    };

    await pedir();

    const orden = facturarAlVuelo.mock.calls.map((c) => (c[0] as { gastoId: string }).gastoId);
    // El de portal desconocido se despacha primero, sin navegador; los dos de
    // CAPUFE van seguidos, dentro del lote.
    expect(orden).toEqual(['sin-portal', 'capufe-1', 'capufe-2']);
  });

  it('sin ticket de portal automatizable NO se abre navegador', async () => {
    // Arrancar Chromium para descubrir que no hay a dónde entrar cuesta segundos
    // de una invocación de 300.
    cola = { data: [fila({ id: 'g-1', ocr_extra: OTRO })], error: null };

    const cuerpo = await (await pedir()).json();

    expect(conNavegador).not.toHaveBeenCalled();
    expect(facturarAlVuelo).toHaveBeenCalledTimes(1);
    expect(cuerpo.corrio).toBe(true);
  });

  it('una flota sin datos fiscales no gasta navegador, y se dice qué le falta', async () => {
    // El portal pide los seis datos del receptor antes que nada: el intento
    // terminaría igual, con un Chromium de más. Los tickets SÍ se despachan para
    // que queden sellados y no acaparen el lote siguiente.
    fiscalPorFlota = { 't-1': { flota: null, falta: ['la flota no tiene RFC'] } };
    const cuerpo = await (await pedir()).json();

    expect(conNavegador).not.toHaveBeenCalled();
    expect(facturarAlVuelo).toHaveBeenCalledTimes(1);
    expect(cuerpo.flotas[0].falta).toEqual(['la flota no tiene RFC']);
  });
});

describe('cuando Chromium no arranca —que es HOY, en Vercel—', () => {
  beforeEach(() => {
    navegadorRoto = "browserType.launch: Executable doesn't exist at /ms-playwright/chromium/chrome-linux/chrome";
  });

  it('responde 503, no un 200 que se vea verde', async () => {
    const res = await pedir();
    const cuerpo = await res.json();

    expect(res.status).toBe(503);
    expect(cuerpo.corrio).toBe(false);
    // El motivo tiene que decir QUÉ hacer, no solo que falló.
    expect(cuerpo.motivo).toContain('CUADRA_CHROMIUM_PATH');
    // Y el error del navegador tal cual: es lo que identifica el fallo.
    expect(cuerpo.error).toContain("Executable doesn't exist");
  });

  it('NO toca los tickets: se recogen enteros en la corrida en que sí se pueda', async () => {
    // `facturarAlVuelo` es quien escribe `autofactura_intentada_en`. No llamarlo
    // es lo que deja el ticket sin marcar; marcarlo aquí los mandaría al final de
    // la cola sin haberlo intentado nunca.
    const cuerpo = await (await pedir()).json();

    expect(facturarAlVuelo).not.toHaveBeenCalled();
    expect(cuerpo.sinIntentar).toBe(1);
    expect(cuerpo.intentados).toBe(0);
  });

  it('no lo reintenta flota por flota: un arranque fallido vale para toda la corrida', async () => {
    cola = { data: [fila({ id: 'g-1', tenant_id: 't-1' }), fila({ id: 'g-2', tenant_id: 't-2' })], error: null };

    const cuerpo = await (await pedir()).json();

    expect(conNavegador).toHaveBeenCalledTimes(1);
    expect(cuerpo.sinIntentar).toBe(2);
  });

  it('lo que SÍ se pudo hacer sin navegador se hizo, y se reporta', async () => {
    // El 503 no puede leerse como "no pasó nada": los tickets sin portal
    // automatizable ya quedaron intentados y sellados.
    cola = { data: [fila({ id: 'sin-portal', ocr_extra: OTRO }), fila({ id: 'capufe-1' })], error: null };

    const res = await pedir();
    const cuerpo = await res.json();

    expect(res.status).toBe(503);
    expect(facturarAlVuelo).toHaveBeenCalledTimes(1);
    expect((facturarAlVuelo.mock.calls[0][0] as { gastoId: string }).gastoId).toBe('sin-portal');
    expect(cuerpo.intentados).toBe(1);
    expect(cuerpo.sinIntentar).toBe(1);
  });

  it('lo grita en el log: sin esto el 503 se ve en Vercel y no dice por qué', async () => {
    await pedir();
    expect(logger.error).toHaveBeenCalledWith('cron.facturar.sin_navegador', expect.objectContaining({ sinIntentar: 1 }));
  });
});

describe('el modo', () => {
  it('EL DEFAULT ES ENSAYO: el cron no emite CFDI por su cuenta', async () => {
    // La prueba más importante del archivo. Un cron corriendo solo, sin nadie
    // mirando, es donde un selector equivocado emite cincuenta facturas malas.
    const cuerpo = await (await pedir()).json();

    expect(cuerpo.modo).toBe('ensayo');
    expect((facturarAlVuelo.mock.calls[0][0] as unknown as { modo: string }).modo).toBe('ensayo');
  });

  it('solo emite con FACTURACION_MODO=emitir puesto a mano en el ambiente', async () => {
    process.env.FACTURACION_MODO = 'emitir';
    const cuerpo = await (await pedir()).json();
    delete process.env.FACTURACION_MODO;

    expect(cuerpo.modo).toBe('emitir');
    expect((facturarAlVuelo.mock.calls[0][0] as unknown as { modo: string }).modo).toBe('emitir');
  });

  it('cualquier otro valor es ensayo', async () => {
    process.env.FACTURACION_MODO = 'EMITIR';
    const cuerpo = await (await pedir()).json();
    delete process.env.FACTURACION_MODO;
    expect(cuerpo.modo).toBe('ensayo');
  });
});

describe('cuando la base no contesta', () => {
  it('devuelve 500 con el error, no un lote vacío que parezca "no había nada"', async () => {
    cola = { data: null, error: { message: 'timeout' } };
    const res = await pedir();

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('timeout');
    expect(facturarAlVuelo).not.toHaveBeenCalled();
  });
});
