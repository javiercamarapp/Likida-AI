import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '@/lib/likida/presupuesto';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';

// ═══════════════════════════════════════════════════════════════════════════
// LOS DATOS LEGALES DEL RESPONSABLE, POR FLOTA (auditoría ola 1, #10).
//
// La razón social, el domicilio y el contacto de privacidad (art. 29) de CADA flota
// viven en `tenant` (razon_social, domicilio_fiscal, contacto_privacidad), pero
// nadie podía capturarlos desde el producto: había que tocar la tabla a mano. Y
// mientras faltaban, el chofer se quedaba sin servicio desde su primer mensaje y
// `/aviso/<flota>` daba 404. Ahora el dueño los captura en /dashboard/legal, y
// mientras no estén el aviso sale con el hueco dicho (privacidad.ts,
// `lineaResponsable`) — la ausencia ya no bloquea a nadie.
//
// Capturar o cambiar un dato cambia la versión del aviso (`versionAvisoVigente`) y
// por tanto el chofer recibe el aviso nuevo solo (art. 15 fr. VI).
// ═══════════════════════════════════════════════════════════════════════════

export interface CamposResponsable {
  razonSocial: string | null;
  domicilio: string | null;
  contactoPrivacidad: string | null;
}

export const LIMITES_RESPONSABLE = {
  razonSocial: { min: 3, max: 200 },
  domicilio: { min: 10, max: 400 },
  contactoPrivacidad: { min: 5, max: 200 },
} as const;

const CONTROL = /[\u0000-\u001f\u007f]/;
const EMAIL = /^[^\s@<>()[\]\\,;:]+@[^\s@<>()[\]\\,;:]+\.[^\s@<>()[\]\\,;:]{2,}$/;

/** Una cadena vacía o de espacios es «sin dato» (null): se puede BORRAR un dato. */
function limpio(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
}

export type ResultadoValidacion =
  | { ok: true; valores: CamposResponsable }
  | { ok: false; error: string };

export function validarCamposResponsable(crudo: Partial<Record<keyof CamposResponsable, unknown>>): ResultadoValidacion {
  const valores: CamposResponsable = {
    razonSocial: limpio(crudo.razonSocial),
    domicilio: limpio(crudo.domicilio),
    contactoPrivacidad: limpio(crudo.contactoPrivacidad),
  };
  const rotulo: Record<keyof CamposResponsable, string> = {
    razonSocial: 'La razón social', domicilio: 'El domicilio', contactoPrivacidad: 'El contacto de privacidad',
  };
  for (const campo of ['razonSocial', 'domicilio', 'contactoPrivacidad'] as const) {
    const v = valores[campo];
    if (v === null) continue;
    const { min, max } = LIMITES_RESPONSABLE[campo];
    if (v.length < min || v.length > max) return { ok: false, error: `${rotulo[campo]} debe tener entre ${min} y ${max} caracteres.` };
    if (CONTROL.test(v)) return { ok: false, error: `${rotulo[campo]} trae caracteres no válidos.` };
  }
  const contacto = valores.contactoPrivacidad;
  if (contacto !== null && !EMAIL.test(contacto) && contacto.replace(/\D/g, '').length < 10) {
    return { ok: false, error: 'El contacto de privacidad debe ser un correo o un teléfono de al menos 10 dígitos.' };
  }
  return { ok: true, valores };
}

/** Lo que hay hoy en la flota, para pintar el formulario. LANZA si la lectura falla. */
export async function leerDatosResponsable(tenantId: string): Promise<CamposResponsable> {
  const { data, error } = await acotada(supabaseAdmin().from('tenant')
    .select('razon_social, domicilio_fiscal, contacto_privacidad')
    .eq('id', tenantId).maybeSingle(), 'legal.datos_responsable');
  if (error) throw new Error(`datos_responsable: ${error.message}`);
  if (!data) throw new Error('datos_responsable: la flota no existe');
  return {
    razonSocial: limpio(data.razon_social),
    domicilio: limpio(data.domicilio_fiscal),
    contactoPrivacidad: limpio(data.contacto_privacidad),
  };
}

export type ResultadoGuardado = { ok: true } | { ok: false; error: string };

/**
 * Guarda los tres datos de UNA flota (el `tenantId` viene de la sesión, nunca del
 * formulario) y deja bitácora de QUÉ campos cambiaron (no de sus valores: el
 * domicilio y el contacto son datos de la empresa y la bitácora no los necesita).
 */
export async function guardarDatosResponsable(
  tenantId: string,
  crudo: Partial<Record<keyof CamposResponsable, unknown>>,
  actor: { id: string },
): Promise<ResultadoGuardado> {
  const v = validarCamposResponsable(crudo);
  if (!v.ok) return v;
  const antes = await leerDatosResponsable(tenantId);
  const cambios = (['razonSocial', 'domicilio', 'contactoPrivacidad'] as const).filter((c) => antes[c] !== v.valores[c]);
  if (cambios.length === 0) return { ok: true };

  const { error } = await acotada(supabaseAdmin().from('tenant').update({
    razon_social: v.valores.razonSocial,
    domicilio_fiscal: v.valores.domicilio,
    contacto_privacidad: v.valores.contactoPrivacidad,
  }).eq('id', tenantId), 'legal.guardar_datos_responsable');
  if (error) {
    logger.error('legal.datos_responsable_no_guardados', { tenantId, err: error.message });
    return { ok: false, error: 'No se pudieron guardar los datos. Intenta de nuevo.' };
  }
  await anotarBitacora(
    { tenantId, actor, accion: 'tenant.datos_privacidad', entidad: 'tenant', entidadId: tenantId, detalle: { campos: cambios } },
    { evento: 'legal.bitacora_no_escribio' },
  );
  return { ok: true };
}
