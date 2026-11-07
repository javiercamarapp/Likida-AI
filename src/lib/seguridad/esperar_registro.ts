/**
 * Espera acotada de un registro de auditoría justo antes de un `redirect()` (CT-SEG-11).
 *
 * `redirect()` lanza y corta la ejecución: un `void registrar...()` suelto dejaba el INSERT a merced de que el runtime serverless no
 * congelara la función al responder (se perdían filas sin rastro). Los escritores de `registro_acceso` ya cuelgan su promesa de
 * `after()` de Next; esto añade la espera explícita, con tope corto para que un Supabase lento no retrase el rebote.
 *
 * FAIL-CLOSED: esta función NUNCA lanza ni rechaza. Si el registro falla o vence el tope, el llamador sigue y niega el acceso igual.
 */
export const TOPE_REGISTRO_ANTES_DE_REDIRECT_MS = 800;

export async function esperarRegistro(registro: Promise<void> | void): Promise<void> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve(registro).catch(() => {}),
      new Promise<void>((resolver) => { reloj = setTimeout(resolver, TOPE_REGISTRO_ANTES_DE_REDIRECT_MS); }),
    ]);
  } catch {
    // un registro que lanza de forma síncrona tampoco puede abrir la puerta
  } finally {
    if (reloj) clearTimeout(reloj);
  }
}
