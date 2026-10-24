import { guardarPerfilPatch, actualizarFacilidad15 } from '../repo';
import { guardarDatosFiscalesParciales, REGIMENES } from '@/lib/saas/fiscal';
import { facilidad15Declarada } from './preguntas';
import { DatoInvalido } from '../errores';
import { logger } from '@/lib/logger';

/**
 * A37-S19-08: el perfil YA quedó escrito pero la parte derivada (facilidad del 15 % o
 * régimen del tenant) falló. Es idempotente: volver a guardar la reintenta. Se dice tal
 * cual (no «no se pudo guardar», que mentiría) y el llamador NO debe borrar el documento
 * subido, porque el perfil ya lo referencia.
 */
export class PerfilGuardadoParcial extends DatoInvalido {
  constructor(parte: string) {
    super(`Tus respuestas quedaron guardadas, pero no pude aplicar ${parte}. Vuelve a pulsar Guardar para reintentarlo; si se repite, avísale a Likida.`);
    this.name = 'PerfilGuardadoParcial';
  }
}

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
    try {
      await actualizarFacilidad15(tenantId, f15.dedicacionExclusivaCarga, f15.regimenElegible, userId);
    } catch (e) {
      logger.error('perfil.formulario_parcial', { tenantId, parte: 'facilidad15', err: e instanceof Error ? e.message : String(e) });
      throw new PerfilGuardadoParcial('la facilidad fiscal del 15 %');
    }
  }
  const regimen = (patch.regimenSat as { valor?: string } | undefined)?.valor;
  if (regimen && REGIMENES.some((r) => r.clave === regimen)) {
    try {
      await guardarDatosFiscalesParciales(tenantId, { regimenFiscal: regimen });
    } catch (e) {
      logger.error('perfil.formulario_parcial', { tenantId, parte: 'regimen', err: e instanceof Error ? e.message : String(e) });
      throw new PerfilGuardadoParcial('el régimen fiscal a tus facturas');
    }
  }
}
