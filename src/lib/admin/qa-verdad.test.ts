import { describe, test, expect } from 'vitest';
import {
  normalizarTextoVerdad, normalizarDominio, normalizarFechaVerdad, normalizarRfcVerdad, montosIguales,
  compararCampo, medir, medicionSinLeer, agregar, ocrVacio, ocrLeidoDeGasto,
  medirSinGasto, esAlucinacion, contarAlucinaciones, agregarPorCampo, resumenPrecision, variantesEmisorEsperado,
  type OcrLeido, type MedicionFotoResumen,
} from './qa-verdad';
import { CLAVES_VERDAD, type ClaveVerdad, type VerdadTerreno } from './qa-tipos';

// ═══════════════════════════════════════════════════════════════════════════
// MEDIR EL OCR CONTRA LA ETIQUETA — lo que se fija:
//
//  1. `no_medido` no es ni acierto ni error, y sale del DENOMINADOR. Es la
//     diferencia entre "el modelo lee bien el 84%" y una cifra inflada por
//     campos que nadie pudo leer en la foto.
//  2. Un campo que el papel NO imprime y el OCR "lee" es una ALUCINACIÓN y
//     cuenta como error: es el fallo que una medición ingenua no ve, porque no
//     hay valor esperado con el que chocar.
//  3. `null` esperado jamás se vuelve 0 ni cadena vacía.
//  4. Sin campos medidos NO hay porcentaje: `exactitud` es null, nunca 0% ni
//     100% sobre una medición que no existe.
// ═══════════════════════════════════════════════════════════════════════════

const VERDAD: VerdadTerreno = {
  comercioClave: 'capufe',
  emisor: 'Caminos y Puentes Federales, S.A. de C.V.',
  rfcEmisor: 'CPF890101AAA',
  folio: '000123',
  monto: 1234.5,
  fecha: '2026-07-31',
  sucursal: 'Caseta Palmillas',
  dominioFacturacion: 'facturacioncapufe.com.mx',
  ilegibles: [],
  noAplica: [],
  clase: 'ticket',
  notas: null,
};

const LEIDO_PERFECTO: OcrLeido = {
  emisor: 'Caminos y Puentes Federales, S.A. de C.V.',
  rfcEmisor: 'CPF890101AAA',
  folio: '000123',
  monto: 1234.5,
  fecha: '2026-07-31',
  sucursal: 'Caseta Palmillas',
  dominioFacturacion: 'facturacioncapufe.com.mx',
};

const verdad = (p: Partial<VerdadTerreno>): VerdadTerreno => ({ ...VERDAD, ...p });
const leido = (p: Partial<OcrLeido>): OcrLeido => ({ ...LEIDO_PERFECTO, ...p });

describe('normalización de texto — sin acentos, sin puntuación ni separadores', () => {
  test('los tres casos reales de campo dan la MISMA cadena comparable', () => {
    expect(normalizarTextoVerdad('S.A. DE C.V.')).toBe(normalizarTextoVerdad('SA DE CV'));
    expect(normalizarTextoVerdad('ESTACIÓN')).toBe(normalizarTextoVerdad('Estacion'));
    expect(normalizarTextoVerdad('OXXO  GAS')).toBe('OXXOGAS');
  });

  test('lo vacío y lo nulo salen null — jamás cadena vacía que parezca un dato', () => {
    expect(normalizarTextoVerdad(null)).toBeNull();
    expect(normalizarTextoVerdad('   ')).toBeNull();
    expect(normalizarTextoVerdad('...')).toBeNull();
  });

  test('NO junta dos emisores distintos: la normalización no interpreta', () => {
    expect(normalizarTextoVerdad('Oxxo Gas')).not.toBe(normalizarTextoVerdad('Oxxo'));
  });
});

describe('normalización de dominio', () => {
  test('esquema, www y camino son decoración: los tres apuntan al mismo dominio', () => {
    expect(normalizarDominio('www.factura.oxxo.com/')).toBe('factura.oxxo.com');
    expect(normalizarDominio('https://factura.oxxo.com/portal?a=1')).toBe('factura.oxxo.com');
    expect(normalizarDominio('FACTURA.OXXO.COM')).toBe('factura.oxxo.com');
  });

  test('el punto final del renglón no cambia el dominio', () => {
    expect(normalizarDominio('facturacioncapufe.com.mx.')).toBe('facturacioncapufe.com.mx');
  });

  test('vacío y null salen null', () => {
    expect(normalizarDominio('')).toBeNull();
    expect(normalizarDominio(null)).toBeNull();
    expect(normalizarDominio('https://')).toBeNull();
  });
});

describe('fecha y monto', () => {
  test('la fecha se compara normalizada a yyyy-mm-dd, con o sin hora', () => {
    expect(normalizarFechaVerdad('2026-07-31T18:22:00Z')).toBe('2026-07-31');
    expect(normalizarFechaVerdad('2026-07-31')).toBe('2026-07-31');
    expect(normalizarFechaVerdad('31/07/2026')).toBeNull();
    expect(normalizarFechaVerdad(null)).toBeNull();
  });

  test('el monto es exacto a dos decimales: tolerancia CERO', () => {
    expect(montosIguales(1234.5, 1234.5)).toBe(true);
    expect(montosIguales(1234.5, 1234.501)).toBe(true);   // ruido de coma flotante
    expect(montosIguales(1234.5, 1234.05)).toBe(false);   // dígito transpuesto: error
    expect(montosIguales(1234.5, null)).toBe(false);
    expect(montosIguales(null, null)).toBe(true);
  });
});

describe('comparador de RFC — la Ñ y el & cuentan (auditoría tandas 21-24, hallazgo 2)', () => {
  // El comparador genérico descomponía la Ñ (NFD) y eliminaba el & con
  // [^A-Z0-9]: dos RFC de contribuyentes DISTINTOS daban `ok` — el fallo que
  // la cabecera del módulo llama el más caro, con el porcentaje inflado justo
  // en los casos difíciles. Reproducido con el código real antes del arreglo.
  test('una Ñ leída como N es OTRO contribuyente → mal', () => {
    const c = compararCampo('rfcEmisor', verdad({ rfcEmisor: 'AÑB123456XY0' }), leido({ rfcEmisor: 'ANB123456XY0' }));
    expect(c.veredicto).toBe('mal');
    expect(c.motivo).toMatch(/carácter por carácter/);
  });

  test('un & omitido es OTRO contribuyente → mal', () => {
    const c = compararCampo('rfcEmisor', verdad({ rfcEmisor: 'J&B840101XX1' }), leido({ rfcEmisor: 'JB840101XX1' }));
    expect(c.veredicto).toBe('mal');
  });

  test('la Ñ y el & bien leídos son acierto — no se castigan por raros', () => {
    expect(compararCampo('rfcEmisor', verdad({ rfcEmisor: 'AÑB123456XY0' }), leido({ rfcEmisor: 'AÑB123456XY0' })).veredicto).toBe('ok');
    expect(compararCampo('rfcEmisor', verdad({ rfcEmisor: 'J&B840101XX1' }), leido({ rfcEmisor: 'J&B840101XX1' })).veredicto).toBe('ok');
  });

  test('espacios, guiones y minúsculas NO son error de lectura → ok', () => {
    const c = compararCampo('rfcEmisor', verdad({ rfcEmisor: 'XAX-010101-AB1' }), leido({ rfcEmisor: ' xax 010101 ab1 ' }));
    expect(c.veredicto).toBe('ok');
  });

  test('la MISMA Ñ en NFC y en NFD es la misma letra → ok', () => {
    // 'Ñ' compuesta (U+00D1) vs 'N' + tilde combinante (U+004E U+0303).
    const c = compararCampo('rfcEmisor', verdad({ rfcEmisor: 'A\u00D1B123456XY0' }), leido({ rfcEmisor: 'AN\u0303B123456XY0' }));
    expect(c.veredicto).toBe('ok');
  });

  test('normalizarRfcVerdad: vacío y nulo salen null — jamás cadena vacía', () => {
    expect(normalizarRfcVerdad(null)).toBeNull();
    expect(normalizarRfcVerdad('  - ')).toBeNull();
  });
});

describe('compararCampo — las tres ramas que deciden el número', () => {
  test('lectura idéntica: acierto en las 7 claves', () => {
    const m = medir(VERDAD, LEIDO_PERFECTO);
    expect(m.camposOk).toBe(7);
    expect(m.camposMal).toBe(0);
    expect(m.camposNoMedidos).toBe(0);
  });

  test('ILEGIBLE → no_medido: ni acierto ni error, aunque el OCR haya leído algo', () => {
    const v = verdad({ folio: null, ilegibles: ['folio'] });
    const c = compararCampo('folio', v, leido({ folio: 'XYZ-9' }));
    expect(c.veredicto).toBe('no_medido');
    expect(c.esperado).toBeNull();
    expect(c.motivo).toMatch(/no hay valor esperado/);

    // Y no entra al denominador.
    const m = medir(v, leido({ folio: 'XYZ-9' }));
    expect(m.camposNoMedidos).toBe(1);
    expect(m.camposOk + m.camposMal).toBe(6);
  });

  test('NO APLICA + el OCR leyó algo → mal (alucinación), y lo DICE', () => {
    const v = verdad({ rfcEmisor: null, noAplica: ['rfcEmisor'] });
    const c = compararCampo('rfcEmisor', v, leido({ rfcEmisor: 'XAXX010101000' }));
    expect(c.veredicto).toBe('mal');
    expect(c.motivo).toMatch(/alucinación/);
  });

  test('NO APLICA + el OCR tampoco leyó nada → ok', () => {
    const v = verdad({ rfcEmisor: null, noAplica: ['rfcEmisor'] });
    expect(compararCampo('rfcEmisor', v, leido({ rfcEmisor: null })).veredicto).toBe('ok');
  });

  test('el papel SÍ lo imprime y el OCR no leyó nada → mal, no un empate', () => {
    const c = compararCampo('folio', VERDAD, leido({ folio: null }));
    expect(c.veredicto).toBe('mal');
    expect(c.esperado).toBe('000123');
    expect(c.motivo).toMatch(/no leyó nada/);
  });

  test('un null esperado JAMÁS se vuelve 0: monto null contra monto 0 no es acierto', () => {
    const v = verdad({ monto: null, ilegibles: ['monto'] });
    const c = compararCampo('monto', v, leido({ monto: 0 }));
    // Ilegible manda: no se mide. Y el esperado sigue siendo null, no 0.
    expect(c.veredicto).toBe('no_medido');
    expect(c.esperado).toBeNull();
    expect(c.esperado).not.toBe(0);
  });

  test('el monto mal leído por un dígito es un error, no un redondeo', () => {
    expect(compararCampo('monto', VERDAD, leido({ monto: 1234.05 })).veredicto).toBe('mal');
    expect(compararCampo('monto', VERDAD, leido({ monto: 1234.5 })).veredicto).toBe('ok');
  });

  test('la fecha se compara normalizada: el ISO con hora acierta', () => {
    expect(compararCampo('fecha', VERDAD, leido({ fecha: '2026-07-31T05:00:00Z' })).veredicto).toBe('ok');
    expect(compararCampo('fecha', VERDAD, leido({ fecha: '2026-08-01' })).veredicto).toBe('mal');
    const basura = compararCampo('fecha', VERDAD, leido({ fecha: 'no soy fecha' }));
    expect(basura.veredicto).toBe('mal');
    expect(basura.motivo).toMatch(/no es una fecha/);
  });

  test('el texto acierta con acentos, puntuación y espacios distintos', () => {
    expect(compararCampo('emisor', VERDAD, leido({ emisor: 'CAMINOS Y PUENTES FEDERALES SA DE CV' })).veredicto).toBe('ok');
    expect(compararCampo('sucursal', VERDAD, leido({ sucursal: 'caseta  palmillas' })).veredicto).toBe('ok');
    expect(compararCampo('emisor', VERDAD, leido({ emisor: 'Pemex' })).veredicto).toBe('mal');
  });

  test('el dominio acierta con esquema y www de más', () => {
    expect(compararCampo('dominioFacturacion', VERDAD, leido({ dominioFacturacion: 'https://www.facturacioncapufe.com.mx/Capufe/' })).veredicto).toBe('ok');
    expect(compararCampo('dominioFacturacion', VERDAD, leido({ dominioFacturacion: 'https://factura.oxxo.com' })).veredicto).toBe('mal');
  });

  test('el esperado que se enseña es el CRUDO, no el normalizado', () => {
    const c = compararCampo('emisor', VERDAD, leido({ emisor: 'CAMINOS Y PUENTES FEDERALES SA DE CV' }));
    expect(c.esperado).toBe('Caminos y Puentes Federales, S.A. de C.V.');
  });
});

describe('medir y agregar', () => {
  test('mide las 7 claves, en el orden de la pantalla', () => {
    const m = medir(VERDAD, LEIDO_PERFECTO);
    expect(m.campos.map((c) => c.clave)).toEqual([...CLAVES_VERDAD]);
  });

  test('los tres contadores suman siempre 7 — el mismo CHECK que la 0239', () => {
    const casos: Array<[VerdadTerreno, OcrLeido]> = [
      [VERDAD, LEIDO_PERFECTO],
      [verdad({ folio: null, ilegibles: ['folio'] }), ocrVacio()],
      [verdad({ rfcEmisor: null, noAplica: ['rfcEmisor'] }), leido({ rfcEmisor: 'XAXX010101000' })],
    ];
    for (const [v, l] of casos) {
      const m = medir(v, l);
      expect(m.camposOk + m.camposMal + m.camposNoMedidos).toBe(7);
    }
    const sinLeer = medicionSinLeer('el proveedor devolvió 503');
    expect(sinLeer.camposOk + sinLeer.camposMal + sinLeer.camposNoMedidos).toBe(7);
  });

  test('un fallo técnico NO cuenta 7 errores: cuenta 7 sin medir, con el motivo', () => {
    const m = medicionSinLeer('el proveedor devolvió 503');
    expect(m.camposMal).toBe(0);
    expect(m.camposNoMedidos).toBe(7);
    expect(m.campos.every((c) => c.motivo === 'el proveedor devolvió 503')).toBe(true);
  });

  test('SIN campos medidos no hay porcentaje: exactitud es null, ni 0% ni 100%', () => {
    expect(agregar([]).exactitud).toBeNull();
    expect(agregar([medicionSinLeer('nada')]).exactitud).toBeNull();
    expect(agregar([medicionSinLeer('nada')]).medidos).toBe(0);
  });

  test('la exactitud se calcula sobre ok+mal, con los no medidos FUERA del denominador', () => {
    // 5 aciertos, 1 error, 1 ilegible → 5/6, no 5/7.
    const v = verdad({ folio: null, ilegibles: ['folio'] });
    const m = medir(v, leido({ monto: 999 }));
    expect(m.camposOk).toBe(5);
    expect(m.camposMal).toBe(1);
    expect(m.camposNoMedidos).toBe(1);
    const a = agregar([m]);
    expect(a.medidos).toBe(6);
    expect(a.exactitud).toBeCloseTo(5 / 6, 10);
  });

  test('agrega varias fotos sumando cada bando', () => {
    const a = agregar([medir(VERDAD, LEIDO_PERFECTO), medir(VERDAD, ocrVacio())]);
    expect(a.ok).toBe(7);
    expect(a.mal).toBe(7);
    expect(a.medidos).toBe(14);
    expect(a.exactitud).toBeCloseTo(0.5, 10);
  });
});

describe('ocrLeidoDeGasto — el puente con el Gasto de producción', () => {
  test('saca las 7 claves de donde de verdad viven', () => {
    const l = ocrLeidoDeGasto({
      monto: 1234.5, fecha: '2026-07-31', folio: '000123', rfcEmisor: 'CPF890101AAA',
      ocrExtra: {
        emisor: 'Caminos y Puentes Federales',
        estacion: 'Caseta Palmillas',
        urlFacturacion: 'https://facturacioncapufe.com.mx/Capufe/',
      },
    });
    expect(l.emisor).toBe('Caminos y Puentes Federales');
    expect(l.sucursal).toBe('Caseta Palmillas');
    expect(l.dominioFacturacion).toBe('https://facturacioncapufe.com.mx/Capufe/');
    expect(l.folio).toBe('000123');
  });

  test('`undefined` se vuelve null (nunca cadena vacía) y el monto 0 del fallo técnico es null', () => {
    const l = ocrLeidoDeGasto({ monto: 0 });
    expect(l).toEqual(ocrVacio());
    expect(l.monto).toBeNull();
  });

  test('una cadena en blanco del OCR no se cuela como valor leído', () => {
    const l = ocrLeidoDeGasto({ folio: '   ', ocrExtra: { emisor: '' } });
    expect(l.folio).toBeNull();
    expect(l.emisor).toBeNull();
  });

  test('un monto negativo o no finito no se toma como leído', () => {
    expect(ocrLeidoDeGasto({ monto: -3 }).monto).toBeNull();
    expect(ocrLeidoDeGasto({ monto: Number.POSITIVE_INFINITY }).monto).toBeNull();
  });
});

test('toda ClaveVerdad tiene una rama de comparación que no revienta', () => {
  for (const clave of CLAVES_VERDAD as readonly ClaveVerdad[]) {
    expect(() => compararCampo(clave, VERDAD, ocrVacio())).not.toThrow();
    expect(compararCampo(clave, VERDAD, ocrVacio()).clave).toBe(clave);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// LA MEDICIÓN DE PUNTA A PUNTA (Fase de precisión, mig. 0246): qué se cuenta
// cuando la corrida NO persistió nada para una foto, cómo se agrupan los
// números por campo, y cómo se identifican las alucinaciones desde la
// medición GUARDADA (sin la etiqueta a la mano).
// ═══════════════════════════════════════════════════════════════════════════

describe('medirSinGasto — la foto procesada que no dejó gasto', () => {
  test('la suma SIEMPRE es 7 — el CHECK de la 0239 no es negociable', () => {
    for (const clase of ['ticket', 'voucher_bancario', 'cfdi_impreso', 'no_comprobante'] as const) {
      const m = medirSinGasto(verdad({ clase }));
      expect(m.camposOk + m.camposMal + m.camposNoMedidos).toBe(7);
    }
  });

  test('un negativo (no_comprobante, todo noAplica) RECHAZADO = 7 ok — nada inventado entró', () => {
    const m = medirSinGasto(verdad({
      clase: 'no_comprobante',
      emisor: null, rfcEmisor: null, folio: null, monto: null,
      fecha: null, sucursal: null, dominioFacturacion: null,
      noAplica: [...CLAVES_VERDAD],
    }));
    expect(m.camposOk).toBe(7);
    expect(m.camposMal).toBe(0);
    expect(m.camposNoMedidos).toBe(0);
  });

  test('un ticket de verdad rechazado = sus campos impresos cuentan MAL (estricto, y dicho)', () => {
    const m = medirSinGasto(VERDAD);   // ticket con las 7 impresas
    expect(m.camposMal).toBe(7);
    expect(m.campos.every((c) => c.veredicto !== 'mal' || /punta a punta/.test(c.motivo ?? ''))).toBe(true);
  });

  test('un voucher rechazado POR DISEÑO: campos con valor → no_medido (ni premio ni castigo), noAplica → ok', () => {
    const m = medirSinGasto(verdad({
      clase: 'voucher_bancario',
      folio: null, dominioFacturacion: null,
      noAplica: ['folio', 'dominioFacturacion'],
    }));
    // 5 con valor → no_medido; 2 noAplica → ok (nada inventado).
    expect(m.camposNoMedidos).toBe(5);
    expect(m.camposOk).toBe(2);
    expect(m.camposMal).toBe(0);
    expect(m.campos.find((c) => c.clave === 'monto')?.motivo).toMatch(/solo_pago/);
  });

  test('lo ilegible sale del denominador también aquí', () => {
    const m = medirSinGasto(verdad({ fecha: null, ilegibles: ['fecha'] }));
    expect(m.campos.find((c) => c.clave === 'fecha')?.veredicto).toBe('no_medido');
    expect(m.camposMal).toBe(6);
  });
});

describe('esAlucinacion y contarAlucinaciones — desde la medición guardada', () => {
  test('alucinación = esperado null con veredicto mal; un ilegible jamás califica', () => {
    const negativo = verdad({
      clase: 'no_comprobante',
      emisor: null, rfcEmisor: null, folio: null, monto: null,
      fecha: null, sucursal: null, dominioFacturacion: null,
      noAplica: [...CLAVES_VERDAD],
    });
    const alucinada = medir(negativo, leido({}));           // "leyó" las 7
    const rechazada = medir(negativo, ocrVacio());          // no leyó nada
    expect(alucinada.campos.filter(esAlucinacion)).toHaveLength(7);
    expect(rechazada.campos.filter(esAlucinacion)).toHaveLength(0);

    const conIlegible = medir(verdad({ fecha: null, ilegibles: ['fecha'] }), leido({}));
    // La fecha ilegible sale no_medido: no puede contarse alucinación.
    expect(conIlegible.campos.filter(esAlucinacion)).toHaveLength(0);
  });

  test('contarAlucinaciones suma sobre varias mediciones', () => {
    const negativo = verdad({
      clase: 'no_comprobante',
      emisor: null, rfcEmisor: null, folio: null, monto: null,
      fecha: null, sucursal: null, dominioFacturacion: null,
      noAplica: [...CLAVES_VERDAD],
    });
    const a = medir(negativo, leido({ monto: null, fecha: null }));  // 5 alucinadas
    const b = medir(negativo, ocrVacio());                           // 0
    expect(contarAlucinaciones([a, b])).toBe(5);
  });
});

describe('agregarPorCampo — el campo que peor se lee vale más que el global', () => {
  test('agrupa por clave y deja null (no 0%) al campo sin ni una medición', () => {
    const soloFolioMal = medir(VERDAD, leido({ folio: '999999' }));
    const sinNada = medicionSinLeer('fallo técnico');
    const filas = agregarPorCampo([soloFolioMal, sinNada]);
    const folio = filas.find((f) => f.clave === 'folio');
    expect(folio).toMatchObject({ ok: 0, mal: 1, noMedidos: 1, medidos: 1, exactitud: 0 });
    const monto = filas.find((f) => f.clave === 'monto');
    expect(monto).toMatchObject({ ok: 1, mal: 0, noMedidos: 1, exactitud: 1 });
    // TODAS las claves están presentes aunque nadie las haya medido.
    expect(filas.map((f) => f.clave)).toEqual([...CLAVES_VERDAD]);
    const nadaMedido = agregarPorCampo([sinNada]);
    for (const f of nadaMedido) expect(f.exactitud).toBeNull();
  });
});

describe('resumenPrecision — los negativos van APARTE y el no-medido lleva su razón', () => {
  const negativoVerdad = verdad({
    clase: 'no_comprobante',
    emisor: null, rfcEmisor: null, folio: null, monto: null,
    fecha: null, sucursal: null, dominioFacturacion: null,
    noAplica: [...CLAVES_VERDAD],
  });
  const fotoResumen = (p: Partial<MedicionFotoResumen>): MedicionFotoResumen => ({
    fotoId: 'f1', etiqueta: 'foto.jpg', clase: 'ticket',
    medicion: medir(VERDAD, LEIDO_PERFECTO), modelo: 'm', motivo: null, costoUsd: 0, ...p,
  });

  test('separa los negativos con su conteo de alucinaciones, sin diluirlos en el global', () => {
    const r = resumenPrecision([
      fotoResumen({ fotoId: 'a' }),
      fotoResumen({ fotoId: 'neg-ok', clase: 'no_comprobante', medicion: medir(negativoVerdad, ocrVacio()) }),
      fotoResumen({ fotoId: 'neg-mal', clase: 'no_comprobante', medicion: medir(negativoVerdad, leido({})) }),
    ]);
    expect(r.negativos).toEqual({ fotos: 2, conAlucinacion: 1, camposAlucinados: 7 });
    expect(r.alucinaciones).toBe(7);
    expect(r.global.ok).toBe(7 + 7);   // la perfecta + el negativo rechazado
    expect(r.global.mal).toBe(7);      // el negativo alucinado
  });

  test('los no-medidos se agrupan por su razón — nada sale del denominador sin decir por qué', () => {
    const r = resumenPrecision([
      fotoResumen({ medicion: medicionSinLeer('el proveedor devolvió 5xx') }),
      fotoResumen({ fotoId: 'f2', medicion: medicionSinLeer('el proveedor devolvió 5xx') }),
    ]);
    expect(r.global.exactitud).toBeNull();   // sin campos medidos NO hay porcentaje
    expect(r.noMedidosPorMotivo).toEqual([{ motivo: 'el proveedor devolvió 5xx', campos: 14 }]);
  });
});

describe('el emisor con su nombre comercial entre paréntesis (caso medido, corrida 46ad99ca)', () => {
  test('la razón social exacta acierta aunque la etiqueta anote el alias', () => {
    const v = verdad({ emisor: 'NUEVA WAL MART DE MEXICO S DE RL DE CV (WALMART)' });
    expect(compararCampo('emisor', v, leido({ emisor: 'NUEVA WAL MART DE MEXICO S DE RL DE CV' })).veredicto).toBe('ok');
    // Y la etiqueta completa también, claro.
    expect(compararCampo('emisor', v, leido({ emisor: 'Nueva Wal Mart de Mexico S de RL de CV (Walmart)' })).veredicto).toBe('ok');
  });

  test('el alias SOLO no acierta: "WALMART" a secas no demuestra la razón social', () => {
    const v = verdad({ emisor: 'NUEVA WAL MART DE MEXICO S DE RL DE CV (WALMART)' });
    expect(compararCampo('emisor', v, leido({ emisor: 'WALMART' })).veredicto).toBe('mal');
  });

  test('una razón social incompleta sigue siendo mal — la variante no relaja lo demás', () => {
    const v = verdad({ emisor: 'NUEVA WAL MART DE MEXICO S DE RL DE CV (WALMART)' });
    expect(compararCampo('emisor', v, leido({ emisor: 'WAL MART DE MEXICO S DE RL DE CV' })).veredicto).toBe('mal');
  });

  test('variantesEmisorEsperado: sin paréntesis no duplica variantes', () => {
    expect(variantesEmisorEsperado('OXXO GAS')).toEqual(['OXXOGAS']);
    expect(variantesEmisorEsperado('A.D.F.S.A. (ARCO 8039)')).toEqual(['ADFSAARCO8039', 'ADFSA']);
  });
});
