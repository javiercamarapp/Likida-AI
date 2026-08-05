import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE ESTA SUITE PROTEGE, EN ORDEN DE LO QUE CUESTA EQUIVOCARSE.
//
// 1. LOS NEGATIVOS. Un falso positivo aquí no ensucia una tabla: `crearViaje`
//    llama a `avisarAlChofer`, así que un mensaje mal entendido le manda un
//    WhatsApp a una persona diciéndole que salga a carretera. Por eso hay más
//    casos de "esto NO es una petición" que de "esto sí lo es".
//
// 2. EL DINERO. Un anticipo mal leído no se nota hasta la liquidación, y ahí la
//    diferencia sale contra el chofer. Cada forma rara de escribir una cifra
//    tiene su caso, y la mayoría de esos casos esperan que el módulo se NIEGUE.
//
// 3. LO QUE SE ENSEÑA ANTES DE CREAR. `resumenParaConfirmar` es el único paso
//    entre el parser y un mensaje a un chofer. Se comprueba que no invente
//    ceros ni deje renglones en blanco que se lean como "no aplica".
//
// 4. EL DESEMPATE DE NOMBRES. Dos "Martínez" activos no se resuelven solos.
// ═══════════════════════════════════════════════════════════════════════════

const range = vi.fn();
const order = vi.fn(() => ({ range }));
const eqActivo = vi.fn(() => ({ order }));
const eqTenant = vi.fn(() => ({ eq: eqActivo }));
const select = vi.fn(() => ({ eq: eqTenant }));
const from = vi.fn((tabla: string) => {
  // Revienta ante cualquier otra tabla: este módulo solo tiene permiso de leer
  // `operador`, y un `from('viaje')` aquí sería una escritura que se coló.
  if (tabla !== 'operador') throw new Error(`tabla inesperada: ${tabla}`);
  return { select };
});

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (...a: unknown[]) => from(...(a as [string])) }),
}));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const {
  interpretarPeticionViaje,
  resumenParaConfirmar,
  resolverOperadorPorNombre,
  OperadorNombreAmbiguo,
} = await import('./crear_viaje_wa');
const { ConsultaFallida } = await import('./conv');

// ── 1 · Las cuatro formas en que un jefe mexicano despacha ──────────────────

describe('las formas que se escriben de verdad', () => {
  it('«nuevo viaje para Juan Pérez, Puebla a Monterrey, anticipo 8000»', () => {
    expect(interpretarPeticionViaje('nuevo viaje para Juan Pérez, Puebla a Monterrey, anticipo 8000'))
      .toEqual({
        tipo: 'crear',
        operador: 'Juan Pérez',
        origen: 'Puebla',
        destino: 'Monterrey',
        anticipo: 8000,
        unidad: null,
      });
  });

  it('«asígnale un viaje a Ramírez de CDMX a Guadalajara con 5 mil de anticipo»', () => {
    // Sin una sola coma: el marco "de … a …" es lo único que separa el nombre
    // de la ruta. Y el "con" del anticipo tiene que quedarse fuera del destino
    // —"Guadalajara con" fue un bug real de la primera versión.
    expect(interpretarPeticionViaje('asígnale un viaje a Ramírez de CDMX a Guadalajara con 5 mil de anticipo'))
      .toEqual({
        tipo: 'crear',
        operador: 'Ramírez',
        origen: 'CDMX',
        destino: 'Guadalajara',
        anticipo: 5000,
        unidad: null,
      });
  });

  it('«viaje nuevo: López, unidad 42, Querétaro-Saltillo, $12,500»', () => {
    // El 42 de la unidad NO puede leerse como dinero, y el guion separa
    // ciudades sin que nadie escriba "a".
    expect(interpretarPeticionViaje('viaje nuevo: López, unidad 42, Querétaro-Saltillo, $12,500'))
      .toEqual({
        tipo: 'crear',
        operador: 'López',
        origen: 'Querétaro',
        destino: 'Saltillo',
        anticipo: 12500,
        unidad: '42',
      });
  });

  it('«dale viaje a Martínez» — incompleto, falta la ruta', () => {
    expect(interpretarPeticionViaje('dale viaje a Martínez')).toEqual({
      tipo: 'incompleto',
      falta: ['ruta'],
      parcial: { operador: 'Martínez', origen: null, destino: null, anticipo: null, unidad: null },
    });
  });

  it('conserva acentos y mayúsculas tal como los escribió el jefe', () => {
    // La coincidencia se busca sobre el texto aplanado, pero lo que se devuelve
    // —y lo que el jefe va a leer en el resumen— se rebana del original.
    const r = interpretarPeticionViaje('programa un viaje a Juan Pérez de Veracruz a Xalapa, unidad T-102, anticipo 4500');
    expect(r).toEqual({
      tipo: 'crear',
      operador: 'Juan Pérez',
      origen: 'Veracruz',
      destino: 'Xalapa',
      anticipo: 4500,
      unidad: 'T-102',
    });
  });

  it('aguanta cortesías al frente y el despacho en renglones', () => {
    expect(interpretarPeticionViaje('oye jefe, nuevo viaje para Juan Pérez, Puebla a Monterrey, anticipo 8000'))
      .toMatchObject({ tipo: 'crear', operador: 'Juan Pérez', anticipo: 8000 });
    expect(interpretarPeticionViaje('nuevo viaje\nJuan Pérez\nPuebla a Monterrey\nanticipo 8000'))
      .toMatchObject({ tipo: 'crear', operador: 'Juan Pérez', origen: 'Puebla', destino: 'Monterrey', anticipo: 8000 });
  });

  it('un viaje sin anticipo se crea, con el anticipo en null y no en cero', () => {
    // `null` y `0` NO son lo mismo para el chofer: uno es "nadie lo capturó" y
    // el otro es "sales sin dinero". `notificar.ts` los dice distinto.
    expect(interpretarPeticionViaje('nuevo viaje para Juan, Puebla a Monterrey'))
      .toMatchObject({ tipo: 'crear', anticipo: null });
  });
});

// ── 2 · Los negativos: el error caro ────────────────────────────────────────

describe('lo que NO es una petición de viaje devuelve null', () => {
  // Cada uno de estos, si diera `crear`, terminaría con un WhatsApp saliendo
  // hacia un chofer. Es el único fallo de este módulo que le cuesta a alguien
  // más que al jefe que escribió.
  const NO_SON = [
    'ya llegó Juan?',
    'ya llegó Juan',
    '¿ya salió el viaje de López?',
    'cuántos viajes van este mes',
    'cuantos viajes van este mes',
    'cancela el de Puebla',
    'cancela el viaje de Juan',
    'reasigna el viaje de Juan a Pérez',
    'el viaje de Juan ya salió',
    'mándame el reporte de viajes',
    'dame el viaje de Juan',
    'mándame el estatus del viaje de Martínez',
    'no le des viaje a Martínez',
    'cierra el viaje de Ramírez',
    'liquida el viaje de López',
    'cambia la unidad del viaje de Juan',
    'los viajes de hoy',
    'ok gracias',
    '',
    '   ',
  ];

  it.each(NO_SON)('«%s»', (texto) => {
    expect(interpretarPeticionViaje(texto)).toBeNull();
  });

  it.each([
    'me dijo el cliente que le arma viaje a Pérez de Puebla a Monterrey',
    'en el sistema viejo se hacía así: crea viaje, luego asigna chofer',
  ])('la orden tiene que ir AL PRINCIPIO: «%s»', (texto) => {
    // Estos dos traen un verbo de alta ("arma", "crea") con su "viaje" pegado,
    // y ninguno es una orden: uno narra lo que dijo un cliente y el otro explica
    // cómo se hacía antes. Sin el ancla del disparador los dos crean un viaje —
    // y el primero además le manda el aviso a Pérez.
    expect(interpretarPeticionViaje(texto)).toBeNull();
  });

  it('un mensaje largo con «nuevo viaje» adentro tampoco dispara', () => {
    const parrafo =
      'nuevo viaje para Juan Pérez, aunque la verdad es que estuve pensando que quizá '
      + 'convendría más mandar a alguien del turno de la tarde porque el cliente pidió '
      + 'que llegara temprano y con la unidad grande, avísame qué opinas antes de nada';
    expect(parrafo.length).toBeGreaterThan(220);
    expect(interpretarPeticionViaje(parrafo)).toBeNull();
  });

  it('una entrada que no es texto no revienta ni inventa', () => {
    expect(interpretarPeticionViaje(undefined as unknown as string)).toBeNull();
    expect(interpretarPeticionViaje(null as unknown as string)).toBeNull();
    expect(interpretarPeticionViaje(42 as unknown as string)).toBeNull();
  });

  it('el veto va por palabra completa: «Cerro Azul» no se confunde con «cerrar»', () => {
    // Con `cerr\w*` en la lista, esta ruta real de Veracruz quedaba vetada y
    // nadie se enteraba hasta que el jefe la escribiera en el demo.
    expect(interpretarPeticionViaje('nuevo viaje para Juan, Cerro Azul a Poza Rica, anticipo 3000'))
      .toMatchObject({ tipo: 'crear', origen: 'Cerro Azul', destino: 'Poza Rica' });
  });
});

// ── 3 · El dinero ──────────────────────────────────────────────────────────

describe('el anticipo: se lee exacto o no se lee', () => {
  const conCifra = (cifra: string) =>
    interpretarPeticionViaje(`nuevo viaje para Juan, Puebla a Monterrey, anticipo ${cifra}`);

  it.each([
    ['8000', 8000],
    ['8 mil', 8000],
    ['5 mil', 5000],
    ['$12,500', 12500],
    ['$12,500.50', 12500.5],
    ['12.5k', 12500],
    ['de 4,000', 4000],
    ['1500.75', 1500.75],
  ])('«%s» se lee como %s', (texto, esperado) => {
    expect(conCifra(texto)).toMatchObject({ tipo: 'crear', anticipo: esperado });
  });

  it('«0» se acepta como cifra dicha, no como hueco', () => {
    // El jefe dijo explícitamente que sale sin anticipo. `crearViaje` escribe
    // `anticipo ?? 0`, así que en la base es indistinguible de la omisión — la
    // diferencia solo existe aquí y en el resumen, que la dice en voz alta.
    expect(conCifra('0')).toMatchObject({ tipo: 'crear', anticipo: 0 });
  });

  it.each([
    ['8.500', 'el punto puede ser separador de miles o de centavos'],
    ['8,5', 'una coma que no forma grupos de tres'],
    ['1234,567', 'coma mal puesta'],
    ['-500', 'un anticipo negativo no existe'],
    ['1000000', 'cruza el umbral de revisión: es el dedo pesado'],
    ['5 mdp', 'millones de anticipo no es un anticipo'],
    ['ocho mil', 'escrito con letra, no se parsea'],
    ['8000.555', 'más decimales que centavos'],
  ])('«%s» NO se adivina, se pregunta (%s)', (texto) => {
    const r = conCifra(texto);
    expect(r).toMatchObject({ tipo: 'incompleto' });
    expect((r as { falta: string[] }).falta).toContain('anticipo');
    // Y la cifra dudosa NO se arrastra: quien llame no puede escribirla.
    expect((r as { parcial: { anticipo: number | null } }).parcial.anticipo).toBeNull();
  });

  it('dos «anticipo» en el mismo mensaje no se desempatan', () => {
    const r = interpretarPeticionViaje('nuevo viaje para Juan, Puebla a Monterrey, anticipo 8000, mejor anticipo 9000');
    expect(r).toMatchObject({ tipo: 'incompleto' });
    expect((r as { parcial: { anticipo: number | null } }).parcial.anticipo).toBeNull();
  });

  it('dos cifras en pesos tampoco', () => {
    const r = interpretarPeticionViaje('nuevo viaje para Juan, Puebla a Monterrey, $5,000 o $6,000');
    expect(r).toMatchObject({ tipo: 'incompleto' });
    expect((r as { parcial: { anticipo: number | null } }).parcial.anticipo).toBeNull();
  });

  it('un número pelón NO es dinero: sin «$» ni «anticipo», se pregunta', () => {
    // Un número suelto puede ser un folio, una hora o una unidad. Tomarlo por
    // dinero escribe un anticipo que nadie autorizó; ignorarlo crea el viaje
    // como si el jefe no hubiera escrito nada. Se pregunta.
    const r = interpretarPeticionViaje('nuevo viaje para Juan, Puebla a Monterrey, folio 8891');
    expect(r).toMatchObject({ tipo: 'incompleto' });
    expect((r as { falta: string[] }).falta).toContain('cifra');
    expect((r as { parcial: { anticipo: number | null } }).parcial.anticipo).toBeNull();
  });

  it('si sobra un número, tampoco se enseña el anticipo que sí se leyó', () => {
    // "5000 o 6000": el 5,000 se lee, pero al lado de "hay un número que no supe
    // a qué corresponde" se leería como confirmado — y es justo el que está en
    // disputa.
    const r = interpretarPeticionViaje('nuevo viaje para Juan, Puebla a Monterrey, anticipo 5000 o 6000');
    expect(r).toMatchObject({ tipo: 'incompleto' });
    expect((r as { parcial: { anticipo: number | null } }).parcial.anticipo).toBeNull();
  });

  it('la unidad no se lee como anticipo', () => {
    expect(interpretarPeticionViaje('nuevo viaje para Juan, Puebla a Monterrey, unidad 42'))
      .toEqual({
        tipo: 'crear',
        operador: 'Juan',
        origen: 'Puebla',
        destino: 'Monterrey',
        anticipo: null,
        unidad: '42',
      });
  });

  it('«unidad disponible» no inventa un número económico', () => {
    // Sin la condición de que el token traiga un dígito, `unidad` salía como
    // "disponible" — un económico que no existe en la tabla `unidad`.
    expect(interpretarPeticionViaje('nuevo viaje para Juan, Puebla a Monterrey, unidad disponible'))
      .toMatchObject({ tipo: 'crear', unidad: null });
  });
});

// ── 4 · La ruta y el nombre ────────────────────────────────────────────────

describe('la ruta y el nombre', () => {
  it('los lugares de varias palabras se leen enteros', () => {
    expect(interpretarPeticionViaje('nuevo viaje para Juan, San Luis Potosí a Nuevo Laredo'))
      .toMatchObject({ origen: 'San Luis Potosí', destino: 'Nuevo Laredo' });
  });

  it('no se recorta por la izquierda: «La Paz» y «Los Mochis» sobreviven', () => {
    // Quitar artículos del principio parecía simétrico a quitarlos del final y
    // convertía dos ciudades reales en "Paz" y "Mochis".
    expect(interpretarPeticionViaje('nuevo viaje para Juan, La Paz a Los Mochis'))
      .toMatchObject({ origen: 'La Paz', destino: 'Los Mochis' });
  });

  it('la cola que no es del lugar se recorta: «Monterrey hoy» → «Monterrey»', () => {
    expect(interpretarPeticionViaje('nuevo viaje para Juan, Puebla a Monterrey hoy, anticipo 3000'))
      .toMatchObject({ destino: 'Monterrey', anticipo: 3000 });
  });

  it('dos segmentos con forma de ruta no se desempatan', () => {
    // "Mario A López" tiene una inicial suelta y parece "Mario a López". No hay
    // forma de saber cuál de los dos es la ruta, así que no hay ruta.
    const r = interpretarPeticionViaje('nuevo viaje para Mario A López, Puebla a Monterrey');
    expect(r).toMatchObject({ tipo: 'incompleto' });
    expect((r as { falta: string[] }).falta).toContain('ruta');
    expect((r as { parcial: { origen: null; destino: null } }).parcial.origen).toBeNull();
    expect((r as { parcial: { origen: null; destino: null } }).parcial.destino).toBeNull();
  });

  it('con solo medio camino, dice cuál falta', () => {
    const r = interpretarPeticionViaje('nuevo viaje para Juan, de Puebla');
    expect(r).toMatchObject({ tipo: 'incompleto' });
    expect((r as { falta: string[] }).falta).toContain('ruta');
  });

  it('«nuevo viaje» a secas pide operador y ruta', () => {
    expect(interpretarPeticionViaje('nuevo viaje')).toEqual({
      tipo: 'incompleto',
      falta: ['operador', 'ruta'],
      parcial: { operador: null, origen: null, destino: null, anticipo: null, unidad: null },
    });
  });

  it('el nombre NO se resuelve aquí: sale el texto que escribió el jefe', () => {
    // Esta función es pura. Elegir a qué chofer corresponde exige hablar con la
    // base y poder negarse, y eso vive en `resolverOperadorPorNombre`.
    const r = interpretarPeticionViaje('dale viaje a Martínez');
    expect((r as { parcial: { operador: string } }).parcial.operador).toBe('Martínez');
  });
});

// ── 5 · Lo que el jefe lee antes de que exista el viaje ─────────────────────

describe('resumenParaConfirmar', () => {
  it('enseña los cuatro campos y avisa que el chofer va a recibir un mensaje', () => {
    const texto = resumenParaConfirmar(
      interpretarPeticionViaje('nuevo viaje para Juan Pérez, Puebla a Monterrey, anticipo 8000'),
    );
    expect(texto).toContain('Juan Pérez');
    expect(texto).toContain('Puebla → Monterrey');
    expect(texto).toContain('$8,000.00');
    expect(texto).toContain('no la capturaste'); // la unidad, dicha y no en blanco
    // El paso que justifica que este módulo no escriba solo.
    expect(texto).toContain('WhatsApp al chofer');
  });

  it('el anticipo ausente se DICE, no se pinta como $0.00', () => {
    // Un cero que en realidad es un dato sin capturar le cuesta su gasolina al
    // chofer. Mismo criterio que `notificar.ts`.
    const texto = resumenParaConfirmar(interpretarPeticionViaje('nuevo viaje para Juan, Puebla a Monterrey'));
    expect(texto).not.toContain('$0.00');
    expect(texto).toContain('sin anticipo registrado');
  });

  it('el anticipo dicho en cero se distingue del ausente', () => {
    const texto = resumenParaConfirmar(
      interpretarPeticionViaje('nuevo viaje para Juan, Puebla a Monterrey, anticipo 0'),
    );
    expect(texto).toContain('$0.00');
    expect(texto).toContain('sale sin anticipo');
  });

  it('cuando falta algo, lo nombra y enseña lo que sí entendió', () => {
    const texto = resumenParaConfirmar(interpretarPeticionViaje('dale viaje a Martínez'));
    expect(texto).toContain('Para crear el viaje me falta');
    expect(texto).toContain('la ruta');
    expect(texto).toContain('Martínez');
    // Y no promete crear nada.
    expect(texto).not.toContain('Voy a crear');
  });

  it('ante null devuelve cadena vacía: no hay nada que confirmar', () => {
    // `null` significa que el mensaje no era para este módulo. Contestar
    // cualquier cosa le secuestraría el turno al agente.
    expect(resumenParaConfirmar(null)).toBe('');
  });
});

// ── 6 · Del nombre al chofer ───────────────────────────────────────────────

/** Una página de PostgREST, como la devuelve el builder mockeado. */
function pagina(filas: Array<{ id: string; nombre: string }>) {
  return Promise.resolve({ data: filas, error: null });
}

describe('resolverOperadorPorNombre', () => {
  beforeEach(() => {
    range.mockReset();
    from.mockClear(); select.mockClear(); eqTenant.mockClear(); eqActivo.mockClear(); order.mockClear();
    logger.error.mockClear();
  });

  it('encuentra por apellido aunque el jefe escriba sin acentos', () => {
    // `ilike '%ramirez%'` en Postgres es sensible a acentos y habría devuelto
    // cero sobre un chofer que SÍ está dado de alta.
    range.mockReturnValue(pagina([
      { id: 'o-1', nombre: 'José Ramírez Soto' },
      { id: 'o-2', nombre: 'Ana López' },
    ]));
    return expect(resolverOperadorPorNombre('t-1', 'Ramirez'))
      .resolves.toEqual({ operadorId: 'o-1', nombre: 'José Ramírez Soto' });
  });

  it('acota a la flota y a los activos', async () => {
    range.mockReturnValue(pagina([{ id: 'o-1', nombre: 'Ana López' }]));
    await resolverOperadorPorNombre('t-1', 'López');
    expect(from).toHaveBeenCalledWith('operador');
    expect(eqTenant).toHaveBeenCalledWith('tenant_id', 't-1');
    expect(eqActivo).toHaveBeenCalledWith('activo', true);
  });

  it('DOS «Martínez» activos no se desempatan: lanza con los candidatos', async () => {
    range.mockReturnValue(pagina([
      { id: 'o-1', nombre: 'Pedro Martínez' },
      { id: 'o-2', nombre: 'Luis Martínez Ruiz' },
    ]));
    const err = await resolverOperadorPorNombre('t-1', 'Martínez').catch((e) => e);
    expect(err).toBeInstanceOf(OperadorNombreAmbiguo);
    expect(err.candidatos).toEqual([
      { operadorId: 'o-1', nombre: 'Pedro Martínez' },
      { operadorId: 'o-2', nombre: 'Luis Martínez Ruiz' },
    ]);
    // Y queda en el log con los ids, que es lo único que permite arreglarlo.
    expect(logger.error).toHaveBeenCalledWith('operador.nombre_ambiguo', expect.objectContaining({
      tenantId: 't-1',
      operadores: ['o-1', 'o-2'],
    }));
  });

  it('el nombre completo exacto gana sobre el parcial', async () => {
    // Con "Juan Pérez" y "Juan Pérez López" en la misma flota, escribir "Juan
    // Pérez" no es ambiguo: es el nombre completo de uno de los dos.
    range.mockReturnValue(pagina([
      { id: 'o-1', nombre: 'Juan Pérez' },
      { id: 'o-2', nombre: 'Juan Pérez López' },
    ]));
    await expect(resolverOperadorPorNombre('t-1', 'Juan Pérez'))
      .resolves.toEqual({ operadorId: 'o-1', nombre: 'Juan Pérez' });
  });

  it('no hace parecidos: «Martin» no encuentra a «Martínez»', async () => {
    range.mockReturnValue(pagina([{ id: 'o-1', nombre: 'Pedro Martínez' }]));
    await expect(resolverOperadorPorNombre('t-1', 'Martin')).resolves.toBeNull();
  });

  it('un nombre que no existe da null, no el único chofer que hay', async () => {
    range.mockReturnValue(pagina([{ id: 'o-1', nombre: 'Ana López' }]));
    await expect(resolverOperadorPorNombre('t-1', 'Hernández')).resolves.toBeNull();
  });

  it('un texto sin una sola palabra útil da null', async () => {
    // "de la" son todas palabras vacías: sin este corte, "todas coinciden" sería
    // literalmente cierto y con un solo chofer en la flota devolvería ESE.
    range.mockReturnValue(pagina([{ id: 'o-1', nombre: 'Ana López' }]));
    await expect(resolverOperadorPorNombre('t-1', 'de la')).resolves.toBeNull();
    await expect(resolverOperadorPorNombre('t-1', '')).resolves.toBeNull();
    // Ni siquiera se consultó la base.
    expect(from).not.toHaveBeenCalled();
  });

  it('sin tenantId se niega: un filtro vacío es un chofer de otra flota', async () => {
    await expect(resolverOperadorPorNombre('', 'Martínez')).rejects.toThrow('falta tenantId');
    expect(from).not.toHaveBeenCalled();
  });

  it('si la base no contesta lanza ConsultaFallida, NO devuelve null', async () => {
    // "No pude preguntar" no es "no está dado de alta". Con `null`, el jefe
    // leería que su chofer no existe por un blip de red.
    range.mockReturnValue(Promise.resolve({ data: null, error: { message: 'timeout' } }));
    const err = await resolverOperadorPorNombre('t-1', 'Martínez').catch((e) => e);
    expect(err).toBeInstanceOf(ConsultaFallida);
    expect(err.message).toContain('timeout');
  });

  it('pagina: el chofer 1,001 no es indistinguible de uno que no existe', async () => {
    // PostgREST recorta a 1,000 filas en silencio.
    const relleno = Array.from({ length: 1000 }, (_, i) => ({ id: `o-${i}`, nombre: `Relleno ${i}` }));
    range
      .mockReturnValueOnce(pagina(relleno))
      .mockReturnValueOnce(pagina([{ id: 'o-1001', nombre: 'Sebastián Quiroga' }]));
    await expect(resolverOperadorPorNombre('t-1', 'Quiroga'))
      .resolves.toEqual({ operadorId: 'o-1001', nombre: 'Sebastián Quiroga' });
    expect(range).toHaveBeenCalledTimes(2);
    expect(range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(range).toHaveBeenNthCalledWith(2, 1000, 1999);
  });
});
