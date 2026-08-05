import { describe, it, expect } from 'vitest';
import { desglosarPrecio, desgloseCuadra, etiquetaIva, FALTA_CRITERIO_IVA, TASA_IVA } from './iva';
import { DatoInvalido } from '@/lib/cuadra/errores';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10, rubro pruebas — `iva.ts` es nuevo hoy (0065_iva_de_la_mensualidad,
// llamado desde `transferencia.ts`) y llegó SIN una sola prueba. Es el módulo
// que existe, según su propio comentario, para cerrar un bug real: un plan de
// $10,000 podía transferirse por $10,000 y timbrarse por $11,600 porque
// `emitirMensualidad` y `timbrarMensualidad` leían el mismo número con dos
// convenciones de IVA distintas. El CFDI que sale mal no se puede deshacer —
// es justo la clase de camino de dinero que este rubro exige con arnés propio,
// y hoy no tenía ninguno.
//
// Lo que ancla cada prueba de aquí es el invariante que la migración 0065
// exige con un CHECK en la base (`factura_saas_desglose_cuadra`: `abs(monto -
// (subtotal + iva)) <= 0.01`) — si `desglosarPrecio` alguna vez lo rompe, la
// fila ni siquiera se podría guardar, pero el error le llegaría al operador
// como un fallo de base de datos genérico en vez de como lo que es.
// ═══════════════════════════════════════════════════════════════════════════

describe('desglosarPrecio — IVA incluido (criterio: true)', () => {
  it('$10,000 con IVA incluido: subtotal + iva == total, exacto', () => {
    const d = desglosarPrecio(10000, true);
    expect(d.total).toBe(10000);
    expect(d.subtotal).toBe(8620.69);
    expect(d.iva).toBe(1379.31);
    expect(d.subtotal + d.iva).toBe(d.total);
  });

  it('el redondeo se cierra sobre el total, no sobre las partes (10000/1.16 no es exacto en centavos)', () => {
    // Si `subtotal` e `iva` se redondearan por separado (8620.69 y
    // round2(8620.6896... * 0.16) = 1379.31 calculado DESDE el subtotal en vez
    // de como resto), la suma podría desviarse del total por un centavo. La
    // función evita eso calculando `iva` como `total - subtotal`.
    for (const precio of [1, 10, 99.99, 100, 1000, 12345.67, 999999.99]) {
      const d = desglosarPrecio(precio, true);
      // `toBeCloseTo`, no `toBe`: la SUMA cruda de dos números ya redondeados a
      // centavos puede traer ruido de punto flotante en el bit menos
      // significativo (ver el hallazgo de `desgloseCuadra` abajo). El
      // invariante que de verdad importa —que cuadra dentro de un centavo—
      // está anclado aparte con la función real de producción.
      expect(d.subtotal + d.iva, `precio=${precio}`).toBeCloseTo(d.total, 9);
      expect(desgloseCuadra(d.total, d.subtotal, d.iva), `precio=${precio}`).toBe(true);
    }
  });

  it('precio 0 con IVA incluido: todo en cero, no lanza', () => {
    const d = desglosarPrecio(0, true);
    expect(d).toEqual({ subtotal: 0, iva: 0, total: 0 });
  });
});

describe('desglosarPrecio — IVA aparte (criterio: false)', () => {
  it('$10,000 + IVA: el CFDI sale por $11,600, no por $10,000', () => {
    const d = desglosarPrecio(10000, false);
    expect(d.subtotal).toBe(10000);
    expect(d.iva).toBe(1600);
    expect(d.total).toBe(11600);
    expect(d.subtotal + d.iva).toBe(d.total);
  });

  it('el invariante subtotal + iva == total se sostiene en varios precios', () => {
    for (const precio of [1, 10, 99.99, 100, 1000, 12345.67, 999999.99]) {
      const d = desglosarPrecio(precio, false);
      expect(d.subtotal + d.iva, `precio=${precio}`).toBe(d.total);
    }
  });

  it('la tasa aplicada es TASA_IVA (0.16), no una constante suelta duplicada aquí', () => {
    const d = desglosarPrecio(500, false);
    expect(d.iva).toBe(Math.round(500 * TASA_IVA * 100) / 100);
  });
});

describe('desglosarPrecio — el criterio sin declarar NUNCA se trata como un lado', () => {
  it('criterio null: LANZA, no elige un lado por defecto', () => {
    expect(() => desglosarPrecio(10000, null)).toThrow(DatoInvalido);
    expect(() => desglosarPrecio(10000, null)).toThrow(FALTA_CRITERIO_IVA);
  });

  it('criterio undefined (un plan que nunca guardó el campo): mismo camino que null', () => {
    // El tipo declarado es `boolean | null`, pero lo que viene de una fila de
    // Supabase para una columna nunca escrita es `undefined` en JS, no `null`
    // en TS. El código lo cubre explícitamente (`criterio === null ||
    // criterio === undefined`) — esta prueba es la que se pondría roja si esa
    // segunda mitad de la condición se borrara en un refactor.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => desglosarPrecio(10000, undefined as any)).toThrow(DatoInvalido);
  });

  it('nunca hay una lectura "provisional": el desglose no se calcula si no se sabe el lado', () => {
    // No hay forma de invocar `desglosarPrecio` con `null` y quedarse con un
    // resultado a medias — o lanza, o entrega los tres campos completos.
    let resultado: unknown;
    try {
      resultado = desglosarPrecio(10000, null);
    } catch {
      resultado = undefined;
    }
    expect(resultado).toBeUndefined();
  });
});

describe('desglosarPrecio — precio inválido, antes de mirar el criterio', () => {
  it('precio negativo: lanza DatoInvalido', () => {
    expect(() => desglosarPrecio(-1, true)).toThrow(DatoInvalido);
    expect(() => desglosarPrecio(-1, false)).toThrow(DatoInvalido);
  });

  it('precio NaN: lanza DatoInvalido', () => {
    expect(() => desglosarPrecio(NaN, true)).toThrow(DatoInvalido);
  });

  it('precio Infinity: lanza DatoInvalido (Number.isFinite lo atrapa)', () => {
    expect(() => desglosarPrecio(Infinity, true)).toThrow(DatoInvalido);
  });
});

describe('desgloseCuadra — el mismo CHECK que la 0065 pone en la base, del lado del código', () => {
  it('cuadra exacto: true', () => {
    expect(desgloseCuadra(11600, 10000, 1600)).toBe(true);
  });

  it('cuadra dentro de un centavo (el margen del redondeo real): true', () => {
    expect(desgloseCuadra(10000, 8620.69, 1379.31)).toBe(true);
    expect(desgloseCuadra(10000.01, 8620.69, 1379.31)).toBe(true);
  });

  it('AUDITORÍA 10 · el caso límite EXACTO al centavo: la diferencia matemática es 0.01, no 0.02', () => {
    // Escrita esta prueba en rojo primero (TDD): `10000.01 - (8620.69 +
    // 1379.31)` vale, en punto flotante, `0.010000000000218279` — dos
    // billonésimas de centavo por encima de `<= 0.01`, así que la
    // implementación anterior rechazaba un desglose que la migración 0065
    // documenta como tolerado ("un centavo de tolerancia por el redondeo").
    // Escenario real: una fila corregida a mano en Supabase (el propio
    // comentario de `desgloseCuadra` contempla ese camino) que cae justo en el
    // borde de la tolerancia se leería como "no cuadra" y bloquearía el
    // timbrado de una mensualidad que sí estaba bien. Arreglado en
    // `iva.ts::desgloseCuadra` con un margen de `1e-9` contra el ruido de
    // punto flotante — el centavo de tolerancia de negocio sigue siendo 0.01.
    expect(desgloseCuadra(10000.01, 8620.69, 1379.31)).toBe(true);
    // Y el rechazo real —dos centavos, no ruido de flotante— se preserva:
    expect(desgloseCuadra(10000.02, 8620.69, 1379.31)).toBe(false);
  });

  it('se desvía más de un centavo: false — esto es lo que la base rechazaría con el CHECK', () => {
    expect(desgloseCuadra(10000.02, 8620.69, 1379.31)).toBe(false);
    expect(desgloseCuadra(11700, 10000, 1600)).toBe(false);
  });

  it('resultado de desglosarPrecio siempre pasa su propio desgloseCuadra (consistencia entre las dos funciones)', () => {
    for (const precio of [1, 250.5, 10000, 87654.32]) {
      for (const criterio of [true, false]) {
        const d = desglosarPrecio(precio, criterio);
        expect(
          desgloseCuadra(d.total, d.subtotal, d.iva),
          `precio=${precio} criterio=${criterio}`,
        ).toBe(true);
      }
    }
  });
});

describe('etiquetaIva — lo que se enseña en pantalla junto al precio', () => {
  it('true → "IVA incluido"', () => expect(etiquetaIva(true)).toBe('IVA incluido'));
  it('false → "+ IVA"', () => expect(etiquetaIva(false)).toBe('+ IVA'));
  it('null → "IVA sin declarar" (nunca se calla que falta declarar)', () => {
    expect(etiquetaIva(null)).toBe('IVA sin declarar');
  });
});
