/** Datos legales que solo puede proporcionar la entidad operadora. */
export function datoLegal(valorCrudo: string | undefined): string | null {
  const valor = valorCrudo?.trim();
  if (!valor || /\b(?:completar|pendiente|todo|tbd)\b/i.test(valor)) return null;
  return valor;
}

const contactoConfigurado = datoLegal(process.env.LEGAL_CONTACT_EMAIL);
export const LEGAL_CONFIG = {
  razonSocial: datoLegal(process.env.LEGAL_ENTITY_NAME),
  domicilio: datoLegal(process.env.LEGAL_ENTITY_ADDRESS),
  jurisdiccion: datoLegal(process.env.LEGAL_JURISDICTION),
  contacto: contactoConfigurado ?? 'likida.ai@gmail.com',
  contactoConfigurado,
  dpaVersion: datoLegal(process.env.LEGAL_DPA_VERSION),
  slaVersion: datoLegal(process.env.LEGAL_SLA_VERSION),
  seguridadVersion: datoLegal(process.env.LEGAL_SECURITY_ANNEX_VERSION),
  subencargadosVersion: datoLegal(process.env.LEGAL_SUBPROCESSORS_VERSION),
} as const;

export const LEGAL_PLACEHOLDERS = {
  razonSocial: '[COMPLETAR: razón social inscrita de la entidad operadora]',
  domicilio: '[COMPLETAR: domicilio legal/fiscal para notificaciones]',
  jurisdiccion: '[COMPLETAR: entidad federativa y tribunales competentes]',
  contacto: '[COMPLETAR: correo legal o de privacidad bajo control de la entidad]',
  dpa: '[COMPLETAR Y FIRMAR: versión del DPA]',
  sla: '[COMPLETAR Y FIRMAR: versión del SLA]',
  seguridad: '[COMPLETAR Y APROBAR: versión del anexo de seguridad]',
  subencargados: '[COMPLETAR Y APROBAR: versión del anexo de subencargados]',
} as const;

const REQUISITOS: Array<[keyof typeof LEGAL_CONFIG, string]> = [
  ['razonSocial', 'LEGAL_ENTITY_NAME'],
  ['domicilio', 'LEGAL_ENTITY_ADDRESS'],
  ['jurisdiccion', 'LEGAL_JURISDICTION'],
  ['contactoConfigurado', 'LEGAL_CONTACT_EMAIL'],
  ['dpaVersion', 'LEGAL_DPA_VERSION'],
  ['slaVersion', 'LEGAL_SLA_VERSION'],
  ['seguridadVersion', 'LEGAL_SECURITY_ANNEX_VERSION'],
  ['subencargadosVersion', 'LEGAL_SUBPROCESSORS_VERSION'],
];

export function estadoLegalProduccion() {
  const faltantes = REQUISITOS.filter(([campo]) => !LEGAL_CONFIG[campo]).map(([, env]) => env);
  return {
    listo: faltantes.length === 0,
    faltantes,
    bloqueado: faltantes.length > 0,
  };
}

/** Solo bloquea cuando el despliegue lo activa explícitamente. */
export function exigirLegalEnProduccion(): void {
  if (process.env.VERCEL_ENV !== 'production' && process.env.LEGAL_ENFORCE_PRODUCTION !== 'true') return;
  const estado = estadoLegalProduccion();
  if (!estado.listo) {
    throw new Error(`LEGAL_PRODUCTION_BLOCKED: faltan ${estado.faltantes.join(', ')}`);
  }
}
