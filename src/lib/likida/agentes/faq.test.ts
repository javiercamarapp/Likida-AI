import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// ATENCIÓN Y FAQ (0218) — el único de los seis que gasta modelo, y por eso el
// único con dos guardias encima. Los contratos:
//  · Si el ticket no matchea el corpus, la pieza dice «esto lo contesta un
//    humano» — el agente NO improvisa cuando no sabe.
//  · Una cifra que ninguna fuente respalda TIRA el texto del modelo entero;
//    la pieza sale con el borrador de citas literales, nunca a medias.
//  · Una cita fuera del corpus recuperado hace lo mismo.
//  · Un ticket que ya tiene borrador no recibe otro (una pieza por ticket).
//  · Un ticket roto no tumba el lote, y el costo MEDIDO se anota aunque la
//    corrida truene — el techo del runner no puede quedar ciego.
// ═══════════════════════════════════════════════════════════════════════════

const respuestas = new Map<string, Array<Record<string, unknown>>>();
function responderDe(tabla: string) {
  const cola = respuestas.get(tabla);
  return cola && cola.length > 0 ? cola.shift()! : { data: [], count: 0, error: null };
}
function builder(tabla: string) {
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b, eq: () => b, is: () => b, not: () => b, gte: () => b, lt: () => b,
    in: () => b, limit: () => b, maybeSingle: () => b, order: () => b, range: () => b,
    then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve().then(() => responderDe(tabla)).then(res, rej),
  });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const registrarCorrida = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('./corridas', () => ({ registrarCorrida: (...a: unknown[]) => registrarCorrida(...a) }));

// `./exito` se mockea entero: aquí se prueba el FAQ, no el resto del rubro —
// y así la cola de la bandeja se observa sin arrastrar los cinco motores.
const piezaExistente = vi.fn(async (..._a: unknown[]) => false);
const encolarPiezaExito = vi.fn(async (..._a: unknown[]) => 'encolada' as const);
// Parcial: se doblan las DOS escrituras a la bandeja y se deja lo puro tal
// cual — `cuentaComoRespuesta` es la definición compartida de «sin respuesta»
// (c6-5) y doblarla probaría el doble, no la regla.
vi.mock('./exito', async (orig) => ({
  ...(await orig() as object),
  piezaExistente: (...a: unknown[]) => piezaExistente(...a),
  encolarPiezaExito: (...a: unknown[]) => encolarPiezaExito(...a),
}));

const generateResponse = vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({
  text: 'Respuesta del modelo.', cost: 0.004, tokensIn: 100, tokensOut: 50, model: 'm', noMedido: false,
}));
vi.mock('@/lib/llm/openrouter', () => ({ generateResponse: (...a: unknown[]) => generateResponse(...a) }));

const {
  normalizar, temaDelTicket, lineaDeFicha, borradorCitado, borradorHumano,
  guardarBorrador, armarPiezaFaq, correrAtencionFaq, PALABRAS_POR_TEMA,
} = await import('./faq');

const FICHA_CFDI = {
  norma_id: 'cff-29-A', cita: 'CFF art. 29-A', titulo: 'Requisitos de los comprobantes fiscales',
  jerarquia: 1 as const, vinculante: true, estado: 'verificado_fuente_primaria' as const,
  afirmable: true, exigible_desde: null,
};

const TICKET = {
  id: 'tttttttt-1111-2222-3333-444444444444', tenantId: 'flota-1',
  asunto: 'No me llegó el CFDI de la mensualidad',
  descripcion: 'Pagué el mes pasado y no tengo la factura.',
  categoria: 'facturacion',
};

beforeEach(() => {
  respuestas.clear();
  vi.clearAllMocks();
  piezaExistente.mockResolvedValue(false);
  encolarPiezaExito.mockResolvedValue('encolada');
  generateResponse.mockResolvedValue({ text: 'Respuesta del modelo.', cost: 0.004, tokensIn: 100, tokensOut: 50, model: 'm', noMedido: false });
});

// ── El matcher del corpus ──────────────────────────────────────────────────

describe('el ticket contra el corpus', () => {
  it('normalizar quita acentos y mayúsculas: «Diésel» y «diesel» son la misma palabra', () => {
    expect(normalizar('DIÉSEL en la Autopista')).toBe('diesel en la autopista');
  });

  it('el mapa de palabras va sin acentos: si alguna los trajera, jamás matchearía', () => {
    for (const palabras of Object.values(PALABRAS_POR_TEMA)) {
      for (const p of palabras) expect(p, `"${p}"`).toBe(normalizar(p));
    }
  });

  it('un ticket de facturación cae en cfdi_y_facturacion', () => {
    const c = temaDelTicket(TICKET.asunto, TICKET.descripcion);
    expect(c?.tema).toBe('cfdi_y_facturacion');
    expect(c?.palabras).toContain('cfdi');
  });

  it('gana el tema con MÁS palabras distintas, y el empate lo rompe el orden declarado', () => {
    const c = temaDelTicket('Diésel y combustible: el estímulo del diesel en la caseta', null);
    expect(c?.tema).toBe('diesel_y_combustible');
  });

  it('un ticket que el corpus no cubre devuelve null — y eso es la respuesta correcta', () => {
    expect(temaDelTicket('¿Me pueden dar un descuento en el plan?', 'Quiero renegociar el precio.')).toBeNull();
  });
});

// ── Las dos guardias ───────────────────────────────────────────────────────

describe('las dos guardias sobre el texto del modelo', () => {
  const CONTEXTO = 'TICKET\nAsunto: No me llegó el CFDI\nFUENTES\n- CFF art. 29-A';

  it('un texto limpio con una cita del corpus pasa', () => {
    const g = guardarBorrador('Los requisitos del comprobante están en el CFF art. 29-A.', [FICHA_CFDI], CONTEXTO);
    expect(g.motivo).toBeNull();
    expect(g.texto).toContain('29-A');
  });

  it('una cifra que ninguna fuente respalda TIRA el texto entero', () => {
    const g = guardarBorrador('Te devolvemos $12,450.00 del mes pasado.', [FICHA_CFDI], CONTEXTO);
    expect(g.texto).toBeNull();
    expect(g.motivo).toMatch(/cifra que ninguna fuente respalda/);
  });

  it('una cita legal fuera del corpus recuperado también lo tira', () => {
    // El «27» va en el contexto A PROPÓSITO: así la guardia de CIFRAS deja
    // pasar el número y quien tiene que atrapar la cita es la de FUNDAMENTO.
    // Sin esto la prueba pasaría por el motivo equivocado y la segunda
    // guardia nunca se ejercitaría.
    const conElNumero = `${CONTEXTO}\nFolio del ticket: 27`;
    const g = guardarBorrador('Eso lo resuelve el artículo 27, fracción III de la LISR.', [FICHA_CFDI], conElNumero);
    expect(g.texto).toBeNull();
    expect(g.motivo).toMatch(/fuera del corpus/);
  });

  it('si el propio modelo declara que el corpus no alcanza, se le hace caso', () => {
    const g = guardarBorrador('No alcanza el corpus para contestar esto.', [FICHA_CFDI], CONTEXTO);
    expect(g.texto).toBeNull();
    expect(g.motivo).toMatch(/el corpus no alcanza/);
  });

  it('una respuesta vacía no es una respuesta', () => {
    expect(guardarBorrador('   ', [FICHA_CFDI], CONTEXTO).texto).toBeNull();
  });
});

// ── Las piezas ─────────────────────────────────────────────────────────────

describe('la pieza que llega a la bandeja', () => {
  it('la ficha se escribe con su peso legal, no solo con su número', () => {
    expect(lineaDeFicha(FICHA_CFDI)).toContain('nivel 1, obliga');
    expect(lineaDeFicha({ ...FICHA_CFDI, vinculante: false, jerarquia: 5 })).toContain('orienta, NO obliga');
  });

  it('el borrador sin modelo son las citas literales y lo dice', () => {
    const c = { tema: 'cfdi_y_facturacion' as const, palabras: ['cfdi'] };
    const cuerpo = borradorCitado(TICKET, c, [FICHA_CFDI]);
    expect(cuerpo).toContain('CFF art. 29-A');
    expect(cuerpo).toContain('No hay redacción del modelo');
  });

  it('cuando el corpus no cubre el ticket, la pieza dice quién lo contesta', () => {
    const cuerpo = borradorHumano(TICKET, 'el ticket no matchea ningún tema del corpus citable');
    expect(cuerpo).toContain('ESTO LO CONTESTA UN HUMANO');
    expect(cuerpo).toContain('sería inventarlo');
  });

  it('la pieza con guardia superada dice que la pasó; sin ella, dice por qué no', () => {
    const c = { tema: 'cfdi_y_facturacion' as const, palabras: ['cfdi'] };
    expect(armarPiezaFaq(TICKET, c, [FICHA_CFDI], 'Texto bueno.', null)).toContain('pasó las dos guardias');
    const sin = armarPiezaFaq(TICKET, c, [FICHA_CFDI], null, 'el modelo no respondió');
    expect(sin).toContain('SIN REDACCIÓN DEL MODELO');
    expect(sin).toContain('el modelo no respondió');
    // Y en los dos casos, la pieza NO es una respuesta enviada.
    expect(sin).toContain('aprobarlo es humano');
  });
});

// ── La corrida ─────────────────────────────────────────────────────────────

function sembrarTicket(t = TICKET) {
  respuestas.set('ticket_soporte', [{ data: [{ id: t.id, tenant_id: t.tenantId, asunto: t.asunto, descripcion: t.descripcion, categoria: t.categoria }], error: null }]);
  // El hilo se LEE (autor_id + interna) desde c6-5, ya no se cuenta.
  respuestas.set('ticket_mensaje', [{ data: [], error: null }]);
}

describe('la corrida de atencion_faq', () => {
  it('sin tickets vivos no redacta nada y lo dice', async () => {
    respuestas.set('ticket_soporte', [{ data: [], error: null }]);
    const r = await correrAtencionFaq('cron', '2026-08-27');
    expect(r).toMatchObject({ resultado: 'corrio', piezas: 0, costoUsd: 0 });
    expect(r.motivo).toMatch(/ningún ticket vivo/);
    expect(generateResponse).not.toHaveBeenCalled();
  });

  it('un ticket que YA tiene respuesta en el hilo no se toca', async () => {
    respuestas.set('ticket_soporte', [{ data: [{ id: TICKET.id, tenant_id: 'f', asunto: 'x', descripcion: null, categoria: 'otro', abierto_por: 'u-cliente' }], error: null }]);
    respuestas.set('ticket_mensaje', [{ data: [{ autor_id: 'u-soporte', interna: false }], error: null }]);
    const r = await correrAtencionFaq('cron', '2026-08-27');
    expect(r.piezas).toBe(0);
    expect(encolarPiezaExito).not.toHaveBeenCalled();
  });

  // c6-5: lo que NO cuenta como respuesta y por tanto NO saca al ticket de
  // la cola. Los dos casos que la versión vieja dejaba escapar.
  it('el propio solicitante insistiendo NO es una respuesta', async () => {
    respuestas.set('ticket_soporte', [{ data: [{ id: TICKET.id, tenant_id: 'f', asunto: 'CFDI cancelado', descripcion: null, categoria: 'facturacion', abierto_por: 'u-cliente' }], error: null }]);
    respuestas.set('ticket_mensaje', [{ data: [
      { autor_id: 'u-cliente', interna: false },
      { autor_id: 'u-cliente', interna: false },
    ], error: null }]);
    await correrAtencionFaq('cron', '2026-08-27');
    expect(piezaExistente).toHaveBeenCalled();  // el ticket SIGUE en la cola
  });

  it('una nota INTERNA del equipo tampoco es una respuesta', async () => {
    respuestas.set('ticket_soporte', [{ data: [{ id: TICKET.id, tenant_id: 'f', asunto: 'CFDI cancelado', descripcion: null, categoria: 'facturacion', abierto_por: 'u-cliente' }], error: null }]);
    respuestas.set('ticket_mensaje', [{ data: [{ autor_id: 'u-soporte', interna: true }], error: null }]);
    await correrAtencionFaq('cron', '2026-08-27');
    expect(piezaExistente).toHaveBeenCalled();
  });

  it('un ticket del corpus produce borrador con modelo, con el tenant del ticket y su costo medido', async () => {
    sembrarTicket();
    generateResponse.mockResolvedValue({ text: 'Revisa el CFF art. 29-A: ahí están los requisitos del comprobante.', cost: 0.0123, tokensIn: 1, tokensOut: 1, model: 'm', noMedido: false });
    const r = await correrAtencionFaq('cron', '2026-08-27');
    expect(r.piezas).toBe(1);
    expect(r.costoUsd).toBeCloseTo(0.0123, 6);
    const [, tipo, titulo, cuerpo, fuentes, tenantId] = encolarPiezaExito.mock.calls[0] as unknown[];
    expect(tipo).toBe('faq_borrador');
    expect(titulo).toBe('FAQ — ticket tttttttt');
    expect(tenantId).toBe('flota-1');
    expect(cuerpo as string).toContain('pasó las dos guardias');
    expect((fuentes as { con_modelo: boolean }).con_modelo).toBe(true);
    // El costo MEDIDO se anota en la corrida: es lo que el runner compara
    // contra el techo antes de la siguiente pasada.
    expect(registrarCorrida).toHaveBeenCalledWith(null, 'atencion_faq', expect.objectContaining({ costoUsd: 0.0123 }));
  });

  it('un ticket fuera del corpus NO se le pregunta al modelo: se escala a un humano', async () => {
    sembrarTicket({ ...TICKET, asunto: '¿Me hacen descuento?', descripcion: 'Quiero renegociar.' });
    const r = await correrAtencionFaq('cron', '2026-08-27');
    expect(generateResponse).not.toHaveBeenCalled();
    expect(r.piezas).toBe(1);
    expect(r.costoUsd).toBe(0);
    const [, tipo, , cuerpo] = encolarPiezaExito.mock.calls[0] as unknown[];
    expect(tipo).toBe('faq_escalado');
    expect(cuerpo as string).toContain('ESTO LO CONTESTA UN HUMANO');
  });

  it('si el modelo inventa una cifra, la pieza sale con las citas literales — nunca con el texto sucio', async () => {
    sembrarTicket();
    generateResponse.mockResolvedValue({ text: 'Te devolvemos $9,999.00 de inmediato.', cost: 0.002, tokensIn: 1, tokensOut: 1, model: 'm', noMedido: false });
    const r = await correrAtencionFaq('cron', '2026-08-27');
    expect(r.piezas).toBe(1);
    const [, , , cuerpo, fuentes] = encolarPiezaExito.mock.calls[0] as unknown[];
    expect(cuerpo as string).not.toContain('9,999');
    expect(cuerpo as string).toContain('SIN REDACCIÓN DEL MODELO');
    expect((fuentes as { con_modelo: boolean }).con_modelo).toBe(false);
    // El gasto ocurrió aunque el texto se tirara: el techo no puede ignorarlo.
    expect(r.costoUsd).toBeCloseTo(0.002, 6);
  });

  it('si el modelo no responde, la pieza sale igual con las citas', async () => {
    sembrarTicket();
    generateResponse.mockRejectedValue(new Error('502 del proveedor'));
    const r = await correrAtencionFaq('cron', '2026-08-27');
    expect(r.piezas).toBe(1);
    expect((encolarPiezaExito.mock.calls[0] as unknown[])[3] as string).toContain('el modelo no respondió');
  });

  it('un ticket que ya tiene borrador no recibe otro', async () => {
    sembrarTicket();
    piezaExistente.mockResolvedValue(true);
    const r = await correrAtencionFaq('cron', '2026-08-27');
    expect(r.piezas).toBe(0);
    expect(encolarPiezaExito).not.toHaveBeenCalled();
    expect(generateResponse).not.toHaveBeenCalled();
  });

  it('un ticket roto NO tumba el lote', async () => {
    respuestas.set('ticket_soporte', [{
      data: [
        { id: 'aaaaaaaa-1', tenant_id: 'f', asunto: 'CFDI cancelado', descripcion: null, categoria: 'facturacion' },
        { id: 'bbbbbbbb-2', tenant_id: 'f', asunto: 'CFDI duplicado', descripcion: null, categoria: 'facturacion' },
      ],
      error: null,
    }]);
    respuestas.set('ticket_mensaje', [{ data: [], error: null }, { data: [], error: null }]);
    piezaExistente.mockRejectedValueOnce(new Error('la bandeja no contesta'));
    const r = await correrAtencionFaq('cron', '2026-08-27');
    expect(r.piezas).toBe(1); // el segundo sí entró
  });

  it('una lectura caída deja la corrida en fallo y el costo anotado', async () => {
    respuestas.set('ticket_soporte', [{ data: null, error: { message: 'base caída' } }]);
    await expect(correrAtencionFaq('cron', '2026-08-27')).rejects.toThrow(/base caída/);
    expect(registrarCorrida).toHaveBeenCalledWith(null, 'atencion_faq', expect.objectContaining({ estado: 'fallo', costoUsd: 0 }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL RELOJ DE LA VUELTA (auditoría ciclo 7, c7-1).
//
// ESTE ES EL MOTOR MÁS PARECIDO AL QUE CAUSÓ LOS DOS SILENCIOS DE PRODUCCIÓN.
// Igual que `loteRedactor`, itera una lista de trabajo llamando al MODELO por
// elemento; e igual que él, `ordenarPorCosto` lo despacha AL FINAL de la vuelta
// (`llamaAlModelo('atencion_faq')` es `true`), o sea que hereda todo el
// presupuesto de tiempo que quede. Y sin embargo sus únicas salidas eran el
// tope de cinco borradores y el final de la lista: ninguna miraba el reloj.
//
// El auditor lo dijo así: la suite no atrapaba c7-1 porque «no hay una sola
// prueba en la que un agente ya despachado se pase del presupuesto». Éstas son
// esas pruebas.
// ═══════════════════════════════════════════════════════════════════════════

describe('el reloj de la vuelta corta el lote del FAQ, y lo DICE (c7-1)', () => {
  const RELOJ_VENCIDO = () => Date.now() - 1;

  it('con el reloj vencido no llama al modelo ni una vez, y el corte NO se disfraza de «no había nada que redactar»', async () => {
    sembrarTicket();
    const r = await correrAtencionFaq('cron', '2026-08-27', RELOJ_VENCIDO());

    // CORTA: cero llamadas al modelo, que es lo caro y lo lento (decenas de
    // segundos cada una) y lo que se comía el presupuesto de la ruta para latir.
    expect(generateResponse).not.toHaveBeenCalled();
    expect(encolarPiezaExito).not.toHaveBeenCalled();
    // CUENTA: `sinTurno` sube. Sin él, el runner no mete al agente en
    // `saltadosPorReloj` y el latido diría 'ok' sobre una pasada agonizante —
    // el 28-ago-2026 en una línea.
    expect(r).toMatchObject({ resultado: 'corrio', piezas: 0, sinTurno: true });
    // Y el motivo NO puede ser el del estado sano: «ningún ticket vivo sin
    // respuesta» es lo que se lee cuando todo está bien.
    expect(r.motivo).toMatch(/reloj de la vuelta/);
    expect(r.motivo).not.toMatch(/ningún ticket vivo/);
  });

  it('cortado A LA MITAD: el borrador ya hecho queda, el siguiente no se paga, y el resto se cuenta', async () => {
    // Dos tickets del corpus: una lista de trabajo real sobre la que cortar.
    respuestas.set('ticket_soporte', [{ data: [
      { id: 'aaaaaaaa-0000-0000-0000-000000000001', tenant_id: 'flota-1', asunto: TICKET.asunto, descripcion: TICKET.descripcion, categoria: 'facturacion' },
      { id: 'bbbbbbbb-0000-0000-0000-000000000002', tenant_id: 'flota-2', asunto: TICKET.asunto, descripcion: TICKET.descripcion, categoria: 'facturacion' },
    ], error: null }]);
    respuestas.set('ticket_mensaje', [{ data: [], error: null }, { data: [], error: null }]);

    // EL RELOJ QUE SE AGOTA DENTRO DEL BUCLE: vivo al entrar, vencido en cuanto
    // la primera llamada al modelo termina. Es la reproducción honesta del
    // incidente — la función se muere DENTRO del lote, no antes de entrar.
    let ahora = 1_000_000;
    const vence = ahora + 10_000;
    const reloj = vi.spyOn(Date, 'now').mockImplementation(() => ahora);
    generateResponse.mockImplementation(async () => {
      ahora = vence + 1;
      return { text: 'Revisa el CFF art. 29-A.', cost: 0.004, tokensIn: 1, tokensOut: 1, model: 'm', noMedido: false };
    });
    try {
      const r = await correrAtencionFaq('cron', '2026-08-27', vence);

      // CORTA: el segundo ticket no se pagó.
      expect(generateResponse).toHaveBeenCalledTimes(1);
      // NO DEJA EL ESTADO A MEDIAS: el borrador que sí se fabricó ENTRÓ a la
      // bandeja. Cortar entre la llamada al modelo y el encolado habría tirado
      // un borrador ya pagado — dinero gastado y trabajo perdido.
      expect(encolarPiezaExito).toHaveBeenCalledTimes(1);
      expect(r.piezas).toBe(1);
      expect(r.costoUsd).toBeCloseTo(0.004, 6);
      // CUENTA: el que no alcanzó turno se dice, y se dice AUNQUE se haya
      // fabricado una pieza — un `piezas: 1` mudo es el parte limpio sobre una
      // pasada que dejó trabajo sin hacer.
      expect(r.sinTurno).toBe(true);
      expect(r.motivo).toMatch(/1 ticket\(s\) sin turno/);
    } finally {
      reloj.mockRestore();
    }
  });

  it('sin reloj el lote corre entero — el parámetro es opcional a propósito', async () => {
    sembrarTicket();
    const r = await correrAtencionFaq('cron', '2026-08-27');
    expect(r.piezas).toBe(1);
    expect(r.sinTurno).toBeUndefined();
  });
});
