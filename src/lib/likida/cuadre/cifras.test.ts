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
