import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sinComentarios } from '@/lib/pruebas/codigo';

// `supabase/server` importa `next/headers`, que fuera de una petición de Next
// no se puede cargar. Nada de lo que se prueba aquí toca la base: las funciones
// de cálculo son puras y las estructurales leen el CÓDIGO, no lo ejecutan.
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({}) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));

const {
  UMBRAL_OCR_DUDOSO,
  estadoComprobante,
  resumenLiquidacion,
  leerDiferencia,
  etiquetaEstatusViaje,
} = await import('./chofer');
const { armarRespuesta } = await import('./consulta_chofer');

const FUENTE = readFileSync(fileURLToPath(new URL('./chofer.ts', import.meta.url)), 'utf8');
const CODIGO = sinComentarios(FUENTE);
const FUENTE_WA = readFileSync(fileURLToPath(new URL('./consulta_chofer.ts', import.meta.url)), 'utf8');

/** Un `EstadoViaje` completo con lo que haga falta encima. */
function estado(over: Partial<Parameters<typeof resumenLiquidacion>[0]> = {}) {
  return {
    anticipo: 10600,
    comprobado: 8400,
    comprobantes: 12,
    ultimoConcepto: 'diesel',
    ultimoMonto: 400,
    enRevision: 0,
    ...over,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE EL CHOFER LEE COMO "CUÁNTO ME FALTA".
//
// Es la cifra que va a comparar contra lo que le paguen. Si esta pantalla dice
// una cosa y el WhatsApp otra, el chofer no descubre un bug: descubre que le
// están dando dos números y elige el que le conviene para reclamar.
// ═══════════════════════════════════════════════════════════════════════════
describe('resumenLiquidacion', () => {
  it('con anticipo, dice cuánto lleva y cuánto le falta', () => {
    const r = resumenLiquidacion(estado());
    expect(r.comprobado).toBe(8400);
    expect(r.anticipo).toBe(10600);
    expect(r.falta).toBe(2200);
    expect(r.excedente).toBe(0);
    expect(r.avance).toBeCloseTo(0.7925, 3);
  });

  it('comprobar de más NO se pinta como faltante negativo', () => {
    // El caso real del viaje VJ-2026-0847: $16,297.05 comprobados contra
    // $10,600 de anticipo. Un `falta: -5697.05` en pantalla se lee como una
    // deuda al revés.
    const r = resumenLiquidacion(estado({ comprobado: 16297.05 }));
    expect(r.falta).toBe(0);
    expect(r.excedente).toBe(5697.05);
    expect(r.avance).toBeGreaterThan(1);
    expect(r.leyenda).toMatch(/más que el anticipo/i);
  });

  it('justo en el anticipo no dice ni que falta ni que sobra', () => {
    const r = resumenLiquidacion(estado({ comprobado: 10600 }));
    expect(r.falta).toBe(0);
    expect(r.excedente).toBe(0);
    expect(r.avance).toBe(1);
    expect(r.leyenda).toMatch(/justo/i);
  });

  it('SIN ANTICIPO no inventa un faltante: devuelve null y lo explica', () => {
    // `anticipo = 0` es ambiguo — "no le dieron nada" o "nadie lo capturó" —
    // y las dos lecturas cambian lo que el chofer tiene que hacer. Un cero en
    // la casilla "te falta" afirmaría que ya no debe comprobar nada.
    const r = resumenLiquidacion(estado({ anticipo: 0, comprobado: 1200 }));
    expect(r.falta).toBeNull();
    expect(r.excedente).toBeNull();
    expect(r.avance).toBeNull();
    expect(r.comprobado).toBe(1200);
    expect(r.leyenda).toMatch(/no se puede decir cuánto te falta/i);
  });

  it('un anticipo negativo (captura errónea) se trata como sin anticipo', () => {
    expect(resumenLiquidacion(estado({ anticipo: -500 })).falta).toBeNull();
  });

  it('el faltante se redondea a centavos, que es lo que existe en un CFDI', () => {
    // Sin `round2`, 10600 − 8399.99 sale 2200.0100000000002 en coma flotante.
    const r = resumenLiquidacion(estado({ comprobado: 8399.99 }));
    expect(r.falta).toBe(2200.01);
  });

  it('arrastra los comprobantes y los que se leyeron mal, sin recontarlos', () => {
    const r = resumenLiquidacion(estado({ comprobantes: 7, enRevision: 2 }));
    expect(r.comprobantes).toBe(7);
    expect(r.enRevision).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LAS DOS SUPERFICIES TIENEN QUE CALLAR LO MISMO.
//
// El chofer pregunta "¿cuánto llevo?" por WhatsApp y abre el panel el mismo
// día. `armarRespuesta` ya decidió que sin anticipo no se dice cuánto falta;
// esta prueba amarra el panel a esa misma decisión en vez de confiar en que
// quien escriba la próxima pantalla se acuerde.
// ═══════════════════════════════════════════════════════════════════════════
describe('el panel y el WhatsApp no se contradicen', () => {
  it('sin anticipo, ninguno de los dos dice cuánto falta', () => {
    const e = estado({ anticipo: 0, comprobado: 1200 });
    expect(armarRespuesta('saldo', e)).toMatch(/no te puedo decir cuánto te falta/i);
    expect(resumenLiquidacion(e).falta).toBeNull();
  });

  it('con anticipo, el faltante del panel es el mismo que el del mensaje', () => {
    const e = estado();
    // El mensaje imprime "$2,200.00"; el panel devuelve 2200. Misma resta.
    expect(armarRespuesta('saldo', e)).toContain('$2,200.00');
    expect(resumenLiquidacion(e).falta).toBe(2200);
  });
});

describe('estadoComprobante', () => {
  it('confianza baja = hay que reenviar la foto', () => {
    expect(estadoComprobante(0.4)).toBe('revisar');
    expect(estadoComprobante(0.69)).toBe('revisar');
  });

  it('el umbral es exclusivo: justo en 0.7 el comprobante está bien', () => {
    expect(estadoComprobante(UMBRAL_OCR_DUDOSO)).toBe('registrado');
    expect(estadoComprobante(0.95)).toBe('registrado');
  });

  it('SIN confianza no es "mal leído": es que no pasó por OCR', () => {
    // Un CFDI llega por XML con sus cifras ya escritas. Marcarlo en rojo
    // mandaría al chofer a retomar una foto que nadie necesita.
    expect(estadoComprobante(null)).toBe('registrado');
    expect(estadoComprobante(undefined)).toBe('registrado');
  });

  it('un valor ilegible no se lee como confianza cero', () => {
    // `Number(null)` es 0 y `Number('')` también: si la columna llegara vacía y
    // se convirtiera a ciegas, TODOS los comprobantes saldrían "por revisar".
    expect(estadoComprobante(Number.NaN)).toBe('registrado');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL UMBRAL NO PUEDE SEPARARSE DEL QUE CUENTA LOS "EN REVISIÓN".
//
// `estadoDelViaje` cuenta cuántas fotos se leyeron mal con `< 0.7` escrito a
// mano (consulta_chofer.ts). Esta pantalla marca cuáles son. Si los dos números
// se separaran, el panel diría "2 por revisar" arriba y pintaría 3 abajo — y no
// hay forma de que el chofer sepa cuál va a usar su oficina.
// ═══════════════════════════════════════════════════════════════════════════
describe('el umbral de OCR es UNO solo', () => {
  it('el de consulta_chofer.ts sigue siendo el mismo', () => {
    const m = /ocr_confianza\) < ([\d.]+)\)/.exec(sinComentarios(FUENTE_WA));
    expect(m, 'cambió la forma del filtro de `enRevision` en consulta_chofer.ts').not.toBeNull();
    expect(Number(m![1])).toBe(UMBRAL_OCR_DUDOSO);
  });
});

describe('leerDiferencia', () => {
  it('positiva es a favor de la empresa, negativa del operador', () => {
    expect(leerDiferencia(3288).texto).toBe('A favor de la empresa');
    expect(leerDiferencia(-5697.05).texto).toBe('A favor del operador');
    expect(leerDiferencia(0).texto).toBe('Sin diferencia');
  });

  it('NO le dice al chofer que debe ni que le deben', () => {
    // Que exista una diferencia no autoriza un descuento de nómina: el art. 110
    // fr. I de la LFT exige acuerdo con el trabajador (ver laboral/pagadero.ts).
    // La pantalla reporta el saldo, no dicta el veredicto laboral.
    for (const d of [3288, -3288, 0]) {
      expect(leerDiferencia(d).texto).not.toMatch(/debes|te deben|se te descuenta/i);
    }
  });
});

describe('etiquetaEstatusViaje', () => {
  it('traduce los tres estatus del dominio', () => {
    expect(etiquetaEstatusViaje('abierto')).toBe('En ruta');
    expect(etiquetaEstatusViaje('en_cuadre')).toBe('En cuadre');
    expect(etiquetaEstatusViaje('liquidado')).toBe('Liquidado');
  });

  it('un estatus desconocido se pinta crudo, no traducido a lo que parezca', () => {
    expect(etiquetaEstatusViaje('cancelado')).toBe('cancelado');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL CHOFER VE SOLO LO SUYO — comprobado sobre el CÓDIGO, no sobre la UI.
//
// La 0045 le da RLS propia, pero este archivo usa el service-role en tres
// sitios (unidad, storage, la aceptación) y ahí la RLS no protege nada: el
// único candado es el `.eq()` escrito a mano. Un `.eq('operador_id')` que se le
// olvide a alguien en la próxima consulta es exactamente el IDOR que la 0045
// existe para cerrar, y una revisión a ojo no lo va a atrapar dos meses después.
// ═══════════════════════════════════════════════════════════════════════════
describe('toda consulta de chofer.ts está acotada al chofer de la sesión', () => {
  /**
   * Cada `.from('x')` DE TABLA con el resto de su sentencia (hasta el `;`).
   *
   * `storage.from('liquidaciones')` se descarta: es un bucket, no una tabla, y
   * su acotamiento no es un `.eq()` sino de dónde salió la ruta del objeto.
   */
  const consultas = [...CODIGO.matchAll(/\.from\('(\w+)'\)/g)]
    .filter((m) => !CODIGO.slice(Math.max(0, m.index - 40), m.index).includes('storage'))
    .map((m) => ({
      tabla: m[1],
      sentencia: CODIGO.slice(m.index, CODIGO.indexOf(';', m.index)),
    }));

  it('hay consultas que revisar (si no, esta prueba no está midiendo nada)', () => {
    expect(consultas.length).toBeGreaterThanOrEqual(4);
  });

  it('todas filtran por tenant_id', () => {
    const sinTenant = consultas.filter((c) => !c.sentencia.includes(".eq('tenant_id', tenantId)"));
    expect(sinTenant.map((c) => c.tabla), 'consultas sin filtro de flota').toEqual([]);
  });

  it('las de `viaje` filtran además por operador_id', () => {
    const flojas = consultas
      .filter((c) => c.tabla === 'viaje')
      .filter((c) => !c.sentencia.includes(".eq('operador_id', operadorId)"));
    expect(flojas.length, 'una consulta de viaje sin operador_id le enseña la flota entera al chofer').toBe(0);
  });

  it('las de `gasto` cuelgan de un viaje ya verificado, nunca de un id suelto', () => {
    const flojas = consultas
      .filter((c) => c.tabla === 'gasto')
      .filter((c) => !c.sentencia.includes(".eq('viaje_id', viaje.id)"));
    expect(flojas.length).toBe(0);
  });

  it('la unidad se lee del viaje verificado, no de un uuid por parámetro', () => {
    const flojas = consultas
      .filter((c) => c.tabla === 'unidad')
      .filter((c) => !c.sentencia.includes(".eq('id', viaje.unidadId)"));
    expect(flojas.length).toBe(0);
  });

  it('el service-role NO toca gasto ni liquidacion', () => {
    // Esas dos SÍ tienen policy de operador (0045). Leerlas con el
    // service-role sería apagar la segunda capa sin ganar nada.
    for (const bloque of CODIGO.split('supabaseAdmin()').slice(1)) {
      const hasta = bloque.indexOf(';');
      expect(bloque.slice(0, hasta)).not.toMatch(/\.from\('(gasto|liquidacion)'\)/);
    }
  });
});

describe('chofer.ts no reimplementa lo que ya existe', () => {
  it('el saldo lo calcula `estadoDelViaje`, no una suma nueva', () => {
    expect(CODIGO).toMatch(/import \{ estadoDelViaje/);
    // Una segunda suma de `monto` aquí es cómo el panel y el WhatsApp acabarían
    // contestando distinto a la misma pregunta.
    expect(CODIGO).not.toMatch(/\.reduce\(/);
  });

  it('no enlaza la ruta de PDF que no comprueba de quién es la liquidación', () => {
    // `/api/export/pdf/[id]` autoriza con `getSessionTenant()` a secas: sirve
    // cualquier liquidación del tenant a cualquier usuario del tenant, chofer
    // incluido. Enlazarla desde aquí sería enseñarle la puerta.
    expect(CODIGO).not.toMatch(/\/api\/export\/pdf/);
  });
});
