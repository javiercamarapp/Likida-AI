import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decidirFoto } from './decidir';
import { emparejarCorreccionDeFecha } from './emparejar';
import { mensajePideFechaOtraVez } from './pedir_fecha';
import { fechaDudosa, ventanaDelViaje } from '../cuadre/fecha_dudosa';
import { sinComentarios } from '@/lib/pruebas/codigo';
import type { Gasto } from '@/types/cuadra';
import type { ExtraerResultado } from './ocr';

// ═══════════════════════════════════════════════════════════════════════════
// LA FOTO QUE SE LE PIDE AL OPERADOR CUANDO LA FECHA NO CUADRA. 1-ago-2026.
//
// Antes de esto, una fecha ilegible salía SOLO en el PDF, al cerrar — cuando el
// operador ya guardó el fajo y la 0037 impide tocar el gasto. La observación
// existía y era inaccionable: nadie podía arreglarla ya.
//
// Y pedir la foto sin el camino de vuelta habría sido PEOR que no pedirla:
// `copiasDeComprobante` deduplica por `concepto|folio|monto`, así que un ticket
// SIN folio no se deduplica. La segunda foto de ése entra como gasto nuevo y
// cobra el mismo consumo dos veces. Por eso las dos mitades —pedirla y saber
// recibirla— se prueban juntas: una sin la otra mueve dinero.
// ═══════════════════════════════════════════════════════════════════════════

const VENTANA = { fechaMin: '2026-07-25', fechaMax: '2026-08-01', hoy: '2026-08-01' };

const gasto = (p: Partial<Gasto> = {}): Gasto => ({
  id: 'g1', viajeId: 'v1', concepto: 'alimentacion', monto: 154, fecha: '2026-01-08',
  folio: undefined, cfdiUuid: undefined, ocrExtra: {},
  ...p,
} as unknown as Gasto);

const foto = (p: { monto?: number; fecha?: string | null; concepto?: string; folio?: string | null } = {}): ExtraerResultado => ({
  legible: true,
  gasto: {
    concepto: p.concepto ?? 'alimentacion',
    monto: p.monto ?? 154,
    fecha: p.fecha === undefined ? '2026-07-28' : p.fecha,
    folio: p.folio ?? undefined,
    ocrExtra: {},
  },
  costo: { modelo: 'x', tokensIn: 0, tokensOut: 0, costoUsd: 0 },
} as unknown as ExtraerResultado);

describe('la regla de fecha dudosa vive en UN solo sitio', () => {
  it('el motor no reimplementa la condición: la importa', () => {
    // Es lo único que garantiza que el intake pida exactamente las fotos que el
    // cuadre marca. Dos copias de esta condición no fallan ruidosamente: se
    // separan, y el operador acaba mandando fotos que el PDF no pedía — o
    // recibiendo el reproche sin que nadie se lo hubiera dicho a tiempo.
    const motor = sinComentarios(readFileSync('src/lib/cuadra/cuadre/engine.ts', 'utf8'));
    expect(motor).toContain('fechaDudosa(');
    expect(motor, 'la comparación cruda volvió al motor').not.toMatch(/input\.fechaMax != null && f > input\.fechaMax/);
  });

  it('y la VENTANA también: desde_db la calcula con ventanaDelViaje', () => {
    const db = sinComentarios(readFileSync('src/lib/cuadra/cuadre/desde_db.ts', 'utf8'));
    expect(db).toContain('ventanaDelViaje(');
    expect(db, 'el cálculo crudo de fechaMin volvió a desde_db').not.toMatch(/86_400_000/);
  });
});

describe('fechaDudosa', () => {
  it('dentro de la ventana no es dudosa', () => {
    expect(fechaDudosa('2026-07-28', VENTANA)).toBeNull();
  });

  it('anterior al inicio del viaje: fuera de rango', () => {
    expect(fechaDudosa('2026-07-01', VENTANA)).toBe('fuera_de_rango');
  });

  it('el futuro no existe', () => {
    expect(fechaDudosa('2026-08-15', VENTANA)).toBe('fuera_de_rango');
  });

  it('de otro ejercicio, y gana sobre "fuera de rango" porque duele distinto', () => {
    // Un gasto de otro ejercicio NO se deduce en éste: es un problema fiscal,
    // no de captura, y el texto que se le manda al operador es otro.
    expect(fechaDudosa('2024-07-27', VENTANA)).toBe('otro_ejercicio');
  });

  it('en enero se tolera el ejercicio inmediato anterior', () => {
    // Un viaje a caballo entre años es normal la última semana de diciembre.
    const enero = { fechaMin: '2025-12-28', fechaMax: '2026-01-05', hoy: '2026-01-05' };
    expect(fechaDudosa('2025-12-30', enero)).toBeNull();
    expect(fechaDudosa('2024-12-30', enero)).toBe('otro_ejercicio');
  });

  it('sin fecha NO es dudosa: es otro problema', () => {
    // Confundirlos haría que se pidiera otra foto de un ticket al que no se le
    // leyó la fecha porque la foto entera está rota — que es lo que
    // `pedir_reenvio` ya resuelve mejor.
    expect(fechaDudosa(null, VENTANA)).toBeNull();
    expect(fechaDudosa(undefined, VENTANA)).toBeNull();
  });
});

describe('ventanaDelViaje', () => {
  it('resta la tolerancia al inicio y topa en hoy', () => {
    const v = ventanaDelViaje('2026-07-28', 3, new Date('2026-08-01T18:00:00Z'));
    expect(v).toEqual({ fechaMin: '2026-07-25', fechaMax: '2026-08-01', hoy: '2026-08-01' });
  });

  it('sin fecha de inicio se ancla en hoy, no revienta', () => {
    const v = ventanaDelViaje(null, 3, new Date('2026-08-01T18:00:00Z'));
    expect(v.fechaMin).toBe('2026-07-29');
  });
});

describe('decidirFoto reconoce la foto correctiva', () => {
  it('re-fecha el gasto que ya existe en vez de dar de alta otro', () => {
    const d = decidirFoto(foto(), [gasto()], VENTANA);
    expect(d).toEqual({ accion: 'corregir_fecha', gastoId: 'g1', fecha: '2026-07-28' });
  });

  it('sin ventana se comporta como antes: alta', () => {
    // Quien no la tenga no puede saber que una fecha es dudosa, y adivinarlo
    // sería peor que no corregir.
    expect(decidirFoto(foto(), [gasto()])).toEqual({ accion: 'alta' });
  });

  it('si la SEGUNDA foto también se lee mal, no corrige: cae a alta', () => {
    // Corregir sería cambiar un error por otro, y el cuadre la vuelve a marcar.
    expect(decidirFoto(foto({ fecha: '2026-02-03' }), [gasto()], VENTANA)).toEqual({ accion: 'alta' });
  });

  it('no re-fecha un comprobante que nadie cuestionó', () => {
    expect(decidirFoto(foto(), [gasto({ fecha: '2026-07-27' } as Partial<Gasto>)], VENTANA)).toEqual({ accion: 'alta' });
  });
});

describe('lo que el emparejador NO empareja — aquí es donde se pierde dinero', () => {
  const dudosa = (f?: string | null) => fechaDudosa(f, VENTANA) != null;

  it('dos candidatos del mismo monto: no se adivina', () => {
    // Dos casetas de $300 el mismo día es corriente. Ponerle la fecha buena a
    // la equivocada deja las DOS mal, y la segunda sin registrar.
    const dos = [
      { ...gasto(), id: 'a', concepto: 'caseta', monto: 300, fecha: '2026-01-08' },
      { ...gasto(), id: 'b', concepto: 'caseta', monto: 300, fecha: '2024-03-02' },
    ] as Gasto[];
    expect(emparejarCorreccionDeFecha({ monto: 300, concepto: 'caseta' }, dos, dudosa)).toBeNull();
  });

  it('folios distintos: son papeles distintos', () => {
    const g = { ...gasto(), folio: '3522' } as Gasto;
    expect(emparejarCorreccionDeFecha({ monto: 154, concepto: 'alimentacion', folio: '9001' }, [g], dudosa)).toBeNull();
    expect(emparejarCorreccionDeFecha({ monto: 154, concepto: 'alimentacion', folio: '3522' }, [g], dudosa)?.id).toBe('g1');
  });

  it('que a UNO le falte el folio se tolera: por eso se pidió la foto otra vez', () => {
    const sinFolio = { ...gasto(), folio: undefined } as Gasto;
    expect(emparejarCorreccionDeFecha({ monto: 154, concepto: 'alimentacion', folio: '3522' }, [sinFolio], dudosa)?.id).toBe('g1');
  });

  it('concepto distinto: no es el mismo ticket aunque coincida el total', () => {
    expect(emparejarCorreccionDeFecha({ monto: 154, concepto: 'caseta' }, [gasto()], dudosa)).toBeNull();
  });

  it('monto distinto: si el total cambió no hay corrección que hacer', () => {
    expect(emparejarCorreccionDeFecha({ monto: 155, concepto: 'alimentacion' }, [gasto()], dudosa)).toBeNull();
  });
});

describe('el mensaje le dice CUÁL ticket es', () => {
  const t = {
    etiqueta: 'Alimentación', monto: 154, folio: '3522',
    emisor: 'FARMACIA GUADALAJARA', estacion: null,
    fecha: '2026-01-08', fechaImpresa: '01/08/26', ejercicioHoy: 2026,
  };

  it('trae todas las señas que sí se leyeron', () => {
    // "Uno de tus tickets trae una fecha rara" no es accionable: el operador ya
    // guardó el fajo y no sabe cuál es.
    const m = mensajePideFechaOtraVez(t, 'fuera_de_rango');
    expect(m).toContain('FARMACIA GUADALAJARA');
    expect(m).toContain('$154.00');
    expect(m).toContain('3522');
    expect(m).toContain('01/08/26');
  });

  it('enseña la fecha impresa junto a la interpretada, que es lo que explica el error', () => {
    // Ver «venía impresa como 01/08/26» al lado de «la entendí como 8 de enero»
    // hace obvio el día/mes invertido sin tener que explicárselo.
    const m = mensajePideFechaOtraVez(t, 'fuera_de_rango');
    expect(m).toMatch(/entendí:.*ene.*2026.*venía impresa como "01\/08\/26"/s);
  });

  it('si la impresa REPITE la interpretada, el paréntesis se calla', () => {
    // Visto en producción el 1-ago: el campo que se pintaba era
    // `ocrExtra.fechaRaw`, que guarda lo que el MODELO contestó antes de
    // normalizar — o sea, ISO. El renglón salía «Fecha que entendí: 01 jun 2026
    // (venía impresa como "2026-06-01")»: la misma fecha dos veces, sin delatar
    // nada. Por eso ahora se lee `fechaImpresa`, y por eso se compara.
    const m = mensajePideFechaOtraVez({ ...t, fecha: '2026-06-01', fechaImpresa: '2026-06-01' }, 'fuera_de_rango');
    expect(m).not.toContain('venía impresa');
  });

  it('y tampoco la repite cuando viene ya con formato bonito', () => {
    const m = mensajePideFechaOtraVez({ ...t, fecha: '2026-06-01', fechaImpresa: '01 jun 2026' }, 'fuera_de_rango');
    expect(m).not.toContain('venía impresa');
  });

  it('omite los renglones que no se leyeron en vez de dejarlos vacíos', () => {
    const m = mensajePideFechaOtraVez({ ...t, emisor: null, folio: null, fechaImpresa: null }, 'fuera_de_rango');
    expect(m).not.toContain('Comercio:');
    expect(m).not.toContain('Folio:');
    expect(m).not.toContain('venía impresa');
    expect(m).not.toContain('—');
  });

  it('le dice que YA quedó registrado, o mandaría la foto creyendo que se perdió', () => {
    expect(mensajePideFechaOtraVez(t, 'fuera_de_rango')).toMatch(/no se te va a duplicar/i);
  });

  it('el ejercicio equivocado se explica distinto que la fecha fuera de rango', () => {
    expect(mensajePideFechaOtraVez(t, 'otro_ejercicio')).toContain('estamos en 2026');
    expect(mensajePideFechaOtraVez(t, 'fuera_de_rango')).toContain('fuera de las fechas de tu viaje');
  });
});

describe('lo que el mensaje NO puede decir', () => {
  it('nunca nombra el PRODUCTO: una farmacia imprime el medicamento', () => {
    // Dato sensible del art. 2 fr. VI de la LFPDPPP. Para identificar el papel
    // basta el comercio, y el comercio no dice qué se compró. Si mañana alguien
    // añade `producto` a las señas «para que sea más fácil encontrarlo», esto
    // lo detiene.
    const fuente = sinComentarios(readFileSync('src/lib/cuadra/intake/pedir_fecha.ts', 'utf8'));
    expect(fuente, 'el producto no puede entrar en el mensaje').not.toMatch(/\bproducto\b/);
  });
});
