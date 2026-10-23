import { guardarPerfilPatch, actualizarFacilidad15 } from '../repo';
import { guardarDatosFiscalesParciales, REGIMENES } from '@/lib/saas/fiscal';
import { facilidad15Declarada } from './preguntas';

/**
 * Camino de escritura del FORMULARIO de onboarding (A36-R15-02). Antes solo
 * tocaba el perfil y la facilidad del 15 %; el chat además escribía el régimen
 * en el tenant (el que va al CFDI), así que elegir 601 en el formulario tras
 * haber dicho 612 en el chat dejaba el CFDI en 612. Ahora el régimen declarado
 * se sincroniza al tenant por la MISMA función conservadora que usa el chat
 * (`guardarDatosFiscalesParciales`): cambia solo el régimen, no pisa uso CFDI,
 * domicilio ni correo, y no inventa una fila fiscal si el tenant aún no la tiene.
 */
export async function guardarPerfilFormulario(
  tenantId: string,
  patch: Record<string, unknown>,
  userId: string | null,
): Promise<void> {
  await guardarPerfilPatch(tenantId, patch, userId);
  const f15 = facilidad15Declarada(patch);
  if (f15) {
    await actualizarFacilidad15(tenantId, f15.dedicacionExclusivaCarga, f15.regimenElegible, userId);
  }
  const regimen = (patch.regimenSat as { valor?: string } | undefined)?.valor;
  if (regimen && REGIMENES.some((r) => r.clave === regimen)) {
    await guardarDatosFiscalesParciales(tenantId, { regimenFiscal: regimen });
  }
}
