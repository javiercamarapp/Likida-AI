import { describe, it, expect } from 'vitest';
import { tieneCifrasDeDinero, cifrasSinRespaldo, cardinalesEnPalabras } from './cifras';

describe('tieneCifrasDeDinero', () => {
  it('marca las formas de dinero que sí escribe el agente', () => {
    for (const t of ['$500', '$ 6,850', '10,600', '5700.00', '500 pesos', 'sobró 500', '1500 a favor'])
      expect(tieneCifrasDeDinero(t), t).toBe(true);
  });
  it('no marca enteros sueltos sin contexto de dinero', () => {
    for (const t of ['son 3 comprobantes', 'folio 1042', 'en 2026'])
      expect(tieneCifrasDeDinero(t), t).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LA PUERTA TRASERA DE `consultar_politica`.
//
// La guardia dejaba pasar CUALQUIER cifra en cuanto el modelo hubiera llamado
// consultar_politica, razonando que entonces las cifras eran topes de política.
// Pero la tool no ata al texto: el modelo puede consultar la política (una tool
// barata) y luego narrar "comprobaste $8,340 y sobró $500" — cifras que nadie
// calculó. Llamar una tool irrelevante desbloqueaba narrar dinero inventado,
// que es exactamente lo que la regla fundacional prohíbe.
//
// Grounded tiene que significar que la cifra ESTÁ en lo que devolvió la tool,
// no que hubo una tool.
// ═══════════════════════════════════════════════════════════════════════════
describe('cifrasSinRespaldo', () => {
  const politica = [{ topeAlimentacionDia: 750, topeEfectivo: 2000 }];

  it('una cifra que sí devolvió la tool está respaldada', () => {
    expect(cifrasSinRespaldo('El tope de alimentación es de $750 por día.', politica)).toEqual([]);
  });

  it('acepta el formato del modelo aunque la tool devuelva el número pelón', () => {
    // La tool devuelve 2000; el modelo escribe "$2,000.00". Es la misma cifra.
    expect(cifrasSinRespaldo('Puedes pagar hasta $2,000.00 en efectivo.', politica)).toEqual([]);
  });

  it('DELATA la cifra que ninguna tool devolvió', () => {
    const fuera = cifrasSinRespaldo('El tope es $750, y tu viaje comprobó $8,340.', politica);
    expect(fuera).toEqual([8340]);
  });

  it('un total derivado por el modelo tampoco está respaldado', () => {
    // 8840 - 8340 = 500. Aritmética del modelo, no del motor. El motor es quien
    // calcula diferencias; si el número no salió de él, no se manda.
    expect(cifrasSinRespaldo('Sobró $500 del anticipo.', [{ comprobado: 8340, anticipo: 8840 }])).toEqual([500]);
  });

  it('busca dentro de estructuras anidadas, no solo en el primer nivel', () => {
    expect(cifrasSinRespaldo('El tope es $750.', [{ politica: { topes: [{ monto: 750 }] } }])).toEqual([]);
  });

  it('acepta números que la tool devolvió como texto', () => {
    expect(cifrasSinRespaldo('Son $750.', [{ tope: '750.00' }])).toEqual([]);
  });

  it('sin resultados de tool, toda cifra queda sin respaldo', () => {
    expect(cifrasSinRespaldo('Comprobaste $8,340.', [])).toEqual([8340]);
  });

  it('un texto sin cifras no reporta nada', () => {
    expect(cifrasSinRespaldo('Mándame la foto del ticket, porfa.', politica)).toEqual([]);
  });

  it('tolera el centavo entre lo que calculó la tool y lo que escribió el modelo', () => {
    expect(cifrasSinRespaldo('Son $1,234.57.', [{ total: 1234.567 }])).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL PORTÓN TENÍA FALSOS NEGATIVOS, Y UN FALSO NEGATIVO AQUÍ ES UNA CIFRA
// INVENTADA EN EL WHATSAPP DEL OPERADOR.
//
// `tieneCifrasDeDinero` exigía $, coma de miles, .XX, "pesos/mxn" o una de 8
// palabras clave pegada al número. Frases que un modelo escribe con toda
// naturalidad lo evadían — medido contra el regex real.
//
// La asimetría manda: un falso POSITIVO cuesta que se reemplace el texto por el
// resumen del motor, que es correcto. Un falso NEGATIVO cuesta una cifra que
// nadie calculó, en el teléfono de quien liquida. Ante la duda, se verifica.
// ═══════════════════════════════════════════════════════════════════════════
describe('tieneCifrasDeDinero — las evasiones que se colaban', () => {
  it('atrapa cifras sin símbolo ni palabra-moneda', () => {
    for (const t of [
      'Tu resultado final: 8000',
      'El total quedó en 8000 y ya cerré tu viaje',
      'Quedó así: 8000 contra 8500',
      'Tu saldo: 500 a tu favor',
      'Te quedan 1500 por comprobar',
    ]) expect(tieneCifrasDeDinero(t), t).toBe(true);
  });

  it('atrapa cantidades escritas en palabras', () => {
    // "ocho mil pesos" no tiene un solo dígito: el regex viejo ni la veía.
    for (const t of ['Te sobraron ocho mil pesos', 'Son como quinientos pesos', 'Cerca de dos mil'])
      expect(tieneCifrasDeDinero(t), t).toBe(true);
  });

  // AUDITORÍA 12, MEDIO: cardinales SUELTOS (sin "pesos"/"mil" pegado) —
  // "ochocientos", "trece", "quinientos" — el español natural de WhatsApp.
  // Antes pasaban intactos: una cifra que nadie calculó llegaba al teléfono
  // de quien liquida.
  it('atrapa cardinales sueltos — el español natural de WhatsApp', () => {
    for (const t of [
      'Te sobran ochocientos del anticipo.',
      'Me faltan trece para completar.',
      'Quedaron quinientos a tu favor.',
      'Te quedan mil por comprobar.',
      'El viaje cerró con veinticuatro de diferencia.',
    ]) expect(tieneCifrasDeDinero(t), t).toBe(true);
  });

  it('sigue sin marcar lo que NO es dinero', () => {
    // Un falso positivo aquí sustituiría un mensaje conversacional por el
    // resumen del cuadre, y eso se ve mal en la demo.
    for (const t of [
      'Mándame la foto del ticket, porfa',
      'Ya recibí tus 3 comprobantes',
      'Van 8 fotos, ¿te falta alguna?',
      'Listo 👍',
      '¿Cerramos el viaje?',
    ]) expect(tieneCifrasDeDinero(t), t).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 8 · CRÍTICO (rubro agéntico): NO_ES_DINERO se evaluaba sobre la
// FRASE completa, así que una sola palabra del vocabulario del producto
// ("comprobantes", "litros", "artículo"...) apagaba la detección de TODOS los
// números del mensaje, aunque el número de dinero real estuviera en otra
// cláusula, sin relación con esa palabra.
//
// Reproducido con el motor real: "Llevas 6 comprobantes y te sobran 3200 del
// anticipo." daba tieneCifrasDeDinero = false, y el saldo "3200" —que nadie
// calculó— llegaba tal cual al WhatsApp del operador.
// ═══════════════════════════════════════════════════════════════════════════
describe('tieneCifrasDeDinero — auditoría 8, la palabra inocente ya no apaga TODO el mensaje', () => {
  it('un número de dinero en OTRA cláusula sí se marca, aunque la frase traiga vocabulario del dominio', () => {
    for (const t of [
      'Llevas 6 comprobantes y te sobran 3200 del anticipo.',
      'Cargaste 320 litros y te quedan 4500 de anticipo por comprobar.',
      'Tu tope de diésel en efectivo es 5000, según el artículo 27, fracción III de la LISR.',
    ]) expect(tieneCifrasDeDinero(t), t).toBe(true);
  });

  it('sigue sin marcar cuando el número SÍ vive en la misma cláusula que la palabra inocente', () => {
    for (const t of [
      'Van 8 fotos y el folio 1042 ya quedó registrado',
      'Tienes 15 días para el folio 1042',
    ]) expect(tieneCifrasDeDinero(t), t).toBe(false);
  });
});

// ── AUDITORÍA 13 · MEDIO: el portón cerraba en "once" — 1-10 pasaba ─────────
describe('AUDITORÍA 13 — cardinales 1-10 (el cierre parcial de la 12)', () => {
  it('atrapa "diez" y "cinco" sueltos — el español natural de WhatsApp', () => {
    // "uno"/"un" se excluyen A PROPÓSITO: "en UN momento" y "una hora" disparan
    // demasiado (NO_ES_DINERO no los cubre); el 1 nunca es monto de dinero en
    // este dominio. La frontera útil arranca en 2.
    for (const t of ['Te sobran diez del anticipo.', 'Me faltan cinco para completar.', 'Quedaron ocho a tu favor.']) {
      expect(tieneCifrasDeDinero(t), t).toBe(true);
    }
    expect(tieneCifrasDeDinero('Ya te lo mando en un momento.')).toBe(false);
    expect(tieneCifrasDeDinero('Quedó uno a tu favor.')).toBe(false);
  });

  it('sigue sin marcar los sustantivos comunes ("tres comprobantes")', () => {
    for (const t of ['Ya recibí tus tres comprobantes.', 'Van cinco fotos, ¿te falta alguna?']) {
      expect(tieneCifrasDeDinero(t), t).toBe(false);
    }
  });
});

// ── AUDITORÍA 13 · MEDIO: el cotejo contra la política ve los cardinales ────
describe('AUDITORÍA 13 — cardinales en palabras dentro del cotejo', () => {
  it('un cardinal que NO coincide con nada respaldado sale como cifra sin respaldo', () => {
    const fuera = cifrasSinRespaldo('Te sobran ochocientos del anticipo y el tope del diésel es 850.', [
      { politica: { topes: { diesel: 850, caseta: 1500 } } },
    ]);
    expect(fuera).toContain(800);
  });

  it('un cardinal que SÍ coincide con lo que la tool devolvió queda respaldado', () => {
    const fuera = cifrasSinRespaldo('Te sobran ochocientos del anticipo y el tope del diésel es 800.', [
      { politica: { topes: { diesel: 800 } } },
    ]);
    expect(fuera).toEqual([]);
  });

  it('los compuestos simples se convierten ("treinta y dos" → 32)', () => {
    expect(cardinalesEnPalabras('me faltan treinta y dos para completar')).toContain(32);
    expect(cardinalesEnPalabras('son mil ochocientos pesos')).toContain(1800);
  });
});

// ── AUDITORÍA 32 c7 · ARQ/AG/TC/REN-32C7: `mil` MULTIPLICA, no suma ─────────
// Tres auditores independientes de la ronda (agéntico, tool calling y
// rendimiento) llegaron al mismo defecto por caminos distintos: el acumulador
// sumaba SIEMPRE, así que "ochocientos mil" daba 800+1000 = 1800 en vez de
// 800,000. `5aeda80` (la c5) extendió la guardia del panel para que leyera
// letras reusando esta función, y con eso expuso el colapso de escala a la
// frontera donde una cifra mal cotejada llega al contralor.
//
// Falla en las DOS direcciones, y la primera es la cara:
//  · ABIERTA: un respaldo real de $1,800 APRUEBA el texto "un millón
//    ochocientos mil pesos" — un error de 1000x con el sello de la guardia.
//  · CERRADA pero costosa: "doce mil pesos" con 12,000 respaldado daba 1012,
//    salía como cifra sin respaldo, y el llamador paga un segundo ciclo de
//    modelo (`copiloto.ts:267`) o tira la pieza entera sin reintento
//    (`agentes/contenido.ts:194`, `agentes/faq.ts:264`).
describe('AUDITORÍA 32 c7 — el colapso de escala de `mil`', () => {
  it('«ochocientos mil» vale 800000, no 1800 (si no, $1,800 respaldados aprueban un millón ochocientos mil)', () => {
    expect(cardinalesEnPalabras('ochocientos mil pesos')).toEqual([800000]);
  });

  it('«doce mil» vale 12000, no 1012 (el falso positivo que cuesta un ciclo de modelo)', () => {
    expect(cardinalesEnPalabras('son doce mil pesos')).toEqual([12000]);
  });

  it('«doscientos cincuenta mil» vale 250000, no 1250', () => {
    expect(cardinalesEnPalabras('doscientos cincuenta mil pesos')).toEqual([250000]);
  });

  it('«dos mil veintiséis» vale 2026, no 1028 — un año en prosa normal', () => {
    expect(cardinalesEnPalabras('el ejercicio dos mil veintiséis')).toEqual([2026]);
  });

  it('la suma sigue mandando cuando `mil` va PRIMERO: «mil ochocientos» sigue siendo 1800', () => {
    expect(cardinalesEnPalabras('son mil ochocientos pesos')).toEqual([1800]);
  });

  it('«mil» solo sigue valiendo 1000, y «cien mil» 100000', () => {
    expect(cardinalesEnPalabras('te quedan mil por comprobar')).toEqual([1000]);
    expect(cardinalesEnPalabras('cien mil pesos')).toEqual([100000]);
  });

  it('un respaldo de 1800 ya NO aprueba «un millón ochocientos mil»: la cifra sale como sin respaldo', () => {
    const fuera = cifrasSinRespaldo('El ahorro es de un millón ochocientos mil pesos.', [
      { politica: { topes: { diesel: 1800 } } },
    ]);
    expect(fuera).not.toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 32 c8 — `millón` no existía para la guardia, y era la mitad grande
// del mismo agujero que la c7 dejó a medias.
//
// AG-32C8-C1 (CRÍTICO) y TC-32C8-A1 (ALTO), encontrados por separado por el
// auditor agéntico y el de tool calling sobre el arreglo de la c7 (`3ed4fd8`).
//
// Dos huecos distintos, una sola causa: la palabra no estaba en ningún lado.
//
//  1. EL PARSER (`cardinalesEnPalabras`). `millón` no está en `VALOR_CARDINAL`,
//     así que el token se salta y sólo sale el multiplicando chico. MEDIDO antes
//     del arreglo:
//         'dos millones de pesos'   → [2]
//         'tres millones de pesos'  → [3]
//         'cien millones de pesos'  → [100]
//         'un millón de pesos'      → []
//     Un respaldo real que contenga 3 —y `esDerivada` acepta enteros chicos—
//     APRUEBA el texto «tres millones de pesos» con el sello de la guardia
//     puesto. Es el mismo error de 1000x que la c7 cerró para `mil`, con la
//     escala de arriba y por la puerta de al lado.
//
//  2. EL PORTÓN (`tieneCifrasDeDinero`). El regex decía `millones?`, que es
//     "millone" + "s" opcional: NO casa `millón` ni `millon`. MEDIDO:
//         tieneCifrasDeDinero('Facturaste un millón de pesos.')  → false
//     El plural sí se atrapaba, y por eso nadie lo había visto. En falso el
//     texto sale verbatim por WhatsApp sin `logger.warn` y sin reintento.
//
// LA DIRECCIÓN DEL ARREGLO es la que este archivo ya declaraba querer:
// verificar de más. `millón` como multiplicador da números grandes que no
// empatan con nada del respaldo, así que el texto cae a 'fuera' y se reemplaza
// por el resumen determinístico del motor. Lo que NO se pretende es que el
// parser sea completo: «un millón ochocientos mil» sigue sin dar 1,800,000
// —da 1,001,800— y eso está bien, porque tampoco empata: el caso peligroso es
// el que empata por accidente, no el que no empata.
describe('AUDITORÍA 32 c8 — `millón` para la guardia de cifras', () => {
  it('«dos millones» vale 2000000, no 2 (si no, un respaldo con un 2 aprueba dos millones de pesos)', () => {
    expect(cardinalesEnPalabras('dos millones de pesos')).toEqual([2000000]);
  });

  it('«tres millones» vale 3000000, no 3 — el caso que midió el auditor agéntico', () => {
    expect(cardinalesEnPalabras('Llevas tres millones de pesos')).toEqual([3000000]);
  });

  it('el SINGULAR cuenta igual que el plural: «un millón» vale 1000000, no nada', () => {
    expect(cardinalesEnPalabras('un millón de pesos')).toEqual([1000000]);
    expect(cardinalesEnPalabras('un millon de pesos')).toEqual([1000000]);
  });

  it('«cien millones» vale 100000000 y «mil millones» 1000000000', () => {
    expect(cardinalesEnPalabras('cien millones de pesos')).toEqual([100000000]);
    expect(cardinalesEnPalabras('mil millones de pesos')).toEqual([1000000000]);
  });

  it('el portón ve el SINGULAR con acento y sin él, no sólo el plural', () => {
    for (const t of ['Facturaste un millón de pesos.', 'Facturaste un millon de pesos.', 'medio millón de pesos'])
      expect(tieneCifrasDeDinero(t), t).toBe(true);
  });

  it('un respaldo con un 3 ya NO aprueba «tres millones de pesos»', () => {
    const fuera = cifrasSinRespaldo('Llevas tres millones de pesos.', [
      { politica: { topes: { diesel: 3 } } },
    ]);
    expect(fuera).not.toEqual([]);
  });

  it('lo que la c7 cerró sigue cerrado: `mil` no se rompe al entrar `millón`', () => {
    expect(cardinalesEnPalabras('ochocientos mil pesos')).toEqual([800000]);
    expect(cardinalesEnPalabras('son mil ochocientos pesos')).toEqual([1800]);
    expect(cardinalesEnPalabras('el ejercicio dos mil veintiséis')).toEqual([2026]);
  });
});

describe('AUDITORÍA 32 c9 — SEG-32C9-C1: un monto con marca de dinero no es un año', () => {
  // El respaldo que devuelve `estado_viaje`: anticipo 8000, comprobado 6000. El
  // modelo DERIVA el saldo y lo escribe; nadie lo calculó.
  const estado = [{ anticipo: 8000, comprobado: 6000, comprobantes: 4 }];
  const conSaldo = (s: string) =>
    `De tus $8,000.00 de anticipo comprobaste $6,000.00, te sobran ${s}.`;

  // `ANIO` corre DENTRO de `cifrasSinRespaldo`, y su lookbehind `(?<![\w-])` deja
  // pasar el `$`: los 200 enteros de 1900 a 2099 se borraban del texto antes del
  // cotejo, y una lista vacía significa «todo respaldado». La única diferencia
  // entre que la guardia atrape la cifra y que la apruebe era la coma de miles.
  it('un saldo de $2000 sin coma de miles NO se cuenta como respaldado', () => {
    expect(cifrasSinRespaldo(conSaldo('$2000'), estado)).toEqual([2000]);
  });

  it('la banda entera 1900-2099 se coteja: $1950 y $2099', () => {
    expect(cifrasSinRespaldo(conSaldo('$1950'), estado)).toEqual([1950]);
    expect(cifrasSinRespaldo(conSaldo('$2099'), estado)).toEqual([2099]);
  });

  it('con la palabra «pesos» o «MXN» pegada tampoco es un año', () => {
    expect(cifrasSinRespaldo(conSaldo('2000 pesos'), estado)).toEqual([2000]);
    expect(cifrasSinRespaldo(conSaldo('2050 MXN'), estado)).toEqual([2050]);
  });

  it('`$ 2000` con espacio se coteja igual que `$2000`', () => {
    expect(cifrasSinRespaldo(conSaldo('$ 2000'), estado)).toEqual([2000]);
  });

  // El peor caso medido: borraba el `2000` y dejaba el `.50` suelto, así que
  // reportaba 50 — una cifra que el modelo nunca escribió.
  it('`$2000.50` se reporta como 2000.5, no como 50', () => {
    expect(cifrasSinRespaldo(conSaldo('$2000.50'), estado)).toEqual([2000.5]);
  });

  // La otra mitad, y es la razón por la que `ANIO` existe: un año de verdad
  // sigue sin ser dinero. Si esto se cayera, un folio o una cita a una norma
  // dispararían el reemplazo y el operador recibiría el cuadre entero en
  // respuesta a «¿sigue abierto mi viaje?».
  //
  // Se afirma sobre el AÑO y no sobre la lista completa a propósito: dos de
  // estos textos ya reportan otra cosa hoy («regla 2.9» → 2.9, «01/01/2026» →
  // 1) y eso es un falso positivo PRE-EXISTENTE, ajeno a este hallazgo, que
  // sólo cuesta que se sustituya el texto por el resumen del motor. Afirmar
  // `toEqual([])` aquí ataría esta prueba a un defecto que no viene a arreglar.
  it('los años de verdad siguen fuera del cotejo', () => {
    const casos = [
      'El viaje VJ-2026-0847 cerró en 2026 con $6,000.00 comprobados de $8,000.00.',
      'Comprobaste $6,000.00 de $8,000.00 el 01/01/2026.',
      'La RFA 2026 aplica; comprobaste $6,000.00 de $8,000.00.',
      'La regla 2.9 de la RFA 2026 aplica; comprobaste $6,000.00 de $8,000.00.',
    ];
    for (const t of casos) {
      expect(cifrasSinRespaldo(t, estado)).not.toContain(2026);
    }
    // Y el caso limpio sigue dando lista vacía, sin nada que lo enturbie.
    expect(
      cifrasSinRespaldo(
        'El viaje VJ-2026-0847 cerró en 2026 con $6,000.00 comprobados de $8,000.00.',
        estado,
      ),
    ).toEqual([]);
  });
})

describe('AUDITORÍA 32 c10 — SEG/AG/TC-32C10-C1: la banda 1900-2099 sin marca de dinero', () => {
  // Lo que `2d527d6` (c9) cerró fue la MITAD marcada: `$2000`, `2000 pesos`,
  // `2050 MXN`, `$ 2000`, `$2000.50`. La mitad abierta es la ANCHA, porque es
  // como se escribe un monto en WhatsApp: pelado. Tres auditores llegaron por
  // separado (SEG-32C10-C1, AG-32C10-C1, TC-32C10-C1) y el orquestador lo
  // reprodujo ejecutando este mismo archivo.
  //
  // El default estaba invertido en LOS DOS carriles: se borraba el año SALVO
  // que hubiera marca de dinero. Debe borrarse SÓLO cuando hay marca de AÑO —
  // que es la asimetría que este archivo ya declara por escrito («ante la duda
  // se CONSERVA el número»), aplicada al revés.
  const estado = [{ anticipo: 8000, comprobado: 6000, comprobantes: 4 }];
  const conSaldo = (s: string) =>
    `De tus $8,000.00 de anticipo comprobaste $6,000.00, te sobran ${s}.`;

  it('el cotejo atrapa el monto PELADO de la banda, igual que el marcado', () => {
    // Medido antes del arreglo: los tres daban `[]` — «todo respaldado» — y el
    // texto salía verbatim al WhatsApp del chofer. `3200`, fuera de la banda,
    // siempre se atrapó: la única diferencia era caer entre 1900 y 2099.
    expect(cifrasSinRespaldo(conSaldo('2000'), estado)).toEqual([2000]);
    expect(cifrasSinRespaldo(conSaldo('1950'), estado)).toEqual([1950]);
    expect(cifrasSinRespaldo(conSaldo('2099'), estado)).toEqual([2099]);
    expect(cifrasSinRespaldo(conSaldo('3200'), estado)).toEqual([3200]);
  });

  it('el PORTÓN también ve el monto pelado de la banda', () => {
    // La cabecera del arreglo de la c9 afirmaba que aquí «el agujero no existe
    // porque DINERO_EXPLICITO corre ANTES». Es cierto para los cuatro casos que
    // enumeró y falso para el quinto: un monto pelado no tiene marca, así que
    // DINERO_EXPLICITO no encaja y `ANIO` lo borraba antes de buscar.
    for (const t of [
      'Te sobran 2000 del anticipo.',
      'Te sobran 1900 del anticipo.',
      'Te sobran 2099 del anticipo.',
      'Tu resultado final: 2000',
      'Tu saldo: 1950 a tu favor.',
    ])
      expect(tieneCifrasDeDinero(t), t).toBe(true);
  });

  it('la banda COMPLETA, los 200 enteros, en los dos carriles', () => {
    for (let n = 1900; n <= 2099; n++) {
      expect(tieneCifrasDeDinero(`Te sobran ${n} del anticipo.`), `portón ${n}`).toBe(true);
      expect(cifrasSinRespaldo(conSaldo(String(n)), estado), `cotejo ${n}`).toEqual([n]);
    }
  });

  it('y un año de verdad SIGUE fuera de los dos carriles', () => {
    // El contrapeso: si esto se cayera, el arreglo se pasó de largo y un folio
    // o una cita a una norma dispararían el reemplazo. `del 2026 al 2027` entra
    // porque es la forma en que el producto habla de un ejercicio.
    for (const t of [
      'El viaje VJ-2026-0847 cerró en 2026 con $6,000.00 comprobados de $8,000.00.',
      'La RFA 2026 aplica; comprobaste $6,000.00 de $8,000.00.',
      'La regla 2.9 de la RFA 2026 aplica; comprobaste $6,000.00 de $8,000.00.',
    ]) {
      expect(cifrasSinRespaldo(t, estado), t).not.toContain(2026);
    }
    // `01/01/2026` NO se afirma aquí: el portón ya daba `true` ANTES de este
    // arreglo, y no por el año sino por el `01` del día, que es un número suelto
    // de dos dígitos. Es el mismo falso positivo PRE-EXISTENTE que el bloque de
    // la c9 documenta doce líneas arriba, y atar esta prueba a él la volvería
    // una prueba de otro defecto. Medido antes de tocar nada.
    for (const t of ['en 2026', 'el ejercicio 2026', 'del 2026 al 2027'])
      expect(tieneCifrasDeDinero(t), t).toBe(false);
  });
});
