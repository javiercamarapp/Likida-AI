import { describe, test, expect } from 'vitest';
import {
  normalizarTextoVerdad, normalizarDominio, normalizarFechaVerdad, montosIguales,
  compararCampo, medir, medicionSinLeer, agregar, ocrVacio, ocrLeidoDeGasto,
  type OcrLeido,
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
