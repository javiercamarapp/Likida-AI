import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A36-R15-04 / A36-R01-03: tras un corte de conexión el servidor puede haber
 * guardado igual (la ruta sigue en `start()` aunque el cliente aborte). La
 * pantalla NO puede afirmar «No guardé nada», y el cliente aborta después que
 * el servidor (maxDuration 120 s). `chat.tsx` es Client Component sin render en
 * vitest: se prueba el texto en el fuente (mismo patrón que dedicacion_sin_pasaje).
 */
describe('chat.tsx — mensaje y plazo tras un corte de conexión', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/app/dashboard/onboarding/chat.tsx'), 'utf8');
  it('no afirma «No guardé nada» y pide revisar antes de repetir', () => {
    expect(src).not.toMatch(/No guardé nada/);
    expect(src).toMatch(/No pude confirmar si se guardó/);
  });
  it('el plazo del cliente no es menor que el maxDuration de la ruta (120 s)', () => {
    const m = /AbortSignal\.timeout\(([\d_]+)\)/.exec(src.slice(src.indexOf('fetch(`/api/dashboard/onboarding-chat')));
    expect(m, 'no se encontró el timeout del fetch al chat').not.toBeNull();
    expect(Number((m as RegExpExecArray)[1].replace(/_/g, ''))).toBeGreaterThanOrEqual(120_000);
  });
  it('manda la pregunta que contesta (preguntaId) y se resincroniza con siguienteId', () => {
    expect(src).toMatch(/preguntaId/);
    expect(src).toMatch(/siguienteId/);
  });
});
