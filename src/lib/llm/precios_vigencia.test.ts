import { describe, it, expect } from 'vitest';
import { calcCost } from './openrouter';

// CT-IA-09 (F5): recordatorio con dientes. El precio de `google/gemini-3.8-flash` en PRICES ($0.75 / $3.75 por M) es el de
// introducción y se anunció que se duplica el 1-ene-2027. Una semana después de esa fecha, si la tabla sigue con el precio viejo,
// esta prueba falla y obliga a hacer lo que la nota de PRICES pide: re-verificar contra el catálogo público de OpenRouter y
// actualizar la tabla (o, si el precio NO cambió, dejar constancia moviendo la fecha de abajo con la fecha de verificación).
const FECHA_REVISION = new Date('2027-01-08T00:00:00-06:00');

describe('vigencia de precios de IA', () => {
  it('gemini-3.8-flash: tras el 1-ene-2027 el precio de la tabla debe haberse re-verificado', () => {
    const entrada = calcCost('google/gemini-3.8-flash', 1_000_000, 0);
    const salida = calcCost('google/gemini-3.8-flash', 0, 1_000_000);
    const sigueConElPrecioViejo = Math.abs(entrada - 0.75) < 1e-9 && Math.abs(salida - 3.75) < 1e-9;
    if (Date.now() < FECHA_REVISION.getTime()) {
      expect(sigueConElPrecioViejo).toBe(true); // hoy el precio de la tabla es el vigente: no se toca antes de tiempo
    } else {
      expect(
        sigueConElPrecioViejo,
        'Pasó el 1-ene-2027: re-verifica el precio de google/gemini-3.8-flash en el catálogo de OpenRouter, actualiza PRICES en ' +
        'src/lib/llm/openrouter.ts (y la reserva de models.ts) y, si NO cambió, mueve FECHA_REVISION en esta prueba con la fecha de verificación.',
      ).toBe(false);
    }
  });
});
