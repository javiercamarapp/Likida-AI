import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL ATAJO QUE CONTESTA "¿CUÁNTO LLEVO?" — y el `null` que lo hace seguro.
//
// El módulo tiene DOS clientes y solo uno se ve:
//
//   · el chofer que pregunta, que recibe cifras;
//   · el AGENTE de siempre, que recibe todo lo demás. Ese cliente no aparece
//     en el archivo, pero cada `null` es un mensaje que le llega. Cada mensaje
//     que esta regla se traga POR ERROR es un mensaje que el agente NUNCA ve:
//     no se contesta mal, se contesta otra cosa y ahí se acaba el camino.
//
// Por eso el peso de este archivo está en los negativos, y por eso los FALSOS
// POSITIVOS tienen su propio bloque: son el modo de falla del atajo, y hoy hay
// varios con frases que un operador de camión escribe todos los días.
//
// La segunda mitad fija que la respuesta NO OPINA. "Vas bien" es un juicio que
// depende de la política de la flota —topes por concepto, CFDI exigido, reglas
// por ruta— y lo emite el motor de cuadre. Un mensaje de estado que se adelanta
// a decirlo le está dando al chofer una absolución que nadie firmó.
// ═══════════════════════════════════════════════════════════════════════════

/** Nodo encadenable: `.select().eq().order()` / `.maybeSingle()` → resultado. */
function cadena(resultado: () => unknown) {
  const nodo: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'not', 'limit', 'order']) nodo[m] = () => nodo;
  nodo.maybeSingle = () => Promise.resolve(resultado());
  nodo.then = (r: (v: unknown) => unknown) => Promise.resolve(resultado()).then(r);
  return nodo;
}

/** Lo que devuelve cada tabla en la prueba en curso. */
const respuesta: Record<string, unknown> = {};
const from = vi.fn((tabla: string) => cadena(() => respuesta[tabla] ?? { data: null, error: null }));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (...a: unknown[]) => from(...(a as [string])) }),
}));

const { interpretarPregunta, armarRespuesta, estadoDelViaje, responderConsulta } =
  await import('./consulta_chofer');
type TipoConsulta = NonNullable<ReturnType<typeof interpretarPregunta>>;

beforeEach(() => {
  from.mockClear();
  for (const k of Object.keys(respuesta)) delete respuesta[k];
});

// ═══════════════════════════════════════════════════════════════════════════
// interpretarPregunta — LOS ACIERTOS
// ═══════════════════════════════════════════════════════════════════════════

describe('interpretarPregunta reconoce las formas en que se pregunta de verdad', () => {
  it.each([
    ['¿cuánto llevo?', 'saldo'],
    // Un chofer teclea sin tildes en un teléfono, de pie, junto a la unidad.
    ['cuanto llevo', 'saldo'],
    ['CUÁNTO LLEVO', 'saldo'],
    ['como voy', 'saldo'],
    ['cuánto he comprobado', 'saldo'],
    ['mi saldo', 'saldo'],
    ['¿qué me falta?', 'faltantes'],
    ['falta algo', 'faltantes'],
    ['qué recibiste', 'ultimo'],
    ['cual fue el ultimo', 'ultimo'],
    ['ayuda', 'ayuda'],
    ['menu', 'ayuda'],
    ['opciones', 'ayuda'],
    ['qué puedo hacer', 'ayuda'],
  ] as ReadonlyArray<[string, TipoConsulta]>)('«%s» → %s', (texto, tipo) => {
    expect(interpretarPregunta(texto)).toBe(tipo);
  });

  it('las mayúsculas y los signos de pregunta no cambian nada', () => {
    expect(interpretarPregunta('  ¿CUÁNTO LLEVO GASTADO?  ')).toBe('saldo');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// interpretarPregunta — LOS NEGATIVOS, que es donde está el riesgo
// ═══════════════════════════════════════════════════════════════════════════

describe('interpretarPregunta devuelve null cuando no es una consulta', () => {
  it.each([
    ['', 'vacío'],
    ['   ', 'solo espacios'],
    ['👍', 'solo emoji'],
    ['👍👍👍', 'solo emojis'],
    ['ya quedó jefe', 'un acuse cualquiera'],
    ['aquí está el ticket de la caseta', 'lo que acompaña a una foto'],
    ['ya acabé', 'el cierre, que lo atiende el agente'],
    ['se me ponchó una llanta en la 57', 'una incidencia'],
    ['ayúdame', 'no es el comando: `ayuda\\b` no casa con «ayúdame»'],
  ])('«%s» (%s) → null', (texto) => {
    expect(interpretarPregunta(texto)).toBeNull();
  });

  it('un mensaje largo cae al agente aunque contenga la frase', () => {
    // 120 caracteres es la frontera: arriba de eso ya no es una pregunta suelta,
    // es un relato con contexto que solo el agente puede leer.
    const largo = `cuánto llevo ${'y también quería contarte lo que pasó en la caseta '.repeat(3)}`;
    expect(largo.length).toBeGreaterThan(120);
    expect(interpretarPregunta(largo)).toBeNull();
    expect(interpretarPregunta('cuánto llevo'.padEnd(120, ' ') + '')).toBe('saldo');
  });

  it('un saludo en otro renglón no estorba: la pregunta se reconoce igual', () => {
    expect(interpretarPregunta('Buenas tardes jefe\n¿cuánto llevo comprobado?')).toBe('saldo');
  });

  it('pero la pregunta PARTIDA en dos renglones se pierde (`.*` no cruza el salto)', () => {
    // Sin la bandera `s`, `\bcuánto\b.*\bllevo\b` no puede casar si el salto de
    // línea queda en medio. Cae al agente, así que no hace daño; se fija para
    // que quien toque la regla sepa que este caso existe.
    expect(interpretarPregunta('cuánto\nllevo')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FALSOS POSITIVOS — DEFECTO DOCUMENTADO, NO APROBADO.
//
// Todo lo de este bloque son mensajes que un operador manda en ruta y que la
// regla se TRAGA hoy: el chofer recibe un estado de cuenta y su mensaje real
// —«voy llegando», «no llego a tiempo», «recibido»— nunca llega al agente.
//
// Estas pruebas FIJAN LO QUE PASA HOY para que el defecto sea visible y medible,
// no para bendecirlo. Cuando alguien apriete la regla, este bloque se pone rojo:
// eso es la señal de que se arregló, y los renglones arreglados se borran de
// aquí y se mueven al bloque de negativos de arriba.
// ═══════════════════════════════════════════════════════════════════════════

describe('FALSOS POSITIVOS que hoy se traga la regla (defecto, no contrato)', () => {
  it.each([
    // ── regla 3: /\bfalta(n|rme)?\b|\bpendiente/ — la más ancha de todas ──
    ['ya me falta poco para llegar', 'faltantes'],
    ['cuánto me falta de camino', 'faltantes'],
    ['me falta diesel, ¿me autorizan carga?', 'faltantes'],
    ['falta el sello del cliente en la carta porte', 'faltantes'],
    ['me faltan 200 km', 'faltantes'],
    ['sigo pendiente de que me carguen', 'faltantes'],
    ['quedo pendiente', 'faltantes'],
    // ── regla 2: /\bsaldo\b/ — "saldo" no siempre es el del viaje ──
    ['se me acabó el saldo del celular', 'saldo'],
    ['no tengo saldo para llamar', 'saldo'],
    // ── regla 1: "como" es también conjunción y verbo, y "va" es cualquier cosa ──
    ['¿cuánto tiempo va a tardar la descarga?', 'saldo'],
    ['cuánto se va a tardar el cliente', 'saldo'],
    ['como voy saliendo tarde, ¿cancelo el viaje?', 'saldo'],
    ['¿cómo va el trámite del permiso?', 'saldo'],
    ['cuánto peso llevo en la caja', 'saldo'],
    // ── regla 4: `lleg[óo]` atrapa el presente "llego", que es media operación ──
    ['ya llego', 'ultimo'],
    ['en 20 minutos llego', 'ultimo'],
    ['no llego a tiempo', 'ultimo'],
    ['no llego al cierre de la gasolinera', 'ultimo'],
    ['ya casi llego a la caseta', 'ultimo'],
    ['no llego el cliente', 'ultimo'],
    ['el ultimo cliente ya me firmo', 'ultimo'],
    // "recibido" es el acuse de radio de toda la vida, no una pregunta.
    ['recibido', 'ultimo'],
    ['recibido jefe', 'ultimo'],
    ['recibido, voy en camino', 'ultimo'],
    // ── regla 5: anclada al inicio, pero "ayuda" también es un grito ──
    ['ayuda! se me ponchó una llanta', 'ayuda'],
  ] as ReadonlyArray<[string, TipoConsulta]>)('«%s» se traga hoy como %s', (texto, tipo) => {
    expect(interpretarPregunta(texto)).toBe(tipo);
  });

  it('el peor de todos: "no llego a tiempo" contesta con el último ticket', () => {
    // La consecuencia completa, en una sola prueba, porque el tipo de consulta
    // por sí solo no enseña el daño: el chofer avisa que va tarde y el sistema
    // le contesta con un comprobante. El aviso de retraso no llega a nadie.
    const r = armarRespuesta(interpretarPregunta('no llego a tiempo')!, {
      anticipo: 5000, comprobado: 400, comprobantes: 1,
      ultimoConcepto: 'diesel', ultimoMonto: 400, enRevision: 0,
    });
    expect(r).toMatch(/último que recibí/i);
  });
});

describe('los acentos parten la regla en dos (defecto documentado)', () => {
  // `\b` de JavaScript solo conoce [A-Za-z0-9_]: entre un espacio y una «ú» NO
  // hay frontera de palabra, así que `\b([úu]ltimo|…|lleg[óo])\b` no puede casar
  // NUNCA con la forma acentuada. El encabezado del módulo pone justo esos dos
  // ejemplos como casos que sí atiende.
  it('los ejemplos ACENTUADOS del propio encabezado NO se reconocen', () => {
    expect(interpretarPregunta('llegó mi ticket')).toBeNull();
    expect(interpretarPregunta('cuál fue el último')).toBeNull();
  });

  it('y "menú" —como lo escribe cualquiera— tampoco abre la ayuda', () => {
    // `men[úu]\b`: después de la «ú» no hay frontera de palabra, así que la
    // grafía correcta es justo la que no funciona.
    expect(interpretarPregunta('menú')).toBeNull();
    expect(interpretarPregunta('menu')).toBe('ayuda');
  });

  it('y sin acento los mismos textos sí, incluidos los que no debían', () => {
    expect(interpretarPregunta('llego mi ticket')).toBe('ultimo');
    expect(interpretarPregunta('cual fue el ultimo')).toBe('ultimo');
  });

  it('por accidente eso salva dos falsos positivos — hasta que alguien lo arregle', () => {
    // Quien arregle el `\b` va a destapar estos dos, que hoy pasan de largo por
    // el mismo defecto. Están aquí para que el arreglo no los estrene en
    // producción sin verlos.
    expect(interpretarPregunta('no llegó el cliente')).toBeNull();
    expect(interpretarPregunta('el último cliente ya me firmó')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// armarRespuesta — cifras sí, veredicto no
// ═══════════════════════════════════════════════════════════════════════════

const ESTADO = {
  anticipo: 10600, comprobado: 8400, comprobantes: 6,
  ultimoConcepto: 'diesel', ultimoMonto: 1200, enRevision: 0,
};

describe('armarRespuesta · saldo', () => {
  it('dice comprobado, anticipo, cuántos y cuánto falta', () => {
    const t = armarRespuesta('saldo', ESTADO);
    expect(t).toContain(pesos(8400));
    expect(t).toContain(pesos(10600));
    expect(t).toContain('6 comprobante(s)');
    expect(t).toContain(pesos(2200));
  });

  it('anticipo en 0 NO se imprime como cifra: se dice que no hay dato', () => {
    // Un 0 en `viaje.anticipo` puede ser "no le dieron nada" o "nadie lo
    // capturó", y las dos se ven igual. Restarle lo comprobado daría un
    // "te sobran $8,400" que es pura invención.
    const t = armarRespuesta('saldo', { ...ESTADO, anticipo: 0 });
    expect(t).toMatch(/no tiene anticipo registrado/i);
    expect(t).toMatch(/no te puedo decir cuánto te falta/i);
    expect(t).not.toContain('$0.00');
    expect(t).toContain(pesos(8400));   // lo que sí se sabe, sigue estando
  });

  it('un anticipo negativo se trata igual que el 0, no se resta', () => {
    expect(armarRespuesta('saldo', { ...ESTADO, anticipo: -50 })).toMatch(/no tiene anticipo registrado/i);
  });

  it('sobregiro: lo dice en positivo, sin cifra negativa en pantalla', () => {
    const t = armarRespuesta('saldo', { ...ESTADO, anticipo: 1000, comprobado: 1500 });
    expect(t).toContain('Comprobaste');
    expect(t).toContain(pesos(500));
    // "-$500.00" en el teléfono de un chofer no se lee como sobregiro.
    expect(t).not.toContain('-$');
    expect(t).not.toMatch(/te faltan/i);
  });

  it('exacto: ni faltan ni sobran, y tampoco se felicita a nadie', () => {
    const t = armarRespuesta('saldo', { ...ESTADO, anticipo: 8400, comprobado: 8400 });
    expect(t).toContain('Vas justo con el anticipo');
    expect(t).not.toMatch(/te faltan|comprobaste .* más/i);
  });

  it('sin un solo comprobante dice 0, que ahí sí es una medición', () => {
    const t = armarRespuesta('saldo', { ...ESTADO, comprobado: 0, comprobantes: 0 });
    expect(t).toContain('0 comprobante(s)');
    expect(t).toContain(pesos(10600));
  });
});

describe('armarRespuesta · faltantes', () => {
  it('suma el dinero que falta y las fotos que se leyeron mal', () => {
    const t = armarRespuesta('faltantes', { ...ESTADO, enRevision: 2 });
    expect(t).toContain(pesos(2200));
    expect(t).toMatch(/2 foto\(s\) se leyeron mal/);
  });

  it('sin nada pendiente dice qué hacer para cerrar', () => {
    const t = armarRespuesta('faltantes', { ...ESTADO, comprobado: 10600 });
    expect(t).toMatch(/no falta nada/i);
    expect(t).toMatch(/escribe que terminaste/i);
  });

  it('BUG · con anticipo 0 AFIRMA "no falta nada" — y en «saldo» dice que no sabe', () => {
    // El mismo estado, dos preguntas, dos respuestas incompatibles:
    //   "¿cuánto llevo?" → "no te puedo decir cuánto te falta"
    //   "¿me falta algo?" → "Por mi parte no falta nada"
    // La segunda afirma sobre exactamente el dato que la primera declara que no
    // tiene. Un chofer que pregunta de la segunda forma se va del viaje creyendo
    // que ya comprobó todo.
    const sinAnticipo = { ...ESTADO, anticipo: 0, comprobado: 0, comprobantes: 0, enRevision: 0 };
    expect(armarRespuesta('faltantes', sinAnticipo)).toMatch(/no falta nada/i);
    expect(armarRespuesta('saldo', sinAnticipo)).toMatch(/no te puedo decir/i);
  });

  it('en sobregiro no reclama dinero que no falta', () => {
    const t = armarRespuesta('faltantes', { ...ESTADO, anticipo: 1000, comprobado: 1500 });
    expect(t).not.toMatch(/te faltan/i);
  });
});

describe('armarRespuesta · último y ayuda', () => {
  it('el último dice concepto, monto y el total que van', () => {
    const t = armarRespuesta('ultimo', ESTADO);
    expect(t).toContain('diesel');
    expect(t).toContain(pesos(1200));
    expect(t).toContain('6 en total');
  });

  it('sin comprobantes lo dice, no inventa uno', () => {
    const t = armarRespuesta('ultimo', { ...ESTADO, ultimoConcepto: null, ultimoMonto: null, comprobantes: 0 });
    expect(t).toMatch(/todavía no me llega ningún comprobante/i);
    expect(t).not.toContain('$');
  });

  it('BUG · un comprobante con monto nulo se anuncia como $0.00', () => {
    // `mxn(e.ultimoMonto ?? 0)`. `EstadoViaje.ultimoMonto` es `number | null` y
    // el concepto puede venir sin monto (OCR que leyó el ticket pero no la
    // cifra). El chofer lee "recibí tu diesel por $0.00" y da por bueno un
    // comprobante que no vale nada — el ceroque-parece-medición que el resto
    // del repo se niega a imprimir.
    const t = armarRespuesta('ultimo', { ...ESTADO, ultimoMonto: null });
    expect(t).toContain('$0.00');
  });

  it('la ayuda enseña las tres cosas que el chofer puede hacer', () => {
    const t = armarRespuesta('ayuda', ESTADO);
    expect(t).toMatch(/foto/i);
    expect(t).toMatch(/cuánto llevo/i);
    expect(t).toMatch(/terminaste/i);
  });
});

describe('armarRespuesta NUNCA opina', () => {
  const ESTADOS = [
    ESTADO,
    { ...ESTADO, anticipo: 0 },
    { ...ESTADO, comprobado: 10600 },                       // exacto
    { ...ESTADO, anticipo: 1000, comprobado: 1500 },        // sobregiro
    { ...ESTADO, comprobado: 0, comprobantes: 0, ultimoConcepto: null, ultimoMonto: null },
    { ...ESTADO, enRevision: 3 },
  ];

  it('no dice "bien", ni "en orden", ni felicita, en ninguna combinación', () => {
    const juicios = /\bbien\b|todo en orden|vas perfecto|excelente|¡felicidades|correcto\b/i;
    for (const tipo of ['saldo', 'faltantes', 'ultimo', 'ayuda'] as const) {
      for (const e of ESTADOS) {
        const t = armarRespuesta(tipo, e);
        expect(t, `«${t}» opina, y el veredicto lo da el motor de cuadre`).not.toMatch(juicios);
      }
    }
  });

  it('sin viaje abierto contesta lo mismo para cualquier pregunta y no inventa cifras', () => {
    for (const tipo of ['saldo', 'faltantes', 'ultimo', 'ayuda'] as const) {
      const t = armarRespuesta(tipo, null);
      expect(t).toMatch(/no tienes un viaje abierto/i);
      expect(t).not.toContain('$');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// estadoDelViaje — la consulta
// ═══════════════════════════════════════════════════════════════════════════

describe('estadoDelViaje', () => {
  it('suma lo comprobado, cuenta los comprobantes y toma el más reciente', () => {
    respuesta.viaje = { data: { anticipo: '10600.00' }, error: null };
    respuesta.gasto = {
      data: [
        { concepto: 'diesel', monto: '1200.00', ocr_confianza: '0.950', created_at: '2026-08-04T18:00:00Z' },
        { concepto: 'caseta', monto: '300.50', ocr_confianza: '0.400', created_at: '2026-08-03T10:00:00Z' },
      ],
      error: null,
    };

    return estadoDelViaje('t-1', 'v-1').then((e) => {
      // PostgREST devuelve `numeric` como string: si esto se sumara sin Number,
      // "1200.00" + "300.50" daría la concatenación y nadie lo notaría hasta ver
      // un saldo de siete cifras.
      expect(e).toEqual({
        anticipo: 10600,
        comprobado: 1500.5,
        comprobantes: 2,
        ultimoConcepto: 'diesel',
        ultimoMonto: 1200,
        enRevision: 1,     // solo el de 0.40; el de 0.95 no
      });
    });
  });

  it('confianza NULA no cuenta como "en revisión": no se sabe nada de ella', () => {
    respuesta.viaje = { data: { anticipo: 100 }, error: null };
    respuesta.gasto = {
      data: [{ concepto: 'caseta', monto: 50, ocr_confianza: null, created_at: '2026-08-04T18:00:00Z' }],
      error: null,
    };
    return estadoDelViaje('t-1', 'v-1').then((e) => expect(e!.enRevision).toBe(0));
  });

  it('0.7 exacto NO va a revisión; 0.699 sí', async () => {
    respuesta.viaje = { data: { anticipo: 100 }, error: null };
    respuesta.gasto = {
      data: [
        { concepto: 'a', monto: 1, ocr_confianza: 0.7, created_at: '2026-08-04T18:00:00Z' },
        { concepto: 'b', monto: 1, ocr_confianza: 0.699, created_at: '2026-08-03T18:00:00Z' },
      ],
      error: null,
    };
    expect((await estadoDelViaje('t-1', 'v-1'))!.enRevision).toBe(1);
  });

  it('un viaje que no es de esta flota devuelve null', async () => {
    respuesta.viaje = { data: null, error: null };
    respuesta.gasto = { data: [], error: null };
    expect(await estadoDelViaje('OTRA', 'v-1')).toBeNull();
  });

  it('sin anticipo capturado devuelve 0 sin reventar', async () => {
    respuesta.viaje = { data: { anticipo: null }, error: null };
    respuesta.gasto = { data: [], error: null };
    const e = await estadoDelViaje('t-1', 'v-1');
    expect(e).toMatchObject({ anticipo: 0, comprobado: 0, comprobantes: 0, ultimoConcepto: null, ultimoMonto: null });
  });

  it('BUG · un error de la base se lee como "no hay comprobantes" y sale una cifra falsa', () => {
    // Ninguna de las dos consultas comprueba `error`. supabase-js reporta por
    // VALOR: con la base caída, `data` es null y esto devuelve comprobado 0 con
    // el anticipo intacto — el chofer recibe "Llevas $0.00 de $10,600. Te faltan
    // $10,600" habiendo mandado veinte tickets. Es exactamente el modo de falla
    // que CLAUDE.md manda cerrar con `exigir()`.
    respuesta.viaje = { data: { anticipo: 10600 }, error: null };
    respuesta.gasto = { data: null, error: { message: 'timeout' } };

    return estadoDelViaje('t-1', 'v-1').then((e) => {
      expect(e).toMatchObject({ anticipo: 10600, comprobado: 0, comprobantes: 0 });
      expect(armarRespuesta('saldo', e)).toContain(pesos(10600));
    });
  });

  it('BUG · si la que falla es la del viaje, dice que no hay viaje abierto', async () => {
    respuesta.viaje = { data: null, error: { message: 'timeout' } };
    respuesta.gasto = { data: [{ concepto: 'diesel', monto: 400, ocr_confianza: 0.9, created_at: 'x' }], error: null };
    // Afirma algo falso —"todavía no tienes un viaje abierto"— sobre un chofer
    // que sí lo tiene y que acaba de mandar un comprobante.
    expect(await estadoDelViaje('t-1', 'v-1')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// responderConsulta — el atajo completo
// ═══════════════════════════════════════════════════════════════════════════

describe('responderConsulta', () => {
  it('lo que no es consulta devuelve null Y NO TOCA LA BASE', async () => {
    expect(await responderConsulta('aquí va el ticket', 't-1', 'v-1')).toBeNull();
    // Que no consulte importa tanto como el null: este atajo corre delante del
    // agente en el presupuesto del webhook de WhatsApp.
    expect(from).not.toHaveBeenCalled();
  });

  it('sin viaje abierto contesta sin consultar nada', async () => {
    const r = await responderConsulta('cuánto llevo', 't-1', null);
    expect(r).toMatch(/no tienes un viaje abierto/i);
    expect(from).not.toHaveBeenCalled();
  });

  it('con viaje abierto contesta con las cifras de ese viaje', async () => {
    respuesta.viaje = { data: { anticipo: 5000 }, error: null };
    respuesta.gasto = {
      data: [{ concepto: 'diesel', monto: 1200, ocr_confianza: 0.95, created_at: '2026-08-04T18:00:00Z' }],
      error: null,
    };
    const r = await responderConsulta('¿cuánto llevo?', 't-1', 'v-1');
    expect(r).toContain(pesos(1200));
    expect(r).toContain(pesos(5000));
    expect(from).toHaveBeenCalledWith('viaje');
    expect(from).toHaveBeenCalledWith('gasto');
  });
});

/**
 * La cifra tal como la imprime `mxn`, sin reimplementar el formato aquí ni
 * escribirlo a mano: un "$8,400.00" literal seguiría verde el día que el
 * formato cambie, mientras el mensaje del chofer ya dice otra cosa.
 */
function pesos(n: number): string {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}
