import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// FACTURAR AL VUELO — el único módulo del repo que puede hacer algo
// IRREVERSIBLE ante el SAT.
//
// Emitir un CFDI no se deshace: cancelarlo cuesta y, fuera de plazo, se le
// queda al cliente en su contabilidad. Por eso las pruebas de este archivo no
// están repartidas por igual: casi todas vigilan el CAMINO A EMITIR.
//
//   · `decidirAutofactura` es pura y es la puerta. Cada motivo de rechazo tiene
//     su prueba, y el umbral se prueba en el borde exacto (0.89 / 0.90 / 0.91),
//     porque un `<=` donde va un `<` no se ve leyendo.
//   · LO QUE NO ES UN NÚMERO FINITO NO ES CONFIANZA ALTA. `null`, `undefined` y
//     `NaN` caen los tres en `confianza_baja`. La comprobación anterior era
//     `=== null || < 0.9` y con `NaN` las dos daban false, así que un
//     comprobante del que no se sabía NADA autorizaba timbrar un CFDI. Se
//     prueba el valor Y la forma: ningún no-numérico puede volver a abrirlo.
//   · EL MODO POR DEFECTO ES `ensayo`. Esa es la prueba más importante del
//     archivo: no protege un comportamiento, protege que un cambio futuro no
//     empiece a emitir facturas reales sin que nadie lo haya pedido.
//   · Y el caso feo: el portal SÍ emitió pero guardar el UUID falló. Devuelve
//     `facturado: true`. Perder el UUID es un problema de registro; volver a
//     facturar es un problema fiscal del cliente.
// ═══════════════════════════════════════════════════════════════════════════

const { facturarConAgente, adaptadorDe, facturarLoteConAgente } = vi.hoisted(() => ({
  facturarConAgente: vi.fn(),
  adaptadorDe: vi.fn(),
  facturarLoteConAgente: vi.fn(),
}));
/**
 * Se doblan las TRES puertas al portal y NADA MÁS.
 *
 * `pideCaptcha` se deja REAL a propósito: es la que decide si un ticket sale de
 * la cola automática y entra al camino de una persona. Doblarla dejaría que la
 * prueba afirmara ese ruteo mientras el predicado de verdad dice otra cosa —o
 * sea probaría el doble. Es una función pura de una línea; no hay nada que
 * aislar.
 */
vi.mock('./agente', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./agente')>()),
  facturarConAgente, adaptadorDe, facturarLoteConAgente,
}));

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

/**
 * Lo que devuelve el SELECT del gasto. `facturarAlVuelo` lee UNA fila
 * (`.maybeSingle()`); `facturarLoteAlVuelo` lee VARIAS (`.in('id', …)`) — el
 * mismo doble sirve a los dos porque los dos leen de `nodo.then` directo.
 */
let lectura: { data: Record<string, unknown> | Record<string, unknown>[] | null; error: { message: string } | null };
/** Lo que devuelve el UPDATE que guarda el UUID. */
let resultadoUpdate: { error: { message: string } | null };
/** Lo que devuelve el UPDATE que sella el intento. */
let resultadoSello: { error: { message: string } | null };
const filtros: Array<[string, unknown[]]> = [];
const updates: Array<{ fila: Record<string, unknown>; por: Array<[string, unknown]> }> = [];

function cadenaLectura() {
  const nodo: Record<string, unknown> = {};
  // `.in()` es lo que usa `facturarLoteAlVuelo` para leer TODO el lote en un
  // solo viaje (`facturarAlVuelo` lee uno con `.eq('id', …)` y no lo necesita).
  for (const m of ['select', 'eq', 'is', 'in', 'limit', 'order']) {
    nodo[m] = (...a: unknown[]) => { filtros.push([m, a]); return nodo; };
  }
  nodo.maybeSingle = () => Promise.resolve(lectura);
  nodo.then = (r: (v: unknown) => unknown) => Promise.resolve(lectura).then(r);
  return nodo;
}

/**
 * El UPDATE admite `.eq()` ENCADENADO, no uno solo.
 *
 * No es cosmética del doble: las dos escrituras de este módulo van acotadas por
 * `id` Y por `tenant_id`. Un doble que solo aceptara un `eq` obligaría a
 * escribir la consulta sin el filtro de flota para que la prueba pasara — o sea
 * el doble dictando que se pueda escribir en la fila de otra empresa.
 */
/**
 * Los ids que "ganan" el claim de `reclamarIntentos`. `null` = todos los que
 * se pidieron por `.in('id', …)` (el caso normal: nadie más compite por ellos).
 * Se pone en `[]` para simular que otra corrida ya se los llevó — el UPDATE
 * condicional no devuelve filas sin que eso sea un error.
 */
let idsReclamados: string[] | null = null;

function cadenaUpdate(fila: Record<string, unknown>, resultado: () => { error: { message: string } | null }) {
  const por: Array<[string, unknown]> = [];
  updates.push({ fila, por });
  const nodo: Record<string, unknown> = {};
  nodo.eq = (col: string, val: unknown) => { por.push([col, val]); return nodo; };
  // `.in()` porque el sello del intento se pone para TODO el lote en un solo
  // viaje a la base: ocho updates para ordenar la cola serían presupuesto del
  // cron gastado en contabilidad propia. El doble lo acepta igual que `.eq`
  // —registra columna y valor— para que las pruebas puedan seguir mirando que
  // la escritura va acotada por flota.
  nodo.in = (col: string, val: unknown) => { por.push([col, val]); return nodo; };
  // `.is()`/`.or()` del claim de `reclamarIntentos` (AUD-9): no son parte del
  // acotamiento por flota que `por` existe para vigilar, así que no se
  // registran ahí — son no-ops que solo mantienen la cadena.
  nodo.is = () => nodo;
  nodo.or = () => nodo;
  // El claim termina en `.select('id')` y espera FILAS de vuelta —las que
  // ganaron la carrera—, no solo `{error}` como las demás escrituras de este
  // módulo. Sin esto el `data` que lee `reclamarIntentos` sale `undefined`, el
  // Set de ganadores queda vacío SIEMPRE, y todo el módulo se comporta como si
  // cada corrida perdiera su propia carrera.
  nodo.select = () => {
    nodo.then = (r: (v: unknown) => unknown) => Promise.resolve((() => {
      const { error } = resultado();
      if (error) return { data: null, error };
      const pedidos = (por.find(([col]) => col === 'id')?.[1] as string[] | undefined) ?? [];
      const ganados = idsReclamados ?? pedidos;
      return { data: ganados.map((id) => ({ id })), error: null };
    })()).then(r);
    return nodo;
  };
  nodo.then = (r: (v: unknown) => unknown) => Promise.resolve(resultado()).then(r);
  return nodo;
}

const from = vi.fn((tabla: string) => ({
  select: (...a: unknown[]) => { filtros.push([`select ${tabla}`, a]); return cadenaLectura(); },
  update: (f: Record<string, unknown>) =>
    cadenaUpdate(f, () => ('autofactura_intentada_en' in f ? resultadoSello : resultadoUpdate)),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (...a: unknown[]) => from(...(a as [string])) }),
}));

const { decidirAutofactura, facturarAlVuelo, facturarLoteAlVuelo, CONFIANZA_MINIMA_AUTOFACTURA } = await import('./al_vuelo');
const { armar } = await import('./pendientes');

const HOY = '2026-08-04';

// Enerser NO pide cuenta → es de los que la máquina puede hacer sola.
// OXXO Gas sí → ese va con el encargado, con su sesión.
const SIN_CUENTA = { urlFacturacion: 'https://facturacion.enerser.com.mx/', webId: '650', estacion: 'E1' };
const CON_CUENTA = { urlFacturacion: 'https://facturacion.oxxogas.com/', webId: '650', estacion: 'E1' };

/** Una fila de `gasto` como la devuelve la consulta de `facturarAlVuelo`. */
const g = (o: Record<string, unknown> = {}) => ({
  id: 'g-1', concepto: 'diesel', monto: 400, fecha: HOY, folio: '286188',
  rfc_emisor: null, cfdi_uuid: null, ocr_confianza: 0.95, ocr_extra: SIN_CUENTA,
  ...o,
});

/** El ticket ya armado, que es lo que recibe la función pura. */
const ticket = (o: Record<string, unknown> = {}) => armar(g(o) as Parameters<typeof armar>[0], HOY);

const ADAPTADOR = { comercio: 'enerser', portal: 'x', facturar: vi.fn() };

/** El sello del intento, que va en CADA llamada que llega a decidir. */
const AHORA = '2026-08-04T18:00:00.000Z';
const SELLO = { autofactura_intentada_en: AHORA };
/** Los updates que NO son el sello: es lo que las pruebas viejas medían. */
const sinSello = () => updates.filter((u) => !('autofactura_intentada_en' in u.fila));
const sellos = () => updates.filter((u) => 'autofactura_intentada_en' in u.fila);

beforeEach(() => {
  lectura = { data: g(), error: null };
  resultadoUpdate = { error: null };
  resultadoSello = { error: null };
  idsReclamados = null;
  filtros.length = 0;
  updates.length = 0;
  from.mockClear();
  facturarConAgente.mockReset();
  facturarConAgente.mockResolvedValue({ modo: 'emitir', ok: true, capturado: {}, cfdiUuid: 'B0800A68-1111-2222-3333-444455556666' });
  // Sin este reset, la primera prueba que de verdad ejercite `facturarLoteAlVuelo`
  // (antes de esta ronda, ninguna lo hacía) deja su llamada registrada para
  // SIEMPRE: `facturarLoteConAgente` nunca se limpiaba porque nunca se llamaba.
  facturarLoteConAgente.mockReset();
  adaptadorDe.mockReset();
  adaptadorDe.mockReturnValue(ADAPTADOR);
  for (const f of Object.values(logger)) f.mockReset();
  // El candado del mandato (auditoría 10) se prueba en SU PROPIO describe, más
  // abajo. En todas las demás pruebas de este archivo se da por aceptado, para
  // que sigan probando lo que ya probaban: si `modo:'emitir'` llega o no llega
  // al agente, no si el mandato está firmado.
  process.env.FACTURACION_MANDATO_ACEPTADO = 'si';
});

// ═══════════════════════════════════════════════════════════════════════════
// decidirAutofactura — la puerta, y es pura
// ═══════════════════════════════════════════════════════════════════════════

describe('decidirAutofactura · cuándo SÍ', () => {
  it('portal sin cuenta, campos completos, adaptador y confianza alta', () => {
    expect(decidirAutofactura(ticket(), 0.95, true)).toEqual({ procede: true });
  });

  it('no arrastra motivo ni detalle cuando procede', () => {
    const d = decidirAutofactura(ticket(), 0.99, true);
    expect(d.motivo).toBeUndefined();
    expect(d.detalle).toBeUndefined();
  });
});

describe('decidirAutofactura · el umbral, en el borde', () => {
  it('0.90 exacto SÍ pasa — el umbral es el mínimo aceptable, no el primero rechazado', () => {
    expect(CONFIANZA_MINIMA_AUTOFACTURA).toBe(0.9);
    expect(decidirAutofactura(ticket(), 0.9, true).procede).toBe(true);
  });

  it('0.91 pasa y 0.89 no', () => {
    expect(decidirAutofactura(ticket(), 0.91, true).procede).toBe(true);
    const d = decidirAutofactura(ticket(), 0.89, true);
    expect(d).toMatchObject({ procede: false, motivo: 'confianza_baja' });
    expect(d.detalle).toBe('confianza 0.890');
  });

  it('`null` NO es confianza alta: sin confianza registrada no se emite nada', () => {
    // El caso que de verdad importa: un `null` que se colara como "no menor que
    // 0.9" emitiría un CFDI sobre una lectura de la que no se sabe NADA. Y el
    // detalle tiene que distinguirlo de una confianza baja medida, porque en
    // pantalla son dos problemas distintos.
    const d = decidirAutofactura(ticket(), null, true);
    expect(d).toEqual({ procede: false, motivo: 'confianza_baja', detalle: 'sin confianza registrada' });
  });

  it('0 se rechaza como cifra medida, no como dato ausente', () => {
    // Y se distingue en el texto de "sin confianza registrada": un 0 medido y
    // un dato ausente son dos problemas distintos en la pantalla de "por
    // facturar" — uno es una foto mala, el otro un OCR que no corrió.
    expect(decidirAutofactura(ticket(), 0, true).detalle).toBe('confianza 0.000');
  });

  it('el detalle lleva TRES decimales: con dos, el rechazo se contradecía solo', () => {
    // `(0.899).toFixed(2)` imprime "0.90", o sea el rechazo declaraba una
    // confianza IGUAL al mínimo aceptable, y quien leyera la pantalla de "por
    // facturar" creería que la regla está mal, no la lectura.
    expect(decidirAutofactura(ticket(), 0.899, true)).toEqual({
      procede: false, motivo: 'confianza_baja', detalle: 'confianza 0.899',
    });
  });

  it('OJO · el redondeo no desapareció, se corrió tres decimales adentro', () => {
    // `ocr_confianza` es `numeric(4,3)`, así que la base no puede guardar un
    // 0.8999 y esto no se ve en producción hoy. Queda fijado porque el día que
    // esa precisión cambie, el detalle vuelve a declarar el umbral exacto como
    // motivo del rechazo.
    expect(decidirAutofactura(ticket(), 0.8999, true).detalle).toBe('confianza 0.900');
  });

  it('NaN es ausencia de dato, NUNCA confianza alta — aquí hubo un agujero que emitía', () => {
    // El agujero: la comprobación era `confianzaOcr === null || confianzaOcr <
    // 0.9`, y con `NaN` las DOS dan false —`NaN === null` es false y `NaN < 0.9`
    // también—, así que caía por abajo a `procede: true`. No era hipotético: el
    // llamador hace `Number(data.ocr_confianza)`, que devuelve NaN con la
    // columna vacía o con texto. Un comprobante del que no se sabía NADA
    // autorizaba timbrar un CFDI irreversible ante el SAT.
    expect(decidirAutofactura(ticket(), Number.NaN, true)).toEqual({
      procede: false, motivo: 'confianza_baja', detalle: 'sin confianza registrada',
    });
  });

  it('y `undefined` cae en el mismo cajón que `null` y `NaN`', () => {
    // El tipo dice `number | null`, pero el valor llega de una fila de PostgREST
    // por un `as`: la única defensa que aguanta es la del valor, no la del tipo.
    const sinDato = undefined as unknown as number;
    expect(decidirAutofactura(ticket(), sinDato, true)).toEqual({
      procede: false, motivo: 'confianza_baja', detalle: 'sin confianza registrada',
    });
  });

  it('ningún valor no-numérico puede volver a abrirlo', () => {
    // La forma de la comprobación importa tanto como el caso: con
    // `Number.isFinite` no queda ninguna rendija por donde entre algo que no sea
    // un número finito. Un `!== null` la reabriría entera.
    for (const v of [Number.NaN, Infinity, -Infinity, null, undefined, '0.99', {}]) {
      const d = decidirAutofactura(ticket(), v as unknown as number, true);
      expect(d.procede, `«${String(v)}» no puede autorizar una emisión`).toBe(false);
      expect(d.motivo).toBe('confianza_baja');
    }
  });
});

describe('decidirAutofactura · cada motivo de rechazo', () => {
  it('requiere_cuenta: el portal pide sesión y esa la tiene una persona', () => {
    const d = decidirAutofactura(ticket({ ocr_extra: CON_CUENTA }), 0.99, true);
    expect(d).toMatchObject({ procede: false, motivo: 'requiere_cuenta' });
    // El detalle es el NOMBRE del comercio: es lo que la persona reconoce.
    expect(d.detalle).toMatch(/oxxo gas/i);
  });

  it('incompleto: sin liga de facturación no hay portal al que entrar', () => {
    const d = decidirAutofactura(ticket({ ocr_extra: {} }), 0.99, true);
    expect(d).toMatchObject({ procede: false, motivo: 'incompleto' });
    expect(d.detalle).toMatch(/liga de facturación/i);
  });

  it('incompleto: falta un campo que el portal EXIGE', () => {
    // Enerser pide el número de referencia, que sale del folio del ticket.
    const d = decidirAutofactura(ticket({ folio: null }), 0.99, true);
    expect(d).toMatchObject({ procede: false, motivo: 'incompleto' });
    expect(d.detalle).toMatch(/referencia/i);
  });

  it('incompleto: un ticket vencido no se manda a intentar lo imposible', () => {
    const d = decidirAutofactura(armar(g({ fecha: '2026-05-01' }) as Parameters<typeof armar>[0], HOY), 0.99, true);
    expect(d).toMatchObject({ procede: false, motivo: 'incompleto' });
    expect(d.detalle).toMatch(/venci/i);
  });

  it('sin_adaptador: el portal se reconoce pero nadie sabe operarlo todavía', () => {
    const d = decidirAutofactura(ticket(), 0.99, false);
    expect(d).toMatchObject({ procede: false, motivo: 'sin_adaptador', detalle: 'enerser' });
  });

  it('el orden de los rechazos: primero lo que hace imposible el intento', () => {
    // Con varios problemas a la vez se reporta el que hay que resolver PRIMERO.
    // Decirle a alguien "confianza baja" de un ticket que además está vencido lo
    // manda a re-fotografiar algo que ya no se puede facturar.
    expect(decidirAutofactura(ticket({ ocr_extra: CON_CUENTA }), null, false).motivo).toBe('requiere_cuenta');
    expect(decidirAutofactura(ticket({ ocr_extra: {} }), null, false).motivo).toBe('incompleto');
    expect(decidirAutofactura(ticket(), null, false).motivo).toBe('sin_adaptador');
  });

  it('es PURA: no toca la base ni el agente', () => {
    decidirAutofactura(ticket(), 0.99, true);
    decidirAutofactura(ticket(), null, false);
    expect(from).not.toHaveBeenCalled();
    expect(facturarConAgente).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// facturarAlVuelo
// ═══════════════════════════════════════════════════════════════════════════

describe('facturarAlVuelo · el modo, que es lo que emite o no', () => {
  it('EL DEFAULT ES `ensayo`: sin pedirlo NUNCA se emite un CFDI', async () => {
    // La prueba que este archivo existe para tener. `ensayo` navega, llena todos
    // los campos y SE DETIENE antes del botón. Si alguien cambia este default,
    // cada foto que entre por WhatsApp emite un documento fiscal real, y no hay
    // manera de deshacerlo.
    await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', hoy: HOY });

    expect(facturarConAgente).toHaveBeenCalledTimes(1);
    const [llamada] = facturarConAgente.mock.calls[0] as [{ modo: string; comercio: string }];
    expect(llamada.modo).toBe('ensayo');
    expect(llamada.modo).not.toBe('emitir');
    expect(llamada.comercio).toBe('enerser');
  });

  it('`emitir` solo cuando se pide explícitamente', async () => {
    await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', modo: 'emitir', hoy: HOY });
    expect((facturarConAgente.mock.calls[0] as [{ modo: string }])[0].modo).toBe('emitir');
  });

  it('le pasa al agente los campos YA resueltos, no el ticket crudo', async () => {
    await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', hoy: HOY });
    const [{ campos }] = facturarConAgente.mock.calls[0] as [{ campos: Array<{ clave: string; valor: string | null }> }];
    expect(campos.find((c) => c.clave === 'referencia')?.valor).toBe('286188');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL CANDADO DEL MANDATO — auditoría 10, legal + fiscal, hallazgo ALTO.
//
// `legal.md` y `fiscal.md` documentan, cada uno desde su rubro, el mismo hueco:
// no existe una cláusula que autorice al sistema a presentar el RFC del
// cliente ante el portal de un tercero y apretar "emitir" en su nombre,
// mientras `/terminos` dice hoy "Likida no timbra facturas". El candado NO
// redacta esa cláusula —eso le toca a Javier con su abogado—, solo evita que
// `FACTURACION_MODO=emitir` tenga efecto mientras no exista: hace falta
// TAMBIÉN `FACTURACION_MANDATO_ACEPTADO=si`, puesta a mano.
//
// Estas pruebas NO doblan `modoEfectivo` — es una función pura de `./modo.ts`
// y se ejercita real, igual que `pideCaptcha` arriba: doblarla probaría el
// doble, no el candado.
// ═══════════════════════════════════════════════════════════════════════════

describe('facturarAlVuelo · el candado del mandato (auditoría 10)', () => {
  it('SIN el mandato aceptado, `emitir` se trata como `ensayo` — y se grita en el log', async () => {
    delete process.env.FACTURACION_MANDATO_ACEPTADO;

    // OJO: el doble de `facturarConAgente` (beforeEach) devuelve SIEMPRE un
    // `cfdiUuid`, sin mirar el `modo` que se le pasó — no distingue ensayo de
    // emitir. Por eso lo que prueba el candado es EL ARGUMENTO con el que se
    // llamó al agente, no lo que el agente contestó.
    await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', modo: 'emitir', hoy: HOY });

    const [llamada] = facturarConAgente.mock.calls[0] as [{ modo: string }];
    expect(llamada.modo).toBe('ensayo');
    // No es un fallo silencioso: el motivo exacto queda en el log, con la
    // fuente del hallazgo, para que quien active el modo sin saber de esto se
    // entere de inmediato de por qué no está emitiendo.
    expect(logger.error).toHaveBeenCalledWith('autofactura.mandato_no_aceptado', {
      detalle: 'FACTURACION_MODO=emitir ignorado: falta FACTURACION_MANDATO_ACEPTADO — ver docs/auditoria-10/legal.md',
    });
  });

  it('CON `FACTURACION_MANDATO_ACEPTADO=si`, `emitir` sí llega al agente como `emitir`', async () => {
    process.env.FACTURACION_MANDATO_ACEPTADO = 'si';
    await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', modo: 'emitir', hoy: HOY });
    const [llamada] = facturarConAgente.mock.calls[0] as [{ modo: string }];
    expect(llamada.modo).toBe('emitir');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('un valor que NO sea exactamente "si" no cuenta como aceptado — "SI", "true", "1"', async () => {
    for (const valor of ['SI', 'true', '1', 'sí', ' si ']) {
      facturarConAgente.mockClear();
      logger.error.mockClear();
      process.env.FACTURACION_MANDATO_ACEPTADO = valor;

      await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', modo: 'emitir', hoy: HOY });

      const [llamada] = facturarConAgente.mock.calls[0] as [{ modo: string }];
      expect(llamada.modo, `«${valor}» no debería aceptar el mandato`).toBe('ensayo');
    }
  });

  it('el modo `ensayo` NUNCA necesita el mandato: sin él, sigue llegando como `ensayo` y sin gritar', async () => {
    delete process.env.FACTURACION_MANDATO_ACEPTADO;
    await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', hoy: HOY });
    const [llamada] = facturarConAgente.mock.calls[0] as [{ modo: string }];
    expect(llamada.modo).toBe('ensayo');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('el candado también cubre el LOTE, no solo el ticket suelto', async () => {
    delete process.env.FACTURACION_MANDATO_ACEPTADO;
    lectura = { data: [g()], error: null };
    facturarLoteConAgente.mockResolvedValueOnce({
      modo: 'ensayo', ok: true, capturado: {},
      porGasto: [{ gastoId: 'g-1', incluido: true }],
    });

    await facturarLoteAlVuelo({
      tenantId: 't-1', comercio: 'enerser', gastoIds: ['g-1'], modo: 'emitir', hoy: HOY,
    });

    const [llamada] = facturarLoteConAgente.mock.calls[0] as [{ modo: string }];
    expect(llamada.modo).toBe('ensayo');
    expect(logger.error).toHaveBeenCalledWith('autofactura.mandato_no_aceptado', expect.any(Object));
  });
});

describe('facturarAlVuelo · lo que NO se intenta', () => {
  it('un gasto que ya tiene CFDI no se re-factura', async () => {
    // Refacturar es emitir un SEGUNDO documento fiscal por el mismo ticket. Se
    // corta antes de mirar nada más.
    lectura = { data: g({ cfdi_uuid: 'B0800A68-YA-EXISTE' }), error: null };
    const r = await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', modo: 'emitir', hoy: HOY });

    expect(r).toEqual({ intentado: false, facturado: false, motivo: 'ya_facturado' });
    expect(facturarConAgente).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it('un gasto de otra flota no existe para esta', async () => {
    lectura = { data: null, error: null };
    const r = await facturarAlVuelo({ gastoId: 'g-1', tenantId: 'OTRA', hoy: HOY });
    expect(r).toEqual({ intentado: false, facturado: false, detalle: 'no existe' });
    expect(facturarConAgente).not.toHaveBeenCalled();
  });

  it('la consulta va acotada por tenant, no solo por id', async () => {
    await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', hoy: HOY });
    const eq = filtros.filter(([m]) => m === 'eq').map(([, a]) => a);
    expect(eq).toContainEqual(['id', 'g-1']);
    expect(eq).toContainEqual(['tenant_id', 't-1']);
  });

  it('si la lectura falla, NO se factura a ciegas y el motivo se devuelve', async () => {
    lectura = { data: null, error: { message: 'timeout' } };
    const r = await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', modo: 'emitir', hoy: HOY });
    expect(r).toEqual({ intentado: false, facturado: false, detalle: 'timeout' });
    expect(facturarConAgente).not.toHaveBeenCalled();
  });

  it('lo que la decisión rechaza no llega al portal, y se dice por qué', async () => {
    lectura = { data: g({ ocr_confianza: 0.5 }), error: null };
    const r = await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', modo: 'emitir', hoy: HOY });

    expect(r).toMatchObject({ intentado: false, facturado: false, motivo: 'confianza_baja' });
    expect(facturarConAgente).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('autofactura.no_procede', { gastoId: 'g-1', motivo: 'confianza_baja' });
  });

  it('confianza NULA en la base tampoco llega al portal', async () => {
    lectura = { data: g({ ocr_confianza: null }), error: null };
    const r = await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', modo: 'emitir', hoy: HOY });
    expect(r.motivo).toBe('confianza_baja');
    expect(r.detalle).toBe('sin confianza registrada');
    expect(facturarConAgente).not.toHaveBeenCalled();
  });

  it('la confianza llega como string desde PostgREST y se compara como número', async () => {
    // `numeric(4,3)` viaja como "0.950". Comparado como texto, "0.950" < 0.9
    // sería una comparación entre tipos distintos y el umbral dejaría de medir.
    lectura = { data: g({ ocr_confianza: '0.950' }), error: null };
    await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', hoy: HOY });
    expect(facturarConAgente).toHaveBeenCalledTimes(1);
  });

  it('sin adaptador registrado para ese portal no se intenta nada', async () => {
    adaptadorDe.mockReturnValue(null);
    const r = await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', modo: 'emitir', hoy: HOY });
    expect(r).toMatchObject({ intentado: false, motivo: 'sin_adaptador' });
    expect(facturarConAgente).not.toHaveBeenCalled();
  });

  it('un gasto sin la columna `ocr_confianza` NO LLEGA AL PORTAL ni en modo emitir', async () => {
    // Reproducción de punta a punta del agujero del NaN: la fila llega sin esa
    // clave —un `select` que la deje fuera, una vista, un renombre de columna
    // como el que ya mató a `ocr_raw`— y `Number(undefined)` da NaN. Antes eso
    // abría la puerta y en modo `emitir` timbraba un CFDI real sobre un ticket
    // del que no se sabía nada. Es la prueba que más caro sale perder.
    const sinColumna: Record<string, unknown> = { ...g() };
    delete sinColumna.ocr_confianza;
    lectura = { data: sinColumna, error: null };

    const r = await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', modo: 'emitir', hoy: HOY });

    expect(facturarConAgente).not.toHaveBeenCalled();
    expect(r).toEqual({
      intentado: false, facturado: false,
      motivo: 'confianza_baja', detalle: 'sin confianza registrada',
    });
  });

  it('una confianza de texto tampoco: `Number("alta")` es NaN', async () => {
    lectura = { data: g({ ocr_confianza: 'alta' }), error: null };
    const r = await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', modo: 'emitir', hoy: HOY });
    expect(facturarConAgente).not.toHaveBeenCalled();
    expect(r.motivo).toBe('confianza_baja');
  });
});

describe('facturarAlVuelo · lo que pasa después del portal', () => {
  it('emitido y guardado: devuelve el UUID', async () => {
    const r = await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', modo: 'emitir', hoy: HOY });

    expect(r).toEqual({
      intentado: true, facturado: true, cfdiUuid: 'B0800A68-1111-2222-3333-444455556666',
      capturado: {}, captura: undefined,
    });
    // Acotado por id Y por tenant: el `select` ya probó que la fila es de esta
    // flota, pero una escritura sin el filtro es la forma de que un `gastoId`
    // venido de fuera acabe marcando la fila de otra empresa.
    //
    // `cfdi_orden: 1` es de la 0065: un gasto que factura solo es el primero (y
    // el único) de su CFDI. Lo que reparte 2, 3, 4… es el lote de CAPUFE, y esa
    // es exactamente la posición que sigue chocando si el mismo CFDI entra otra
    // vez por el camino de ingesta.
    expect(sinSello()).toEqual([{
      fila: { cfdi_uuid: 'B0800A68-1111-2222-3333-444455556666', cfdi_orden: 1 },
      por: [['id', 'g-1'], ['tenant_id', 't-1']],
    }]);
    expect(logger.info).toHaveBeenCalledWith('autofactura.ok', expect.objectContaining({ gastoId: 'g-1' }));
  });

  it('EL CASO FEO: el portal facturó y guardar el UUID falló → `facturado: true`', async () => {
    // El CFDI ya existe ante el SAT. Devolver "no facturado" haría que el
    // siguiente intento —de esta corrida o de una pantalla— emitiera un SEGUNDO
    // documento por el mismo ticket. Perder el UUID en nuestra base es un
    // problema de registro; duplicar un CFDI es un problema fiscal del cliente.
    resultadoUpdate = { error: { message: 'deadlock detected' } };

    const r = await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', modo: 'emitir', hoy: HOY });

    expect(r).toMatchObject({ intentado: true, facturado: true, cfdiUuid: 'B0800A68-1111-2222-3333-444455556666' });
    // Y SALE DE LA COLA AUTOMÁTICA (mig. 0065). Es la mitad que faltaba: sin
    // esto, el gasto se ve sin CFDI, el cron lo vuelve a elegir la hora
    // siguiente y emite un SEGUNDO documento por el mismo consumo — el problema
    // fiscal que este caso existe para no tener.
    expect(r.bloqueado).toContain('YA SE EMITIÓ');
    // Y NO se reintenta: una sola visita al portal.
    expect(facturarConAgente).toHaveBeenCalledTimes(1);
    // El UUID queda en el log, que es lo único que permite recuperarlo a mano.
    expect(logger.error).toHaveBeenCalledWith('autofactura.uuid_sin_guardar', expect.objectContaining({
      gastoId: 'g-1', uuid: 'B0800A68-1111-2222-3333-444455556666', err: 'deadlock detected',
    }));
  });

  it('si el portal falla, el gasto ya está guardado y esto solo lo reporta', async () => {
    // Best-effort a propósito: corre dentro del presupuesto del webhook de
    // WhatsApp y el chofer ya recibió su acuse. Tirar el mensaje entero porque
    // un portal no contestó cambiaría un problema de oficina por uno de ruta.
    facturarConAgente.mockResolvedValue({ modo: 'emitir', ok: false, capturado: {}, error: 'el portal no cargó' });

    const r = await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', modo: 'emitir', hoy: HOY });

    expect(r).toEqual({
      intentado: true, facturado: false, detalle: 'el portal no cargó',
      capturado: {}, captura: undefined,
    });
    expect(sinSello()).toEqual([]);
  });

  it('un `ok` sin UUID no se cuenta como facturado, y se dice que fue un ensayo', async () => {
    // Es justo lo que devuelve un ensayo: llenó todo y se detuvo antes del
    // botón. Contarlo como facturado marcaría el gasto y nadie volvería a él;
    // devolverlo sin explicación deja a la pantalla de "por facturar" sin saber
    // por qué ese ticket sigue ahí.
    facturarConAgente.mockResolvedValue({ modo: 'ensayo', ok: true, capturado: { referencia: '286188' } });

    const r = await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', hoy: HOY });

    // Y VUELVE LO QUE SE HABRÍA ESCRITO. Es lo único que hace que el ensayo
    // sirva de algo: el modo por defecto del cron nunca devuelve folio, así que
    // sin `capturado` (y sin la captura de pantalla) la corrida entera se
    // resumía en una frase que no distingue un formulario bien llenado de uno
    // con el RFC en el campo del correo.
    expect(r).toEqual({
      intentado: true, facturado: false,
      detalle: 'ensayo: se llenó el portal y no se emitió',
      capturado: { referencia: '286188' }, captura: undefined,
    });
    expect(r.cfdiUuid).toBeUndefined();
    expect(sinSello()).toEqual([]);
  });

  it('UN ENSAYO EXITOSO NO ES UN FALLO: no ensucia el log de fallos', async () => {
    // El modo por DEFECTO termina siempre en esta rama. Antes caía en
    // `!r.ok || !r.cfdiUuid` y dejaba un warn `autofactura.fallo` con
    // `error: undefined` por cada foto que entraba: quien fuera a averiguar
    // "por qué no se factura nada" encontraba fallos que no ocurrieron, y el
    // log de fallos deja de servir para lo único que sirve.
    facturarConAgente.mockResolvedValue({ modo: 'ensayo', ok: true, capturado: { referencia: '286188' } });

    await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', hoy: HOY });

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('autofactura.ensayo', { gastoId: 'g-1', capturado: 1 });
  });

  it('si el agente revienta, el error sube: aquí no se atrapa nada', async () => {
    // `facturarConAgente` ya atrapa lo suyo y devuelve `{ok:false}`; que esto no
    // ponga un segundo try/catch es lo que impide reintentar a ciegas después de
    // un fallo ambiguo, que en `emitir` es como se acaba con dos CFDI.
    facturarConAgente.mockRejectedValue(new Error('playwright crashed'));
    await expect(facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', modo: 'emitir', hoy: HOY }))
      .rejects.toThrow('playwright crashed');
    expect(sinSello()).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL SELLO DEL INTENTO — lo que impide que la cola se bloquee a sí misma
//
// `gasto.autofactura_intentada_en` entró en la 0063 exactamente para esto: el
// cron ordena por `autofactura_intentada_en nulls first, created_at` y toma
// ocho. Sin escribir la columna, los ocho gastos más viejos que NO proceden
// —portal con cuenta, confianza baja, un campo que falta— salen elegidos en
// CADA corrida, para siempre, y los que sí se pueden facturar no entran nunca.
//
// Desde fuera eso se ve como un cron que corre cada hora y no factura nada, o
// sea el mismo verde engañoso que persigue todo este módulo, una capa más
// abajo. Y la columna existía sin que nadie la escribiera.
// ═══════════════════════════════════════════════════════════════════════════

describe('facturarAlVuelo · sella el intento, proceda o no', () => {
  it('LO MARCA AUNQUE NO PROCEDA — es el caso entero', async () => {
    // El ticket de confianza baja no se puede facturar hoy, pero SÍ se intentó.
    // Sin el sello vuelve a salir el primero en la corrida siguiente, y en la
    // siguiente, tapando a los que sí se pueden facturar.
    lectura = { data: g({ ocr_confianza: 0.5 }), error: null };

    const r = await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', hoy: HOY, ahora: AHORA });

    expect(r.motivo).toBe('confianza_baja');
    expect(facturarConAgente).not.toHaveBeenCalled();
    expect(sellos()).toEqual([{ fila: SELLO, por: [['id', ['g-1']], ['tenant_id', 't-1']] }]);
  });

  it('lo marca también cuando procede y el portal factura', async () => {
    await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', modo: 'emitir', hoy: HOY, ahora: AHORA });
    expect(sellos()).toEqual([{ fila: SELLO, por: [['id', ['g-1']], ['tenant_id', 't-1']] }]);
  });

  it('lo marca también cuando el portal se reconoce pero nadie sabe operarlo', async () => {
    adaptadorDe.mockReturnValue(null);
    const r = await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', hoy: HOY, ahora: AHORA });
    expect(r.motivo).toBe('sin_adaptador');
    expect(sellos()).toHaveLength(1);
  });

  it('el sello va ANTES del portal: si el agente revienta, ya está puesto', async () => {
    // Si se pusiera después, un portal caído dejaría a sus ocho tickets sin
    // sellar y volverían a acaparar el lote entero en la corrida siguiente —
    // justo cuando el portal sigue caído. La cola se atoraría sola contra el
    // fallo que menos rápido se arregla.
    facturarConAgente.mockRejectedValue(new Error('playwright crashed'));

    await expect(facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', modo: 'emitir', hoy: HOY, ahora: AHORA }))
      .rejects.toThrow('playwright crashed');

    expect(sellos()).toEqual([{ fila: SELLO, por: [['id', ['g-1']], ['tenant_id', 't-1']] }]);
  });

  it('NO sella lo que no se pudo leer: "no contestó la base" no es un intento', async () => {
    lectura = { data: null, error: { message: 'timeout' } };
    await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', hoy: HOY, ahora: AHORA });
    expect(updates).toEqual([]);
  });

  it('NO sella un gasto de otra flota', async () => {
    lectura = { data: null, error: null };
    await facturarAlVuelo({ gastoId: 'g-1', tenantId: 'OTRA', hoy: HOY, ahora: AHORA });
    expect(updates).toEqual([]);
  });

  it('NO sella uno que ya tiene CFDI: no hay nada que intentar', async () => {
    lectura = { data: g({ cfdi_uuid: 'B0800A68-YA-EXISTE' }), error: null };
    await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', hoy: HOY, ahora: AHORA });
    expect(updates).toEqual([]);
  });

  it('EL DOBLE CFDI: si otra corrida ganó el claim, no se abre el portal', async () => {
    // LA PRUEBA QUE JUSTIFICA TODO EL CAMBIO.
    //
    // Vercel Cron entrega at-least-once, y el candado era un `if
    // (data.cfdi_uuid)` en memoria con una sesión de navegador de 10-60 s
    // detrás. Dos corridas solapadas leían las dos `cfdi_uuid IS NULL`, las dos
    // sellaban, las dos manejaban el portal, y las dos emitían: DOS CFDI del
    // mismo ticket. Hoy lo tapa que el modo por defecto es `ensayo` — o sea que
    // el defecto se estrena el día que se ponga en `emitir`.
    //
    // `idsReclamados = []` es el UPDATE condicional devolviendo CERO filas, que
    // es como Postgres dice "otro proceso llegó primero". No es un error: es el
    // resultado normal de perder una carrera.
    idsReclamados = [];

    const r = await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', modo: 'emitir', hoy: HOY, ahora: AHORA });

    expect(r.motivo).toBe('ya_en_proceso');
    expect(r.intentado).toBe(false);
    expect(r.facturado).toBe(false);
    // Lo que de verdad importa: el portal NO se tocó. Todo lo demás es
    // contabilidad; esto es lo irreversible ante el SAT.
    expect(facturarConAgente).not.toHaveBeenCalled();
  });

  it('el claim va acotado por flota Y exige que el CFDI siga vacío', async () => {
    // El UPDATE tiene que llevar `id` + `tenant_id` (no se escribe en la fila de
    // otra empresa) y las condiciones de la carrera. Si alguien quitara el
    // `.is('cfdi_uuid', null)`, el claim dejaría de ser una carrera contra un
    // ticket ya facturado y volveríamos al defecto por otra puerta.
    await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', modo: 'emitir', hoy: HOY, ahora: AHORA });

    const claim = sellos()[0];
    expect(claim.fila).toEqual({ autofactura_intentada_en: AHORA });
    expect(claim.por).toEqual([['id', ['g-1']], ['tenant_id', 't-1']]);
  });

  it('si el CLAIM no se puede confirmar, NO se factura: falla cerrado y lo dice', async () => {
    // ESTE TEST CAMBIÓ DE SENTIDO A PROPÓSITO.
    //
    // Antes decía "si el sello no se guarda, el intento SIGUE", con el argumento
    // de que el sello ordenaba la cola y no autorizaba nada. Eso era cierto
    // mientras el sello fuera solo un sello — pero el candado contra el doble
    // CFDI era un `if (data.cfdi_uuid)` en memoria, y entre esa lectura y la
    // escritura del UUID hay una sesión de navegador de 10-60 s. Con Vercel Cron
    // entregando at-least-once, dos corridas solapadas leían las dos
    // `cfdi_uuid IS NULL`, las dos sellaban y las dos emitían: DOS CFDI del
    // mismo ticket, con el SAT ya enterado.
    //
    // Ahora el UPDATE condicional ES la carrera, así que "seguir sin haber
    // confirmado el claim" es exactamente el camino por el que se emite el
    // segundo CFDI. Se falla CERRADO. El problema de orden en la cola se
    // resuelve solo en la corrida siguiente; un CFDI de más, no.
    resultadoSello = { error: { message: 'deadlock detected' } };

    const r = await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', modo: 'emitir', hoy: HOY, ahora: AHORA });

    expect(r.facturado).toBe(false);
    expect(r.intentado).toBe(false);
    expect(r.motivo).toBe('ya_en_proceso');
    expect(logger.warn).toHaveBeenCalledWith('autofactura.claim_sin_guardar', {
      gastoId: 'g-1', err: 'deadlock detected',
    });
  });

  it('sin `ahora` el sello es una marca de tiempo ISO de verdad', async () => {
    await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', hoy: HOY });
    const [s] = sellos();
    expect(typeof s.fila.autofactura_intentada_en).toBe('string');
    expect(Number.isFinite(Date.parse(s.fila.autofactura_intentada_en as string))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// facturarLoteAlVuelo — LA MISMA CARRERA, PERO ESTE ES EL CAMINO QUE DE VERDAD
// CORRE EN PRODUCCIÓN.
//
// `route.ts` del cron llama `facturarLoteAlVuelo`, no `facturarAlVuelo` — el
// lote es el camino real (ver el bloque de comentarios arriba de la función:
// "la sesión se paga una vez"). Antes de esta ronda el archivo tenía CERO
// pruebas para esta función: `route.test.ts` la dobla por completo
// (`vi.mock('@/lib/likida/facturacion/al_vuelo', …)`), así que la lógica real
// del claim dentro del lote —el mismo `reclamarIntentos` que arriba se probó
// para UN gasto— nunca se había ejercitado. Auditoría 10, backend: hueco de
// cobertura en el camino fiscal irreversible que de verdad ejecuta el cron.
// ═══════════════════════════════════════════════════════════════════════════
describe('facturarLoteAlVuelo · la misma carrera del claim, pero por lote', () => {
  const g2 = (o: Record<string, unknown> = {}) => g({ id: 'g-2', folio: '999999', ...o });

  it('EL DOBLE CFDI, por lote: el gasto que otra corrida ya se ganó no entra al portal, y el resto del lote sigue', async () => {
    // Dos tickets en el lote. `idsReclamados = ['g-1']` simula el UPDATE
    // condicional devolviendo SOLO la fila que esta corrida ganó — 'g-2' lo
    // tomó otro proceso entre la lectura del lote y el claim (el escenario que
    // el propio código describe en el comentario de `facturarLoteAlVuelo`:
    // "Lo que no esté ahí lo tomó otro proceso y no se toca").
    lectura = { data: [g(), g2()], error: null };
    idsReclamados = ['g-1'];
    facturarLoteConAgente.mockResolvedValueOnce({
      modo: 'emitir', ok: true, capturado: {},
      porGasto: [{ gastoId: 'g-1', incluido: true, cfdiUuid: 'B0800A68-1111-2222-3333-444455556666' }],
    });

    const r = await facturarLoteAlVuelo({
      tenantId: 't-1', comercio: 'enerser', gastoIds: ['g-1', 'g-2'], modo: 'emitir', hoy: HOY, ahora: AHORA,
    });

    // El portal SOLO vio el ticket que ganó el claim — 'g-2' nunca entró a la
    // sesión, que es justo lo que evita el segundo CFDI.
    expect(facturarLoteConAgente).toHaveBeenCalledTimes(1);
    const { tickets } = facturarLoteConAgente.mock.calls[0][0] as { tickets: Array<{ gastoId: string }> };
    expect(tickets.map((t) => t.gastoId)).toEqual(['g-1']);

    const deG2 = r.porGasto.find((p) => p.gastoId === 'g-2');
    expect(deG2).toMatchObject({ intentado: false, facturado: false, motivo: 'ya_en_proceso' });

    const deG1 = r.porGasto.find((p) => p.gastoId === 'g-1');
    expect(deG1).toMatchObject({ intentado: true, facturado: true, cfdiUuid: 'B0800A68-1111-2222-3333-444455556666' });
  });

  it('si NADIE del lote gana el claim, el navegador nunca se abre — cero filas no es un error', async () => {
    // El caso extremo del mismo hallazgo: la corrida entera llegó tarde. Las
    // dos filas las tomó otro proceso; `idsReclamados = []` es el UPDATE
    // condicional devolviendo cero filas para las dos.
    lectura = { data: [g(), g2()], error: null };
    idsReclamados = [];

    const r = await facturarLoteAlVuelo({
      tenantId: 't-1', comercio: 'enerser', gastoIds: ['g-1', 'g-2'], modo: 'emitir', hoy: HOY, ahora: AHORA,
    });

    expect(facturarLoteConAgente).not.toHaveBeenCalled();
    expect(r.facturados).toBe(0);
    expect(r.porGasto).toEqual([
      { gastoId: 'g-1', intentado: false, facturado: false, motivo: 'ya_en_proceso' },
      { gastoId: 'g-2', intentado: false, facturado: false, motivo: 'ya_en_proceso' },
    ]);
  });
});
