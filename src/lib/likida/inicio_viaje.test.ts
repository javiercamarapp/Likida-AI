import { describe, it, expect } from 'vitest';
import {
  interpretarRespuesta,
  numeroElegido,
  decidirInicio,
  señaViaje,
  SIN_SEÑAS,
  MAX_EN_CUERPO,
  type ViajeAsignado,
} from './inicio_viaje';

// Coordinar el arranque del viaje. El error caro no es "no entendí": es
// arrancar el viaje equivocado, porque los gastos se cargan a otra liquidación
// y las dos cierran cuadradas. Casi toda esta suite existe para probar que
// cuando el módulo duda, NO elige.

const viaje = (
  id: string,
  folio?: string | null,
  origen?: string | null,
  destino?: string | null,
): ViajeAsignado => ({ id, folio, origen, destino });

const V1 = viaje('a1', 'V-1042', 'Toluca', 'Querétaro');
const V2 = viaje('b2', 'V-1043', 'CDMX', 'Monterrey');
const V3 = viaje('c3', 'V-1044', 'León', 'Guadalajara');
const V4 = viaje('d4', 'V-1045', 'Irapuato', 'Saltillo');
const V5 = viaje('e5', 'V-1046', 'Puebla', 'Veracruz');

// ═══════════════════════════════════════════════════════════════════════════
// CÓMO CONTESTA UN OPERADOR MEXICANO
// ═══════════════════════════════════════════════════════════════════════════

describe('interpretarRespuesta · confirma', () => {
  const SIES = [
    'sí', 'Sí.', 'si', 'sip', 'sipi', 'simón', 'simon', 'va', 'Va!', 'vale',
    'sale', 'sale pues', 'va pues', 'va que va', 'ese', 'ese mero', 'ese es',
    'ese mismo', 'órale', 'orale', 'ándale', 'claro', 'correcto', 'exacto',
    'afirmativo', 'positivo', 'confirmo', 'adelante', 'ok', 'OK', 'okey',
    'listo', 'dale', 'arre', 'sobres', 'chido', 'enterado', 'copiado',
    'seguro', 'así es', 'asi es', 'de acuerdo', 'está bien', 'ya voy',
    '👍', '✅', '👌',
  ];

  it.each(SIES)('«%s» es un sí', (texto) => {
    expect(interpretarRespuesta(texto)).toBe('confirma');
  });

  it('un sí dentro de una frase larga sigue siendo un sí', () => {
    // "sí" con acento no tiene otra lectura posible, así que no necesita que
    // la respuesta sea corta para valer.
    expect(interpretarRespuesta('sí voy a arrancar ese viaje ahorita')).toBe('confirma');
  });
});

describe('interpretarRespuesta · niega', () => {
  const NOES = [
    'no', 'No.', 'nop', 'nel', 'nel pastel', 'negativo', 'ninguno',
    'ese no', 'ese no es', 'no es ese', 'no ese', 'otro', 'el otro',
    'otro viaje', 'todavía no', 'ahorita no', 'al rato', 'para nada',
    'tampoco', 'cancelado', '👎', '❌',
  ];

  it.each(NOES)('«%s» es un no', (texto) => {
    expect(interpretarRespuesta(texto)).toBe('niega');
  });

  it('«ese no» NO se lee como el «ese» que confirma', () => {
    // La trampa central del módulo: "ese no" trae las dos señales. Si la
    // afirmación ganara, el agente abriría el viaje que el operador acaba de
    // rechazar.
    expect(interpretarRespuesta('ese')).toBe('confirma');
    expect(interpretarRespuesta('ese no')).toBe('niega');
  });

  it('un número junto a una negación NO elige — está aceptado que cueste un mensaje', () => {
    // "el 1 no" y "no, el 1" son lo contrario entre sí y solo se distinguen por
    // dónde cae la negación. Se prefiere repreguntar antes que apostarle.
    expect(interpretarRespuesta('el 1 no')).toBe('niega');
    expect(interpretarRespuesta('no, el 1')).toBe('niega');
  });

  it('«sí, no hay bronca» se lee como un no, y es una pérdida ACEPTADA', () => {
    // Documenta una decisión, no un descuido: la negación le gana a todo. El
    // costo es un mensaje de más; el de la regla contraria es una liquidación
    // descuadrada. Si alguien invierte el orden, esta prueba se lo dice.
    expect(interpretarRespuesta('sí, no hay bronca')).toBe('niega');
  });
});

describe('interpretarRespuesta · elige por número', () => {
  const NUMEROS: Array<[string, number]> = [
    ['1', 1], ['el 1', 1], ['la 1', 1], ['el uno', 1], ['uno', 1],
    ['el primero', 1], ['primero', 1],
    ['2', 2], ['el 2', 2], ['#2', 2], ['opción 2', 2], ['opcion 2', 2],
    ['el segundo', 2], ['sale el 2', 2],
    ['3', 3], ['el 3', 3], ['tercero', 3], ['el tercero', 3],
    ['1️⃣', 1], ['2️⃣', 2], ['3️⃣', 3],
  ];

  it.each(NUMEROS)('«%s» elige el %i', (texto, n) => {
    expect(interpretarRespuesta(texto)).toBe('elige_numero');
    expect(numeroElegido(texto)).toBe(n);
  });

  it('el número le gana al sí, porque dice más', () => {
    expect(interpretarRespuesta('sí, el 3')).toBe('elige_numero');
    expect(numeroElegido('sí, el 3')).toBe(3);
  });

  it('dos números no son una elección, son una pregunta', () => {
    expect(numeroElegido('1 o 2')).toBeNull();
    expect(interpretarRespuesta('1 o 2')).toBe('no_entendido');
  });
});

describe('interpretarRespuesta · no se entendió', () => {
  const RAROS = [
    '', '   ', 'jajaja', 'aquí ando', '...', 'ke onda',
  ];

  it.each(RAROS)('«%s» no se entiende', (texto) => {
    expect(interpretarRespuesta(texto)).toBe('no_entendido');
  });

  it('un «no entendí» pide la pregunta otra vez, NO cancela el viaje', () => {
    // Todas empiezan con "no". Leerlas como negación le cierra el viaje a
    // alguien que solo no oyó bien.
    for (const t of ['no entendí', 'no entendi', 'no le entendí', 'no te entiendo', 'no sé', 'mande', '¿cuál?']) {
      expect(interpretarRespuesta(t)).toBe('no_entendido');
    }
  });

  it('«si» condicional dentro de una frase NO es un sí', () => {
    // Sin acento, "si" es condicional. Es la razón de que el "si" pelón solo
    // valga cuando ES toda la respuesta.
    expect(interpretarRespuesta('si llego tarde te aviso')).toBe('no_entendido');
    expect(interpretarRespuesta('si')).toBe('confirma');
  });

  it('un reporte de avance NO es una confirmación', () => {
    // "va" y "ya" son verbos comunes. Un parte de avance leído como un sí
    // abriría el viaje sin que nadie lo haya dicho.
    expect(interpretarRespuesta('ya voy llegando a la caseta')).toBe('no_entendido');
    expect(interpretarRespuesta('va a llegar tarde el cliente')).toBe('no_entendido');
    expect(interpretarRespuesta('va')).toBe('confirma');
  });

  it('un número dentro de un mensaje largo NO es una elección', () => {
    expect(numeroElegido('voy en la 57 rumbo a 2 casetas')).toBeNull();
    expect(interpretarRespuesta('voy en la 57 rumbo a 2 casetas')).toBe('no_entendido');
  });

  it('un folio con dígitos no se confunde con un número de opción', () => {
    expect(numeroElegido('V-1042')).toBeNull();
    expect(interpretarRespuesta('V-1042')).toBe('no_entendido');
  });

  it('«una» no es el número 1 — es un artículo', () => {
    // "espérame una hora" traía el 1, y con un solo viaje asignado el 1 es
    // válido: un "ahorita no puedo" habría abierto el viaje.
    expect(numeroElegido('espérame una hora')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CÓMO SE NOMBRA EL VIAJE — sin inventar nada
// ═══════════════════════════════════════════════════════════════════════════

describe('señaViaje', () => {
  it('folio y ruta completos', () => {
    expect(señaViaje(V1)).toBe('*V-1042* — Toluca → Querétaro');
  });

  it('sin ruta, se queda con el folio y no inventa el trayecto', () => {
    expect(señaViaje(viaje('x', 'V-1042'))).toBe('*V-1042*');
  });

  it('solo origen, o solo destino: se dice lo que hay', () => {
    expect(señaViaje(viaje('x', null, 'Toluca', null))).toBe('sale de Toluca');
    expect(señaViaje(viaje('x', null, null, 'Querétaro'))).toBe('va a Querétaro');
  });

  it('sin folio ni ruta se DECLARA el hueco; no se enseña el id', () => {
    // El id es un UUID: no ayuda a nadie a reconocer su viaje y hace ver el
    // producto roto. Se dice qué falta, que es lo que pide CLAUDE.md.
    const s = señaViaje(viaje('3f8a-9c11-uuid'));
    expect(s).toBe(SIN_SEÑAS);
    expect(s).not.toContain('3f8a');
  });

  it('los espacios sueltos no cuentan como dato', () => {
    expect(señaViaje(viaje('x', '  ', '  ', '  '))).toBe(SIN_SEÑAS);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SIN NINGÚN VIAJE ASIGNADO
// ═══════════════════════════════════════════════════════════════════════════

describe('decidirInicio · sin ningún viaje', () => {
  it('lo dice y manda con el encargado, sin inventar un viaje', () => {
    const d = decidirInicio({ viajesAsignados: [] });
    expect(d.estado).toBe('sin_viaje');
    expect(d.viajeElegido).toBeUndefined();
    expect(d.mensaje).toContain('encargado');
  });

  it('ni un «sí» materializa un viaje que no existe', () => {
    const d = decidirInicio({ viajesAsignados: [], respuesta: 'sí, va' });
    expect(d.estado).toBe('sin_viaje');
    expect(d.viajeElegido).toBeUndefined();
  });

  it('una lista que no es lista falla cerrado', () => {
    const d = decidirInicio({
      viajesAsignados: undefined as unknown as ViajeAsignado[],
      respuesta: 'sí',
    });
    expect(d.estado).toBe('sin_viaje');
    expect(d.viajeElegido).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// UN SOLO VIAJE — se pregunta, no se asume
// ═══════════════════════════════════════════════════════════════════════════

describe('decidirInicio · un solo viaje', () => {
  it('NO se asume: se pregunta con folio y ruta', () => {
    const d = decidirInicio({ viajesAsignados: [V1] });
    expect(d.estado).toBe('esperando_confirmacion');
    expect(d.viajeElegido).toBeUndefined();
    expect(d.mensaje).toContain('V-1042');
    expect(d.mensaje).toContain('Toluca → Querétaro');
    expect(d.mensaje).toContain('*sí*');
    expect(d.mensaje).toContain('*no*');
  });

  it('una respuesta en blanco es lo mismo que no haber contestado', () => {
    const d = decidirInicio({ viajesAsignados: [V1], respuesta: '   ' });
    expect(d.estado).toBe('esperando_confirmacion');
  });

  it.each(['sí', 'va', 'simón', 'sale pues', 'ese', 'ok', '👍', 'el 1', 'el primero'])(
    'con «%s» queda confirmado ESE viaje',
    (respuesta) => {
      const d = decidirInicio({ viajesAsignados: [V1], respuesta });
      expect(d.estado).toBe('confirmado');
      expect(d.viajeElegido).toBe('a1');
      expect(d.mensaje).toContain('V-1042');
    },
  );

  it.each(['no', 'nel', 'ese no', 'otro', 'ahorita no'])(
    'con «%s» no se abre nada y se manda con el encargado',
    (respuesta) => {
      const d = decidirInicio({ viajesAsignados: [V1], respuesta });
      // `sin_viaje` y no `esperando_confirmacion`: repetirle la misma pregunta
      // a quien ya dijo que no es no haberlo escuchado. Y la verdad operativa
      // es que no hay viaje abierto, que es justo lo que protege el cuadre.
      expect(d.estado).toBe('sin_viaje');
      expect(d.viajeElegido).toBeUndefined();
      expect(d.mensaje).toContain('encargado');
    },
  );

  it('un número que no se le enseñó no confirma nada', () => {
    // Solo se le puso una opción. Un "2" no señala nada que haya leído.
    const d = decidirInicio({ viajesAsignados: [V1], respuesta: 'el 2' });
    expect(d.estado).toBe('ambiguo');
    expect(d.viajeElegido).toBeUndefined();
  });

  it('lo que no se entiende se repregunta más simple, UNA vez', () => {
    const d = decidirInicio({ viajesAsignados: [V1], respuesta: 'jajaja' });
    expect(d.estado).toBe('ambiguo');
    expect(d.viajeElegido).toBeUndefined();
    expect(d.mensaje).toContain('no te entendí');
    expect(d.mensaje).toContain('*sí*');
  });

  it('a la segunda ya no se insiste: se pasa a un humano', () => {
    // Repreguntar en bucle a alguien manejando no consigue la respuesta; solo
    // deja al agente a un mensaje de rendirse y tomar el primero de la lista.
    const d = decidirInicio({ viajesAsignados: [V1], respuesta: 'jajaja', intento: 2 });
    expect(d.estado).toBe('ambiguo');
    expect(d.viajeElegido).toBeUndefined();
    expect(d.mensaje).toContain('encargado');
    expect(d.mensaje).not.toContain('¿Arrancas');
  });

  it('un viaje sin folio ni ruta se pregunta declarando el hueco', () => {
    const d = decidirInicio({ viajesAsignados: [viaje('uuid-sin-datos')] });
    expect(d.estado).toBe('esperando_confirmacion');
    expect(d.mensaje).toContain(SIN_SEÑAS);
    expect(d.mensaje).not.toContain('uuid-sin-datos');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// VARIOS VIAJES — se enumeran y él elige
// ═══════════════════════════════════════════════════════════════════════════

describe('decidirInicio · varios viajes', () => {
  it('con dos, se enumeran los dos y se pide el número', () => {
    const d = decidirInicio({ viajesAsignados: [V1, V2] });
    expect(d.estado).toBe('esperando_confirmacion');
    expect(d.viajeElegido).toBeUndefined();
    expect(d.mensaje).toContain('1) *V-1042*');
    expect(d.mensaje).toContain('2) *V-1043*');
    expect(d.mensaje).toContain('1 o 2');
  });

  it('con tres, se enumeran los tres', () => {
    const d = decidirInicio({ viajesAsignados: [V1, V2, V3] });
    expect(d.mensaje).toContain('3) *V-1044*');
    expect(d.mensaje).toContain('1, 2 o 3');
  });

  it(`con más de ${MAX_EN_CUERPO} solo se enumeran ${MAX_EN_CUERPO}, y se ofrece salida`, () => {
    // Una lista de cinco renglones no se lee de pie junto a una unidad
    // prendida: se ignora. Los que no caben se resuelven con "otro".
    const d = decidirInicio({ viajesAsignados: [V1, V2, V3, V4, V5] });
    expect(d.mensaje).toContain('3) *V-1044*');
    expect(d.mensaje).not.toContain('V-1045');
    expect(d.mensaje).not.toContain('V-1046');
    expect(d.mensaje).toContain('*otro*');
    expect(d.mensaje).toContain('2 más');
  });

  it('cuando la lista está completa NO se le ofrece «otro»', () => {
    const d = decidirInicio({ viajesAsignados: [V1, V2] });
    expect(d.mensaje).not.toContain('*otro*');
  });

  it.each([
    ['1', 'a1'], ['el 2', 'b2'], ['3', 'c3'],
    ['el primero', 'a1'], ['el segundo', 'b2'], ['tercero', 'c3'],
    ['2️⃣', 'b2'],
  ])('«%s» confirma el viaje %s', (respuesta, id) => {
    const d = decidirInicio({ viajesAsignados: [V1, V2, V3], respuesta });
    expect(d.estado).toBe('confirmado');
    expect(d.viajeElegido).toBe(id);
  });

  it('un «sí» con varios asignados NO elige: no dice cuál', () => {
    // El caso que descuadra la liquidación si se resuelve tomando el primero.
    const d = decidirInicio({ viajesAsignados: [V1, V2, V3], respuesta: 'sí' });
    expect(d.estado).toBe('ambiguo');
    expect(d.viajeElegido).toBeUndefined();
    expect(d.mensaje).toContain('¿cuál?');
    expect(d.mensaje).toContain('1, 2 o 3');
  });

  it('un número fuera de lo que se le enseñó NO confirma', () => {
    // Trae cinco asignados pero solo vio tres. Ese "4" no señala nada que haya
    // leído, y el cuarto de la lista no es el cuarto de su cabeza.
    const d = decidirInicio({ viajesAsignados: [V1, V2, V3, V4, V5], respuesta: '4' });
    expect(d.estado).toBe('ambiguo');
    expect(d.viajeElegido).toBeUndefined();
    expect(d.mensaje).toContain('1, 2 o 3');
  });

  it('«otro» descarta la lista completa y manda con el encargado', () => {
    const d = decidirInicio({ viajesAsignados: [V1, V2, V3, V4, V5], respuesta: 'otro' });
    expect(d.estado).toBe('sin_viaje');
    expect(d.viajeElegido).toBeUndefined();
    expect(d.mensaje).toContain('encargado');
  });

  it('«ninguno» tampoco elige por descarte', () => {
    const d = decidirInicio({ viajesAsignados: [V1, V2], respuesta: 'ninguno' });
    expect(d.estado).toBe('sin_viaje');
    expect(d.viajeElegido).toBeUndefined();
  });

  it('«1 o 2» no elige ninguno de los dos', () => {
    const d = decidirInicio({ viajesAsignados: [V1, V2, V3], respuesta: '1 o 2' });
    expect(d.estado).toBe('ambiguo');
    expect(d.viajeElegido).toBeUndefined();
  });

  it('«el 1 no» no abre el 1', () => {
    const d = decidirInicio({ viajesAsignados: [V1, V2, V3], respuesta: 'el 1 no' });
    expect(d.viajeElegido).toBeUndefined();
    expect(d.estado).toBe('sin_viaje');
  });

  it('a la segunda respuesta ininteligible se pasa a un humano', () => {
    const d = decidirInicio({ viajesAsignados: [V1, V2, V3], respuesta: 'ke onda', intento: 2 });
    expect(d.estado).toBe('ambiguo');
    expect(d.viajeElegido).toBeUndefined();
    expect(d.mensaje).toContain('encargado');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PROPIEDADES DE TODA LA MÁQUINA
// ═══════════════════════════════════════════════════════════════════════════

/** Todos los caminos que puede tomar la máquina, para barrerlos de un jalón. */
const TODOS_LOS_CASOS = (): Array<{ etiqueta: string; d: ReturnType<typeof decidirInicio> }> => {
  const listas: Array<[string, ViajeAsignado[]]> = [
    ['ninguno', []],
    ['uno', [V1]],
    ['uno sin datos', [viaje('uuid-pelon')]],
    ['dos', [V1, V2]],
    ['tres', [V1, V2, V3]],
    ['cinco', [V1, V2, V3, V4, V5]],
  ];
  const respuestas = [
    undefined, '', 'sí', 'va', 'no', 'ese no', 'otro', '1', '2', '4', '9',
    'jajaja', 'no entendí', '1 o 2', 'el 1 no', 'V-1042',
  ];
  const salida: Array<{ etiqueta: string; d: ReturnType<typeof decidirInicio> }> = [];
  for (const [nombre, viajes] of listas) {
    for (const respuesta of respuestas) {
      for (const intento of [1, 2]) {
        salida.push({
          etiqueta: `${nombre} / «${respuesta ?? '(sin respuesta)'}» / intento ${intento}`,
          d: decidirInicio({ viajesAsignados: viajes, respuesta, intento }),
        });
      }
    }
  }
  return salida;
};

describe('decidirInicio · invariantes', () => {
  it('solo `confirmado` trae viajeElegido, y siempre es un id de la lista', () => {
    const ids = new Set(['a1', 'b2', 'c3', 'd4', 'e5', 'uuid-pelon']);
    for (const { etiqueta, d } of TODOS_LOS_CASOS()) {
      if (d.estado === 'confirmado') {
        expect(d.viajeElegido, etiqueta).toBeTruthy();
        expect(ids.has(d.viajeElegido!), etiqueta).toBe(true);
      } else {
        expect(d.viajeElegido, etiqueta).toBeUndefined();
      }
    }
  });

  it('nunca se confirma sin que el operador haya contestado', () => {
    for (const viajes of [[V1], [V1, V2], [V1, V2, V3]]) {
      expect(decidirInicio({ viajesAsignados: viajes }).estado).not.toBe('confirmado');
      expect(decidirInicio({ viajesAsignados: viajes, respuesta: '' }).estado).not.toBe('confirmado');
    }
  });

  it('nunca se confirma cuando no hay viajes asignados', () => {
    for (const { d } of TODOS_LOS_CASOS()) {
      if (d.estado === 'confirmado') expect(d.viajeElegido).toBeTruthy();
    }
    for (const respuesta of ['sí', '1', 'va', 'ese']) {
      expect(decidirInicio({ viajesAsignados: [], respuesta }).estado).toBe('sin_viaje');
    }
  });

  it('todo mensaje se lee de pie: corto, en español y sin id crudo', () => {
    for (const { etiqueta, d } of TODOS_LOS_CASOS()) {
      expect(d.mensaje.trim(), etiqueta).not.toBe('');
      // Un mensaje de WhatsApp que no cabe en la pantalla no se lee.
      expect(d.mensaje.length, etiqueta).toBeLessThanOrEqual(400);
      // Nada de "estimado usuario": esto lo lee un operador junto a su unidad.
      expect(d.mensaje.toLowerCase(), etiqueta).not.toContain('estimado');
      expect(d.mensaje.toLowerCase(), etiqueta).not.toContain('usuario');
      // Los ids son UUIDs y no significan nada para quien maneja.
      expect(d.mensaje, etiqueta).not.toContain('uuid-pelon');
    }
  });

  it('es pura: mismos argumentos, mismo resultado', () => {
    const args = { viajesAsignados: [V1, V2, V3], respuesta: 'el 2', intento: 1 };
    expect(decidirInicio(args)).toEqual(decidirInicio(args));
    // Y no muta la lista que le pasaron.
    const lista = [V1, V2, V3];
    decidirInicio({ viajesAsignados: lista, respuesta: '2' });
    expect(lista).toEqual([V1, V2, V3]);
  });
});

describe('decidirInicio · la conversación completa', () => {
  it('tres viajes: pregunta → «sí» ambiguo → «el 2» confirma el segundo', () => {
    const viajes = [V1, V2, V3];

    const pregunta = decidirInicio({ viajesAsignados: viajes });
    expect(pregunta.estado).toBe('esperando_confirmacion');

    const duda = decidirInicio({ viajesAsignados: viajes, respuesta: 'sí', intento: 1 });
    expect(duda.estado).toBe('ambiguo');

    const cierre = decidirInicio({ viajesAsignados: viajes, respuesta: 'el 2', intento: 2 });
    expect(cierre.estado).toBe('confirmado');
    expect(cierre.viajeElegido).toBe('b2');
    expect(cierre.mensaje).toContain('V-1043');
  });

  it('un viaje: pregunta → «ese no» → queda sin viaje abierto', () => {
    const viajes = [V1];
    expect(decidirInicio({ viajesAsignados: viajes }).estado).toBe('esperando_confirmacion');
    const no = decidirInicio({ viajesAsignados: viajes, respuesta: 'ese no' });
    expect(no.estado).toBe('sin_viaje');
    expect(no.viajeElegido).toBeUndefined();
  });
});
