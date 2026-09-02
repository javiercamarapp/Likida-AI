import { describe, it, expect } from 'vitest';
import { etiquetaFormaPago } from './vista';
import { MEDIOS_LISR_27_III, MEDIOS_ELECTRONICOS_PEAJE } from '@/lib/likida/cuadre/engine';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 21 (frontend, MEDIO 2): LA FORMA DE PAGO SALÍA COMO CÓDIGO SAT
// CRUDO EN LA PANTALLA QUE SUSTENTA LA DEDUCIBILIDAD.
//
// `FORMA_PAGO` en vista.tsx no traía '05' (monedero electrónico) ni '06'
// (dinero electrónico), pese a que el motor los trata como medios VÁLIDOS
// (`MEDIOS_LISR_27_III`, `MEDIOS_ELECTRONICOS_PEAJE`) y el monedero es el
// pago MÁS común de diésel en flotas mexicanas (RMF 3.3.1.7): un diésel
// pagado con monedero enseñaba "05" crudo en la columna "Forma de pago" del
// detalle de liquidación (detalle.tsx:379), al lado de filas con 'Efectivo' y
// 'Transferencia' bien traducidas.
//
// La prueba no fija una lista a mano: LEE del motor qué claves admite y exige
// que todas tengan rótulo — si el motor admite un medio nuevo, esta prueba
// falla antes de que el contralor vea el código crudo.
// ═══════════════════════════════════════════════════════════════════════════

describe('etiquetaFormaPago — la columna que sustenta la deducibilidad', () => {
  it("los dos casos de la auditoría: '05' y '06' ya no caen al fallback crudo", () => {
    expect(etiquetaFormaPago('05')).toBe('Monedero electrónico');
    expect(etiquetaFormaPago('06')).toBe('Dinero electrónico');
  });

  it('toda clave que el motor admite para combustible (LISR 27-III) tiene rótulo', () => {
    for (const clave of MEDIOS_LISR_27_III) {
      expect(etiquetaFormaPago(clave), `la clave '${clave}' salió cruda`).not.toBe(clave);
    }
  });

  it('toda clave que el motor admite para el estímulo de peaje (RMF 9.1.8 fr. III) tiene rótulo', () => {
    for (const clave of MEDIOS_ELECTRONICOS_PEAJE) {
      expect(etiquetaFormaPago(clave), `la clave '${clave}' salió cruda`).not.toBe(clave);
    }
  });

  it('una clave desconocida se pinta cruda — visible, nunca adivinada', () => {
    // '31' (Intermediario pagos) no está en el catálogo de la vista a
    // propósito: no aparece en comprobantes de viaje. Que se vea el código es
    // el contrato — inventar un rótulo sería mentir en una columna fiscal.
    expect(etiquetaFormaPago('31')).toBe('31');
  });

  it('sin forma de pago se dice con un guion, no con un texto que parezca dato', () => {
    expect(etiquetaFormaPago(undefined)).toBe('—');
    expect(etiquetaFormaPago('')).toBe('—');
  });
});
