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
//   · `confianzaOcr === null` NO es confianza alta. Un comprobante sin confianza
//     registrada es uno del que no se sabe nada; tratarlo como bueno es
//     exactamente lo que el umbral existe para impedir.
//   · EL MODO POR DEFECTO ES `ensayo`. Esa es la prueba más importante del
//     archivo: no protege un comportamiento, protege que un cambio futuro no
//     empiece a emitir facturas reales sin que nadie lo haya pedido.
//   · Y el caso feo: el portal SÍ emitió pero guardar el UUID falló. Devuelve
//     `facturado: true`. Perder el UUID es un problema de registro; volver a
//     facturar es un problema fiscal del cliente.
// ═══════════════════════════════════════════════════════════════════════════

const { facturarConAgente, adaptadorDe } = vi.hoisted(() => ({
  facturarConAgente: vi.fn(),
  adaptadorDe: vi.fn(),
}));
vi.mock('./agente', () => ({ facturarConAgente, adaptadorDe }));

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

/** Lo que devuelve el SELECT del gasto. */
let lectura: { data: Record<string, unknown> | null; error: { message: string } | null };
/** Lo que devuelve el UPDATE que guarda el UUID. */
let resultadoUpdate: { error: { message: string } | null };
const filtros: Array<[string, unknown[]]> = [];
const updates: Array<{ fila: Record<string, unknown>; por: [string, unknown] }> = [];

function cadenaLectura() {
  const nodo: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'limit', 'order']) {
    nodo[m] = (...a: unknown[]) => { filtros.push([m, a]); return nodo; };
  }
  nodo.maybeSingle = () => Promise.resolve(lectura);
  nodo.then = (r: (v: unknown) => unknown) => Promise.resolve(lectura).then(r);
  return nodo;
}

const from = vi.fn((tabla: string) => ({
  select: (...a: unknown[]) => { filtros.push([`select ${tabla}`, a]); return cadenaLectura(); },
  update: (f: Record<string, unknown>) => ({
    eq: (col: string, val: unknown) => { updates.push({ fila: f, por: [col, val] }); return Promise.resolve(resultadoUpdate); },
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (...a: unknown[]) => from(...(a as [string])) }),
}));

const { decidirAutofactura, facturarAlVuelo, CONFIANZA_MINIMA_AUTOFACTURA } = await import('./al_vuelo');
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

beforeEach(() => {
  lectura = { data: g(), error: null };
  resultadoUpdate = { error: null };
  filtros.length = 0;
  updates.length = 0;
  from.mockClear();
  facturarConAgente.mockReset();
  facturarConAgente.mockResolvedValue({ modo: 'emitir', ok: true, capturado: {}, cfdiUuid: 'B0800A68-1111-2222-3333-444455556666' });
  adaptadorDe.mockReset();
  adaptadorDe.mockReturnValue(ADAPTADOR);
  for (const f of Object.values(logger)) f.mockReset();
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
    expect(d.detalle).toBe('confianza 0.89');
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
    expect(decidirAutofactura(ticket(), 0, true).detalle).toBe('confianza 0.00');
  });

  it('OJO · un 0.899 se rechaza diciendo "confianza 0.90", que es el umbral mismo', () => {
    // `toFixed(2)` redondea, y el detalle es lo que se lee en la pantalla de
    // "por facturar": dice que se rechazó por una confianza igual al mínimo
    // aceptable. Quien lo lea va a creer que la regla está mal, no la lectura.
    expect(decidirAutofactura(ticket(), 0.899, true)).toEqual({
      procede: false, motivo: 'confianza_baja', detalle: 'confianza 0.90',
    });
  });

  it('BUG · un NaN pasa el umbral y AUTORIZA la emisión', () => {
    // `NaN < 0.9` es false y `NaN === null` es false: la comparación deja pasar
    // el único valor que no significa nada. Y no es hipotético — el llamador
    // hace `Number(data.ocr_confianza)`, que da NaN para `undefined` o para
    // cualquier texto que no sea un número. Ver la reproducción de punta a punta
    // en «BUG · un gasto sin la columna `ocr_confianza`…» más abajo.
    expect(decidirAutofactura(ticket(), Number.NaN, true)).toEqual({ procede: true });
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

  it('BUG · un gasto sin la columna `ocr_confianza` SE EMITE sin confianza ninguna', async () => {
    // Reproducción de punta a punta del NaN: la fila llega sin esa clave —un
    // `select` que la deje fuera, una vista, un renombre de columna como el que
    // ya mató a `ocr_raw`— y `Number(undefined)` da NaN. NaN no es null y no es
    // menor que 0.9, así que la puerta se abre y en modo `emitir` esto crea un
    // CFDI REAL sobre un ticket del que no se sabe nada.
    const sinColumna: Record<string, unknown> = { ...g() };
    delete sinColumna.ocr_confianza;
    lectura = { data: sinColumna, error: null };

    const r = await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', modo: 'emitir', hoy: HOY });

    expect(facturarConAgente).toHaveBeenCalledTimes(1);
    expect((facturarConAgente.mock.calls[0] as [{ modo: string }])[0].modo).toBe('emitir');
    expect(r.facturado).toBe(true);
  });
});

describe('facturarAlVuelo · lo que pasa después del portal', () => {
  it('emitido y guardado: devuelve el UUID', async () => {
    const r = await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', modo: 'emitir', hoy: HOY });

    expect(r).toEqual({ intentado: true, facturado: true, cfdiUuid: 'B0800A68-1111-2222-3333-444455556666' });
    expect(updates).toEqual([{ fila: { cfdi_uuid: 'B0800A68-1111-2222-3333-444455556666' }, por: ['id', 'g-1'] }]);
    expect(logger.info).toHaveBeenCalledWith('autofactura.ok', expect.objectContaining({ gastoId: 'g-1' }));
  });

  it('EL CASO FEO: el portal facturó y guardar el UUID falló → `facturado: true`', async () => {
    // El CFDI ya existe ante el SAT. Devolver "no facturado" haría que el
    // siguiente intento —de esta corrida o de una pantalla— emitiera un SEGUNDO
    // documento por el mismo ticket. Perder el UUID en nuestra base es un
    // problema de registro; duplicar un CFDI es un problema fiscal del cliente.
    resultadoUpdate = { error: { message: 'deadlock detected' } };

    const r = await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', modo: 'emitir', hoy: HOY });

    expect(r).toEqual({ intentado: true, facturado: true, cfdiUuid: 'B0800A68-1111-2222-3333-444455556666' });
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

    expect(r).toEqual({ intentado: true, facturado: false, detalle: 'el portal no cargó' });
    expect(updates).toEqual([]);
  });

  it('un `ok` sin UUID no se cuenta como facturado', async () => {
    // Es justo lo que devuelve un ensayo: llenó todo y se detuvo antes del
    // botón. Contarlo como facturado marcaría el gasto y nadie volvería a él.
    facturarConAgente.mockResolvedValue({ modo: 'ensayo', ok: true, capturado: { referencia: '286188' } });

    const r = await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', hoy: HOY });

    expect(r).toMatchObject({ intentado: true, facturado: false });
    expect(r.cfdiUuid).toBeUndefined();
    expect(updates).toEqual([]);
  });

  it('OJO · el ensayo exitoso se registra como "autofactura.fallo"', async () => {
    // El modo por DEFECTO termina siempre en esta rama: un ensayo que salió bien
    // deja un warn de fallo con `error: undefined`. El valor devuelto es
    // correcto; lo que miente es el log, y es el log donde alguien va a buscar
    // por qué "no se factura nada" cuando en realidad nunca se pidió emitir.
    facturarConAgente.mockResolvedValue({ modo: 'ensayo', ok: true, capturado: {} });
    await facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', hoy: HOY });
    expect(logger.warn).toHaveBeenCalledWith('autofactura.fallo', { gastoId: 'g-1', error: undefined });
  });

  it('si el agente revienta, el error sube: aquí no se atrapa nada', async () => {
    // `facturarConAgente` ya atrapa lo suyo y devuelve `{ok:false}`; que esto no
    // ponga un segundo try/catch es lo que impide reintentar a ciegas después de
    // un fallo ambiguo, que en `emitir` es como se acaba con dos CFDI.
    facturarConAgente.mockRejectedValue(new Error('playwright crashed'));
    await expect(facturarAlVuelo({ gastoId: 'g-1', tenantId: 't-1', modo: 'emitir', hoy: HOY }))
      .rejects.toThrow('playwright crashed');
    expect(updates).toEqual([]);
  });
});
